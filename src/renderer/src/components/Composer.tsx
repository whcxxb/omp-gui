import { ArrowUp, Brain, Check, ChevronDown, Shield, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { abort, runCommand, sendPrompt, setApprovalMode, setModel, setThinkingLevel } from "@/state/threads";
import type { ApprovalMode, ModelInfo, Thread } from "@/state/types";

export const APPROVAL_CONFIG: Record<ApprovalMode, { label: string; sub: string; desc: string }> = {
	"yolo": {
		label: "全自动",
		sub: "yolo",
		desc: "跳过工具审批，自动执行全部操作",
	},
	"write": {
		label: "写入审批",
		sub: "write",
		desc: "只读自动允许，修改文件与终端命令需确认",
	},
	"always-ask": {
		label: "全部审批",
		sub: "always-ask",
		desc: "最高安全级别，所有工具调用均需手动确认",
	},
};

const THINKING_LABELS: Record<string, string> = {
	off: "关闭",
	minimal: "最低",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "超高",
	max: "最高",
	auto: "自动",
};

export function Composer({ thread, autoFocus }: { thread: Thread; autoFocus?: boolean }): ReactNode {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const connected = thread.status === "ready";

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [thread.key, autoFocus]);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
	}, [text]);

	const submit = (): void => {
		const message = text.trim();
		if (!message || !connected) return;
		setText("");
		void sendPrompt(thread.key, message);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};

	const usage = thread.state?.contextUsage;
	const queued = thread.state?.queuedMessageCount ?? 0;

	return (
		<div className="cp">
			<textarea
				ref={inputRef}
				className="cp-input"
				rows={1}
				value={text}
				placeholder={
					!connected ? "正在连接 omp…" : thread.working ? "补充说明，将在当前步骤后处理" : "输入消息，Enter 发送，Shift+Enter 换行"
				}
				disabled={!connected}
				onChange={e => setText(e.target.value)}
				onKeyDown={onKeyDown}
			/>
			<div className="cp-bar">
				<ModelPicker thread={thread} />
				<ThinkingPicker thread={thread} />
				<ApprovalModePicker thread={thread} />
				<div className="cp-spacer" />
				{queued > 0 && <span className="cp-meta">排队 {queued}</span>}
				{usage?.percent != null && (
					<span className="cp-meta" title={`${usage.tokens ?? "-"} / ${usage.contextWindow ?? "-"} tokens`}>
						上下文 {Math.round(usage.percent)}%
					</span>
				)}
				{thread.working && !text.trim() ? (
					<button type="button" className="cp-send is-stop" title="停止" onClick={() => void abort(thread.key)}>
						<Square size={12} fill="currentColor" />
					</button>
				) : (
					<button type="button" className="cp-send" title="发送" disabled={!connected || !text.trim()} onClick={submit}>
						<ArrowUp size={16} />
					</button>
				)}
			</div>
		</div>
	);
}

function usePopover(): [boolean, (open: boolean) => void, React.RefObject<HTMLDivElement | null>] {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent): void => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: globalThis.KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	return [open, setOpen, ref];
}

function ModelPicker({ thread }: { thread: Thread }): ReactNode {
	const [open, setOpen, ref] = usePopover();
	const [models, setModels] = useState<ModelInfo[] | null>(null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const current = thread.state?.model;

	useEffect(() => {
		if (!open || models) return;
		runCommand<{ models: ModelInfo[] }>(thread.key, { type: "get_available_models" })
			.then(data => setModels(data.models))
			.catch(e => setError(e instanceof Error ? e.message : String(e)));
	}, [open, models, thread.key]);

	const q = query.trim().toLowerCase();
	const filtered = (models ?? []).filter(
		m => !q || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
	);

	return (
		<div className="pk" ref={ref}>
			<button type="button" className="pk-trigger" disabled={thread.status !== "ready"} onClick={() => setOpen(!open)}>
				<span className="pk-label">{current ? current.name || current.id : "模型"}</span>
				<ChevronDown size={12} />
			</button>
			{open && (
				<div className="pk-pop">
					<input
						className="pk-search"
						placeholder="搜索模型"
						value={query}
						autoFocus
						onChange={e => setQuery(e.target.value)}
					/>
					<div className="pk-list">
						{error && <div className="pk-empty">{error}</div>}
						{!error && !models && <div className="pk-empty">加载中</div>}
						{models && filtered.length === 0 && <div className="pk-empty">没有匹配的模型</div>}
						{filtered.slice(0, 200).map(m => {
							const selected = current?.provider === m.provider && current.id === m.id;
							return (
								<button
									type="button"
									key={`${m.provider}/${m.id}`}
									className={`pk-item${selected ? " is-selected" : ""}`}
									onClick={() => {
										setOpen(false);
										void setModel(thread.key, m);
									}}
								>
									<span className="pk-item-main">{m.name || m.id}</span>
									<span className="pk-item-sub">{m.provider}</span>
									{selected && <Check size={13} />}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

function ThinkingPicker({ thread }: { thread: Thread }): ReactNode {
	const [open, setOpen, ref] = usePopover();
	const [levels, setLevels] = useState<string[] | null>(null);
	const current = thread.state?.thinkingLevel;
	const modelKey = `${thread.state?.model?.provider}/${thread.state?.model?.id}`;

	// 可选强度随模型变化
	useEffect(() => setLevels(null), [modelKey]);

	useEffect(() => {
		if (!open || levels) return;
		runCommand<{ levels: string[] }>(thread.key, { type: "get_available_thinking_levels" })
			.then(data => setLevels(data.levels))
			.catch(() => setLevels([]));
	}, [open, levels, thread.key]);

	return (
		<div className="pk" ref={ref}>
			<button
				type="button"
				className="pk-trigger"
				title="思考强度"
				disabled={thread.status !== "ready"}
				onClick={() => setOpen(!open)}
			>
				<Brain size={13} />
				<span className="pk-label">{current ? (THINKING_LABELS[current] ?? current) : "默认"}</span>
				<ChevronDown size={12} />
			</button>
			{open && (
				<div className="pk-pop is-narrow">
					<div className="pk-list">
						{!levels && <div className="pk-empty">加载中</div>}
						{levels?.length === 0 && <div className="pk-empty">当前模型不支持调整</div>}
						{levels?.map(level => (
							<button
								type="button"
								key={level}
								className={`pk-item${level === current ? " is-selected" : ""}`}
								onClick={() => {
									setOpen(false);
									void setThinkingLevel(thread.key, level);
								}}
							>
								<span className="pk-item-main">{THINKING_LABELS[level] ?? level}</span>
								{level === current && <Check size={13} />}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
function ApprovalModePicker({ thread }: { thread: Thread }): ReactNode {
	const [open, setOpen, ref] = usePopover();
	const currentMode = thread.approvalMode ?? "yolo";
	const current = APPROVAL_CONFIG[currentMode] ?? APPROVAL_CONFIG.yolo;

	const Icon = currentMode === "write" ? ShieldCheck : currentMode === "always-ask" ? ShieldAlert : Shield;

	return (
		<div className="pk" ref={ref}>
			<button
				type="button"
				className="pk-trigger"
				title={`审批模式：${current.label}（${current.desc}）`}
				disabled={thread.status !== "ready"}
				onClick={() => setOpen(!open)}
			>
				<Icon size={13} />
				<span className="pk-label">{current.label}</span>
				<ChevronDown size={12} />
			</button>
			{open && (
				<div className="pk-pop is-approval">
					<div className="pk-list">
						{(Object.keys(APPROVAL_CONFIG) as ApprovalMode[]).map(mode => {
							const cfg = APPROVAL_CONFIG[mode];
							const selected = mode === currentMode;
							const ModeIcon = mode === "write" ? ShieldCheck : mode === "always-ask" ? ShieldAlert : Shield;
							return (
								<button
									type="button"
									key={mode}
									className={`pk-item is-multiline${selected ? " is-selected" : ""}`}
									onClick={() => {
										setOpen(false);
										void setApprovalMode(thread.key, mode);
									}}
								>
									<div className="pk-item-content">
										<div className="pk-item-row">
											<ModeIcon size={12} />
											<span className="pk-item-main">{cfg.label}</span>
											<span className="pk-item-sub">{cfg.sub}</span>
										</div>
										<span className="pk-item-desc">{cfg.desc}</span>
									</div>
									{selected && <Check size={13} />}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

