// omp 进程池：每个打开的对话一个 RPC 进程，空闲进程按最近使用淘汰。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApprovalMode, OpenSessionOptions, RuntimeInfo, RuntimeMessage } from "@shared/ipc";
import { OmpRpc } from "./omp-rpc";

/** 最多保留的空闲进程数（正在执行的不计入淘汰） */
const MAX_IDLE = 4;

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
}

export class RuntimePool {
	#entries = new Map<string, Entry>();

	constructor(private readonly emit: Emit) {}

	async open(options: OpenSessionOptions): Promise<RuntimeInfo> {
		const ompPath = resolveOmp();
		if (!ompPath) throw new Error("未找到 omp 可执行文件，请确认已安装并在 PATH 中");
		const rpc = new OmpRpc({ ompPath, cwd: options.cwd, approvalMode: options.approvalMode, env: loginEnv() });
		const entry: Entry = { rpc, lastUsed: Date.now(), streaming: false };
		this.#entries.set(rpc.id, entry);

		rpc.on("frame", (frame: Record<string, unknown>) => {
			if (frame.type === "agent_start") entry.streaming = true;
			else if (frame.type === "agent_end") entry.streaming = false;
			this.emit(rpc.id, { kind: "frame", frame });
		});
		rpc.on("stderr", (text: string) => this.emit(rpc.id, { kind: "stderr", text }));
		rpc.on("exit", (code: number | null, signal: string | null) => {
			this.#entries.delete(rpc.id);
			this.emit(rpc.id, { kind: "exit", code, signal });
		});

		try {
			await rpc.ready;
			if (options.sessionFile) {
				const result = await rpc.request<{ cancelled: boolean }>("switch_session", { sessionPath: options.sessionFile });
				if (result?.cancelled) throw new Error("切换会话被取消");
			}
		} catch (error) {
			rpc.dispose();
			this.#entries.delete(rpc.id);
			throw error;
		}
		this.#evict(rpc.id);
		return { runtimeId: rpc.id, cwd: rpc.cwd, pid: rpc.pid };
	}

	get(runtimeId: string): OmpRpc {
		const entry = this.#entries.get(runtimeId);
		if (!entry) throw new Error("会话进程不存在或已退出");
		entry.lastUsed = Date.now();
		return entry.rpc;
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
}
