// 单个 `omp --mode rpc` 子进程：JSONL 读写、协议 v2 协商、分块重组、请求/响应配对。
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

type Frame = Record<string, unknown>;

interface Pending {
	resolve: (data: unknown) => void;
	reject: (error: Error) => void;
	command: string;
}

interface ChunkBuffer {
	count: number;
	byteLength: number;
	parts: Buffer[];
}

export class RpcError extends Error {
	constructor(
		message: string,
		readonly command: string,
		readonly code?: string,
	) {
		super(message);
	}
}

export interface OmpRpcOptions {
	ompPath: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * 事件：
 * - `frame` (frame)：除 response / ready / rpc_chunk 以外的所有输出帧
 * - `stderr` (text)
 * - `exit` (code, signal)
 */
export class OmpRpc extends EventEmitter {
	readonly id = randomUUID();
	readonly cwd: string;
	#child: ChildProcessWithoutNullStreams;
	#buffer = "";
	#pending = new Map<string, Pending>();
	#chunks = new Map<string, ChunkBuffer>();
	#seq = 0;
	#exited = false;
	readonly ready: Promise<void>;

	constructor(options: OmpRpcOptions) {
		super();
		this.cwd = options.cwd;
		this.#child = spawn(options.ompPath, ["--mode", "rpc", "--cwd", options.cwd], {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.#child.stdout.setEncoding("utf8");
		this.#child.stderr.setEncoding("utf8");

		let onReady!: () => void;
		let onFail!: (error: Error) => void;
		this.ready = new Promise<void>((resolve, reject) => {
			onReady = resolve;
			onFail = reject;
		});
		this.once("ready-frame", (frame: Frame) => {
			const versions = frame.supportedProtocolVersions;
			if (Array.isArray(versions) && versions.includes(2)) {
				this.request("negotiate_protocol", { protocolVersion: 2 }).then(() => onReady(), onFail);
			} else {
				onReady();
			}
		});

		this.#child.stdout.on("data", (text: string) => this.#onData(text));
		this.#child.stderr.on("data", (text: string) => this.emit("stderr", text));
		this.#child.on("error", error => {
			onFail(error);
			this.#finish(null, null, error.message);
		});
		this.#child.on("exit", (code, signal) => {
			onFail(new Error(`omp 进程已退出（code=${code}, signal=${signal}）`));
			this.#finish(code, signal);
		});
	}

	get pid(): number | undefined {
		return this.#child.pid;
	}

	get alive(): boolean {
		return !this.#exited;
	}

	/** 发送命令并等待对应的 response 帧，返回其 data。 */
	request<T = unknown>(type: string, payload: Frame = {}): Promise<T> {
		if (this.#exited) return Promise.reject(new RpcError("omp 进程已退出", type));
		const id = `r${++this.#seq}`;
		return new Promise<T>((resolve, reject) => {
			this.#pending.set(id, { resolve: resolve as (data: unknown) => void, reject, command: type });
			this.#write({ ...payload, id, type });
		});
	}

	/** 发送无需响应的帧（如 extension_ui_response）。 */
	send(frame: Frame): void {
		if (!this.#exited) this.#write(frame);
	}

	dispose(): void {
		if (this.#exited) return;
		this.#child.stdin.end();
		const timer = setTimeout(() => {
			if (!this.#exited) this.#child.kill("SIGTERM");
		}, 1500);
		timer.unref();
		const hard = setTimeout(() => {
			if (!this.#exited) this.#child.kill("SIGKILL");
		}, 5000);
		hard.unref();
	}

	#write(frame: Frame): void {
		this.#child.stdin.write(`${JSON.stringify(frame)}\n`);
	}

	#onData(text: string): void {
		this.#buffer += text;
		let newline = this.#buffer.indexOf("\n");
		while (newline !== -1) {
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line) this.#onLine(line);
			newline = this.#buffer.indexOf("\n");
		}
	}

	#onLine(line: string): void {
		let frame: Frame;
		try {
			frame = JSON.parse(line) as Frame;
		} catch {
			this.emit("stderr", `${line}\n`);
			return;
		}
		if (frame.type === "rpc_chunk") {
			const whole = this.#reassemble(frame);
			if (whole) this.#onLine(whole);
			return;
		}
		this.#dispatch(frame);
	}

	#reassemble(frame: Frame): string | null {
		const chunkId = String(frame.chunkId);
		const index = Number(frame.index);
		const count = Number(frame.count);
		let buf = this.#chunks.get(chunkId);
		if (!buf) {
			buf = { count, byteLength: Number(frame.byteLength), parts: [] };
			this.#chunks.set(chunkId, buf);
		}
		buf.parts[index] = Buffer.from(String(frame.data), "base64");
		if (buf.parts.filter(Boolean).length < buf.count) return null;
		this.#chunks.delete(chunkId);
		return Buffer.concat(buf.parts).toString("utf8");
	}

	#dispatch(frame: Frame): void {
		switch (frame.type) {
			case "ready":
				this.emit("ready-frame", frame);
				return;
			case "response": {
				const id = typeof frame.id === "string" ? frame.id : undefined;
				const pending = id ? this.#pending.get(id) : undefined;
				if (!pending || !id) {
					// 异步失败（如 prompt 已确认后出错）会复用同一 id 再发一次 response
					this.emit("frame", frame);
					return;
				}
				this.#pending.delete(id);
				if (frame.success === true) pending.resolve(frame.data);
				else
					pending.reject(
						new RpcError(
							String(frame.error ?? "未知错误"),
							pending.command,
							typeof frame.code === "string" ? frame.code : undefined,
						),
					);
				return;
			}
			default:
				this.emit("frame", frame);
		}
	}

	#finish(code: number | null, signal: string | null, reason?: string): void {
		if (this.#exited) return;
		this.#exited = true;
		for (const [, pending] of this.#pending) {
			pending.reject(new RpcError(reason ?? "omp 进程已退出", pending.command));
		}
		this.#pending.clear();
		this.emit("exit", code, signal);
	}
}
