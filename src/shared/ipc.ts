// 主进程与渲染进程共享的 IPC 数据结构。

export type ApprovalMode = "yolo" | "write" | "always-ask";

/** 界面配色主题；明暗仍跟随系统 */
export type Theme = "default" | "claude" | "tokyo-night" | "pure-black";

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

/** 全局提示词 / 指令文件标识 */
export type PromptFileId = "AGENTS" | "RULES" | "APPEND_SYSTEM" | "SYSTEM" | "PERSONALITY";

export interface PromptFile {
	id: PromptFileId;
	/** 文件名，如 AGENTS.md */
	name: string;
	/** 绝对路径 */
	path: string;
	/** 作用说明 */
	description: string;
	/** 卡片副标题 */
	hint: string;
	content: string;
	/** 文件是否已存在于磁盘 */
	exists: boolean;
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

export interface GitCommitSummary {
	hash: string;
	shortHash: string;
	author: string;
	relativeDate: string;
	timestamp: number;
	subject: string;
}

export interface GitCommitDetail extends GitCommitSummary {
	body: string;
	files: Array<{
		path: string;
		status: GitFileStatus;
	}>;
}

export interface TerminalOutputEvent {
	id: string;
	data: string;
	isStderr?: boolean;
}

export interface TerminalExitEvent {
	id: string;
	code: number | null;
	signal: string | null;
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
	/** 启动后立即切换到的模型（待办「开始工作」用） */
	model?: ModelRef;
}

export interface ModelRef {
	provider: string;
	id: string;
	name?: string;
}

/** omp 模型目录条目（来自 `omp models --json`） */
export interface CatalogModel {
	provider: string;
	id: string;
	name?: string;
	selector?: string;
	thinking?: string[];
	contextWindow?: number | null;
}

export type TodoStatus = "todo" | "doing" | "done" | "dropped";
export type TodoPriority = "high" | "normal" | "low";

export interface TodoAttachment {
	id: string;
	kind: "image" | "file";
	name: string;
	mimeType: string;
	/** 内容寻址的 sha256；文件本体在 userData/todo-blobs/。纯路径引用的附件没有 blob */
	blob?: string;
	size: number;
	/** 拖拽来源的原始绝对路径，可直接写进提示词让模型读取 */
	path?: string;
}

/** 一次「开始工作」派生出的执行会话 */
export interface TodoRun {
	id: string;
	/** 会话落盘后回填，用于重新打开该执行会话 */
	sessionFile?: string;
	model?: ModelRef;
	startedAt: number;
}

export interface TodoItem {
	id: string;
	/** 所属项目绝对路径，待办按项目隔离 */
	cwd: string;
	/** 分组名（模型规划时按阶段分组） */
	phase: string;
	title: string;
	/** Markdown 正文 */
	detail: string;
	status: TodoStatus;
	priority: TodoPriority;
	order: number;
	attachments: TodoAttachment[];
	runs: TodoRun[];
	/** 人工新增还是模型通过 project_todo 工具写入 */
	source: "user" | "model";
	createdAt: number;
	updatedAt: number;
}

export interface TodoCreateInput {
	cwd: string;
	title: string;
	detail?: string;
	phase?: string;
	priority?: TodoPriority;
	source?: "user" | "model";
}

export interface TodoPatch {
	title?: string;
	detail?: string;
	phase?: string;
	status?: TodoStatus;
	priority?: TodoPriority;
}

export interface TodoAttachmentInput {
	cwd: string;
	todoId: string;
	name: string;
	mimeType: string;
	/** base64（不含 data: 前缀）；与 path 至少提供一个 */
	data?: string;
	path?: string;
}

/** 注册给 omp 的宿主工具定义（RPC `set_host_tools`） */
export interface HostToolDefinition {
	name: string;
	label?: string;
	description: string;
	/** JSON Schema */
	parameters: Record<string, unknown>;
	loadMode?: "essential" | "discoverable";
}

/** 宿主工具执行结果（RPC `host_tool_result`） */
export interface HostToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: unknown;
	isError?: boolean;
}

/** 主进程推送到渲染进程的运行时消息 */
export type RuntimeMessage =
	| { kind: "frame"; frame: Record<string, unknown> }
	| { kind: "stderr"; text: string }
	| { kind: "exit"; code: number | null; signal: string | null };

export interface MemoryItem {
	id: string;
	bankId: string;
	bankName: string;
	content: string;
	subject?: string;
	predicate?: string;
	type: "fact" | "episode" | "explicit";
	createdAt: string;
}

export interface MemoryBankSummary {
	id: string;
	name: string;
	path: string;
	factsCount: number;
	edgesCount: number;
}

export interface MemoryGraphNode {
	id: string;
	label: string;
	bankId: string;
	bankName: string;
	type: "bank" | "fact" | "node";
	content?: string;
	createdAt?: string;
}

export interface MemoryGraphEdge {
	source: string;
	target: string;
	label: string;
	weight?: number;
}

export interface MemoryGraphData {
	banks: MemoryBankSummary[];
	totalFacts: number;
	totalEdges: number;
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
	memories: MemoryItem[];
}

export interface MemorySavedEvent {
	cwd: string;
	memories: MemoryItem[];
}

export interface OmpApi {
	listProjects(): Promise<ProjectSummary[]>;
	pickProject(): Promise<string | null>;
	removeProject(path: string): Promise<void>;
	deleteSession(file: string): Promise<boolean>;
	renameSession(file: string, title: string): Promise<boolean>;
	readSessionExcerpt(file: string, maxTurns?: number): Promise<string>;
	openSession(options: OpenSessionOptions): Promise<RuntimeInfo>;
	closeRuntime(runtimeId: string): Promise<void>;
	request<T = unknown>(runtimeId: string, command: Record<string, unknown>): Promise<T>;
	send(runtimeId: string, frame: Record<string, unknown>): Promise<void>;
	ompVersion(): Promise<string | null>;
	defaultApprovalMode(): Promise<ApprovalMode>;
	setDefaultApprovalMode(mode: ApprovalMode): Promise<void>;
	getOmpConfigs(): Promise<Record<string, unknown>>;
	setOmpConfig(key: string, value: string): Promise<boolean>;
	readPromptFiles(): Promise<PromptFile[]>;
	writePromptFile(id: PromptFileId, content: string): Promise<{ ok: boolean; path: string; error?: string }>;
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
	generateTitle(prompt: string): Promise<string | null>;
	searchProjectFiles(cwd: string, query?: string): Promise<string[]>;
	forkSession(options: { cwd: string; sourceSessionFile: string; targetEntryId: string }): Promise<string>;
	gitLog(cwd: string, limit?: number): Promise<GitCommitSummary[]>;
	gitCommitDetail(cwd: string, hash: string): Promise<GitCommitDetail | null>;
	gitCommitDiff(cwd: string, hash: string, file?: string): Promise<string>;
	runTerminalCommand(cwd: string, command: string): Promise<string>;
	killTerminalCommand(id: string): Promise<boolean>;
	getMemoryOverview(cwd?: string): Promise<MemoryGraphData>;
	deleteMemory(bankId: string, id: string, type: "fact" | "episode"): Promise<boolean>;
	onMemorySaved(listener: (event: MemorySavedEvent) => void): () => void;
	onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void;
	onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
	onRuntime(listener: (runtimeId: string, message: RuntimeMessage) => void): () => void;
	onProjectsChanged(listener: () => void): () => void;
	/** 项目待办清单（按 cwd 隔离，存于 userData） */
	listTodos(cwd: string): Promise<TodoItem[]>;
	createTodo(input: TodoCreateInput): Promise<TodoItem>;
	updateTodo(cwd: string, id: string, patch: TodoPatch): Promise<TodoItem | null>;
	deleteTodo(cwd: string, id: string): Promise<boolean>;
	reorderTodos(cwd: string, orderedIds: string[]): Promise<TodoItem[]>;
	addTodoAttachment(input: TodoAttachmentInput): Promise<TodoItem | null>;
	removeTodoAttachment(cwd: string, todoId: string, attachmentId: string): Promise<TodoItem | null>;
	readTodoAttachment(blob: string): Promise<string | null>;
	/** 记录一次「开始工作」派生的执行会话 */
	recordTodoRun(cwd: string, todoId: string, run: Omit<TodoRun, "id">): Promise<TodoItem | null>;
	/** omp 模型目录（`omp models --json`，带缓存） */
	listCatalogModels(): Promise<CatalogModel[]>;
	onTodosChanged(listener: (cwd: string) => void): () => void;
}
