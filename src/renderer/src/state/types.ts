import type { ActiveTool } from "@/collab/lib/client";
import type { ApprovalMode, ModelRef } from "@shared/ipc";
export type { ApprovalMode };
export type ExecutionMode = "edit" | "plan" | "ask";

import type { AssistantMessage, ImageContent, SessionEntry } from "@/collab/wire/index";

export interface QueuedPromptAttachment {
	id: string;
	type: "image" | "file" | "session" | "message-record";
	name: string;
	path?: string;
	relativePath?: string;
	mimeType?: string;
	data?: string;
	previewUrl?: string;
	sessionFile?: string;
	sessionTitle?: string;
	quoteRole?: "user" | "assistant";
	quoteContent?: string;
}

export interface QueuedPrompt {
	id: string;
	text: string;
	message: string;
	images?: ImageContent[];
	attachments?: QueuedPromptAttachment[];
	createdAt: number;
	delivery?: "sending" | "failed" | "unknown";
	error?: string;
}

/** omp 实际下发、但上游 wire 类型未声明的计时与用量字段；collab 目录由同步脚本覆盖，扩展放在这里 */
export type TimedAssistantMessage = AssistantMessage & {
	/** 请求总耗时（毫秒） */
	duration?: number;
	/** 首 token 延迟（毫秒） */
	ttft?: number;
	usage: AssistantMessage["usage"] & { reasoningTokens?: number };
};

export interface ModelInfo {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number | null;
}

export interface ContextUsage {
	tokens: number | null;
	contextWindow: number | null;
	percent: number | null;
}
export interface SubagentProgress {
	id: string;
	status: "running" | "completed" | "failed" | "aborted";
	task?: string;
	assignment?: string;
	description?: string;
	recentTools?: Array<{ name: string; endMs?: number }>;
	currentTool?: string;
	currentToolStartMs?: number;
	lastIntent?: string;
	toolCount: number;
	requests: number;
	tokens: number;
	cost: number;
	durationMs: number;
}

export interface SubagentSnapshot {
	id: string;
	index: number;
	agent: string;
	agentSource?: string;
	description?: string;
	status: "started" | "running" | "completed" | "failed" | "aborted";
	task?: string;
	assignment?: string;
	sessionFile?: string;
	lastUpdate: number;
	progress?: SubagentProgress;
	parentToolCallId?: string;
	error?: string;
}
export type RightPanelTab = "files" | "git" | "terminal" | "subagents" | "todos";

/** get_state 的子集 */
export interface SessionStateSnapshot {
	model?: ModelInfo;
	thinkingLevel?: string;
	isStreaming: boolean;
	isCompacting?: boolean;
	hasPendingAsyncWork?: boolean;
	isSettled?: boolean;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	queuedMessageCount: number;
	contextUsage?: ContextUsage;
}

export type UiRequest =
	| { id: string; method: "select"; title: string; options: string[]; optionDetails?: { description?: string }[] }
	| { id: string; method: "confirm"; title: string; message: string }
	| { id: string; method: "input"; title: string; placeholder?: string }
	| { id: string; method: "editor"; title: string; prefill?: string };

export interface Notice {
	id: number;
	level: "info" | "warning" | "error";
	message: string;
}

export type ThreadStatus = "starting" | "ready" | "exited" | "error";

export interface Thread {
	/** 本地稳定标识；进程重启后 runtimeId 会变 */
	key: string;
	runtimeId: string | null;
	cwd: string;
	sessionFile?: string;
	approvalMode: ApprovalMode;
	pendingApprovalMode?: ApprovalMode;
	executionMode: ExecutionMode;
	status: ThreadStatus;
	error?: string;
	entries: SessionEntry[];
	stream: AssistantMessage | null;
	streamDone: boolean;
	activeTools: ReadonlyMap<string, ActiveTool>;
	working: boolean;
	activity?: "thinking" | "compacting" | "retrying";
	lastEventAt?: number;
	lastEventType?: string;
	connectionError?: string;
	state: SessionStateSnapshot | null;
	subagents: SubagentSnapshot[];
	activeSubagentId: string | null;
	isRightPanelOpen: boolean;
	rightPanelTab: RightPanelTab;
	isSubagentPanelOpen: boolean;
	uiRequests: UiRequest[];
	queuedPrompts: QueuedPrompt[];
	queuePaused?: boolean;
	editing?: boolean;
	notices: Notice[];
	/** 待办「开始工作」指定的模型；attach 时在主进程完成切换 */
	modelOverride?: ModelRef;
	/** 线程就绪后自动发送的首条消息 */
	pendingPrompt?: { message: string; images?: ImageContent[] };
	/** 首条消息前用于顶栏显示的临时标题 */
	titleOverride?: string;
	createdAt: number;
	updatedAt: number;
}
