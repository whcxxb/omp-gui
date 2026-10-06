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

async function refreshState(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	try {
		const state = await window.omp.request<SessionStateSnapshot>(thread.runtimeId, { type: "get_state" });
		update(key, t => ({
			state,
			sessionFile: state.sessionFile ?? t.sessionFile,
		}));
	} catch {
		// 进程退出时忽略
	}
}

async function loadEntries(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	const data = await window.omp.request<{ entries: SessionEntry[]; leafId: string | null }>(thread.runtimeId, {
		type: "get_entries",
	});
	const branch = currentBranch(data.entries, data.leafId);
	update(key, () => ({ entries: branch }));
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
		if (Array.isArray(data?.subagents)) {
			update(key, () => ({ subagents: data.subagents }));
		}
	} catch {
		// 忽略初始化失败
	}
}



/** 为线程启动（或重启）omp 进程。 */
async function attach(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread) return;
	update(key, () => ({ status: "starting", error: undefined }));
	try {
		const info = await window.omp.openSession({
			cwd: thread.cwd,
			sessionFile: thread.sessionFile,
			approvalMode: thread.approvalMode,
			model: thread.modelOverride,
		});
		update(key, () => ({ runtimeId: info.runtimeId, status: "ready" }));
		await Promise.all([
			refreshState(key),
			thread.sessionFile ? loadEntries(key) : Promise.resolve(),
			initSubagents(key),
		]);
		// 待办「开始工作」：进程与模型都就绪后自动发出首条消息
		const pending = getThread(key)?.pendingPrompt;
		if (pending) {
			update(key, () => ({ pendingPrompt: undefined }));
			void sendPrompt(key, pending.message, pending.images);
		}
	} catch (error) {
		update(key, () => ({ status: "error", error: error instanceof Error ? error.message : String(error) }));
	} finally {
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
		if (existing.status === "exited" || existing.status === "error") void attach(existing.key);
		return existing.key;
	}
	const thread = blankThread(cwd, sessionFile);
	threads.push(thread);
	commit();
	void attach(thread.key);
	return thread.key;
}
export function reconnect(key: string): void {
	void attach(key);
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
		const newFile = await window.omp.forkSession({
			cwd: source.cwd,
			sourceSessionFile: sourceFile,
			targetEntryId,
		});
		playSound("switch");
		const newThreadKey = openThread(source.cwd, newFile);
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("omp:select-thread", { detail: { key: newThreadKey } }));
		}
		return newThreadKey;
	} catch (err) {
		console.error("Fork thread failed:", err);
		return null;
	}
}
export async function closeThread(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread) return;
	threads = threads.filter(t => t.key !== key);
	commit();
	threadReady.get(key)?.resolve();
	threadReady.delete(key);
	if (thread.runtimeId) await window.omp.closeRuntime(thread.runtimeId);
}

/** 发送提示；执行中时作为排队的后续消息。首次发送时自动调用模型总结简短标题。 */
export async function sendPrompt(key: string, message: string, images?: ImageContent[]): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	if (thread.status !== "ready") return;

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
	if (thread.working) command.streamingBehavior = "followUp";
	try {
		await window.omp.request(thread.runtimeId, command);
		// 第一次发送消息后自动使用模型进行简短总结，并持久化为会话标题
		if (isFirstUserPrompt && message.trim()) {
			void (async () => {
				try {
					const title = await window.omp.generateTitle(message);
					if (title) {
						const current = getThread(key);
						if (current?.runtimeId) {
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
	} catch (error) {
		update(key, t => pushNotice(t, "error", error instanceof Error ? error.message : String(error)));
	}
}
export async function editAndResendPrompt(key: string, targetEntryId?: string, newMessage?: string): Promise<void> {
	const thread = getThread(key);
	if (!thread || !newMessage?.trim()) return;

	if (thread.working) {
		await abort(key);
	}

	if (targetEntryId && thread.entries.length > 0) {
		const idx = thread.entries.findIndex(e => e.id === targetEntryId);
		if (idx !== -1) {
			const prevEntries = thread.entries.slice(0, idx);
			const prevMessage = prevEntries.findLast(e => e.type === "message" || Boolean(e.id));
			if (prevMessage && thread.runtimeId) {
				await window.omp.request(thread.runtimeId, { type: "branch", entryId: prevMessage.id }).catch(() => undefined);
			} else if (prevEntries.length === 0 && thread.runtimeId) {
				await window.omp.request(thread.runtimeId, { type: "new_session" }).catch(() => undefined);
			}
			update(key, () => ({ entries: prevEntries }));
		}
	}

	await sendPrompt(key, newMessage.trim());
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

export async function steerQueuedPrompt(key: string, id: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	const target = thread.queuedPrompts.find(q => q.id === id);
	if (!target) return;
	update(key, t => ({ queuedPrompts: t.queuedPrompts.filter(q => q.id !== id) }));
	playSound("request");
	const command: Frame = {
		type: "prompt",
		message: target.message,
		streamingBehavior: "steer",
	};
	if (target.images && target.images.length > 0) command.images = target.images;
	try {
		await window.omp.request(thread.runtimeId, command);
		update(key, t => pushNotice(t, "info", "已向当前对话任务注入修改干预"));
	} catch (error) {
		update(key, t => pushNotice(t, "error", error instanceof Error ? error.message : String(error)));
	}
}

export function removeQueuedPrompt(key: string, id: string): QueuedPrompt | undefined {
	const thread = getThread(key);
	if (!thread) return undefined;
	const target = thread.queuedPrompts.find(q => q.id === id);
	update(key, t => ({ queuedPrompts: t.queuedPrompts.filter(q => q.id !== id) }));
	playSound("toggle");
	return target;
}

export async function dispatchNextQueuedPrompt(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread || !thread.runtimeId || thread.working || thread.status !== "ready") return;
	if (thread.queuedPrompts.length === 0) return;
	const next = thread.queuedPrompts[0]!;
	update(key, t => ({ queuedPrompts: t.queuedPrompts.slice(1) }));
	void sendPrompt(key, next.message, next.images);
}

export async function renameThread(key: string, newTitle: string): Promise<void> {
	const trimmed = newTitle.trim();
	if (!trimmed) return;

	const thread = getThread(key);
	if (!thread) return;

	update(key, t => ({
		...t,
		state: t.state
			? { ...t.state, sessionName: trimmed }
			: { sessionId: "", sessionName: trimmed, queuedMessageCount: 0, isStreaming: false },
	}));

	if (thread.runtimeId && thread.status === "ready") {
		try {
			await window.omp.request(thread.runtimeId, {
				type: "set_session_name",
				name: trimmed,
			});
			void refreshState(key);
		} catch {
			// ignore runtime request error
		}
	}

	const sessionFile = thread.sessionFile ?? thread.state?.sessionFile;
	if (sessionFile) {
		try {
			await window.omp.renameSession(sessionFile, trimmed);
		} catch (err) {
			console.error("Failed to rename session file on disk:", err);
		}
	}
}

export async function abort(key: string): Promise<void> {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	await window.omp.request(thread.runtimeId, { type: "abort" }).catch(() => undefined);
}

export async function runCommand<T>(key: string, command: Frame): Promise<T> {
	const thread = getThread(key);
	if (!thread?.runtimeId) throw new Error("会话未连接");
	const result = await window.omp.request<T>(thread.runtimeId, command);
	void refreshState(key);
	return result;
}

export function answerUiRequest(key: string, id: string, response: Frame): void {
	const thread = getThread(key);
	if (!thread?.runtimeId) return;
	void window.omp.send(thread.runtimeId, { type: "extension_ui_response", id, ...response });
	update(key, t => ({ uiRequests: t.uiRequests.filter(r => r.id !== id) }));
}

function applyFrame(thread: Thread, frame: Frame): Partial<Thread> | null {
	switch (frame.type) {
		case "agent_start":
			return { working: true, updatedAt: Date.now() };
		case "agent_end":
			void refreshState(thread.key);
			playSound("complete");
			if (typeof window !== "undefined") {
				window.dispatchEvent(new CustomEvent("omp:workspace-changed", { detail: { cwd: thread.cwd } }));
			}
			setTimeout(() => {
				void dispatchNextQueuedPrompt(thread.key);
			}, 120);
			return { working: false, activeTools: new Map(), updatedAt: Date.now() };
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
			return pushNotice(thread, "info", `正在重试（${frame.attempt}/${frame.maxAttempts}）：${frame.errorMessage}`);
		case "auto_retry_end":
			return frame.success ? null : pushNotice(thread, "error", String(frame.finalError ?? "重试失败"));
		case "auto_compaction_start":
			return pushNotice(thread, "info", "正在压缩上下文");
		case "auto_compaction_end":
			void loadEntries(thread.key).catch(() => undefined);
			return null;
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
			return frame.success === false ? pushNotice(thread, "error", String(frame.error ?? "命令失败")) : null;
		case "prompt_result": {
			// omp >= 18.3.2：提示词终态帧，仅在出错时提示
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
			const patch = applyFrame(thread, message.frame);
			if (patch) update(thread.key, () => patch);
			return;
		}
		case "exit":
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
	if (!thread || thread.approvalMode === mode) return;
	const sessionFile = thread.sessionFile ?? thread.state?.sessionFile;
	update(key, () => ({ approvalMode: mode, sessionFile }));
	if (thread.runtimeId) {
		const oldId = thread.runtimeId;
		update(key, () => ({ runtimeId: null, status: "starting" }));
		try {
			await window.omp.closeRuntime(oldId);
		} catch {
			// 忽略关闭异常
		}
	}
	void attach(key);
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
