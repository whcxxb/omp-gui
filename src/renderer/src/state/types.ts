import type { ActiveTool } from "@/collab/lib/client";
import type { ApprovalMode } from "@shared/ipc";

export type { ApprovalMode };
import type { AssistantMessage, ImageContent, SessionEntry } from "@/collab/wire/index";

export interface QueuedPromptAttachment {
	id: string;
	type: "image" | "file";
	name: string;
	path?: string;
	relativePath?: string;
	mimeType?: string;
	data?: string;
	previewUrl?: string;
}

export interface QueuedPrompt {
	id: string;
	text: string;
	message: string;
	images?: ImageContent[];
	attachments?: QueuedPromptAttachment[];
	createdAt: number;
}

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


/** get_state 的子集 */
export interface SessionStateSnapshot {
	model?: ModelInfo;
	thinkingLevel?: string;
	isStreaming: boolean;
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
	status: ThreadStatus;
	error?: string;
	entries: SessionEntry[];
	stream: AssistantMessage | null;
	streamDone: boolean;
	activeTools: ReadonlyMap<string, ActiveTool>;
	working: boolean;
	state: SessionStateSnapshot | null;
	subagents: SubagentSnapshot[];
	activeSubagentId: string | null;
	isSubagentPanelOpen: boolean;
	uiRequests: UiRequest[];
	queuedPrompts: QueuedPrompt[];
	notices: Notice[];
}
