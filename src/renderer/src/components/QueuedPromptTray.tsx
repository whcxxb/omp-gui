import {
	Clock,
	CornerDownLeft,
	FileText,
	MessagesSquare,
	Pencil,
	Quote,
	Trash2,
	Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { removeQueuedPrompt, resumeQueuedPrompts, steerQueuedPrompt } from "@/state/threads";
import type { QueuedPrompt } from "@/state/types";

export interface QueuedPromptTrayProps {
	threadKey: string;
	prompts: QueuedPrompt[];
	paused?: boolean;
	disabled?: boolean;
	onEdit(prompt: QueuedPrompt): void;
}

export function QueuedPromptTray(props: QueuedPromptTrayProps): ReactNode {
	const { threadKey, prompts, paused, disabled, onEdit } = props;

	if (!prompts || prompts.length === 0) return null;

	return (
		<div className="qp-tray" aria-label="排队等待中的需求">
			{paused && !prompts[0]?.delivery && (
				<button type="button" className="qp-btn" disabled={disabled} onClick={() => void resumeQueuedPrompts(threadKey)}>继续队列</button>
			)}
			{prompts.map((item, index) => (
				<div key={item.id} className="qp-card">
					<div className="qp-header">
						<div className="qp-status">
							<Clock size={12} className="qp-clock-icon" />
							<span className="qp-badge">
								{item.delivery === "sending" ? "发送中" : item.delivery ? "发送未确认" : paused ? "队列已暂停" : prompts.length > 1 ? `排队 #${index + 1}` : "排队挂起中"}
							</span>
							<span className="qp-sub">{item.error ?? (paused ? "确认后可继续发送" : "上一个任务完成后将自动发送")}</span>
						</div>

						<div className="qp-actions">
							<button
								type="button"
								className="qp-btn is-steer"
								disabled={disabled || item.delivery === "sending"}
								title="直接发送给当前正在运行的任务进行修改判断，无需等待任务结束"
								onClick={() => void steerQueuedPrompt(threadKey, item.id)}
							>
								<Zap size={12} />
								<span>{item.delivery ? "核对后重新发送" : "直接发送 (修改当前任务)"}</span>
							</button>

							<button
								type="button"
								className="qp-btn"
								disabled={item.delivery === "sending"}
								title="放回输入框编辑"
								onClick={() => onEdit(item)}
							>
								<Pencil size={12} />
								<span>编辑</span>
							</button>

							<button
								type="button"
								className="qp-btn is-danger"
								disabled={item.delivery === "sending"}
								title="撤回并取消排队"
								onClick={() => removeQueuedPrompt(threadKey, item.id)}
							>
								<Trash2 size={12} />
							</button>
						</div>
					</div>

					<div className="qp-body">
						<div className="qp-text">{item.text || item.message}</div>
						{item.attachments && item.attachments.length > 0 && (
							<div className="qp-attachments">
								{item.attachments.map(att => (
									<div key={att.id} className="qp-att-tag">
										{att.type === "image" && att.previewUrl ? (
											<img src={att.previewUrl} alt={att.name} className="qp-att-thumb" />
										) : att.type === "session" ? (
											<MessagesSquare size={11} />
										) : att.type === "message-record" ? (
											<Quote size={11} />
										) : (
											<FileText size={11} />
										)}
										<span className="qp-att-name">{att.name}</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
