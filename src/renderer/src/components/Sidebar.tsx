import { Archive, ArchiveRestore, ChevronRight, Download, Folder, FolderPlus, PanelLeft, Pencil, Pin, PinOff, Settings, SquarePen, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";
import { relativeTime, shortPath } from "@/lib/time";
import type { Thread } from "@/state/types";

const COLLAPSED_LIMIT = 6;
const PINNED_STORAGE_KEY = "omp_gui_pinned_sessions";
const ARCHIVED_STORAGE_KEY = "omp_gui_archived_sessions";

export interface SidebarThreadItem {
	key: string;
	title: string;
	updatedAt: number;
	thread?: Thread;
	session?: SessionSummary;
	isActive: boolean;
}

function getThreadLatestTime(thread: Thread, fallback = 0): number {
	if (thread.working) return Date.now();
	if (thread.entries.length > 0) {
		const last = thread.entries[thread.entries.length - 1];
		if (last.type === "message") {
			const raw = last.message.timestamp || last.timestamp;
			const ts = typeof raw === "number" ? raw : Date.parse(raw);
			if (!isNaN(ts)) return ts;
		} else if (last.timestamp) {
			const ts = Date.parse(last.timestamp);
			if (!isNaN(ts)) return ts;
		}
	}
	return fallback;
}

interface SidebarProps {
	projects: ProjectSummary[];
	threads: Thread[];
	activeKey: string | null;
	activeProject: string | null;
	ompVersion: string | null;
	isSettingsActive?: boolean;
	onNewThread(cwd: string): void;
	onOpenSession(session: SessionSummary): void;
	onSelectThread(key: string): void;
	onAddProject(): void;
	onRemoveProject(path: string): void;
	onDeleteSession(file: string): void;
	onExportSession?(item: SidebarThreadItem, projectPath: string): void;
	onRenameSession?(item: SidebarThreadItem, newTitle: string): Promise<void> | void;
	onCloseThread?(key: string): void;
	onToggleSidebar(): void;
	sidebarWidth: number;
	onWidthChange(width: number): void;
	onResetWidth(): void;
	onOpenSettings(): void;
}

export function Sidebar(props: SidebarProps): ReactNode {
	const { projects, threads, activeKey, activeProject, ompVersion, sidebarWidth, onWidthChange, onResetWidth, onOpenSettings } = props;
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: SidebarThreadItem; projectPath: string } | null>(null);
	const [isResizing, setIsResizing] = useState(false);

	const startResize = (e: React.MouseEvent): void => {
		e.preventDefault();
		setIsResizing(true);
		const startX = e.clientX;
		const startW = sidebarWidth;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const onMouseMove = (moveEvent: MouseEvent): void => {
			const delta = moveEvent.clientX - startX;
			const next = Math.min(Math.max(startW + delta, 180), 500);
			onWidthChange(next);
		};

		const onMouseUp = (): void => {
			setIsResizing(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const renameInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (editingKey && renameInputRef.current) {
			renameInputRef.current.focus();
			renameInputRef.current.select();
		}
	}, [editingKey]);

	const startRenaming = (item: SidebarThreadItem, e?: React.MouseEvent): void => {
		e?.stopPropagation();
		e?.preventDefault();
		setEditingKey(item.key);
		setRenameValue(item.title);
	};

	const cancelRenaming = (): void => {
		setEditingKey(null);
		setRenameValue("");
	};

	const commitRenaming = async (item: SidebarThreadItem): Promise<void> => {
		const trimmed = renameValue.trim();
		const currentEditing = editingKey;
		setEditingKey(null);
		setRenameValue("");
		if (currentEditing && trimmed && trimmed !== item.title && props.onRenameSession) {
			await props.onRenameSession(item, trimmed);
		}
	};

	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(() => {
		try {
			const raw = localStorage.getItem(PINNED_STORAGE_KEY);
			return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
		} catch {
			return new Set();
		}
	});

	const [archivedKeys, setArchivedKeys] = useState<Set<string>>(() => {
		try {
			const raw = localStorage.getItem(ARCHIVED_STORAGE_KEY);
			return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
		} catch {
			return new Set();
		}
	});

	const [archivedExpanded, setArchivedExpanded] = useState<Set<string>>(new Set());

	const togglePin = (targetKey: string): void => {
		setPinnedKeys(prev => {
			const next = new Set(prev);
			if (next.has(targetKey)) {
				next.delete(targetKey);
			} else {
				next.add(targetKey);
				// 置顶时自动解除归档
				setArchivedKeys(aPrev => {
					if (aPrev.has(targetKey)) {
						const aNext = new Set(aPrev);
						aNext.delete(targetKey);
						try {
							localStorage.setItem(ARCHIVED_STORAGE_KEY, JSON.stringify([...aNext]));
						} catch {
							// ignore
						}
						return aNext;
					}
					return aPrev;
				});
			}
			try {
				localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...next]));
			} catch {
				// ignore
			}
			return next;
		});
	};

	const toggleArchive = (targetKey: string): void => {
		setArchivedKeys(prev => {
			const next = new Set(prev);
			if (next.has(targetKey)) {
				next.delete(targetKey);
			} else {
				next.add(targetKey);
				// 归档时自动取消置顶
				setPinnedKeys(pPrev => {
					if (pPrev.has(targetKey)) {
						const pNext = new Set(pPrev);
						pNext.delete(targetKey);
						try {
							localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...pNext]));
						} catch {
							// ignore
						}
						return pNext;
					}
					return pPrev;
				});
			}
			try {
				localStorage.setItem(ARCHIVED_STORAGE_KEY, JSON.stringify([...next]));
			} catch {
				// ignore
			}
			return next;
		});
	};

	const toggle = (set: Set<string>, value: string): Set<string> => {
		const next = new Set(set);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		return next;
	};

	const threadByFile = useMemo(() => {
		const map = new Map<string, Thread>();
		for (const thread of threads) {
			const file = thread.sessionFile ?? thread.state?.sessionFile;
			if (file) map.set(file, thread);
		}
		return map;
	}, [threads]);

	// 项目内对话按最新的修改时间统一降序排序
	const projectThreadItems = useMemo(() => {
		const map = new Map<string, SidebarThreadItem[]>();

		for (const project of projects) {
			const items: SidebarThreadItem[] = [];
			const seenFiles = new Set<string>();
			const seenKeys = new Set<string>();

			// 1. 已持久化的历史会话
			for (const session of project.sessions) {
				seenFiles.add(session.file);
				const open = threadByFile.get(session.file);
				if (open) seenKeys.add(open.key);

				const threadTime = open ? getThreadLatestTime(open, session.updatedAt) : session.updatedAt;
				const updatedAt = Math.max(session.updatedAt, threadTime);
				const title = open?.state?.sessionName || session.title || "未命名对话";

				items.push({
					key: session.file,
					title,
					updatedAt,
					thread: open,
					session,
					isActive: open ? open.key === activeKey : false,
				});
			}

			// 2. 当前项目中已打开但尚未写入会话文件的对话（如新对话）
			const projectThreads = threads.filter(t => t.cwd === project.path);
			for (const t of projectThreads) {
				if (seenKeys.has(t.key)) continue;
				const file = t.sessionFile ?? t.state?.sessionFile;
				if (file && seenFiles.has(file)) continue;

				seenKeys.add(t.key);
				const threadTime = getThreadLatestTime(t, t.updatedAt ?? t.createdAt ?? 0);
				const updatedAt = threadTime > 0 ? threadTime : (t.updatedAt ?? t.createdAt ?? 0);
				const title = t.state?.sessionName || "新对话";

				items.push({
					key: t.key,
					title,
					updatedAt,
					thread: t,
					isActive: t.key === activeKey,
				});
			}

			// 按最新的修改/活动时间从新到旧排序，时间相同时按 key 稳定排序
			items.sort((a, b) => {
				if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
				return a.key.localeCompare(b.key);
			});
			map.set(project.path, items);
		}

		return map;
	}, [projects, threads, threadByFile, activeKey]);

	const renderThreadItem = (item: SidebarThreadItem, isArchivedList = false): ReactNode => {
		const isPinned = pinnedKeys.has(item.key);

		return (
			<li key={item.key} className="sb-thread-li">
				<button
					type="button"
					className={`sb-thread${item.isActive ? " is-active" : ""}`}
					title={`${item.title} · ${relativeTime(item.updatedAt)} (可拖拽到输入框引入)`}
					draggable={editingKey !== item.key}
					onDragStart={e => {
						if (editingKey === item.key) {
							e.preventDefault();
							return;
						}
						const payload = {
							type: "session",
							title: item.title,
							file: item.session?.file,
							threadKey: item.thread?.key ?? (item.session ? undefined : item.key),
							cwd: item.session?.cwd ?? (item.thread?.cwd ?? ""),
						};
						e.dataTransfer.setData("application/x-omp-session", JSON.stringify(payload));
						e.dataTransfer.setData("text/plain", `[对话记录: ${item.title}]`);
						e.dataTransfer.effectAllowed = "copyLink";
					}}
					onClick={() => {
						if (editingKey === item.key) return;
						if (item.session) props.onOpenSession(item.session);
						else if (item.thread) props.onSelectThread(item.thread.key);
					}}
					onDoubleClick={e => startRenaming(item, e)}
					onContextMenu={e => {
						e.preventDefault();
						e.stopPropagation();
						setContextMenu({
							x: e.clientX,
							y: e.clientY,
							item,
							projectPath: item.session?.cwd ?? (item.thread?.cwd ?? ""),
						});
					}}
				>
					<ThreadDot thread={item.thread} />
					{editingKey === item.key ? (
						<input
							ref={renameInputRef}
							className="sb-thread-rename-input"
							value={renameValue}
							onClick={e => e.stopPropagation()}
							onChange={e => setRenameValue(e.target.value)}
							onKeyDown={e => {
								if (e.key === "Enter") {
									e.preventDefault();
									void commitRenaming(item);
								} else if (e.key === "Escape") {
									e.preventDefault();
									cancelRenaming();
								}
							}}
							onBlur={() => void commitRenaming(item)}
						/>
					) : (
						<span className="sb-thread-title">{item.title}</span>
					)}
					<div className="sb-thread-actions" onClick={e => e.stopPropagation()}>
						{!isArchivedList && editingKey !== item.key && (
							<button
								type="button"
								className={`sb-thread-pin${isPinned ? " is-pinned" : ""}`}
								title={isPinned ? "取消置顶" : "置顶此对话"}
								onClick={e => {
									e.stopPropagation();
									togglePin(item.key);
								}}
							>
								{isPinned ? <PinOff size={11} /> : <Pin size={11} />}
							</button>
						)}
						{editingKey !== item.key && (
							<button
								type="button"
								className="sb-thread-rename"
								title="重命名此对话"
								onClick={e => startRenaming(item, e)}
							>
								<Pencil size={11} />
							</button>
						)}
						{(item.session || item.thread) && editingKey !== item.key && (
							<button
								type="button"
								className="sb-thread-delete"
								title={item.session ? "删除此会话" : "关闭此新对话"}
								onClick={e => {
									e.stopPropagation();
									if (item.session) {
										props.onDeleteSession(item.session.file);
									} else if (item.thread && props.onCloseThread) {
										props.onCloseThread(item.thread.key);
									}
								}}
							>
								<Trash2 size={12} />
							</button>
						)}
					</div>
				</button>
			</li>
		);
	};

	return (
		<aside className="sb">
			<div
				className={`sb-resizer${isResizing ? " is-resizing" : ""}`}
				onMouseDown={startResize}
				onDoubleClick={onResetWidth}
				title="拖拽调整侧边栏宽度，双击恢复默认"
			/>
			<div className="sb-titlebar">
				<button
					type="button"
					className="sb-titlebar-toggle"
					title="折叠侧边栏 (⌘B)"
					onClick={props.onToggleSidebar}
				>
					<PanelLeft size={14} />
				</button>
			</div>
			<div className="sb-actions">
				<button
					type="button"
					className="sb-action"
					disabled={!activeProject}
					onClick={() => activeProject && props.onNewThread(activeProject)}
				>
					<SquarePen size={15} />
					<span>新对话</span>
				</button>
			</div>

			<div className="sb-section-head">
				<span>项目</span>
				<button type="button" className="sb-icon-btn" title="添加项目" onClick={props.onAddProject}>
					<FolderPlus size={14} />
				</button>
			</div>

			<nav className="sb-scroll">
				{projects.length === 0 && (
					<div className="sb-empty">
						还没有项目。
						<button type="button" className="sb-link" onClick={props.onAddProject}>
							添加项目
						</button>
					</div>
				)}
				{projects.map(project => {
					const isCollapsed = collapsed.has(project.path);
					const allItems = projectThreadItems.get(project.path) ?? [];
					const pinnedItems = allItems.filter(item => pinnedKeys.has(item.key));
					const archivedItems = allItems.filter(item => archivedKeys.has(item.key));
					const activeItems = allItems.filter(item => !pinnedKeys.has(item.key) && !archivedKeys.has(item.key));
					const showAll = expanded.has(project.path);
					const visibleActiveItems = showAll ? activeItems : activeItems.slice(0, COLLAPSED_LIMIT);
					const isArchiveOpen = archivedExpanded.has(project.path);

					return (
						<div key={project.path} className="sb-project">
							<div className={`sb-project-row${project.path === activeProject ? " is-current" : ""}`}>
								<button
									type="button"
									className="sb-project-toggle"
									title={shortPath(project.path)}
									onClick={() => setCollapsed(s => toggle(s, project.path))}
								>
									<ChevronRight size={12} className={`sb-chev${isCollapsed ? "" : " is-open"}`} />
									<Folder size={14} />
									<span className={`sb-project-name${project.missing ? " is-missing" : ""}`}>{project.name}</span>
								</button>
								<div className="sb-row-tools">
									<button
										type="button"
										className="sb-icon-btn"
										title="在此项目中新建对话"
										disabled={project.missing}
										onClick={() => props.onNewThread(project.path)}
									>
										<SquarePen size={13} />
									</button>
									<button
										type="button"
										className="sb-icon-btn"
										title="从列表中移除"
										onClick={() => props.onRemoveProject(project.path)}
									>
										<X size={13} />
									</button>
								</div>
							</div>
							{!isCollapsed && (
								<div className="sb-project-threads">
									{pinnedItems.length > 0 && (
										<div className="sb-pinned-section">
											<div className="sb-subgroup-title">
												<Pin size={10} />
												<span>置顶</span>
											</div>
											<ul className="sb-threads">
												{pinnedItems.map(item => renderThreadItem(item))}
											</ul>
										</div>
									)}

									<ul className="sb-threads">
										{visibleActiveItems.map(item => renderThreadItem(item))}
									</ul>

									{activeItems.length > COLLAPSED_LIMIT && (
										<button
											type="button"
											className="sb-more"
											onClick={() => setExpanded(s => toggle(s, project.path))}
										>
											{showAll ? "收起" : `显示全部 ${activeItems.length} 个`}
										</button>
									)}

									{archivedItems.length > 0 && (
										<div className="sb-archive-group">
											<button
												type="button"
												className="sb-archive-toggle"
												onClick={() => setArchivedExpanded(s => toggle(s, project.path))}
												title="已归档会话"
											>
												<ChevronRight size={12} className={`sb-chev${isArchiveOpen ? " is-open" : ""}`} />
												<Archive size={12} />
												<span>已归档 ({archivedItems.length})</span>
											</button>
											{isArchiveOpen && (
												<ul className="sb-threads sb-threads-archived">
													{archivedItems.map(item => renderThreadItem(item, true))}
												</ul>
											)}
										</div>
									)}

									{pinnedItems.length === 0 && activeItems.length === 0 && archivedItems.length === 0 && (
										<div className="sb-thread-empty">暂无对话</div>
									)}
								</div>
							)}
						</div>
					);
				})}
			</nav>

			<footer className="sb-footer">
				<button
					type="button"
					className={`sb-version-btn${props.isSettingsActive ? " is-active" : ""}`}
					title="打开设置 (⌘,)"
					onClick={onOpenSettings}
				>
					<Settings size={13} />
					<span className="sb-version">{ompVersion ?? "设置"}</span>
				</button>
			</footer>

			{contextMenu && (
				<div
					className="sb-context-overlay"
					onClick={() => setContextMenu(null)}
					onContextMenu={e => {
						e.preventDefault();
						setContextMenu(null);
					}}
				>
					<div
						className="sb-context-menu"
						style={{
							top: Math.min(contextMenu.y, window.innerHeight - 200),
							left: Math.min(contextMenu.x, window.innerWidth - 180),
						}}
						onClick={e => e.stopPropagation()}
					>
						{pinnedKeys.has(contextMenu.item.key) ? (
							<button
								type="button"
								className="sb-context-item"
								onClick={() => {
									togglePin(contextMenu.item.key);
									setContextMenu(null);
								}}
							>
								<PinOff size={13} />
								<span>取消置顶</span>
							</button>
						) : (
							<button
								type="button"
								className="sb-context-item"
								onClick={() => {
									togglePin(contextMenu.item.key);
									setContextMenu(null);
								}}
							>
								<Pin size={13} />
								<span>置顶会话</span>
							</button>
						)}

						{archivedKeys.has(contextMenu.item.key) ? (
							<button
								type="button"
								className="sb-context-item"
								onClick={() => {
									toggleArchive(contextMenu.item.key);
									setContextMenu(null);
								}}
							>
								<ArchiveRestore size={13} />
								<span>取消归档</span>
							</button>
						) : (
							<button
								type="button"
								className="sb-context-item"
								onClick={() => {
									toggleArchive(contextMenu.item.key);
									setContextMenu(null);
								}}
							>
								<Archive size={13} />
								<span>归档会话</span>
							</button>
						)}

						<div className="sb-context-sep" />

						<button
							type="button"
							className="sb-context-item"
							onClick={() => {
								props.onExportSession?.(contextMenu.item, contextMenu.projectPath);
								setContextMenu(null);
							}}
						>
							<Download size={13} />
							<span>导出为 Markdown</span>
						</button>
						<button
							type="button"
							className="sb-context-item"
							onClick={e => {
								startRenaming(contextMenu.item, e);
								setContextMenu(null);
							}}
						>
							<Pencil size={13} />
							<span>重命名</span>
						</button>
						<div className="sb-context-sep" />
						<button
							type="button"
							className="sb-context-item is-danger"
							onClick={() => {
								const { item } = contextMenu;
								if (item.session) {
									props.onDeleteSession(item.session.file);
								} else if (item.thread && props.onCloseThread) {
									props.onCloseThread(item.thread.key);
								}
								setContextMenu(null);
							}}
						>
							<Trash2 size={13} />
							<span>删除此对话</span>
						</button>
					</div>
				</div>
			)}
		</aside>
	);
}

function ThreadDot({ thread }: { thread: Thread | undefined }): ReactNode {
	if (!thread) return null;
	// 仅在有待确认操作或任务正在执行时展示状态指示点；普通已就绪/空闲状态不展示圆点
	if (thread.uiRequests.length > 0) return <span className="sb-dot is-attention" title="等待你的确认" />;
	if (thread.working) return <span className="sb-dot is-working" title="执行中" />;
	return null;
}
