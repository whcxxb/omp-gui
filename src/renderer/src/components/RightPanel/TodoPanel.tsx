import {
	Check,
	ChevronDown,
	ChevronRight,
	CircleDashed,
	CirclePlay,
	FileText,
	Image as ImageIcon,
	Loader2,
	Paperclip,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogModel, ModelRef, TodoItem, TodoPriority, TodoStatus } from "@shared/ipc";
import { type DroppedFile, filesFromClipboard, readDroppedFiles } from "@/lib/attachments";
import { relativeTime } from "@/lib/time";
import { addTodoAttachment, createTodo, deleteTodo, loadTodos, removeTodoAttachment, reorderTodos, updateTodo, useTodos } from "@/state/todos";
import { startTodoWork } from "@/state/threads";

const STATUS_META: Record<TodoStatus, { label: string; className: string }> = {
	todo: { label: "待办", className: "is-todo" },
	doing: { label: "进行中", className: "is-doing" },
	done: { label: "已完成", className: "is-done" },
	dropped: { label: "已放弃", className: "is-dropped" },
};

const PRIORITY_META: Record<TodoPriority, { label: string; className: string }> = {
	high: { label: "高", className: "is-high" },
	normal: { label: "中", className: "is-normal" },
	low: { label: "低", className: "is-low" },
};

type Filter = "open" | "all" | "done";

export function TodoPanel({ cwd }: { cwd: string }): ReactNode {
	const todos = useTodos(cwd);
	const [filter, setFilter] = useState<Filter>("open");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [draggingId, setDraggingId] = useState<string | null>(null);

	useEffect(() => {
		void loadTodos(cwd);
	}, [cwd]);

	const grouped = useMemo(() => {
		const visible = todos.filter(item => {
			if (filter === "all") return true;
			if (filter === "done") return item.status === "done" || item.status === "dropped";
			return item.status === "todo" || item.status === "doing";
		});
		const phases = new Map<string, TodoItem[]>();
		for (const item of visible) {
			const bucket = phases.get(item.phase) ?? [];
			bucket.push(item);
			phases.set(item.phase, bucket);
		}
		return [...phases.entries()];
	}, [todos, filter]);

	const openCount = todos.filter(item => item.status === "todo" || item.status === "doing").length;
	const archivedCount = todos.filter(item => item.status === "done" || item.status === "dropped").length;

	const onDrop = async (event: DragEvent, target: TodoItem): Promise<void> => {
		event.preventDefault();
		const sourceId = draggingId ?? event.dataTransfer.getData("text/plain");
		setDraggingId(null);
		if (!sourceId || sourceId === target.id) return;
		const ids = todos.map(item => item.id);
		const from = ids.indexOf(sourceId);
		const to = ids.indexOf(target.id);
		if (from === -1 || to === -1) return;
		ids.splice(to, 0, ids.splice(from, 1)[0]!);
		await reorderTodos(cwd, ids);
	};

	return (
		<div className="td-panel">
			<div className="td-topbar">
				<div className="td-filters">
					{(["open", "all", "done"] as Filter[]).map(mode => (
						<button
							key={mode}
							type="button"
							className={`td-filter${filter === mode ? " is-active" : ""}`}
							onClick={() => setFilter(mode)}
						>
							{mode === "open" ? `未完成 ${openCount}` : mode === "all" ? `全部 ${todos.length}` : `已归档 ${archivedCount}`}
						</button>
					))}
				</div>
				<button
					type="button"
					className="rp-icon-btn"
					title="刷新"
					onClick={() => void loadTodos(cwd)}
				>
					<RefreshCw size={12} />
				</button>
				<button
					type="button"
					className="td-add-btn"
					title="新增待办"
					onClick={() => {
						setCreating(true);
						setEditingId(null);
					}}
				>
					<Plus size={13} />
				</button>
			</div>

			<div className="td-body">
				{creating && (
					<TodoEditor
						cwd={cwd}
						onClose={() => setCreating(false)}
					/>
				)}

				{grouped.length === 0 && !creating ? (
					<div className="rp-empty">
						<CircleDashed size={32} className="rp-empty-icon" />
						<div className="rp-empty-title">还没有待办</div>
						<div className="rp-empty-desc">
							点击右上角 + 新增，或直接对模型说「帮我规划下一步并放进待办清单」。
						</div>
					</div>
				) : (
					grouped.map(([phase, items]) => (
						<div key={phase} className="td-phase">
							<div className="td-phase-head">
								<ChevronDown size={11} />
								<span>{phase}</span>
								<span className="td-phase-count">{items.length}</span>
							</div>
							{items.map(item =>
								editingId === item.id ? (
									<TodoEditor key={item.id} cwd={cwd} todo={item} onClose={() => setEditingId(null)} />
								) : (
									<TodoCard
										key={item.id}
										cwd={cwd}
										todo={item}
										dragging={draggingId === item.id}
										onEdit={() => setEditingId(item.id)}
										onDragStart={() => setDraggingId(item.id)}
										onDropOn={target => void onDrop(target, item)}
									/>
								),
							)}
						</div>
					))
				)}
			</div>
		</div>
	);
}

function TodoCard({
	cwd,
	todo,
	dragging,
	onEdit,
	onDragStart,
	onDropOn,
}: {
	cwd: string;
	todo: TodoItem;
	dragging: boolean;
	onEdit(): void;
	onDragStart(): void;
	onDropOn(event: DragEvent): void;
}): ReactNode {
	const status = STATUS_META[todo.status];
	const priority = PRIORITY_META[todo.priority];
	const [thumbs, setThumbs] = useState<Record<string, string>>({});
	const latestRun = todo.runs.at(-1);

	useEffect(() => {
		let cancelled = false;
		const images = todo.attachments.filter(att => att.kind === "image" && att.blob);
		if (images.length === 0) return;
		void Promise.all(
			images.map(async att => {
				const data = att.blob ? await window.omp.readTodoAttachment(att.blob) : null;
				return [att.id, data ? `data:${att.mimeType || "image/png"};base64,${data}` : ""] as const;
			}),
		).then(entries => {
			if (!cancelled) setThumbs(Object.fromEntries(entries.filter(([, url]) => url)));
		});
		return () => {
			cancelled = true;
		};
	}, [todo.attachments]);

	const cycleStatus = async (): Promise<void> => {
		const next: TodoStatus = todo.status === "todo" ? "doing" : todo.status === "doing" ? "done" : "todo";
		await updateTodo(cwd, todo.id, { status: next });
	};

	return (
		<div
			className={`td-card${dragging ? " is-dragging" : ""}${todo.status === "done" ? " is-done" : ""}`}
			draggable
			onDragStart={onDragStart}
			onDragOver={e => e.preventDefault()}
			onDrop={onDropOn}
		>
			<div className="td-card-main">
				<button
					type="button"
					className={`td-status-dot ${status.className}`}
					title={`${status.label}（点击切换）`}
					onClick={() => void cycleStatus()}
				/>
				<div className="td-card-text">
					<div className="td-card-title">
						{todo.title}
						{todo.source === "model" && <span className="td-chip is-model">模型</span>}
						{todo.priority !== "normal" && <span className={`td-chip ${priority.className}`}>{priority.label}</span>}
					</div>
					{todo.detail.trim() && <div className="td-card-detail">{todo.detail.trim().split("\n")[0]}</div>}
					<div className="td-card-meta">
						<span>{relativeTime(todo.updatedAt)}</span>
						{todo.attachments.length > 0 && (
							<span className="td-meta-item">
								<Paperclip size={10} />
								{todo.attachments.length}
							</span>
						)}
						{latestRun?.model && <span className="td-meta-item">{latestRun.model.name ?? latestRun.model.id}</span>}
					</div>
				</div>
				<div className="td-card-actions">
					<StartWorkButton cwd={cwd} todo={todo} />
					<button type="button" className="td-icon-btn" title="编辑" onClick={onEdit}>
						<Pencil size={12} />
					</button>
					<button
						type="button"
						className="td-icon-btn is-danger"
						title="删除"
						onClick={() => void deleteTodo(cwd, todo.id)}
					>
						<Trash2 size={12} />
					</button>
				</div>
			</div>

			{(Object.keys(thumbs).length > 0 || todo.attachments.some(att => att.kind === "file")) && (
				<div className="td-attachments">
					{todo.attachments.map(att =>
						att.kind === "image" ? (
							thumbs[att.id] ? (
								<img key={att.id} src={thumbs[att.id]} alt={att.name} className="td-att-thumb" title={att.name} />
							) : null
						) : (
							<span key={att.id} className="td-att-file" title={att.path ?? att.name}>
								<FileText size={11} />
								{att.name}
							</span>
						),
					)}
				</div>
			)}

			{todo.runs.length > 0 && (
				<div className="td-runs">
					{todo.runs
						.slice(-3)
						.reverse()
						.map(run => (
							<button
								key={run.id}
								type="button"
								className="td-run"
								disabled={!run.sessionFile}
								title={run.sessionFile ? `打开执行会话：${run.sessionFile}` : "会话文件未记录"}
								onClick={() => {
									if (!run.sessionFile) return;
									window.dispatchEvent(
										new CustomEvent("omp:open-session-file", {
											detail: { cwd, sessionFile: run.sessionFile },
										}),
									);
								}}
							>
								<CirclePlay size={10} />
								<span>{run.model?.name ?? run.model?.id ?? "默认模型"}</span>
								<span className="td-run-time">{relativeTime(run.startedAt)}</span>
							</button>
						))}
				</div>
			)}
		</div>
	);
}

function StartWorkButton({ cwd, todo }: { cwd: string; todo: TodoItem }): ReactNode {
	const [open, setOpen] = useState(false);
	const [models, setModels] = useState<CatalogModel[] | null>(null);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent): void => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	useEffect(() => {
		if (!open || models) return;
		void window.omp.listCatalogModels().then(setModels);
	}, [open, models]);

	const run = async (model?: ModelRef): Promise<void> => {
		setBusy(true);
		try {
			await startTodoWork(todo, model);
			setOpen(false);
		} finally {
			setBusy(false);
		}
	};

	const q = query.trim().toLowerCase();
	const filtered = (models ?? []).filter(
		model =>
			!q ||
			model.id.toLowerCase().includes(q) ||
			model.provider.toLowerCase().includes(q) ||
			(model.name ?? "").toLowerCase().includes(q),
	);

	return (
		<div className="td-start" ref={ref}>
			<button
				type="button"
				className="td-icon-btn is-primary"
				title="开始工作（新建对话执行该待办）"
				disabled={busy}
				onClick={() => setOpen(v => !v)}
			>
				{busy ? <Loader2 size={12} className="is-spinning" /> : <CirclePlay size={12} />}
			</button>
			{open && (
				<div className="td-model-pop">
					<div className="td-model-head">选择执行模型</div>
					<input
						className="td-model-search"
						placeholder="搜索模型"
						value={query}
						onChange={e => setQuery(e.target.value)}
					/>
					<div className="td-model-list">
						{!q && (
							<button type="button" className="td-model-item is-default" onClick={() => void run(undefined)}>
								使用默认模型
							</button>
						)}
						{!models && <div className="td-model-empty">加载中…</div>}
						{models?.length === 0 && <div className="td-model-empty">未获取到模型目录（omp models 无输出）</div>}
						{models && models.length > 0 && filtered.length === 0 && <div className="td-model-empty">没有匹配的模型</div>}
						{filtered.slice(0, 100).map(model => (
							<button
								key={`${model.provider}/${model.id}`}
								type="button"
								className="td-model-item"
								onClick={() => void run({ provider: model.provider, id: model.id, name: model.name })}
							>
								<span className="td-model-name">{model.name ?? model.id}</span>
								<span className="td-model-sub">{model.provider}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function TodoEditor({ cwd, todo, onClose }: { cwd: string; todo?: TodoItem; onClose(): void }): ReactNode {
	const [title, setTitle] = useState(todo?.title ?? "");
	const [detail, setDetail] = useState(todo?.detail ?? "");
	const [phase, setPhase] = useState(todo?.phase ?? "");
	const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? "normal");
	const [busy, setBusy] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	/** 新建时尚未落盘的附件：先暂存在本地，保存待办后再写入 */
	const [staged, setStaged] = useState<DroppedFile[]>([]);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const save = async (): Promise<void> => {
		if (!title.trim() || busy) return;
		setBusy(true);
		try {
			const saved = todo
				? await updateTodo(cwd, todo.id, { title, detail, phase: phase || undefined, priority })
				: await createTodo({ cwd, title, detail, phase: phase || undefined, priority });
			// 新建流程里暂存的附件此时才有归属
			for (const file of staged) {
				await addTodoAttachment({
					cwd,
					todoId: saved.id,
					name: file.name,
					mimeType: file.mimeType,
					data: file.data,
					path: file.path || undefined,
				});
			}
			onClose();
		} finally {
			setBusy(false);
		}
	};

	const attachFiles = async (files: FileList | File[]): Promise<void> => {
		const read = await readDroppedFiles(files, cwd);
		if (read.length === 0) return;
		if (!todo) {
			// 待办尚未创建，先暂存；落盘时再统一写入
			setStaged(prev => [...prev, ...read]);
			return;
		}
		for (const file of read) {
			await addTodoAttachment({
				cwd,
				todoId: todo.id,
				name: file.name,
				mimeType: file.mimeType,
				data: file.data,
				path: file.path || undefined,
			});
		}
	};

	const attachments = todo?.attachments ?? [];

	return (
		<div
			className={`td-editor${isDragging ? " is-dragging" : ""}`}
			onDragOver={e => {
				e.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={() => setIsDragging(false)}
			onDrop={e => {
				e.preventDefault();
				setIsDragging(false);
				if (e.dataTransfer.files.length > 0) void attachFiles(e.dataTransfer.files);
			}}
			onPaste={e => {
				// 整个编辑器都可接收截图粘贴（含尚未保存的新待办）
				const files = filesFromClipboard(e.clipboardData);
				if (files.length === 0) return;
				e.preventDefault();
				void attachFiles(files);
			}}
		>
			<textarea
				ref={inputRef}
				className="td-editor-title"
				rows={1}
				placeholder="待办标题"
				value={title}
				onChange={e => setTitle(e.target.value)}
				onKeyDown={e => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						void save();
					}
					if (e.key === "Escape") onClose();
				}}
			/>
			<textarea
				className="td-editor-detail"
				rows={4}
				placeholder="详细描述（支持 Markdown，可直接粘贴截图）"
				value={detail}
				onChange={e => setDetail(e.target.value)}
			/>

			{(attachments.length > 0 || staged.length > 0) && (
				<div className="td-editor-atts">
					{todo &&
						attachments.map(att => (
							<span key={att.id} className="td-editor-att">
								{att.kind === "image" ? <ImageIcon size={11} /> : <FileText size={11} />}
								<span className="td-editor-att-name" title={att.path ?? att.name}>
									{att.name}
								</span>
								<button
									type="button"
									title="移除附件"
									onClick={() => void removeTodoAttachment(cwd, todo.id, att.id)}
								>
									<X size={10} />
								</button>
							</span>
						))}
					{staged.map((file, index) => (
						<span key={`${file.name}-${index}`} className="td-editor-att is-staged">
							{file.isImage ? <ImageIcon size={11} /> : <FileText size={11} />}
							<span className="td-editor-att-name" title={file.path || file.name}>
								{file.name}
							</span>
							<button
								type="button"
								title="移除附件"
								onClick={() => setStaged(prev => prev.filter((_, i) => i !== index))}
							>
								<X size={10} />
							</button>
						</span>
					))}
				</div>
			)}

			<button type="button" className="td-editor-advanced-toggle" onClick={() => setShowAdvanced(v => !v)}>
				{showAdvanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
				分组与优先级
			</button>
			{showAdvanced && (
				<div className="td-editor-advanced">
					<input
						className="td-editor-phase"
						placeholder="分组（默认「待办」）"
						value={phase}
						onChange={e => setPhase(e.target.value)}
					/>
					<div className="td-priority-row">
						{(Object.keys(PRIORITY_META) as TodoPriority[]).map(level => (
							<button
								key={level}
								type="button"
								className={`td-priority-opt${priority === level ? " is-active" : ""}`}
								onClick={() => setPriority(level)}
							>
								{PRIORITY_META[level].label}
							</button>
						))}
					</div>
				</div>
			)}

			<div className="td-editor-actions">
				<button type="button" className="td-editor-cancel" onClick={onClose}>
					取消
				</button>
				<button type="button" className="td-editor-save" disabled={!title.trim() || busy} onClick={() => void save()}>
					<Check size={12} />
					{todo ? "保存" : "新增"}
				</button>
			</div>
			<div className="td-editor-hint">
				{todo ? "提示：拖入或粘贴图片/文件即可作为附件保存" : "提示：可先粘贴截图，保存待办时一并写入附件"}
			</div>
		</div>
	);
}
