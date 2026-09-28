// 主进程与渲染进程共享的 IPC 数据结构。

export type ApprovalMode = "yolo" | "write" | "always-ask";

/** 界面配色主题；明暗仍跟随系统 */
export type Theme = "default" | "claude";

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
export interface FileItem {
	name: string;
	path: string; // 相对 cwd 的路径，如 "src/main/index.ts"
	isDirectory: boolean;
	size?: number;
	mtimeMs?: number;
	extension?: string;
}

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "copied";

export interface GitChangedFile {
	path: string;
	oldPath?: string;
	stagedStatus: string;
	worktreeStatus: string;
	displayStatus: GitFileStatus;
	staged: boolean;
}

export interface GitStatusResult {
	isGitRepo: boolean;
	branch?: string;
	upstream?: string;
	ahead: number;
	behind: number;
	stagedFiles: GitChangedFile[];
	unstagedFiles: GitChangedFile[];
	untrackedFiles: GitChangedFile[];
	totalChanges: number;
}

export interface GitDiffOptions {
	cwd: string;
	file: string;
	staged?: boolean;
}

export interface SkillItem {
	name: string;
	description: string;
	scope: "project" | "global";
	path: string;
	dir: string;
}

export interface RegistrySkillHit {
	name: string;
	scope?: string;
	version?: string;
	description?: string;
	weeklyDownloads?: number;
	updatedAt?: number;
	publisher?: { username: string };
	keywords?: string[];
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
	/** 工具审批模式；默认从用户全局配置中读取 */
	approvalMode?: ApprovalMode;
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
	deleteSession(file: string): Promise<boolean>;
	openSession(options: OpenSessionOptions): Promise<RuntimeInfo>;
	closeRuntime(runtimeId: string): Promise<void>;
	request<T = unknown>(runtimeId: string, command: Record<string, unknown>): Promise<T>;
	send(runtimeId: string, frame: Record<string, unknown>): Promise<void>;
	ompVersion(): Promise<string | null>;
	defaultApprovalMode(): Promise<ApprovalMode>;
	setDefaultApprovalMode(mode: ApprovalMode): Promise<void>;
	getOmpConfigs(): Promise<Record<string, unknown>>;
	setOmpConfig(key: string, value: string): Promise<boolean>;
	/** 同步主题到主进程，用于窗口底色 */
	setTheme(theme: Theme): Promise<void>;
	revealPath(path: string): Promise<void>;
	getPathForFile(file: File): string;
	listDir(cwd: string, relativePath?: string): Promise<FileItem[]>;
	gitStatus(cwd: string): Promise<GitStatusResult>;
	gitDiff(options: GitDiffOptions): Promise<string>;
	openInEditor(cwd: string, file: string): Promise<boolean>;
	listSkills(cwd?: string): Promise<SkillItem[]>;
	createSkill(options: { name: string; description: string; scope: "project" | "global"; cwd?: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
	deleteSkill(path: string): Promise<boolean>;
	readSkill(path: string): Promise<string>;
	saveSkill(path: string, content: string): Promise<boolean>;
	searchRegistrySkills(query: string): Promise<RegistrySkillHit[]>;
	installRegistrySkill(name: string, isGlobal?: boolean, cwd?: string): Promise<{ ok: boolean; message: string }>;
	onRuntime(listener: (runtimeId: string, message: RuntimeMessage) => void): () => void;
	onProjectsChanged(listener: () => void): () => void;
}
