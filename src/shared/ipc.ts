// 主进程与渲染进程共享的 IPC 数据结构。

export interface SessionSummary {
	/** 会话文件绝对路径 */
	file: string;
	id: string;
	title: string | null;
	cwd: string;
	/** 会话创建时间（毫秒） */
	createdAt: number;
	/** 文件最后修改时间（毫秒） */
	updatedAt: number;
}

export interface ProjectSummary {
	/** 项目绝对路径 */
	path: string;
	name: string;
	/** 路径已不存在 */
	missing: boolean;
	/** 按更新时间倒序 */
	sessions: SessionSummary[];
	updatedAt: number;
}

export interface RuntimeInfo {
	runtimeId: string;
	cwd: string;
	pid: number | undefined;
}

export interface OpenSessionOptions {
	cwd: string;
	/** 恢复已有会话；不传则新建 */
	sessionFile?: string;
}

/** 主进程推送到渲染进程的运行时消息 */
export type RuntimeMessage =
	| { kind: "frame"; frame: Record<string, unknown> }
	| { kind: "stderr"; text: string }
	| { kind: "exit"; code: number | null; signal: string | null };

export interface OmpApi {
	listProjects(): Promise<ProjectSummary[]>;
	pickProject(): Promise<string | null>;
	removeProject(path: string): Promise<void>;
	openSession(options: OpenSessionOptions): Promise<RuntimeInfo>;
	closeRuntime(runtimeId: string): Promise<void>;
	request<T = unknown>(runtimeId: string, command: Record<string, unknown>): Promise<T>;
	send(runtimeId: string, frame: Record<string, unknown>): Promise<void>;
	ompVersion(): Promise<string | null>;
	revealPath(path: string): Promise<void>;
	onRuntime(listener: (runtimeId: string, message: RuntimeMessage) => void): () => void;
	onProjectsChanged(listener: () => void): () => void;
}
