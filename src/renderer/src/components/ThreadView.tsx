import { ArrowDown, Brain, Check, ChevronRight, Copy, CornerDownLeft, GitFork, GripVertical, Pencil, Quote } from "lucide-react";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveTool } from "@/collab/lib/client";
import { Markdown } from "./Markdown";
import { messageText } from "@/collab/lib/format";
import { ToolView } from "@/collab/tool-render";
import type {
	AssistantMessage,
	ImageContent,
	SessionEntry,
	TextContent,
	ToolResultMessage,
} from "@/collab/wire/index";
import { editAndResendPrompt, forkThread } from "@/state/threads";
import type { Thread } from "@/state/types";
const FOLLOW_THRESHOLD_PX = 80;
/** 长会话只挂载尾部若干条，向上滚动再逐批加载 */
const WINDOW = 120;

function ThinkingBlock({ text, redacted, live }: { text: string; redacted?: boolean; live?: boolean }): ReactNode {
	const [open, setOpen] = useState(false);
	const [elapsedSec, setElapsedSec] = useState(0);
	const startTimeRef = useRef<number | null>(null);

	useEffect(() => {
		if (live) {
			if (!startTimeRef.current) startTimeRef.current = Date.now();
			const interval = setInterval(() => {
				if (startTimeRef.current) {
					setElapsedSec(Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)));
				}
			}, 500);
			return () => clearInterval(interval);
		}
		if (startTimeRef.current && elapsedSec === 0) {
			setElapsedSec(Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)));
		}
	}, [live]);

	const charCount = text ? text.length : 0;
	let label = "思考过程";
	if (redacted) {
		label = "思考过程（已隐藏）";
	} else if (live) {
		label = elapsedSec > 0 ? `深度思考中 (${elapsedSec}s)...` : "深度思考中...";
	} else if (charCount > 0) {
		label = elapsedSec > 0 ? `已思考 ${elapsedSec}s · ${charCount.toLocaleString()} 字符` : `已深度思考 · ${charCount.toLocaleString()} 字符`;
	}

	return (
		<div className={`th-think${live ? " is-live" : ""}${open ? " is-open" : ""}`}>
			<button type="button" className="th-think-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
				<Brain size={13} className={`th-think-icon${live ? " is-pulsing" : ""}`} />
				<span className={`th-think-label${live ? " th-shimmer" : ""}`}>{label}</span>
				<ChevronRight size={12} className={`th-chev${open ? " is-open" : ""}`} />
			</button>
			<div className="th-think-wrapper">
				<div className="th-think-body-inner">
					<div className="th-think-body">
						{redacted ? (
							<div className="th-think-redacted">模型提供方未返回思考内容</div>
						) : (
							<pre className="th-think-text">{text}</pre>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function UserContent({ content }: { content: string | readonly (TextContent | ImageContent)[] }): ReactNode {
	if (typeof content === "string") return <Markdown text={content} />;
	return (
		<>
			{content.map((block, i) =>
				block.type === "text" ? (
					<Markdown key={i} text={block.text} />
				) : block.type === "image" ? (
					<img key={i} className="th-user-img" src={`data:${block.mimeType};base64,${block.data}`} alt="附件图片" />
				) : null,
			)}
		</>
	);
}
function extractUserText(content: string | readonly (TextContent | ImageContent)[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((b): b is TextContent => b.type === "text")
		.map(b => b.text)
		.join("\n");
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
		.map(b => b.text)
		.join("\n\n");
}

function formatMessageTime(raw?: number | string): string | null {
	if (!raw) return null;
	const date = typeof raw === "number" ? new Date(raw) : new Date(Date.parse(raw));
	if (isNaN(date.getTime())) return null;

	const now = new Date();
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();

	const h = String(date.getHours()).padStart(2, "0");
	const m = String(date.getMinutes()).padStart(2, "0");

	if (isToday) return `${h}:${m}`;

	const isSameYear = date.getFullYear() === now.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	if (isSameYear) return `${month}-${day} ${h}:${m}`;
	return `${date.getFullYear()}-${month}-${day} ${h}:${m}`;
}

function getFullTimeString(raw?: number | string): string | undefined {
	if (!raw) return undefined;
	const date = typeof raw === "number" ? new Date(raw) : new Date(Date.parse(raw));
	if (isNaN(date.getTime())) return undefined;
	return date.toLocaleString();
}

interface AssistantProps {
	threadKey: string;
	entryId?: string;
	message: AssistantMessage;
	results: ReadonlyMap<string, ToolResultMessage>;
	active: ReadonlyMap<string, ActiveTool>;
	pending: boolean;
}

function AssistantBody({ threadKey, entryId, message, results, active, pending }: AssistantProps): ReactNode {
	const [copied, setCopied] = useState(false);
	const last = message.content.length - 1;
	const assistantText = extractAssistantText(message);

	const handleCopy = (): void => {
		if (!assistantText) return;
		void navigator.clipboard.writeText(assistantText);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleQuote = (): void => {
		if (!assistantText) return;
		window.dispatchEvent(
			new CustomEvent("omp:insert-prompt", {
				detail: { text: `> 助手回复:\n> ${assistantText.slice(0, 300).replace(/\n/g, "\n> ")}\n\n` },
			}),
		);
	};

	return (
		<div className="th-assistant">
			{message.content.map((block, i) => {
				switch (block.type) {
					case "thinking":
						return block.thinking.trim() ? (
							<ThinkingBlock key={i} text={block.thinking} live={pending && i === last} />
						) : null;
					case "redactedThinking":
						return <ThinkingBlock key={i} text="" redacted />;
					case "text":
						return block.text ? <Markdown key={i} text={block.text} /> : null;
					case "toolCall": {
						const act = active.get(block.id);
						const result = results.get(block.id);
						const running = !result && (act !== undefined || pending);
						const partial =
							running && act?.partialResult !== undefined
								? typeof act.partialResult === "string"
									? act.partialResult
									: messageText(act.partialResult)
								: "";
						return (
							<ToolView
								key={block.id}
								name={block.name}
								args={act?.args ?? block.arguments}
								intent={block.intent ?? act?.intent}
								result={result}
								running={running}
								partial={partial || undefined}
							/>
						);
					}
					default:
						return null;
				}
			})}
			{!pending && message.stopReason === "error" && (
				<div className="th-stop is-error">{message.errorMessage || "请求出错"}</div>
			)}
			{!pending && message.stopReason === "aborted" && <div className="th-stop">已中断</div>}
			{!pending && message.stopReason === "length" && <div className="th-stop">输出达到长度上限</div>}

			{!pending && assistantText && (
				<div className="th-assistant-bar">
					<button
						type="button"
						className="th-action-btn"
						title={copied ? "已复制全文" : "复制回复全文"}
						onClick={handleCopy}
					>
						{copied ? <Check size={12} className="is-success" /> : <Copy size={12} />}
						<span>{copied ? "已复制" : "复制"}</span>
					</button>
					<button
						type="button"
						className="th-action-btn"
						title="引用此回复到输入框"
						onClick={handleQuote}
					>
						<Quote size={12} />
						<span>引用</span>
					</button>
					{entryId && (
						<button
							type="button"
							className="th-action-btn"
							title="由此回复节点派生新分支会话"
							onClick={() => void forkThread(threadKey, entryId)}
						>
							<GitFork size={12} />
							<span>分支</span>
						</button>
					)}
					<div
						className="th-action-drag"
						draggable={true}
						title="拖拽此回复记录到输入框以引入"
						onDragStart={e => {
							const payload = {
								type: "message-record",
								role: "assistant",
								content: assistantText,
								summary: assistantText.slice(0, 40),
							};
							e.dataTransfer.setData("application/x-omp-message", JSON.stringify(payload));
							e.dataTransfer.setData("text/plain", `> 助手回复: ${assistantText}`);
							e.dataTransfer.effectAllowed = "copyLink";
						}}
					>
						<GripVertical size={12} />
						<span>拖拽引用</span>
					</div>
				</div>
			)}
		</div>
	);
}

function UserMessageBubble({
	threadKey,
	entryId,
	content,
	timestamp,
}: {
	threadKey: string;
	entryId?: string;
	content: string | readonly (TextContent | ImageContent)[];
	timestamp?: number | string;
}): ReactNode {
	const [copied, setCopied] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const editInputRef = useRef<HTMLTextAreaElement | null>(null);
	const userText = extractUserText(content);
	const timeStr = formatMessageTime(timestamp);
	const fullTime = getFullTimeString(timestamp);

	useEffect(() => {
		if (isEditing && editInputRef.current) {
			editInputRef.current.focus();
			editInputRef.current.setSelectionRange(editInputRef.current.value.length, editInputRef.current.value.length);
		}
	}, [isEditing]);

	const handleCopy = (e: React.MouseEvent): void => {
		e.stopPropagation();
		e.preventDefault();
		if (!userText) return;
		void navigator.clipboard.writeText(userText);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleStartEdit = (e: React.MouseEvent): void => {
		e.stopPropagation();
		e.preventDefault();
		setEditText(userText);
		setIsEditing(true);
	};

	const handleSaveAndResend = async (): Promise<void> => {
		const trimmed = editText.trim();
		if (!trimmed) return;
		setIsEditing(false);
		await editAndResendPrompt(threadKey, entryId, trimmed);
	};

	return (
		<div className="th-user">
			<div className="th-user-wrap">
				<div className={`th-user-bubble${isEditing ? " is-editing" : ""}`}>
					{isEditing ? (
						<div className="th-user-edit-wrap">
							<textarea
								ref={editInputRef}
								className="th-user-edit-input"
								value={editText}
								placeholder="修改提问内容..."
								onChange={e => setEditText(e.target.value)}
								onKeyDown={e => {
									if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
										e.preventDefault();
										void handleSaveAndResend();
									} else if (e.key === "Escape") {
										e.preventDefault();
										setIsEditing(false);
										setEditText(userText);
									}
								}}
							/>
							<div className="th-user-edit-footer">
								<span className="th-user-edit-hint">按 ⌘+Enter 或点击重新发送</span>
								<div className="th-user-edit-btns">
									<button
										type="button"
										className="th-user-edit-btn is-cancel"
										onClick={() => {
											setIsEditing(false);
											setEditText(userText);
										}}
									>
										取消
									</button>
									<button
										type="button"
										className="th-user-edit-btn is-submit"
										disabled={!editText.trim()}
										onClick={() => void handleSaveAndResend()}
									>
										重新发送
									</button>
								</div>
							</div>
						</div>
					) : (
						<div className="th-user-body">
							<UserContent content={content} />
						</div>
					)}
				</div>
				{!isEditing && (
					<div className="th-user-footer">
						{timeStr && (
							<span className="th-user-time" title={fullTime}>
								{timeStr}
							</span>
						)}
						<button
							type="button"
							className="th-user-btn"
							title={copied ? "已复制提问" : "复制提问"}
							onClick={handleCopy}
						>
							{copied ? <Check size={13} className="is-success" /> : <Copy size={13} />}
						</button>
						<button
							type="button"
							className="th-user-btn"
							title="修改并重新发送"
							onClick={handleStartEdit}
						>
							<Pencil size={13} />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

const EntryRow = memo(function EntryRow({
	threadKey,
	entry,
	results,
	active,
}: {
	threadKey: string;
	entry: SessionEntry;
	results: ReadonlyMap<string, ToolResultMessage>;
	active: ReadonlyMap<string, ActiveTool>;
}): ReactNode {
	switch (entry.type) {
		case "message": {
			const msg = entry.message;
			if (msg.role === "user") {
				if (msg.synthetic) return null;
				return (
					<UserMessageBubble
						threadKey={threadKey}
						entryId={entry.id}
						content={msg.content}
						timestamp={msg.timestamp || entry.timestamp}
					/>
				);
			}
			if (msg.role === "assistant") {
				return (
					<AssistantBody
						threadKey={threadKey}
						entryId={entry.id}
						message={msg}
						results={results}
						active={active}
						pending={false}
					/>
				);
			}
			return null;
		}
		case "custom_message":
			if (!entry.display) return null;
			return (
				<div className="th-custom">
					<span className="th-chip">{entry.customType}</span>
					{typeof entry.content === "string" ? (
						<Markdown text={entry.content} />
					) : (
						<Markdown text={entry.content.map(b => (b.type === "text" ? b.text : "")).join("\n")} />
					)}
				</div>
			);
		case "compaction":
			return <div className="th-divider">上下文已压缩</div>;
		case "branch_summary":
			return <div className="th-divider">分支摘要</div>;
		case "model_change":
			return <div className="th-marker">切换模型：{entry.model}</div>;
		default:
			return null;
	}
});

export function ThreadView({ thread }: { thread: Thread }): ReactNode {
	const { entries, stream, activeTools, working } = thread;
	const [start, setStart] = useState<number | null>(null);
	const [showScrollBottom, setShowScrollBottom] = useState(false);
	const tailStart = Math.max(0, entries.length - WINDOW);
	const from = start === null ? tailStart : Math.min(start, tailStart);
	const visible = useMemo(() => entries.slice(from), [entries, from]);
	const results = useMemo(() => {
		const map = new Map<string, ToolResultMessage>();
		for (const entry of entries) {
			if (entry.type === "message" && entry.message.role === "toolResult") map.set(entry.message.toolCallId, entry.message);
		}
		return map;
	}, [entries]);

	// 未出现在任何 toolCall 块里的执行中工具（例如子进程直接触发）
	const tailTools = useMemo(() => {
		const known = new Set<string>();
		for (const entry of entries) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			for (const block of entry.message.content) if (block.type === "toolCall") known.add(block.id);
		}
		for (const block of stream?.content ?? []) if (block.type === "toolCall") known.add(block.id);
		return [...activeTools.values()].filter(t => !known.has(t.toolCallId));
	}, [entries, stream, activeTools]);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const followRef = useRef(true);

	useEffect(() => {
		followRef.current = true;
		setStart(null);
	}, [thread.key]);

	useEffect(() => {
		const el = scrollRef.current;
		if (el && followRef.current) el.scrollTop = el.scrollHeight;
	}, [entries, stream, activeTools, working, thread.uiRequests]);

	const onScroll = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		followRef.current = distanceFromBottom < FOLLOW_THRESHOLD_PX;
		setShowScrollBottom(distanceFromBottom > 160);
		if (el.scrollTop < 200 && from > 0) {
			const prevHeight = el.scrollHeight;
			setStart(Math.max(0, from - WINDOW));
			requestAnimationFrame(() => {
				el.scrollTop += el.scrollHeight - prevHeight;
			});
		}
	};

	const scrollToBottom = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		followRef.current = true;
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	};

	return (
		<div className="th-scroll-wrap">
			<div className="th-scroll" ref={scrollRef} onScroll={onScroll}>
				<div className="th-column">
					{from > 0 && <div className="th-earlier">向上滚动加载更早的 {from} 条记录</div>}
					{visible.map(entry => (
						<EntryRow key={entry.id} threadKey={thread.key} entry={entry} results={results} active={activeTools} />
					))}
					{stream && <AssistantBody threadKey={thread.key} message={stream} results={results} active={activeTools} pending />}
					{tailTools.length > 0 && (
						<div className="th-assistant">
							{tailTools.map(tool => (
								<ToolView
									key={tool.toolCallId}
									name={tool.toolName}
									args={tool.args}
									intent={tool.intent}
									running
									partial={
										tool.partialResult === undefined
											? undefined
											: typeof tool.partialResult === "string"
												? tool.partialResult
												: messageText(tool.partialResult)
									}
								/>
							))}
						</div>
					)}
					{working && !stream && activeTools.size === 0 && (
						<div className="th-working-pill">
							<Brain size={14} className="th-working-icon is-pulsing" />
							<span className="th-shimmer">正在思考与构思...</span>
						</div>
					)}
				</div>
			</div>
			{showScrollBottom && (
				<button
					type="button"
					className="th-scroll-fab"
					title="回到底部"
					onClick={scrollToBottom}
				>
					<ArrowDown size={15} />
					{(working || stream) && <span className="th-fab-dot" />}
				</button>
			)}
		</div>
	);
}
