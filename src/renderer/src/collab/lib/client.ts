// 本地维护：替代上游 collab-web 的 WebSocket 客户端，只保留渲染层需要的类型。
export type ConnectionPhase = "connecting" | "waiting" | "live" | "reconnecting" | "ended";

export interface ActiveTool {
	toolCallId: string;
	toolName: string;
	args: unknown;
	intent?: string;
	partialResult?: unknown;
	startedAt: number;
}
