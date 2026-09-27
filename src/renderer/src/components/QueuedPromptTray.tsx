import {
	Clock,
	CornerDownLeft,
	FileText,
	Pencil,
	Trash2,
	Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { removeQueuedPrompt, steerQueuedPrompt } from "@/state/threads";
import type { QueuedPrompt } from "@/state/types";

export interface QueuedPromptTrayProps {
	threadKey: string;
	prompts: QueuedPrompt[];
	onEdit(prompt: QueuedPrompt): void;
}

export function QueuedPromptTray(props: QueuedPromptTrayProps): ReactNode {
	const { threadKey, prompts, onEdit } = props;

	if (!prompts || prompts.length === 0) return null;

	return (
		<div className="qp-tray" aria-label="排队等待中的需求">
			{prompts.map((item, index) => (
				<div key={item.id} className="qp-card">
					<div className="qp-header">
						<div className="qp-status">
							<Clock size={12} className="qp-clock-icon" />
							<span className="qp-badge">
								{prompts.length > 1 ? `排队 #${index + 1}` : "排队挂起中"}
							</span>
							<span className="qp-sub">上一个任务完成后将自动发送</span>
						</div>

						<div className="qp-actions">
							<button
								type="button"
								className="qp-btn is-steer"
								title="直接发送给当前正在运行的任务进行修改判断，无需等待任务结束"
								onClick={() => void steerQueuedPrompt(threadKey, item.id)}
							>
								<Zap size={12} />
								<span>直接发送 (修改当前任务)</span>
							</button>

							<button
								type="button"
								className="qp-btn"
								title="放回输入框编辑"
								onClick={() => onEdit(item)}
							>
								<Pencil size={12} />
								<span>编辑</span>
							</button>

							<button
								type="button"
								className="qp-btn is-danger"
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
