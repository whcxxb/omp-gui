import {
	ArrowLeft,
	Bot,
	Clock,
	Coins,
	Cpu,
	RotateCw,
	Workflow,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { runCommand, setActiveSubagent, setSubagentPanelOpen } from "@/state/threads";
import type { SubagentSnapshot, Thread } from "@/state/types";

interface SubagentMessagesResult {
	sessionFile: string;
	fromByte: number;
	nextByte: number;
	reset: boolean;
	entries: Array<{ type: string; id: string; timestamp?: string }>;
	messages: Array<{
		role: string;
		content: string | Array<{ type: string; text?: string; name?: string }>;
	}>;
}

export function SubagentPanel({ thread }: { thread: Thread }): ReactNode {
	const subagents = thread.subagents ?? [];
	const activeId = thread.activeSubagentId;
	const activeSubagent = useMemo(
		() => subagents.find(s => s.id === activeId) ?? null,
		[subagents, activeId],
	);

	const runningCount = subagents.filter(
		s => s.status === "started" || s.status === "running",
	).length;

	return (
		<aside className="sub-panel">
			<div className="sub-header">
				<div className="sub-header-left">
					<Workflow size={15} className="sub-header-icon" />
					<span className="sub-header-title">子任务协同</span>
					{subagents.length > 0 && (
						<span className={`sub-count-badge${runningCount > 0 ? " is-running" : ""}`}>
							{runningCount > 0 ? `${runningCount} 运行中` : `${subagents.length} 完成`}
						</span>
					)}
				</div>
				<button
					type="button"
					className="sub-close-btn"
					title="关闭看板"
					onClick={() => setSubagentPanelOpen(thread.key, false)}
				>
					<X size={14} />
				</button>
			</div>

			<div className="sub-body">
				{activeSubagent ? (
					<SubagentDetail
						threadKey={thread.key}
						subagent={activeSubagent}
						onBack={() => setActiveSubagent(thread.key, null)}
					/>
				) : subagents.length === 0 ? (
					<div className="sub-empty">
						<Bot size={32} className="sub-empty-icon" />
						<div className="sub-empty-title">暂无子智能体任务</div>
						<div className="sub-empty-desc">
							当主 Agent 通过 task 工具分发并发任务（如 scout 快速检索、reviewer
							代码审查、sonic 批量处理）时，此处将实时展示各子任务的思考与工具执行进展。
						</div>
					</div>
				) : (
					<div className="sub-list">
						{subagents.map(sub => (
							<SubagentCard
								key={sub.id}
								subagent={sub}
								onClick={() => setActiveSubagent(thread.key, sub.id)}
							/>
						))}
					</div>
				)}
			</div>
		</aside>
	);
}

function SubagentCard({
	subagent,
	onClick,
}: {
	subagent: SubagentSnapshot;
	onClick: () => void;
}): ReactNode {
	const p = subagent.progress;
	const isRunning = subagent.status === "started" || subagent.status === "running";
	const isFailed = subagent.status === "failed" || subagent.status === "aborted";

	const toolCount = p?.toolCount ?? 0;
	const tokens = p?.tokens ?? 0;
	const cost = p?.cost ?? 0;
	const durationSec = p?.durationMs ? Math.round(p.durationMs / 1000) : null;

	const activityText =
		p?.currentTool
			? `调用 ${p.currentTool}...`
			: p?.lastIntent || subagent.description || subagent.task || "处理中...";

	return (
		<button type="button" className="sub-card" onClick={onClick}>
			<div className="sub-card-head">
				<div className="sub-card-title-group">
					<span
						className={`sub-status-dot${
							isRunning ? " is-running" : isFailed ? " is-failed" : " is-done"
						}`}
					/>
					<span className="sub-agent-name">{subagent.id}</span>
					<span className="sub-agent-role">{subagent.agent}</span>
				</div>
				<span
					className={`sub-status-label${
						isRunning ? " is-running" : isFailed ? " is-failed" : " is-done"
					}`}
				>
					{isRunning ? "运行中" : isFailed ? "失败" : "已完成"}
				</span>
			</div>

			<div className="sub-card-desc">{subagent.task || subagent.description || "子任务"}</div>

			<div className="sub-card-activity">
				<span className="sub-activity-text">{activityText}</span>
			</div>

			<div className="sub-card-meta">
				{tokens > 0 && (
					<span className="sub-meta-item" title="Token 消耗">
						<Cpu size={11} />
						<span>{tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens}</span>
					</span>
				)}
				{cost > 0 && (
					<span className="sub-meta-item" title="推理成本">
						<Coins size={11} />
						<span>${cost.toFixed(3)}</span>
					</span>
				)}
				{toolCount > 0 && (
					<span className="sub-meta-item" title="工具调用次数">
						<span>{toolCount} 工具</span>
					</span>
				)}
				{durationSec !== null && durationSec > 0 && (
					<span className="sub-meta-item sub-meta-right" title="运行耗时">
						<Clock size={11} />
						<span>{durationSec}s</span>
					</span>
				)}
			</div>
		</button>
	);
}

function SubagentDetail({
	threadKey,
	subagent,
	onBack,
}: {
	threadKey: string;
	subagent: SubagentSnapshot;
	onBack: () => void;
}): ReactNode {
	const [transcript, setTranscript] = useState<SubagentMessagesResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadMessages = (): void => {
		setLoading(true);
		setError(null);
		runCommand<SubagentMessagesResult>(threadKey, {
			type: "get_subagent_messages",
			subagentId: subagent.id,
		})
			.then(res => setTranscript(res))
			.catch(err => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		loadMessages();
	}, [threadKey, subagent.id]);

	const isRunning = subagent.status === "started" || subagent.status === "running";
	const isFailed = subagent.status === "failed" || subagent.status === "aborted";

	return (
		<div className="sub-detail">
			<div className="sub-detail-nav">
				<button type="button" className="sub-back-btn" onClick={onBack}>
					<ArrowLeft size={13} />
					<span>返回列表</span>
				</button>
				<button
					type="button"
					className="sub-refresh-btn"
					title="刷新明细"
					disabled={loading}
					onClick={loadMessages}
				>
					<RotateCw size={12} className={loading ? "is-spinning" : ""} />
				</button>
			</div>

			<div className="sub-detail-header">
				<div className="sub-detail-title-row">
					<span
						className={`sub-status-dot${
							isRunning ? " is-running" : isFailed ? " is-failed" : " is-done"
						}`}
					/>
					<h3 className="sub-detail-title">{subagent.id}</h3>
					<span className="sub-agent-role">{subagent.agent}</span>
				</div>
				<div className="sub-detail-task">
					{subagent.task || subagent.description || "无详细描述"}
				</div>
			</div>

			<div className="sub-detail-section">
				<div className="sub-section-title">执行记录与消息</div>
				{loading && !transcript && <div className="sub-loading">加载中...</div>}
				{error && <div className="sub-error">{error}</div>}
				{transcript && transcript.messages.length === 0 && (
					<div className="sub-empty-inline">暂无记录消息</div>
				)}
				{transcript && transcript.messages.length > 0 && (
					<div className="sub-msg-list">
						{transcript.messages.map((msg, i) => {
							const text =
								typeof msg.content === "string"
									? msg.content
									: msg.content.map(b => b.text || b.name || "").join(" ");
							if (!text.trim()) return null;
							return (
								<div key={i} className={`sub-msg-item is-${msg.role}`}>
									<div className="sub-msg-role">{msg.role}</div>
									<div className="sub-msg-text">{text}</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
