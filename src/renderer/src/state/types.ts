import type { ActiveTool } from "@/collab/lib/client";
import type { ApprovalMode } from "@shared/ipc";

export type { ApprovalMode };
import type { AssistantMessage, SessionEntry } from "@/collab/wire/index";

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
	uiRequests: UiRequest[];
	notices: Notice[];
}
