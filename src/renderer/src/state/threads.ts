// 对话线程状态：把 omp RPC 事件归并成可渲染的会话数据。
import { useSyncExternalStore } from "react";
import type { ModelRef, RuntimeMessage, TodoItem } from "@shared/ipc";
import type { ActiveTool } from "@/collab/lib/client";
import type { AssistantMessage, ImageContent, SessionEntry, WireMessage } from "@/collab/wire/index";
import type {
	ApprovalMode,
	ExecutionMode,
	Notice,
	QueuedPrompt,
	QueuedPromptAttachment,
	RightPanelTab,
	SessionStateSnapshot,
	SubagentProgress,
	SubagentSnapshot,
	Thread,
	UiRequest,
} from "./types";
import { playSound } from "@/lib/sound";

const MAX_NOTICES = 20;
const SILENCE_CHECK_MS = 30_000;
const EXECUTION_EVENTS = new Set(["agent_start", "agent_end", "message_start", "message_update", "message_end",
	"tool_execution_start", "tool_execution_update", "tool_execution_end", "auto_retry_start", "auto_retry_end",
	"auto_compaction_start", "auto_compaction_end", "prompt_result"]);
const runtimeRevisions = new Map<string, number>();
const submittingPrompts = new Map<string, number>();
const attaching = new Set<string>();
const exclusiveOperations = new Set<string>();
const sendingQueues = new Set<string>();
const stateChecks = new Map<string, { promise: Promise<void>; recheck: boolean }>();
let healthTimer: ReturnType<typeof setInterval> | undefined;

type Frame = Record<string, unknown>;

let threads: Thread[] = [];
const listeners = new Set<() => void>();
/** 等待线程首次 attach 完成（成功或失败）的等待者 */
const threadReady = new Map<string, { promise: Promise<void>; resolve: () => void }>();
let entrySeq = 0;
let noticeSeq = 0;
let defaultApprovalMode: ApprovalMode = "yolo";
if (typeof window !== "undefined" && window.omp?.defaultApprovalMode) {
	window.omp.defaultApprovalMode().then(mode => {
		defaultApprovalMode = mode;
	}).catch(() => undefined);
}


function commit(): void {
	threads = [...threads];
	for (const listener of listeners) listener();
}

function update(key: string, patch: (thread: Thread) => Partial<Thread>): void {
	const index = threads.findIndex(t => t.key === key);
	if (index === -1) return;
	const current = threads[index]!;
	threads[index] = { ...current, ...patch(current) };
	commit();
}

function byRuntime(runtimeId: string): Thread | undefined {
	return threads.find(t => t.runtimeId === runtimeId);
}

export function getThread(key: string): Thread | undefined {
	return threads.find(t => t.key === key);
}

export function findThreadByFile(file: string): Thread | undefined {
	return threads.find(t => t.sessionFile === file);
}

export function useThreads(): Thread[] {
	return useSyncExternalStore(
		listener => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => threads,
	);
}

function pushNotice(thread: Thread, level: Notice["level"], message: string): Partial<Thread> {
	const notices = [...thread.notices, { id: ++noticeSeq, level, message }];
	return { notices: notices.slice(-MAX_NOTICES) };
}

export function dismissNotice(key: string, id: number): void {
	update(key, t => ({ notices: t.notices.filter(n => n.id !== id) }));
}

/** 从 get_entries 的结果中取出当前分支（leaf 回溯到根）。 */
function currentBranch(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
	if (!leafId) return entries;
	const byId = new Map(entries.map(e => [e.id, e]));
	const branch: SessionEntry[] = [];
	let cursor = byId.get(leafId);
	while (cursor) {
		branch.push(cursor);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	return branch.reverse();
}

function messageEntry(message: WireMessage, parent: SessionEntry | undefined): SessionEntry {
	return {
		type: "message",
		id: `live-${++entrySeq}`,
		parentId: parent?.id ?? null,
		timestamp: new Date(message.timestamp ?? Date.now()).toISOString(),
		message,
	};
}

/** OMP 18.6 的 isSettled 同时考虑压缩、队列、异步工作与计划中的继续执行。 */
function isSettled(state: SessionStateSnapshot): boolean {
	if (typeof state.isSettled === "boolean") return state.isSettled;
	// 旧版未提供 isSettled 时，仅在异步工作信息完整时才纠正结束状态。
	return state.hasPendingAsyncWork === false && !state.isStreaming && !state.isCompacting && state.queuedMessageCount === 0;
}

function monitorRuntimes(): void {
	if (healthTimer) return;
	healthTimer = setInterval(() => {
		for (const thread of threads) {
			if (thread.status !== "ready" || !thread.runtimeId) continue;
			if ((thread.working || thread.stream || thread.activeTools.size || thread.pendingApprovalMode || (thread.queuedPrompts.length && !thread.queuePaused && !thread.queuedPrompts[0]?.delivery)) &&
				Date.now() - (thread.lastEventAt ?? thread.updatedAt) >= SILENCE_CHECK_MS) {
				void refreshState(thread.key);
			}
		}
	}, 15_000);
}

async function refreshState(key: string): Promise<void> {
	const thread = getThread(key);
	const runtimeId = thread?.runtimeId;
	if (!runtimeId) return;
	const existing = stateChecks.get(runtimeId);
	if (existing) {
		existing.recheck = true;
		return existing.promise;
	}
	const revision = runtimeRevisions.get(runtimeId) ?? 0;
	const check = { promise: Promise.resolve(), recheck: false };
	check.promise = (async () => {
		try {
			const state = await window.omp.request<SessionStateSnapshot>(runtimeId, { type: "get_state" });
			let current = getThread(key);
			if (current?.runtimeId !== runtimeId || (runtimeRevisions.get(runtimeId) ?? 0) !== revision) return;
			const settled = isSettled(state) && !submittingPrompts.get(runtimeId);
			if (settled && (current.working || current.stream || current.activeTools.size)) {
				// 先恢复持久化消息，避免清掉尚未归并的最终回答；期间的新事件使快照失效。
				await loadEntries(key);
				current = getThread(key);
				if (current?.runtimeId !== runtimeId || (runtimeRevisions.get(runtimeId) ?? 0) !== revision || submittingPrompts.get(runtimeId)) return;
			}
			update(key, t => ({
				state,
				sessionFile: state.sessionFile ?? t.sessionFile,
				connectionError: undefined,
				...(settled ? { working: false, stream: null, streamDone: false, activeTools: new Map(), uiRequests: [], activity: undefined }
					: state.isStreaming || state.isCompacting || state.hasPendingAsyncWork || state.queuedMessageCount > 0 || state.isSettled === false
						? { working: true, activity: state.isCompacting ? "compacting" as const : t.activity }
						: {}),
			}));
			if (settled && !exclusiveOperations.has(key)) {
				if (getThread(key)?.pendingApprovalMode) await applyPendingApprovalMode(key);
				else void dispatchNextQueuedPrompt(key);
			}
		} catch (error) {
			if (getThread(key)?.runtimeId !== runtimeId) return;
			update(key, () => ({ connectionError: `无法确认 OMP 状态：${error instanceof Error ? error.message : String(error)}。当前任务可能仍在运行。` }));
		} finally {
			stateChecks.delete(runtimeId);
			if (check.recheck && getThread(key)?.runtimeId === runtimeId) {
				setTimeout(() => void refreshState(key), 100);
			}
		}
	})();
	stateChecks.set(runtimeId, check);
	return check.promise;
}

export async function checkThreadConnection(key: string): Promise<void> {
	await refreshState(key);
}

async function loadEntries(key: string): Promise<boolean> {
	const thread = getThread(key);
	const runtimeId = thread?.runtimeId;
	if (!runtimeId) return false;
	const revision = runtimeRevisions.get(runtimeId) ?? 0;
	const data = await window.omp.request<{ entries: SessionEntry[]; leafId: string | null }>(runtimeId, {
		type: "get_entries",
	});
	if (getThread(key)?.runtimeId !== runtimeId || (runtimeRevisions.get(runtimeId) ?? 0) !== revision) return false;
	update(key, () => ({ entries: currentBranch(data.entries, data.leafId) }));
	return true;
}
async function initSubagents(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	try {
		await window.omp.request(thread.runtimeId, {
			type: "set_subagent_subscription",
			level: "events",
		});
		const data = await window.omp.request<{ subagents: SubagentSnapshot[] }>(thread.runtimeId, {
			type: "get_subagents",
		});
		if (getThread(key)?.runtimeId === thread.runtimeId && Array.isArray(data?.subagents)) {
			update(key, () => ({ subagents: data.subagents }));
		}
	} catch {
		// 忽略初始化失败
	}
}



/** 为线程启动（或重启）omp 进程。 */
async function attach(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread || attaching.has(key)) return;
	attaching.add(key);
	monitorRuntimes();
	update(key, () => ({ status: "starting", error: undefined, runtimeId: null, working: false, stream: null,
		streamDone: false, activeTools: new Map(), uiRequests: [], state: null, activity: undefined, connectionError: undefined }));
	try {
		const info = await window.omp.openSession({
			cwd: thread.cwd,
			sessionFile: thread.sessionFile,
			approvalMode: thread.approvalMode,
			model: thread.modelOverride,
		});
		if (!getThread(key)) {
			await window.omp.closeRuntime(info.runtimeId);
			return;
		}
		update(key, () => ({ runtimeId: info.runtimeId, lastEventAt: Date.now() }));
		await Promise.all([
			refreshState(key),
			thread.sessionFile ? loadEntries(key) : Promise.resolve(),
			initSubagents(key),
		]);
		if (getThread(key)?.runtimeId !== info.runtimeId) return;
		update(key, () => ({ status: "ready" }));
		// 待办「开始工作」：进程与模型都就绪后自动发出首条消息
		const pending = getThread(key)?.pendingPrompt;
		if (pending) {
			update(key, () => ({ pendingPrompt: undefined }));
			void sendPrompt(key, pending.message, pending.images);
		}
	} catch (error) {
		update(key, () => ({ status: "error", error: error instanceof Error ? error.message : String(error) }));
	} finally {
		attaching.delete(key);
		if (getThread(key)?.status === "ready") void refreshState(key);
		threadReady.get(key)?.resolve();
		threadReady.delete(key);
	}
}

/** 等待线程首次就绪（含失败），供「开始工作」回填 sessionFile。 */
export function whenThreadReady(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread || thread.status === "ready" || thread.status === "error") return Promise.resolve();
	const existing = threadReady.get(key);
	if (existing) return existing.promise;
	const { promise, resolve } = Promise.withResolvers<void>();
	threadReady.set(key, { promise, resolve });
	return promise;
}

function blankThread(
	cwd: string,
	sessionFile?: string,
	approvalMode: ApprovalMode = defaultApprovalMode,
	options?: { model?: ModelRef; pendingPrompt?: PendingPrompt; title?: string },
): Thread {
	const now = Date.now();
	return {
		key: crypto.randomUUID(),
		runtimeId: null,
		cwd,
		sessionFile,
		approvalMode,
		executionMode: "edit",
		status: "starting",
		entries: [],
		stream: null,
		streamDone: false,
		activeTools: new Map(),
		working: false,
		state: null,
		subagents: [],
		activeSubagentId: null,
		isRightPanelOpen: false,
		rightPanelTab: "files",
		isSubagentPanelOpen: false,
		uiRequests: [],
		queuedPrompts: [],
		notices: [],
		modelOverride: options?.model,
		pendingPrompt: options?.pendingPrompt,
		titleOverride: options?.title,
		createdAt: now,
		updatedAt: now,
	};
}

export function createThread(
	cwd: string,
	options?: { model?: ModelRef; pendingPrompt?: PendingPrompt; title?: string },
): string {
	const thread = blankThread(cwd, undefined, defaultApprovalMode, options);
	threads.push(thread);
	commit();
	void attach(thread.key);
	return thread.key;
}

/** 打开历史会话；已打开的直接复用。 */
export function openThread(cwd: string, sessionFile: string): string {
	const existing = findThreadByFile(sessionFile);
	if (existing) {
		if (existing.status === "exited" || existing.status === "error") reconnect(existing.key);
		return existing.key;
	}
	const thread = blankThread(cwd, sessionFile);
	threads.push(thread);
	commit();
	void attach(thread.key);
	return thread.key;
}
export function reconnect(key: string): void {
	const thread = getThread(key);
	if (!thread || thread.status === "ready" || thread.status === "starting" || attaching.has(key)) return;
	void (async () => {
		if (thread.runtimeId) {
			update(key, () => ({ runtimeId: null, status: "starting" }));
			runtimeRevisions.delete(thread.runtimeId);
			await window.omp.closeRuntime(thread.runtimeId).catch(() => undefined);
		}
		await attach(key);
	})();
}

export async function forkThread(key: string, targetEntryId: string): Promise<string | null> {
	const source = getThread(key);
	if (!source) return null;

	let sourceFile = source.sessionFile;
	if (!sourceFile && source.state?.sessionFile) {
		sourceFile = source.state.sessionFile;
	}
	if (!sourceFile) {
		await refreshState(key);
		const refreshed = getThread(key);
		sourceFile = refreshed?.sessionFile ?? refreshed?.state?.sessionFile;
	}
	if (!sourceFile) return null;

	try {
		if (source.working || exclusiveOperations.has(key)) throw new Error("请等待当前任务结束后创建分支");
		const original = source.entries.find(e => e.id === targetEntryId);
		if (!original) throw new Error("目标消息不存在");
		if (!(await loadEntries(key))) throw new Error("无法加载消息记录");
		const current = getThread(key)!;
		const userIndex = source.entries.filter(e => e.type === "message" && e.message.role === "user").findIndex(e => e.id === original.id);
		const target = original.type === "message" && original.message.role === "user" ? persistedTarget(current, original, userIndex)
			: current.entries.find(e => e.id === original.id);
		if (!target) throw new Error("请等待消息记录加载后创建分支");
		const newFile = await window.omp.forkSession({
			cwd: source.cwd,
			sourceSessionFile: sourceFile,
			targetEntryId: target.id,
		});
		playSound("switch");
		const newThreadKey = openThread(source.cwd, newFile);
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("omp:select-thread", { detail: { key: newThreadKey } }));
		}
		return newThreadKey;
	} catch (err) {
		update(key, t => pushNotice(t, "error", `创建分支失败：${err instanceof Error ? err.message : String(err)}`));
		return null;
	}
}
export async function closeThread(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread) return;
	if (thread.runtimeId) runtimeRevisions.delete(thread.runtimeId);
	threads = threads.filter(t => t.key !== key);
	if (threads.length === 0 && healthTimer) {
		clearInterval(healthTimer);
		healthTimer = undefined;
	}
	commit();
	threadReady.get(key)?.resolve();
	threadReady.delete(key);
	if (thread.runtimeId) await window.omp.closeRuntime(thread.runtimeId);
}

/** 发送提示；执行中时作为排队的后续消息。首次发送时自动调用模型总结简短标题。 */
export async function sendPrompt(key: string, message: string, images?: ImageContent[]): Promise<boolean> {
	if (exclusiveOperations.has(key)) return false;
	return submitPrompt(key, message, images);
}

async function submitPrompt(key: string, message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp"): Promise<boolean> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return false;
	if (thread.status !== "ready") return false;

	const isFirstUserPrompt =
		!thread.state?.sessionName &&
		!thread.entries.some(e => e.type === "message" && e.message.role === "user");

	let actualMessage = message;
	if (thread.executionMode === "plan") {
		actualMessage = `[计划模式 / Plan Mode]\n你当前处于只读架构规划模式。请对当前需求进行深入分析、定位涉及的源码与模块，制定详尽的实施步骤方案与任务清单。在此模式下请务必保持只读，禁止调用 edit/write 直接修改或创建文件，待用户确认方案后再切回编辑模式执行。\n\n${message}`;
	} else if (thread.executionMode === "ask") {
		actualMessage = `[问答模式 / Ask Mode]\n你当前处于代码咨询与答疑模式。请针对当前问题进行专业解答或原理分析，无需进行多文件编写修改。\n\n${message}`;
	}

	const command: Frame = { type: "prompt", message: actualMessage };
	if (images && images.length > 0) command.images = images;
	if (streamingBehavior || thread.working) command.streamingBehavior = streamingBehavior ?? "followUp";
	const runtimeId = thread.runtimeId;
	runtimeRevisions.set(runtimeId, (runtimeRevisions.get(runtimeId) ?? 0) + 1);
	submittingPrompts.set(runtimeId, (submittingPrompts.get(runtimeId) ?? 0) + 1);
	update(key, () => ({ working: true, activity: "thinking", lastEventAt: Date.now() }));
	try {
		await window.omp.request(runtimeId, command);
		// 第一次发送消息后自动使用模型进行简短总结，并持久化为会话标题
		if (isFirstUserPrompt && message.trim()) {
			void (async () => {
				try {
					const title = await window.omp.generateTitle(message);
					if (title) {
						const current = getThread(key);
						if (current?.runtimeId === runtimeId && !current.state?.sessionName) {
							await window.omp.request(current.runtimeId, {
								type: "set_session_name",
								name: title,
							});
							update(key, t => ({
								state: t.state
									? { ...t.state, sessionName: title }
									: { sessionId: "", sessionName: title, queuedMessageCount: 0, isStreaming: false },
							}));
							void refreshState(key);
						}
					}
				} catch {
					// 忽略静默标题生成失败
				}
			})();
		} else if (thread.state?.sessionName) {
			void (async () => {
				try {
					const current = getThread(key);
					if (current?.runtimeId && current.state?.sessionName) {
						await window.omp.request(current.runtimeId, {
							type: "set_session_name",
							name: current.state.sessionName,
						});
					}
				} catch {
					// ignore
				}
			})();
		}
		return true;
	} catch (error) {
		if (getThread(key)?.runtimeId === runtimeId) {
			update(key, t => pushNotice(t, "error", error instanceof Error ? error.message : String(error)));
		}
		return false;
	} finally {
		const count = (submittingPrompts.get(runtimeId) ?? 1) - 1;
		if (count > 0) submittingPrompts.set(runtimeId, count);
		else submittingPrompts.delete(runtimeId);
		if (getThread(key)?.runtimeId === runtimeId) void refreshState(key);
	}
}
/** live-* 只用于渲染；操作前以用户消息顺序与内容校验定位持久化 ID。 */
function persistedTarget(thread: Thread, original: SessionEntry, userIndex: number): SessionEntry {
	const target = thread.entries.find(e => e.id === original.id) ??
		thread.entries.filter(e => e.type === "message" && e.message.role === "user")[userIndex];
	if (!target || target.type !== "message" || target.message.role !== "user" || original.type !== "message" ||
		JSON.stringify(target.message.content) !== JSON.stringify(original.message.content) ||
		(target.message.timestamp !== undefined && original.message.timestamp !== undefined && target.message.timestamp !== original.message.timestamp)) {
		throw new Error("无法确认原消息，请等待记录加载后重新编辑");
	}
	return target;
}

export async function editAndResendPrompt(key: string, targetEntryId?: string, newMessage?: string): Promise<boolean> {
	const initial = getThread(key);
	if (!initial?.runtimeId || initial.status !== "ready" || !newMessage?.trim() || exclusiveOperations.has(key) || sendingQueues.has(key)) return false;
	const original = initial.entries.find(e => e.id === targetEntryId);
	if (!original || original.type !== "message" || original.message.role !== "user") return false;
	const userIndex = initial.entries.filter(e => e.type === "message" && e.message.role === "user").findIndex(e => e.id === original.id);
	const runtimeId = initial.runtimeId;
	exclusiveOperations.add(key);
	update(key, () => ({ editing: true }));
	try {
		if (initial.working && !(await abort(key, false))) return false;
		if (getThread(key)?.runtimeId !== runtimeId || !(await loadEntries(key))) throw new Error("会话已变化，请重新编辑");
		const current = getThread(key)!;
		const target = persistedTarget(current, original, userIndex);
		const result = await window.omp.request<{ cancelled?: boolean }>(runtimeId, { type: "branch", entryId: target.id });
		if (result?.cancelled) throw new Error("编辑已取消，原对话未回退");
		if (getThread(key)?.runtimeId !== runtimeId || !(await loadEntries(key))) throw new Error("无法确认回退结果，未重新发送");
		await refreshState(key);
		if (getThread(key)?.runtimeId !== runtimeId || getThread(key)?.working) throw new Error("当前任务尚未结束，未重新发送");
		return await submitPrompt(key, newMessage.trim());
	} catch (error) {
		update(key, t => pushNotice(t, "error", `编辑未完成：${error instanceof Error ? error.message : String(error)}`));
		return false;
	} finally {
		exclusiveOperations.delete(key);
		update(key, () => ({ editing: false }));
		// 编辑失败留给用户处理；不能用排队内容抢占失败的编辑操作。
	}
}

export function enqueuePrompt(
	key: string,
	text: string,
	message: string,
	images?: ImageContent[],
	attachments?: QueuedPromptAttachment[],
): void {
	const thread = getThread(key);
	if (!thread) return;
	const queued: QueuedPrompt = {
		id: crypto.randomUUID(),
		text,
		message,
		images,
		attachments,
		createdAt: Date.now(),
	};
	update(key, t => ({ queuedPrompts: [...t.queuedPrompts, queued] }));
	playSound("send");
}

async function sendQueuedPrompt(key: string, id: string, steer: boolean): Promise<void> {
	const thread = getThread(key);
	const target = thread?.queuedPrompts.find(q => q.id === id);
	if (!thread?.runtimeId || thread.status !== "ready" || !target || target.delivery === "sending" || exclusiveOperations.has(key) || sendingQueues.has(key)) return;
	sendingQueues.add(key);
	update(key, t => ({ queuedPrompts: t.queuedPrompts.map(q => q.id === id ? { ...q, delivery: "sending", error: undefined } : q) }));
	try {
		const accepted = await submitPrompt(key, target.message, target.images, steer ? "steer" : undefined);
		if (accepted) {
			update(key, t => ({ queuedPrompts: t.queuedPrompts.filter(q => q.id !== id) }));
		} else {
			// 超时不证明未接收，保留原文与附件，但绝不自动重发。
			update(key, t => ({ queuePaused: true, queuedPrompts: t.queuedPrompts.map(q => q.id === id
				? { ...q, delivery: "unknown", error: "发送未确认，请核对对话后再决定是否重试" } : q) }));
		}
	} finally {
		sendingQueues.delete(key);
	}
}

export async function steerQueuedPrompt(key: string, id: string): Promise<void> {
	await sendQueuedPrompt(key, id, true);
}

export async function resumeQueuedPrompts(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread || thread.queuedPrompts[0]?.delivery) return;
	update(key, () => ({ queuePaused: false }));
	await refreshState(key);
}

export function removeQueuedPrompt(key: string, id: string): QueuedPrompt | undefined {
	const thread = getThread(key);
	if (!thread) return undefined;
	const target = thread.queuedPrompts.find(q => q.id === id);
	if (target?.delivery === "sending") return undefined;
	update(key, t => ({ queuedPrompts: t.queuedPrompts.filter(q => q.id !== id) }));
	playSound("toggle");
	return target;
}

export async function dispatchNextQueuedPrompt(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId || thread.working || thread.queuePaused || thread.pendingApprovalMode || exclusiveOperations.has(key) ||
		sendingQueues.has(key) || submittingPrompts.get(thread.runtimeId) || thread.status !== "ready") return;
	const next = thread.queuedPrompts[0];
	if (!next || next.delivery) return;
	await sendQueuedPrompt(key, next.id, false);
}

export async function renameThread(key: string, newTitle: string): Promise<void> {
	const trimmed = newTitle.trim();
	const thread = getThread(key);
	if (!thread || !trimmed) return;
	try {
		if (thread.runtimeId && thread.status === "ready") {
			await window.omp.request(thread.runtimeId, { type: "set_session_name", name: trimmed });
			if (getThread(key)?.runtimeId !== thread.runtimeId) return;
			update(key, t => ({ state: t.state ? { ...t.state, sessionName: trimmed } : t.state, titleOverride: trimmed }));
			await refreshState(key);
		} else {
			const file = thread.sessionFile ?? thread.state?.sessionFile;
			if (!file || !(await window.omp.renameSession(file, trimmed))) throw new Error("会话重命名未完成");
			update(key, t => ({ state: t.state ? { ...t.state, sessionName: trimmed } : t.state, titleOverride: trimmed }));
		}
	} catch (error) {
		update(key, t => pushNotice(t, "error", `重命名失败：${error instanceof Error ? error.message : String(error)}`));
	}
}

export async function abort(key: string, pauseQueue = true): Promise<boolean> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return false;
	const runtimeId = thread.runtimeId;
	if (pauseQueue) update(key, () => ({ queuePaused: true }));
	let confirmed = false;
	try {
		await window.omp.request(runtimeId, { type: "abort" });
		confirmed = true;
	} catch (error) {
		if (getThread(key)?.runtimeId === runtimeId) update(key, t => pushNotice(t, "error", `停止未确认：${error instanceof Error ? error.message : String(error)}`));
	}
	if (getThread(key)?.runtimeId === runtimeId) await refreshState(key);
	const current = getThread(key);
	return confirmed && current?.runtimeId === runtimeId && !current.working;
}

export async function runCommand<T>(key: string, command: Frame): Promise<T> {
	const thread = getThread(key);
	if (!thread?.runtimeId) throw new Error("会话未连接");
	const result = await window.omp.request<T>(thread.runtimeId, command);
	void refreshState(key);
	return result;
}

export async function answerUiRequest(key: string, id: string, response: Frame): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	const runtimeId = thread.runtimeId;
	try {
		await window.omp.send(runtimeId, { type: "extension_ui_response", id, ...response });
		if (getThread(key)?.runtimeId === runtimeId) update(key, t => ({ uiRequests: t.uiRequests.filter(r => r.id !== id) }));
	} catch (error) {
		if (getThread(key)?.runtimeId === runtimeId) update(key, t => pushNotice(t, "error", `回复未送达：${error instanceof Error ? error.message : String(error)}`));
	}
}

function applyFrame(thread: Thread, frame: Frame): Partial<Thread> | null {
	switch (frame.type) {
		case "agent_start":
			return { working: true, activity: "thinking", updatedAt: Date.now() };
		case "agent_end":
			void refreshState(thread.key);
			playSound("complete");
			if (typeof window !== "undefined") {
				window.dispatchEvent(new CustomEvent("omp:workspace-changed", { detail: { cwd: thread.cwd } }));
			}
			// agent_end 后还可能压缩、重试或继续执行；由后台的 settled 状态解锁队列。
			return { updatedAt: Date.now() };
		case "message_start":
		case "message_update": {
			const message = frame.message as WireMessage;
			if (message.role !== "assistant") return null;
			return { stream: message as AssistantMessage, streamDone: false };
		}
		case "message_end": {
			const message = frame.message as WireMessage;
			const entries = [...thread.entries, messageEntry(message, thread.entries.at(-1))];
			if (message.role === "assistant") return { entries, stream: null, streamDone: false, updatedAt: Date.now() };
			return { entries, updatedAt: Date.now() };
		}
		case "tool_execution_start": {
			const tool: ActiveTool = {
				toolCallId: String(frame.toolCallId),
				toolName: String(frame.toolName),
				args: frame.args,
				intent: typeof frame.intent === "string" ? frame.intent : undefined,
				startedAt: Date.now(),
			};
			return { activeTools: new Map(thread.activeTools).set(tool.toolCallId, tool) };
		}
		case "tool_execution_update": {
			const id = String(frame.toolCallId);
			const existing = thread.activeTools.get(id);
			const tool: ActiveTool = existing
				? { ...existing, partialResult: frame.partialResult }
				: {
						toolCallId: id,
						toolName: String(frame.toolName),
						args: frame.args,
						partialResult: frame.partialResult,
						startedAt: Date.now(),
					};
			return { activeTools: new Map(thread.activeTools).set(id, tool) };
		}
		case "tool_execution_end": {
			const next = new Map(thread.activeTools);
			next.delete(String(frame.toolCallId));
			if (typeof window !== "undefined") {
				window.dispatchEvent(new CustomEvent("omp:workspace-changed", { detail: { cwd: thread.cwd } }));
			}
			if ((frame.toolName === "retain" || frame.toolName === "memory_retain") && typeof window !== "undefined") {
				const existingTool = thread.activeTools.get(String(frame.toolCallId));
				const rawArgs = existingTool?.args ?? frame.args;
				const rawItems = (rawArgs as { items?: Array<{ content?: string }> } | undefined)?.items;
				const contentList = Array.isArray(rawItems)
					? rawItems.map(it => String(it?.content ?? "").trim()).filter(Boolean)
					: [];
				window.dispatchEvent(
					new CustomEvent("omp:memory-written", {
						detail: {
							cwd: thread.cwd,
							items: contentList,
						},
					}),
				);
			}
			return { activeTools: next };
		}
		case "notice":
			return pushNotice(thread, (frame.level as Notice["level"]) ?? "info", String(frame.message ?? ""));
		case "auto_retry_start":
			return { ...pushNotice(thread, "info", `正在重试（${frame.attempt}/${frame.maxAttempts}）：${frame.errorMessage}`), working: true, activity: "retrying" };
		case "auto_retry_end":
			void refreshState(thread.key);
			return { ...(frame.success ? {} : pushNotice(thread, "error", String(frame.finalError ?? "重试失败"))), activity: "thinking" };
		case "auto_compaction_start":
			return { ...pushNotice(thread, "info", "正在压缩上下文"), working: true, activity: "compacting" };
		case "auto_compaction_end":
			void refreshState(thread.key);
			return { activity: "thinking" };
		case "session_info_update":
		case "config_update":
		case "model_changed":
			void refreshState(thread.key);
			return null;
		case "subagent_lifecycle": {
			const p = frame.payload as Record<string, unknown> | undefined;
			if (!p || typeof p.id !== "string") return null;
			const id = p.id;
			const existingIdx = thread.subagents.findIndex(s => s.id === id);
			const status = (p.status as SubagentSnapshot["status"]) ?? "running";
			const sub: SubagentSnapshot = existingIdx !== -1
				? {
						...thread.subagents[existingIdx]!,
						status,
						description: (p.description as string) || thread.subagents[existingIdx]!.description,
						sessionFile: (p.sessionFile as string) || thread.subagents[existingIdx]!.sessionFile,
						error: (p.error as string) || thread.subagents[existingIdx]!.error,
						lastUpdate: Date.now(),
					}
				: {
						id,
						index: typeof p.index === "number" ? p.index : thread.subagents.length,
						agent: (p.agent as string) || "task",
						agentSource: p.agentSource as string | undefined,
						description: p.description as string | undefined,
						status,
						sessionFile: p.sessionFile as string | undefined,
						lastUpdate: Date.now(),
						error: p.error as string | undefined,
					};
			const next = existingIdx !== -1
				? thread.subagents.map((s, i) => (i === existingIdx ? sub : s))
				: [...thread.subagents, sub];
			const willOpenSubagent = thread.isSubagentPanelOpen || status === "started" || status === "running";
			return {
				subagents: next,
				isSubagentPanelOpen: willOpenSubagent,
				isRightPanelOpen: thread.isRightPanelOpen || status === "started" || status === "running",
				rightPanelTab: (status === "started" || status === "running") ? "subagents" : thread.rightPanelTab,
			};
		}
		case "subagent_progress": {
			const p = frame.payload as Record<string, unknown> | undefined;
			const prog = p?.progress as Record<string, unknown> | undefined;
			if (!prog || typeof prog.id !== "string") return null;
			const id = prog.id;
			const existingIdx = thread.subagents.findIndex(s => s.id === id);
			if (existingIdx === -1) return null;
			const existing = thread.subagents[existingIdx]!;
			const subProg: SubagentProgress = {
				id,
				status: (prog.status as SubagentProgress["status"]) || existing.status,
				task: (prog.task as string) || existing.task,
				description: (prog.description as string) || existing.description,
				currentTool: prog.currentTool as string | undefined,
				currentToolStartMs: typeof prog.currentToolStartMs === "number" ? prog.currentToolStartMs : undefined,
				lastIntent: prog.lastIntent as string | undefined,
				toolCount: typeof prog.toolCount === "number" ? prog.toolCount : 0,
				requests: typeof prog.requests === "number" ? prog.requests : 0,
				tokens: typeof prog.tokens === "number" ? prog.tokens : 0,
				cost: typeof prog.cost === "number" ? prog.cost : 0,
				durationMs: typeof prog.durationMs === "number" ? prog.durationMs : 0,
			};
			const sub: SubagentSnapshot = {
				...existing,
				status: (prog.status as SubagentSnapshot["status"]) || existing.status,
				task: (p?.task as string) || (prog.task as string) || existing.task,
				assignment: (p?.assignment as string) || existing.assignment,
				lastUpdate: Date.now(),
				progress: subProg,
			};
			return {
				subagents: thread.subagents.map((s, i) => (i === existingIdx ? sub : s)),
			};
		}
		case "command_output":
			return pushNotice(thread, "info", String(frame.text ?? ""));
		case "response":
			// 已确认后异步失败的命令
			if (frame.success === false) void refreshState(thread.key);
			return frame.success === false ? pushNotice(thread, "error", String(frame.error ?? "命令失败")) : null;
		case "prompt_result": {
			// 终态属于单个提示词，核对整个会话是否已结束，不能直接清空其他任务。
			void refreshState(thread.key);
			if (frame.status !== "error") return null;
			playSound("error");
			const error = frame.error as { message?: string } | undefined;
			return pushNotice(thread, "error", String(error?.message ?? "请求失败"));
		}
		case "extension_ui_request":
			return applyUiRequest(thread, frame);
		default:
			return null;
	}
}

function applyUiRequest(thread: Thread, frame: Frame): Partial<Thread> | null {
	const id = String(frame.id);
	switch (frame.method) {
		case "select":
		case "confirm":
		case "input":
		case "editor":
			playSound("request");
			return { uiRequests: [...thread.uiRequests, frame as unknown as UiRequest] };
		case "cancel":
			return { uiRequests: thread.uiRequests.filter(r => r.id !== frame.targetId) };
		case "notify":
			return pushNotice(thread, (frame.notifyType as Notice["level"]) ?? "info", String(frame.message ?? ""));
		case "setTitle":
			void refreshState(thread.key);
			return null;
		case "open_url":
			if (typeof frame.url === "string") window.open(frame.url, "_blank");
			return null;
		default:
			// setStatus / setWidget / set_editor_text 暂不展示
			void id;
			return null;
	}
}

export function handleRuntimeMessage(runtimeId: string, message: RuntimeMessage): void {
	const thread = byRuntime(runtimeId);
	if (!thread) return;
	switch (message.kind) {
		case "frame": {
			const executionEvent = EXECUTION_EVENTS.has(String(message.frame.type)) ||
				(message.frame.type === "extension_ui_request" && ["select", "confirm", "input", "editor", "cancel"].includes(String(message.frame.method)));
			if (executionEvent) runtimeRevisions.set(runtimeId, (runtimeRevisions.get(runtimeId) ?? 0) + 1);
			const patch = applyFrame(thread, message.frame);
			update(thread.key, () => ({ ...patch, ...(executionEvent ? { lastEventAt: Date.now(), lastEventType: String(message.frame.type) } : {}) }));
			return;
		}
		case "exit":
			runtimeRevisions.delete(runtimeId);
			update(thread.key, t => ({
				runtimeId: null,
				status: "exited",
				working: false,
				stream: null,
				activeTools: new Map(),
				uiRequests: [],
				error:
					message.signal === "evicted" ? undefined : `omp 进程已退出（${message.code ?? message.signal ?? "未知原因"}）`,
				sessionFile: t.sessionFile ?? t.state?.sessionFile,
			}));
			return;
		case "stderr":
			return;
	}
}

export function setModel(key: string, model: { provider: string; id: string }): Promise<unknown> {
	return runCommand(key, { type: "set_model", provider: model.provider, modelId: model.id });
}

export function setThinkingLevel(key: string, level: string): Promise<unknown> {
	return runCommand(key, { type: "set_thinking_level", level });
}
export function setExecutionMode(key: string, mode: ExecutionMode): void {
	update(key, () => ({ executionMode: mode, updatedAt: Date.now() }));
}

export async function setApprovalMode(key: string, mode: ApprovalMode): Promise<void> {
	const thread = getThread(key);
	if (!thread || thread.status !== "ready") return;
	update(key, () => ({ pendingApprovalMode: mode === thread.approvalMode ? undefined : mode }));
	if (mode === thread.approvalMode) return;
	if (thread.working) update(key, t => pushNotice(t, "info", "审批模式将在当前任务结束后生效"));
	await refreshState(key);
}

async function applyPendingApprovalMode(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId || !thread.pendingApprovalMode || thread.working || exclusiveOperations.has(key) || submittingPrompts.get(thread.runtimeId) || attaching.has(key)) return;
	const oldId = thread.runtimeId;
	update(key, () => ({ approvalMode: thread.pendingApprovalMode!, pendingApprovalMode: undefined,
		sessionFile: thread.sessionFile ?? thread.state?.sessionFile,
		modelOverride: thread.state?.model ? { provider: thread.state.model.provider, id: thread.state.model.id } : thread.modelOverride,
		runtimeId: null, status: "starting", working: false, stream: null, streamDone: false,
		activeTools: new Map(), uiRequests: [], activity: undefined, connectionError: undefined }));
	runtimeRevisions.delete(oldId);
	await window.omp.closeRuntime(oldId).catch(() => undefined);
	await attach(key);
	void dispatchNextQueuedPrompt(key);
}

export function toggleRightPanel(key: string, tab?: RightPanelTab): void {
	update(key, t => {
		if (!t.isRightPanelOpen) {
			return { isRightPanelOpen: true, rightPanelTab: tab ?? t.rightPanelTab, isSubagentPanelOpen: (tab ?? t.rightPanelTab) === "subagents" };
		}
		if (tab && t.rightPanelTab !== tab) {
			return { isRightPanelOpen: true, rightPanelTab: tab, isSubagentPanelOpen: tab === "subagents" };
		}
		return { isRightPanelOpen: false, isSubagentPanelOpen: false };
	});
}

export function setRightPanelOpen(key: string, open: boolean, tab?: RightPanelTab): void {
	update(key, t => ({
		isRightPanelOpen: open,
		rightPanelTab: tab ?? t.rightPanelTab,
		isSubagentPanelOpen: open && (tab ?? t.rightPanelTab) === "subagents",
	}));
}

export function setRightPanelTab(key: string, tab: RightPanelTab): void {
	update(key, () => ({ rightPanelTab: tab, isRightPanelOpen: true, isSubagentPanelOpen: tab === "subagents" }));
}

export function toggleSubagentPanel(key: string): void {
	toggleRightPanel(key, "subagents");
}

export function setSubagentPanelOpen(key: string, open: boolean): void {
	setRightPanelOpen(key, open, "subagents");
}

export function setActiveSubagent(key: string, id: string | null): void {
	update(key, () => ({ activeSubagentId: id }));
}

/**
 * 待办「开始工作」：新建对话，把待办内容作为首条消息发送。
 * 图片附件以 ImageContent 传入，其他附件按路径写入提示词。
 */
export async function startTodoWork(
	todo: TodoItem,
	model?: ModelRef,
): Promise<{ threadKey: string }> {
	const images: ImageContent[] = [];
	const fileRefs: string[] = [];
	for (const att of todo.attachments) {
		if (att.kind === "image") {
			const data = att.blob ? await window.omp.readTodoAttachment(att.blob) : null;
			if (data) images.push({ type: "image", data, mimeType: att.mimeType || "image/png" });
			continue;
		}
		// 有原始绝对路径时优先给绝对路径，模型可直接 read
		fileRefs.push(`- \`${att.path ?? att.name}\``);
	}

	const sections: string[] = [`待办：${todo.title}`];
	if (todo.detail.trim()) sections.push(todo.detail.trim());
	if (todo.phase) sections.push(`[分组]: ${todo.phase}`);
	if (fileRefs.length > 0) sections.push(`[待办附件]:\n${fileRefs.join("\n")}`);

	const message = sections.join("\n\n");
	const threadKey = createThread(todo.cwd, {
		model,
		title: todo.title,
		pendingPrompt: { message, images: images.length > 0 ? images : undefined },
	});
	playSound("switch");
	window.dispatchEvent(new CustomEvent("omp:select-thread", { detail: { key: threadKey } }));

	void (async () => {
		await whenThreadReady(threadKey);
		const thread = getThread(threadKey);
		const sessionFile = thread?.sessionFile ?? thread?.state?.sessionFile;
		await window.omp.recordTodoRun(todo.cwd, todo.id, {
			sessionFile,
			model: model ? { provider: model.provider, id: model.id, name: model.name } : undefined,
			startedAt: Date.now(),
		});
	})();

	return { threadKey };
}

export function setDefaultApprovalMode(mode: ApprovalMode): void {
	defaultApprovalMode = mode;
	void window.omp.setDefaultApprovalMode(mode);
}

export function getDefaultApprovalMode(): ApprovalMode {
	return defaultApprovalMode;
}


/** 待办「开始工作」：新会话就绪后自动发送的首条消息 */
export interface PendingPrompt {
	message: string;
	images?: ImageContent[];
}

export type { SessionStateSnapshot };

if (typeof window !== "undefined") {
	(window as unknown as Record<string, unknown>).__ompThreads = {
		getThreads: () => threads,
		enqueuePrompt,
		steerQueuedPrompt,
		removeQueuedPrompt,
		dispatchNextQueuedPrompt,
	};
}
