import { ChevronRight } from "lucide-react";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveTool } from "@/collab/lib/client";
import { Markdown } from "@/collab/components/transcript/Markdown";
import { messageText } from "@/collab/lib/format";
import { ToolView } from "@/collab/tool-render";
import type {
	AssistantMessage,
	ImageContent,
	SessionEntry,
	TextContent,
	ToolResultMessage,
} from "@/collab/wire/index";
import type { Thread } from "@/state/types";

/** 距底部小于该值时自动跟随新内容 */
const FOLLOW_THRESHOLD_PX = 80;
/** 长会话只挂载尾部若干条，向上滚动再逐批加载 */
const WINDOW = 120;

function ThinkingBlock({ text, redacted, live }: { text: string; redacted?: boolean; live?: boolean }): ReactNode {
	const [open, setOpen] = useState(false);
	return (
		<div className="th-think">
			<button type="button" className="th-think-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
				<ChevronRight size={12} className={`th-chev${open ? " is-open" : ""}`} />
				<span className={live ? "th-shimmer" : undefined}>{redacted ? "思考过程（已隐藏）" : "思考过程"}</span>
			</button>
			{open && <div className="th-think-body">{redacted ? "模型提供方未返回思考内容" : text}</div>}
		</div>
	);
}

function UserContent({ content }: { content: string | readonly (TextContent | ImageContent)[] }): ReactNode {
	if (typeof content === "string") return <div className="th-user-text">{content}</div>;
	return (
		<>
			{content.map((block, i) =>
				block.type === "text" ? (
					<div key={i} className="th-user-text">
						{block.text}
					</div>
				) : block.type === "image" ? (
					<img key={i} className="th-user-img" src={`data:${block.mimeType};base64,${block.data}`} alt="附件图片" />
				) : null,
			)}
		</>
	);
}

interface AssistantProps {
	message: AssistantMessage;
	results: ReadonlyMap<string, ToolResultMessage>;
	active: ReadonlyMap<string, ActiveTool>;
	pending: boolean;
}

function AssistantBody({ message, results, active, pending }: AssistantProps): ReactNode {
	const last = message.content.length - 1;
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
		</div>
	);
}

const EntryRow = memo(function EntryRow({
	entry,
	results,
	active,
}: {
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
					<div className="th-user">
						<div className="th-user-bubble">
							<UserContent content={msg.content} />
						</div>
					</div>
				);
			}
			if (msg.role === "assistant") return <AssistantBody message={msg} results={results} active={active} pending={false} />;
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
		followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
		if (el.scrollTop < 200 && from > 0) {
			const prevHeight = el.scrollHeight;
			setStart(Math.max(0, from - WINDOW));
			requestAnimationFrame(() => {
				el.scrollTop += el.scrollHeight - prevHeight;
			});
		}
	};

	return (
		<div className="th-scroll" ref={scrollRef} onScroll={onScroll}>
			<div className="th-column">
				{from > 0 && <div className="th-earlier">向上滚动加载更早的 {from} 条记录</div>}
				{visible.map(entry => (
					<EntryRow key={entry.id} entry={entry} results={results} active={activeTools} />
				))}
				{stream && <AssistantBody message={stream} results={results} active={activeTools} pending />}
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
				{working && !stream && activeTools.size === 0 && <div className="th-working th-shimmer">正在思考</div>}
			</div>
		</div>
	);
}
