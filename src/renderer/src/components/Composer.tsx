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
	Sparkles,
	Square,
	Terminal,
	UploadCloud,
	X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillItem } from "@shared/ipc";
import type { ImageContent, SessionEntry } from "@/collab/wire/index";
import { playSound } from "@/lib/sound";
import { abort, enqueuePrompt, removeQueuedPrompt, runCommand, sendPrompt, setApprovalMode, setModel, setThinkingLevel } from "@/state/threads";
import type { ApprovalMode, ModelInfo, QueuedPrompt, Thread, TimedAssistantMessage } from "@/state/types";
import { QueuedPromptTray } from "./QueuedPromptTray";

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

interface PerfStats {
	segments: string[];
	tooltip: string;
}

interface SlashCandidate {
	id: string;
	kind: "skill" | "command";
	name: string;
	desc: string;
	scope?: "project" | "global";
	hint?: string;
}

function formatTokCount(n: number): string {
	if (n >= 1_000_000) {
		const val = (n / 1_000_000).toFixed(1).replace(/\.0$/, "");
		return `${val}M tok`;
	}
	if (n >= 1000) {
		const val = (n / 1000).toFixed(1).replace(/\.0$/, "");
		return `${val}K tok`;
	}
	return `${n} tok`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

function getLatestPerfStats(entries: SessionEntry[]): PerfStats | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const msg = entry.message as TimedAssistantMessage;
		const usage = msg.usage;
		const duration = msg.duration;
		const ttft = msg.ttft;

		if (!usage && duration == null && ttft == null) continue;

		const segments: string[] = [];

		// 1. 首 token / 回复 / 速率
		const timeParts: string[] = [];
		if (ttft != null && ttft > 0) {
			timeParts.push(`首 token ${formatDuration(ttft)}`);
		}
		if (duration != null && duration > 0) {
			timeParts.push(`回复 ${formatDuration(duration)}`);
		}
		const out = usage?.output ?? 0;
		if (duration != null && duration > 0 && out > 0) {
			const speed = Math.round(out / (duration / 1000));
			if (speed > 0) {
				timeParts.push(`${speed} tok/s`);
			}
		}
		if (timeParts.length > 0) {
			segments.push(timeParts.join(" · "));
		}

		// 2. 缓存命中
		const inp = usage?.input ?? 0;
		const cacheRead = usage?.cacheRead ?? 0;
		const totalInput = inp + cacheRead;
		if (totalInput > 0) {
			const cacheRate = Math.round((cacheRead / totalInput) * 100);
			segments.push(`缓存命中 ${cacheRate}%`);
		}

		// 3. 输入输出 Token
		if (totalInput > 0 || out > 0) {
			const tokParts: string[] = [];
			if (totalInput > 0) tokParts.push(`输入 ${formatTokCount(totalInput)}`);
			if (out > 0) tokParts.push(`输出 ${formatTokCount(out)}`);
			if (tokParts.length > 0) {
				segments.push(tokParts.join(" · "));
			}
		}

		if (segments.length === 0) continue;

		const tooltipLines: string[] = [];
		if (msg.model) tooltipLines.push(`模型: ${msg.model}`);
		if (ttft != null && ttft > 0) tooltipLines.push(`首 Token 延迟 (TTFT): ${formatDuration(ttft)}`);
		if (duration != null && duration > 0) tooltipLines.push(`回复总耗时: ${formatDuration(duration)}`);
		if (duration != null && duration > 0 && out > 0) {
			const speed = Math.round(out / (duration / 1000));
			tooltipLines.push(`生成速率: ${speed} tok/s`);
		}
		if (totalInput > 0) {
			const cacheRate = Math.round((cacheRead / totalInput) * 100);
			tooltipLines.push(`输入 Token: ${totalInput.toLocaleString()} (未缓存: ${inp.toLocaleString()}, 命中缓存: ${cacheRead.toLocaleString()}, 命中率: ${cacheRate}%)`);
		}
		if (out > 0) {
			tooltipLines.push(`输出 Token: ${out.toLocaleString()}${usage?.reasoningTokens ? ` (思考: ${usage.reasoningTokens.toLocaleString()})` : ""}`);
		}

		return {
			segments,
			tooltip: tooltipLines.join("\n"),
		};
	}
	return null;
}

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
const PROMPT_HISTORY_KEY = "omp:prompt-history";
const MAX_HISTORY = 100;

function loadPromptHistory(): string[] {
	try {
		const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

function savePromptHistory(entry: string): void {
	try {
		const list = loadPromptHistory();
		const trimmed = entry.trim();
		if (!trimmed) return;
		if (list[list.length - 1] === trimmed) return;
		list.push(trimmed);
		if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY);
		localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(list));
	} catch {
		// ignore storage quota error
	}
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
	const historyIndexRef = useRef<number | null>(null);
	const draftRef = useRef<string>("");
	const [slashDismissed, setSlashDismissed] = useState(false);
	const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);
	const [dynamicSkills, setDynamicSkills] = useState<SkillItem[]>([]);

	// 动态实时拉取当前项目与全局下的技能列表
	const refreshSkills = useCallback(async () => {
		try {
			const list = await window.omp.listSkills(thread.cwd);
			if (Array.isArray(list)) setDynamicSkills(list);
		} catch {
			// ignore
		}
	}, [thread.cwd]);

	useEffect(() => {
		void refreshSkills();
	}, [refreshSkills]);

	const allSkills = useMemo<SkillItem[]>(() => {
		const map = new Map<string, SkillItem>();
		for (const s of dynamicSkills) map.set(s.name.toLowerCase(), s);
		for (const s of thread.availableSkills ?? []) map.set(s.name.toLowerCase(), s);
		return [...map.values()];
	}, [dynamicSkills, thread.availableSkills]);

	const slashMatch = useMemo(() => {
		const isSlash = text.startsWith("/") || text.startsWith("\\");
		if (!isSlash) return null;
		const spaceIdx = text.search(/\s/);
		if (spaceIdx !== -1) return null;
		const rawQuery = text.slice(1).toLowerCase();
		const query = rawQuery.replace(/[_-]/g, "");

		const candidates: SlashCandidate[] = [];

		// 1. 本地发现的 Skills（优先项目级，然后全局级）
		for (const s of allSkills) {
			const sName = s.name.toLowerCase();
			const sNorm = sName.replace(/[_-]/g, "");
			const sDesc = (s.description || "").toLowerCase();
			const matches =
				!rawQuery ||
				sName.includes(rawQuery) ||
				sNorm.includes(query) ||
				sDesc.includes(rawQuery);

			if (matches) {
				candidates.push({
					id: `skill-${s.path}`,
					kind: "skill",
					name: s.name,
					desc: s.description || (s.scope === "project" ? "当前项目专属技能" : "全局通用技能"),
					scope: s.scope,
				});
			}
		}

		// 2. 系统内置命令
		const commands = thread.availableCommands ?? [];
		for (const c of commands) {
			if (c.name.startsWith("skill:")) continue;
			const cName = c.name.toLowerCase();
			const cNorm = cName.replace(/[_-]/g, "");
			const cDesc = (c.description || "").toLowerCase();
			const matches =
				!rawQuery ||
				cName.includes(rawQuery) ||
				cNorm.includes(query) ||
				cDesc.includes(rawQuery);

			if (matches) {
				candidates.push({
					id: `cmd-${c.name}`,
					kind: "command",
					name: c.name,
					desc: c.description || "",
					hint: c.input?.hint,
				});
			}
		}

		return candidates;
	}, [text, allSkills, thread.availableCommands]);

	const activeSkillPill = useMemo(() => {
		const trimmed = text.trim();
		const isSlash = trimmed.startsWith("/") || trimmed.startsWith("\\");
		if (!isSlash) return null;
		const match = trimmed.match(/^[\\/]([a-zA-Z0-9_-]+)/);
		if (!match) return null;
		const rawName = match[1].toLowerCase();
		const normName = rawName.replace(/[_-]/g, "");
		return (
			allSkills.find(s => s.name.toLowerCase() === rawName) ??
			allSkills.find(s => s.name.toLowerCase().replace(/[_-]/g, "") === normName) ??
			null
		);
	}, [text, allSkills]);

	const applySlashCandidate = (candidate: SlashCandidate): void => {
		const prefix = text.startsWith("\\") ? "\\" : "/";
		setText(`${prefix}${candidate.name} `);
		setSlashDismissed(true);
		playSound("toggle");
		inputRef.current?.focus();
	};
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
		if (trimmed) {
			savePromptHistory(trimmed);
		}
		historyIndexRef.current = null;
		draftRef.current = "";
		setText("");
		setAttachments([]);
		if (thread.working) {
			enqueuePrompt(
				thread.key,
				trimmed,
				message,
				images.length > 0 ? images : undefined,
				attachments.map(a => ({
					id: a.id,
					type: a.type,
					name: a.name,
					path: a.path,
					relativePath: a.type === "file" ? a.relativePath : undefined,
					mimeType: a.type === "image" ? a.mimeType : undefined,
					data: a.type === "image" ? a.data : undefined,
					previewUrl: a.type === "image" ? a.previewUrl : undefined,
				})),
			);
			return;
		}
		playSound("send");
		void sendPrompt(thread.key, message, images.length > 0 ? images : undefined);
	};

	const handleEditQueued = (queued: QueuedPrompt): void => {
		removeQueuedPrompt(thread.key, queued.id);
		setText(queued.text);
		if (queued.attachments && queued.attachments.length > 0) {
			const restored: ComposerAttachment[] = queued.attachments.map(att => {
				if (att.type === "image") {
					return {
						id: att.id,
						type: "image",
						name: att.name,
						path: att.path,
						mimeType: att.mimeType || "image/png",
						data: att.data || "",
						previewUrl: att.previewUrl || "",
					};
				}
				return {
					id: att.id,
					type: "file",
					name: att.name,
					path: att.path || att.name,
					relativePath: att.relativePath || att.name,
				};
			});
			setAttachments(restored);
		}
		inputRef.current?.focus();
	};

	useEffect(() => {
		const handleInsert = (e: Event): void => {
			const detail = (e as CustomEvent<{ text: string }>).detail;
			if (detail?.text) {
				setText(prev => (prev ? `${prev} ${detail.text}` : detail.text));
				inputRef.current?.focus();
			}
		};
		window.addEventListener("omp:insert-prompt", handleInsert);
		return () => window.removeEventListener("omp:insert-prompt", handleInsert);
	}, []);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (slashMatch && slashMatch.length > 0 && !slashDismissed) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSlashSelectedIdx(i => (i + 1) % slashMatch.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSlashSelectedIdx(i => (i - 1 + slashMatch.length) % slashMatch.length);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const target = slashMatch[slashSelectedIdx] ?? slashMatch[0];
				if (target) applySlashCandidate(target);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setSlashDismissed(true);
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
			return;
		}
		if (event.key === "ArrowUp") {
			const atStart = inputRef.current
				? inputRef.current.selectionStart === 0 && inputRef.current.selectionEnd === 0
				: text.length === 0;
			if (atStart) {
				const history = loadPromptHistory();
				if (history.length > 0) {
					event.preventDefault();
					if (historyIndexRef.current === null) {
						draftRef.current = text;
						historyIndexRef.current = history.length - 1;
						setText(history[history.length - 1]!);
					} else if (historyIndexRef.current > 0) {
						historyIndexRef.current -= 1;
						setText(history[historyIndexRef.current]!);
					}
				}
			}
			return;
		}

		if (event.key === "ArrowDown") {
			if (historyIndexRef.current !== null) {
				event.preventDefault();
				const history = loadPromptHistory();
				if (historyIndexRef.current < history.length - 1) {
					historyIndexRef.current += 1;
					setText(history[historyIndexRef.current]!);
				} else {
					historyIndexRef.current = null;
					setText(draftRef.current);
				}
			}
			return;
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
		const files: File[] = [];
		if (e.clipboardData.files && e.clipboardData.files.length > 0) {
			files.push(...Array.from(e.clipboardData.files));
		} else if (e.clipboardData.items) {
			for (const item of Array.from(e.clipboardData.items)) {
				if (item.kind === "file") {
					const file = item.getAsFile();
					if (file) files.push(file);
				}
			}
		}
		if (files.length > 0) {
			e.preventDefault();
			const newAtts = await processDroppedFiles(files, thread.cwd);
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
	const perfStats = useMemo(() => getLatestPerfStats(thread.entries), [thread.entries]);
	return (
		<>
			<QueuedPromptTray
				threadKey={thread.key}
				prompts={thread.queuedPrompts}
				onEdit={handleEditQueued}
			/>
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

			{/* 引用技能的样式胶囊 Badge */}
			{activeSkillPill && (
				<div className="cp-skill-pill">
					<div className="cp-skill-pill-left">
						<Sparkles size={13} className="cp-skill-pill-icon" />
						<span className="cp-skill-pill-name">/{activeSkillPill.name}</span>
						<span className={`sk-badge is-${activeSkillPill.scope}`}>
							{activeSkillPill.scope === "project" ? "项目专属技能" : "全局技能"}
						</span>
						{activeSkillPill.description && (
							<span className="cp-skill-pill-desc">{activeSkillPill.description}</span>
						)}
					</div>
					<button
						type="button"
						className="cp-skill-pill-close"
						title="清除技能引用"
						onClick={() => {
							const rest = text.replace(/^[\\/][a-zA-Z0-9_-]+\s*/, "");
							setText(rest);
							inputRef.current?.focus();
						}}
					>
						<X size={12} />
					</button>
				</div>
			)}

			{/* 斜杠命令与技能补全弹层 */}
			{slashMatch && slashMatch.length > 0 && !slashDismissed && (
				<div className="cp-slash-menu">
					<div className="cp-slash-head">
						<span>可用技能与命令（{slashMatch.length}）</span>
						<span>↑↓ 导航 · Enter / Tab 确认 · Esc 关闭</span>
					</div>
					<div className="cp-slash-list">
						{slashMatch.map((item, idx) => (
							<button
								key={item.id}
								type="button"
								className={`cp-slash-item${idx === slashSelectedIdx ? " is-active" : ""}`}
								onMouseDown={e => {
									e.preventDefault();
									applySlashCandidate(item);
								}}
								onMouseEnter={() => setSlashSelectedIdx(idx)}
							>
								<div className="cp-slash-item-left">
									{item.kind === "skill" ? (
										<Sparkles size={13} className="cp-slash-icon is-skill" />
									) : (
										<Terminal size={13} className="cp-slash-icon is-cmd" />
									)}
									<span className="cp-slash-item-name">/{item.name}</span>
									{item.kind === "skill" && item.scope && (
										<span className={`sk-badge is-${item.scope}`}>
											{item.scope === "project" ? "Project" : "Global"}
										</span>
									)}
								</div>
								<span className="cp-slash-item-desc">{item.desc || item.hint}</span>
							</button>
						))}
					</div>
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
							? "任务进行中... 输入新需求按 Enter 挂起排队，或可随时直接干预当前任务"
							: "输入消息，Enter 发送，Shift+Enter 换行，支持拖拽文件/图片"
				}
				disabled={!connected}
				onChange={e => {
					historyIndexRef.current = null;
					setText(e.target.value);
					setSlashDismissed(false);
					setSlashSelectedIdx(0);
				}}
				onFocus={() => void refreshSkills()}
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
					<button
						type="button"
						className="cp-send is-stop"
						title="停止"
						onClick={() => {
							playSound("error");
							void abort(thread.key);
						}}
					>
						<Square size={12} fill="currentColor" />
					</button>
				) : (
					<button
						type="button"
						className="cp-send"
						title={thread.working ? "挂起排队 (任务结束后自动执行)" : "发送"}
						disabled={!canSend}
						onClick={submit}
					>
						<ArrowUp size={16} />
					</button>
				)}
			</div>
		</div>
		{perfStats && (
			<div className="cp-footer-perf" title={perfStats.tooltip}>
				{perfStats.segments.map((seg, i) => (
					<span key={i} className="cp-perf-seg">
						{i > 0 && <span className="cp-perf-bar">|</span>}
						<span>{seg}</span>
					</span>
				))}
			</div>
		)}
		</>
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

