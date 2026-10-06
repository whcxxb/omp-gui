// omp 进程池：每个打开的对话一个 RPC 进程，空闲进程按最近使用淘汰。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ApprovalMode, HostToolDefinition, HostToolResult, OpenSessionOptions, RuntimeInfo, RuntimeMessage } from "@shared/ipc";
import { OmpRpc } from "./omp-rpc";
import { readSessionHeader, recoverLegacySessionCopy } from "./sessions";

/** 最多保留的空闲进程数（正在执行的不计入淘汰） */
const MAX_IDLE = 4;
const EXECUTION_EVENTS = new Set(["agent_start", "agent_end", "message_start", "message_update", "message_end",
	"tool_execution_start", "tool_execution_update", "tool_execution_end", "auto_retry_start", "auto_retry_end",
	"auto_compaction_start", "auto_compaction_end", "prompt_result"]);

type Emit = (runtimeId: string, message: RuntimeMessage) => void;

let shellEnv: NodeJS.ProcessEnv | null = null;

/** 从 Finder 启动时 PATH 很短，取登录 shell 的环境，保证 omp 及其工具可用。 */
export function loginEnv(): NodeJS.ProcessEnv {
	if (shellEnv) return shellEnv;
	const shell = process.env.SHELL || "/bin/zsh";
	try {
		const out = execFileSync(shell, ["-ilc", "env -0"], { encoding: "utf8", timeout: 5000 });
		const env: NodeJS.ProcessEnv = {};
		for (const pair of out.split("\0")) {
			const eq = pair.indexOf("=");
			if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
		}
		shellEnv = { ...process.env, ...env };
	} catch {
		shellEnv = { ...process.env };
	}
	return shellEnv;
}

export function resolveOmp(): string | null {
	const env = loginEnv();
	for (const dir of (env.PATH ?? "").split(":")) {
		if (dir && existsSync(join(dir, "omp"))) return join(dir, "omp");
	}
	const fallback = join(homedir(), ".local", "bin", "omp");
	return existsSync(fallback) ? fallback : null;
}

export function ompVersion(): string | null {
	const omp = resolveOmp();
	if (!omp) return null;
	try {
		return execFileSync(omp, ["--version"], { encoding: "utf8", env: loginEnv(), timeout: 10000 }).trim();
	} catch {
		return null;
	}
}
export function detectDefaultApprovalMode(): ApprovalMode {
	const omp = resolveOmp();
	if (!omp) return "yolo";
	try {
		const out = execFileSync(omp, ["config", "get", "tools.approvalMode"], {
			encoding: "utf8",
			env: loginEnv(),
			timeout: 5000,
		}).trim();
		if (out === "always-ask" || out === "write" || out === "yolo") return out;
	} catch {
		// 回退 yolo
	}
	return "yolo";
}


interface Entry {
	rpc: OmpRpc;
	lastUsed: number;
	streaming: boolean;
	revision: number;
	submissions: number;
}

/** 宿主工具的执行回调：由主进程实现，结果直接回写给 omp。 */
export type HostToolHandler = (cwd: string, toolName: string, args: Record<string, unknown>) => HostToolResult;

export class RuntimePool {
	#entries = new Map<string, Entry>();
	#sessionOperations = new Map<string, Promise<unknown>>();
	#recoveredSessions = new Map<string, string>();

	constructor(
		private readonly emit: Emit,
		private readonly onAgentEnd?: (cwd: string) => void,
		/** 每次启动进程时注册的宿主工具（模型可调用） */
		private readonly hostTools?: (cwd: string) => HostToolDefinition[],
		private readonly onHostToolCall?: HostToolHandler,
	) {}

	async open(options: OpenSessionOptions): Promise<RuntimeInfo> {
		const ompPath = resolveOmp();
		if (!ompPath) throw new Error("未找到 omp 可执行文件，请确认已安装并在 PATH 中");
		const sessionFile = options.sessionFile ? await this.#sessionPath(options.sessionFile) : undefined;
		const rpc = new OmpRpc({ ompPath, cwd: options.cwd, approvalMode: options.approvalMode, env: loginEnv() });
		const entry: Entry = { rpc, lastUsed: Date.now(), streaming: false, revision: 0, submissions: 0 };
		this.#entries.set(rpc.id, entry);

		rpc.on("frame", (frame: Record<string, unknown>) => {
			// 宿主工具调用由主进程就地执行并回包，不下发渲染进程
			if (frame.type === "host_tool_call") {
				void this.#runHostTool(rpc, frame);
				return;
			}
			if (EXECUTION_EVENTS.has(String(frame.type))) entry.revision++;
			if (frame.type === "agent_start" || frame.type === "auto_compaction_start" || frame.type === "auto_retry_start") entry.streaming = true;
			else if (frame.type === "agent_end") {
				void this.#refreshBusy(entry);
				this.onAgentEnd?.(rpc.cwd);
			}
			if (frame.type === "prompt_result" || frame.type === "auto_compaction_end" || frame.type === "auto_retry_end") void this.#refreshBusy(entry);
			this.emit(rpc.id, { kind: "frame", frame });
		});
		rpc.on("stderr", (text: string) => this.emit(rpc.id, { kind: "stderr", text }));
		rpc.on("exit", (code: number | null, signal: string | null) => {
			this.#entries.delete(rpc.id);
			this.emit(rpc.id, { kind: "exit", code, signal });
		});

		try {
			await rpc.ready;
			if (sessionFile) {
				const result = await rpc.request<{ cancelled: boolean }>("switch_session", { sessionPath: sessionFile });
				if (result?.cancelled) throw new Error("切换会话被取消");
			}
			// 注册必须晚于 switch_session：切换会话会重建会话态
			const tools = this.hostTools?.(options.cwd) ?? [];
			if (tools.length > 0) {
				await rpc.request("set_host_tools", { tools });
			}
			if (options.model) {
				await rpc.request("set_model", { provider: options.model.provider, modelId: options.model.id });
			}
		} catch (error) {
			rpc.dispose();
			this.#entries.delete(rpc.id);
			throw error;
		}
		this.#evict(rpc.id);
		return { runtimeId: rpc.id, cwd: rpc.cwd, pid: rpc.pid };
	}

	async #sessionPath(file: string): Promise<string> {
		const source = resolve(file);
		const existing = this.#recoveredSessions.get(source);
		if (existing && existsSync(existing)) return existing;
		const recovered = await recoverLegacySessionCopy(source);
		if (recovered !== source) this.#recoveredSessions.set(source, recovered);
		return recovered;
	}

	async #withSessionOperation<T>(file: string, action: () => Promise<T>): Promise<T> {
		const key = resolve(file);
		const previous = this.#sessionOperations.get(key);
		const operation = (previous ?? Promise.resolve()).catch(() => undefined).then(action);
		this.#sessionOperations.set(key, operation);
		try { return await operation; }
		finally { if (this.#sessionOperations.get(key) === operation) this.#sessionOperations.delete(key); }
	}

	async #findSessionRuntime(file: string): Promise<OmpRpc | undefined> {
		const target = resolve(this.#recoveredSessions.get(resolve(file)) ?? file);
		for (const entry of this.#entries.values()) {
			const state = await entry.rpc.request<{ sessionFile?: string }>("get_state");
			if (state.sessionFile && resolve(state.sessionFile) === target) return entry.rpc;
		}
		return undefined;
	}

	async #withTemporarySession<T>(file: string, action: (rpc: OmpRpc) => Promise<T>): Promise<T> {
		const source = await this.#sessionPath(file);
		const header = await readSessionHeader(source);
		const ompPath = resolveOmp();
		if (!ompPath) throw new Error("未找到 omp 可执行文件");
		const rpc = new OmpRpc({ ompPath, cwd: header.cwd, env: loginEnv() });
		// Temporary sessions have no renderer consumer, but extension errors still
		// settle their RPC requests. No prompts or background work are started here.
		try {
			await rpc.ready;
			const changed = await rpc.request<{ cancelled: boolean }>("switch_session", { sessionPath: source });
			if (changed.cancelled) throw new Error("切换会话被取消");
			return await action(rpc);
		} finally {
			if (rpc.alive) {
				const exited = new Promise<void>(done => rpc.once("exit", () => done()));
				rpc.dispose();
				await exited;
			}
		}
	}

	async renameSession(file: string, title: string): Promise<boolean> {
		if (!title.trim()) throw new Error("会话名称不能为空");
		await readSessionHeader(file);
		return this.#withSessionOperation(file, async () => {
			const live = await this.#findSessionRuntime(file);
			const rename = async (rpc: OmpRpc): Promise<boolean> => {
				const before = await rpc.request<{ sessionFile?: string }>("get_state");
				await rpc.request("set_session_name", { name: title.trim() });
				const after = await rpc.request<{ sessionFile?: string }>("get_state");
				if (before.sessionFile !== after.sessionFile) {
					throw new Error("会话由另一个 OMP 进程持有，重命名已保存在独立副本，请刷新历史列表");
				}
				return true;
			};
			return live ? rename(live) : this.#withTemporarySession(file, rename);
		});
	}

	async forkSession(options: { cwd: string; sourceSessionFile: string; targetEntryId: string }): Promise<string> {
		if (!options.targetEntryId) throw new Error("缺少分支目标消息");
		await readSessionHeader(options.sourceSessionFile);
		return this.#withSessionOperation(options.sourceSessionFile, async () => {
			const live = await this.#findSessionRuntime(options.sourceSessionFile);
			if (live) {
				const state = await live.request<{ isSettled?: boolean }>("get_state");
				if (state.isSettled !== true) throw new Error("请等待当前对话结束后再创建分支");
			}
			return this.#withTemporarySession(options.sourceSessionFile, async rpc => {
				const before = await rpc.request<{ sessionFile?: string }>("get_state");
				const result = await rpc.request<{ cancelled: boolean }>("fork", { entryId: options.targetEntryId });
				if (result.cancelled) throw new Error("创建分支被取消");
				const after = await rpc.request<{ sessionFile?: string }>("get_state");
				if (!after.sessionFile || after.sessionFile === before.sessionFile) throw new Error("OMP 未返回新的分支会话");
				return after.sessionFile;
			});
		});
	}

	get(runtimeId: string): OmpRpc {
		const entry = this.#entries.get(runtimeId);
		if (!entry) throw new Error("会话进程不存在或已退出");
		entry.lastUsed = Date.now();
		return entry.rpc;
	}

	async request(runtimeId: string, type: string, payload: Record<string, unknown>): Promise<unknown> {
		const rpc = this.get(runtimeId);
		const entry = this.#entries.get(runtimeId)!;
		const submits = ["prompt", "steer", "follow_up", "abort_and_prompt"].includes(type);
		if (submits) {
			entry.revision++;
			entry.submissions++;
			entry.streaming = true;
		}
		try {
			return await rpc.request(type, payload);
		} finally {
			if (submits) {
				entry.submissions--;
				void this.#refreshBusy(entry);
			}
		}
	}

	async #refreshBusy(entry: Entry): Promise<void> {
		const revision = entry.revision;
		try {
			const state = await entry.rpc.request<{ isSettled?: boolean }>("get_state");
			if (this.#entries.get(entry.rpc.id) !== entry || revision !== entry.revision || entry.submissions > 0) return;
			// 缺失终态信息或通信失败时保守保留，避免回收仍在执行的进程。
			entry.streaming = state.isSettled !== true;
		} catch {
			// 状态未知不能证明进程空闲。
		}
	}

	close(runtimeId: string): void {
		this.#entries.get(runtimeId)?.rpc.dispose();
		this.#entries.delete(runtimeId);
	}

	disposeAll(): void {
		for (const entry of this.#entries.values()) entry.rpc.dispose();
		this.#entries.clear();
	}

	#evict(keep: string): void {
		const idle = [...this.#entries.entries()]
			.filter(([id, e]) => id !== keep && !e.streaming)
			.sort((a, b) => b[1].lastUsed - a[1].lastUsed);
		for (const [id] of idle.slice(MAX_IDLE)) {
			this.close(id);
			this.emit(id, { kind: "exit", code: null, signal: "evicted" });
		}
	}

	/** 执行模型发起的宿主工具调用，并把结果回写给 omp。 */
	async #runHostTool(rpc: OmpRpc, frame: Record<string, unknown>): Promise<void> {
		const id = String(frame.id);
		const toolName = String(frame.toolName);
		const args = (frame.arguments ?? {}) as Record<string, unknown>;
		let result: HostToolResult;
		try {
			if (!this.onHostToolCall) throw new Error(`未注册宿主工具处理器：${toolName}`);
			result = this.onHostToolCall(rpc.cwd, toolName, args);
		} catch (error) {
			result = {
				content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
				isError: true,
			};
		}
		try {
			await rpc.send({ type: "host_tool_result", id, result, isError: result.isError === true });
		} catch (error) {
			this.emit(rpc.id, { kind: "frame", frame: { type: "notice", level: "error", message: `工具结果未送达：${error instanceof Error ? error.message : String(error)}` } });
		}
	}
}
