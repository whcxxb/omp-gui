import {
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	FileText,
	Image as ImageIcon,
	Paperclip,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Square,
	UploadCloud,
	X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { ImageContent } from "@/collab/wire/index";
import { abort, runCommand, sendPrompt, setApprovalMode, setModel, setThinkingLevel } from "@/state/threads";
import type { ApprovalMode, ModelInfo, Thread } from "@/state/types";

export type ComposerAttachment =
	| {
			id: string;
			type: "image";
			name: string;
			path?: string;
			mimeType: string;
			data: string; // base64
			previewUrl: string;
	  }
	| {
			id: string;
			type: "file";
			name: string;
			path: string;
			relativePath: string;
	  };

async function processDroppedFiles(files: FileList | File[], cwd: string): Promise<ComposerAttachment[]> {
	const results: ComposerAttachment[] = [];
	for (const file of Array.from(files)) {
		let filePath = "";
		if (window.omp.getPathForFile) {
			try {
				filePath = window.omp.getPathForFile(file) || "";
			} catch {
				filePath = "";
			}
		}
		if (!filePath && "path" in file && typeof file.path === "string") {
			filePath = file.path;
		}
		const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name);
		if (isImage) {
			try {
				const dataUrl = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
				const comma = dataUrl.indexOf(",");
				const base64 = comma !== -1 ? dataUrl.slice(comma + 1) : dataUrl;
				const mimeType = file.type || "image/png";
				results.push({
					id: crypto.randomUUID(),
					type: "image",
					name: file.name,
					path: filePath || undefined,
					mimeType,
					data: base64,
					previewUrl: URL.createObjectURL(file),
				});
			} catch (e) {
				console.error("Failed to read image:", e);
			}
		} else {
			const rel = filePath
				? (filePath.startsWith(cwd) ? filePath.slice(cwd.length).replace(/^[/\\]+/, "") : filePath)
				: file.name;
			results.push({
				id: crypto.randomUUID(),
				type: "file",
				name: file.name,
				path: filePath || file.name,
				relativePath: rel,
			});
		}
	}
	return results;
}
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
	const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const dragCounter = useRef(0);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const connected = thread.status === "ready";

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [thread.key, autoFocus]);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
	}, [text, attachments]);

	const submit = (): void => {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || !connected) return;

		const images: ImageContent[] = attachments
			.filter((a): a is Extract<ComposerAttachment, { type: "image" }> => a.type === "image")
			.map(a => ({
				type: "image",
				data: a.data,
				mimeType: a.mimeType,
			}));

		const files = attachments.filter(
			(a): a is Extract<ComposerAttachment, { type: "file" }> => a.type === "file",
		);

		let message = trimmed;
		if (files.length > 0) {
			const refs = files.map(f => `- \`${f.relativePath || f.path}\``).join("\n");
			if (message) {
				message = `${message}\n\n[附带文件]:\n${refs}`;
			} else {
				message = `请查看以下附带文件：\n${refs}`;
			}
		}

		setText("");
		setAttachments([]);
		void sendPrompt(thread.key, message, images.length > 0 ? images : undefined);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};

	const onDragEnter = (e: React.DragEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current += 1;
		setIsDragging(true);
	};

	const onDragLeave = (e: React.DragEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current -= 1;
		if (dragCounter.current <= 0) {
			dragCounter.current = 0;
			setIsDragging(false);
		}
	};

	const onDragOver = (e: React.DragEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
	};

	const onDrop = async (e: React.DragEvent): Promise<void> => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current = 0;
		setIsDragging(false);
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			const newAtts = await processDroppedFiles(e.dataTransfer.files, thread.cwd);
			if (newAtts.length > 0) {
				setAttachments(prev => [...prev, ...newAtts]);
			}
		}
	};

	const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
		if (e.clipboardData.files && e.clipboardData.files.length > 0) {
			const newAtts = await processDroppedFiles(e.clipboardData.files, thread.cwd);
			if (newAtts.length > 0) {
				setAttachments(prev => [...prev, ...newAtts]);
			}
		}
	};

	const removeAttachment = (id: string): void => {
		setAttachments(prev => {
			const item = prev.find(a => a.id === id);
			if (item?.type === "image" && item.previewUrl.startsWith("blob:")) {
				URL.revokeObjectURL(item.previewUrl);
			}
			return prev.filter(a => a.id !== id);
		});
	};

	const canSend = connected && (text.trim().length > 0 || attachments.length > 0);

	const usage = thread.state?.contextUsage;
	const queued = thread.state?.queuedMessageCount ?? 0;

	return (
		<div
			className={`cp${isDragging ? " is-dragging" : ""}`}
			onDragEnter={onDragEnter}
			onDragLeave={onDragLeave}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			{isDragging && (
				<div className="cp-drop-overlay">
					<UploadCloud size={28} />
					<span>拖放文件或图片到此处</span>
				</div>
			)}

			{attachments.length > 0 && (
				<div className="cp-attachments">
					{attachments.map(att => (
						<div key={att.id} className="cp-att-item">
							{att.type === "image" ? (
								<img src={att.previewUrl} alt={att.name} className="cp-att-thumb" />
							) : (
								<FileText size={14} className="cp-att-icon" />
							)}
							<span className="cp-att-name" title={att.type === "file" ? att.path : att.name}>
								{att.type === "file" ? att.relativePath : att.name}
							</span>
							<button
								type="button"
								className="cp-att-remove"
								title="移除"
								onClick={() => removeAttachment(att.id)}
							>
								<X size={11} />
							</button>
						</div>
					))}
				</div>
			)}

			<textarea
				ref={inputRef}
				className="cp-input"
				rows={1}
				value={text}
				placeholder={
					!connected
						? "正在连接 omp…"
						: thread.working
							? "补充说明，将在当前步骤后处理"
							: "输入消息，Enter 发送，Shift+Enter 换行，支持拖拽文件/图片"
				}
				disabled={!connected}
				onChange={e => setText(e.target.value)}
				onKeyDown={onKeyDown}
				onPaste={onPaste}
			/>
			<div className="cp-bar">
				<button
					type="button"
					className="cp-attach-btn"
					title="添加文件或图片"
					disabled={!connected}
					onClick={() => fileInputRef.current?.click()}
				>
					<Paperclip size={14} />
				</button>
				<input
					ref={fileInputRef}
					type="file"
					multiple
					style={{ display: "none" }}
					onChange={async e => {
						if (e.target.files && e.target.files.length > 0) {
							const newAtts = await processDroppedFiles(e.target.files, thread.cwd);
							if (newAtts.length > 0) {
								setAttachments(prev => [...prev, ...newAtts]);
							}
							e.target.value = "";
						}
					}}
				/>
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
				{thread.working && !text.trim() && attachments.length === 0 ? (
					<button type="button" className="cp-send is-stop" title="停止" onClick={() => void abort(thread.key)}>
						<Square size={12} fill="currentColor" />
					</button>
				) : (
					<button type="button" className="cp-send" title="发送" disabled={!canSend} onClick={submit}>
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

