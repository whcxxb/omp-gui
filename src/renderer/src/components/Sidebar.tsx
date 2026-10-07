import {
	Archive,
	ArchiveRestore,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Compass,
	Download,
	Folder,
	FolderGit2,
	FolderOpen,
	FolderPlus,
	GitBranch,
	Loader2,
	PanelLeft,
	Pencil,
	Pin,
	PinOff,
	Search,
	Settings,
	Sparkles,
	SquarePen,
	Terminal,
	Trash2,
	X,
	Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { GitStatusResult, ProjectSummary, SessionSummary } from "@shared/ipc";
import { bucketByTimeline, relativeTime, shortPath } from "@/lib/time";
import type { Thread } from "@/state/types";

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
	onSelectProject?(path: string): void;
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
	const {
		projects,
		threads,
		activeKey,
		activeProject,
		ompVersion,
		sidebarWidth,
		onWidthChange,
		onResetWidth,
		onOpenSettings,
		onSelectProject,
		onNewThread,
		onOpenSession,
		onSelectThread,
		onAddProject,
		onRemoveProject,
		onDeleteSession,
		onExportSession,
		onRenameSession,
		onCloseThread,
		onToggleSidebar,
		isSettingsActive,
	} = props;

	const [searchQuery, setSearchQuery] = useState("");
	const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
	const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: SidebarThreadItem; projectPath: string } | null>(null);
	const [isResizing, setIsResizing] = useState(false);
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	// 快捷键 `/` 快速聚焦搜索框
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
				e.preventDefault();
				searchInputRef.current?.focus();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	// 监听 activeProject 变化，拉取轻量 Git 状态信息
	useEffect(() => {
		if (!activeProject || !window.omp?.gitStatus) {
			setGitStatus(null);
			return;
		}
		let cancelled = false;
		window.omp.gitStatus(activeProject).then(res => {
			if (!cancelled) setGitStatus(res);
		}).catch(() => {
			if (!cancelled) setGitStatus(null);
		});
		return () => {
			cancelled = true;
		};
	}, [activeProject]);

	const startResize = (e: React.MouseEvent): void => {
		e.preventDefault();
		setIsResizing(true);
		const startX = e.clientX;
		const startW = sidebarWidth;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const onMouseMove = (moveEvent: MouseEvent): void => {
			const delta = moveEvent.clientX - startX;
			const next = Math.min(Math.max(startW + delta, 200), 520);
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
		if (currentEditing && trimmed && trimmed !== item.title && onRenameSession) {
			await onRenameSession(item, trimmed);
		}
	};

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

	const [archivedExpanded, setArchivedExpanded] = useState(false);

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
						} catch {}
						return aNext;
					}
					return aPrev;
				});
			}
			try {
				localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...next]));
			} catch {}
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
						} catch {}
						return pNext;
					}
					return pPrev;
				});
			}
			try {
				localStorage.setItem(ARCHIVED_STORAGE_KEY, JSON.stringify([...next]));
			} catch {}
			return next;
		});
	};

	const threadByFile = useMemo(() => {
		const map = new Map<string, Thread>();
		for (const thread of threads) {
			const file = thread.sessionFile ?? thread.state?.sessionFile;
			if (file) map.set(file, thread);
		}
		return map;
	}, [threads]);

	// 当前选中的项目对象
	const currentProjectObj = useMemo(() => {
		return projects.find(p => p.path === activeProject) ?? projects[0] ?? null;
	}, [projects, activeProject]);

	// 当前项目的全部会话集合
	const currentProjectItems = useMemo(() => {
		if (!currentProjectObj) return [];
		const items: SidebarThreadItem[] = [];
		const seenFiles = new Set<string>();
		const seenKeys = new Set<string>();

		// 1. 已持久化的历史会话
		for (const session of currentProjectObj.sessions) {
			seenFiles.add(session.file);
			const open = threadByFile.get(session.file);
			if (open) seenKeys.add(open.key);

			if (!session.hasMessages && !open) continue;

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
		const projectThreads = threads.filter(t => t.cwd === currentProjectObj.path);
		for (const t of projectThreads) {
			if (seenKeys.has(t.key)) continue;
			const file = t.sessionFile ?? t.state?.sessionFile;
			if (file && seenFiles.has(file)) continue;

			seenKeys.add(t.key);
			const threadTime = getThreadLatestTime(t, t.updatedAt ?? t.createdAt ?? 0);
			const updatedAt = threadTime > 0 ? threadTime : (t.updatedAt ?? t.createdAt ?? 0);
			const title = t.state?.sessionName || t.titleOverride || "新对话";

			items.push({
				key: t.key,
				title,
				updatedAt,
				thread: t,
				isActive: t.key === activeKey,
			});
		}

		// 默认按最新活动时间倒序，激活项优先
		items.sort((a, b) => {
			if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
			if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
			return a.key.localeCompare(b.key);
		});

		return items;
	}, [currentProjectObj, threads, threadByFile, activeKey]);

	// 搜索过滤
	const filteredItems = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return currentProjectItems;
		return currentProjectItems.filter(item => {
			const modelName = item.thread?.state?.model?.name?.toLowerCase() || item.thread?.state?.model?.id?.toLowerCase() || "";
			return item.title.toLowerCase().includes(q) || modelName.includes(q);
		});
	}, [currentProjectItems, searchQuery]);

	// 正在运行或等待审批的活跃会话（Agent Hub 监控面）
	const liveHubItems = useMemo(() => {
		return currentProjectItems.filter(item => {
			const t = item.thread;
			if (!t) return false;
			return t.working || t.uiRequests.length > 0;
		});
	}, [currentProjectItems]);

	// 置顶项集合
	const pinnedItems = useMemo(() => {
		return filteredItems.filter(item => pinnedKeys.has(item.key));
	}, [filteredItems, pinnedKeys]);

	// 归档项集合
	const archivedItems = useMemo(() => {
		return filteredItems.filter(item => archivedKeys.has(item.key));
	}, [filteredItems, archivedKeys]);

	// 常规会话（非置顶、非归档）按时间线分组
	const timelineBuckets = useMemo(() => {
		const regulars = filteredItems.filter(item => !pinnedKeys.has(item.key) && !archivedKeys.has(item.key));
		return bucketByTimeline(regulars, item => item.updatedAt);
	}, [filteredItems, pinnedKeys, archivedKeys]);

	const renderThreadItem = (item: SidebarThreadItem, isArchivedList = false): ReactNode => {
		const isPinned = pinnedKeys.has(item.key);
		const modelName = item.thread?.state?.model?.name || item.thread?.state?.model?.id;
		const hasUiRequest = (item.thread?.uiRequests.length ?? 0) > 0;
		const isWorking = Boolean(item.thread?.working);

		return (
			<li key={item.key} className="sb-thread-li">
				<button
					type="button"
					className={`sb-thread${item.isActive ? " is-active" : ""}${isWorking ? " is-busy" : ""}${hasUiRequest ? " has-approval" : ""}`}
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
						if (item.session) onOpenSession(item.session);
						else if (item.thread) onSelectThread(item.thread.key);
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
					<div className="sb-thread-main">
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
							<div className="sb-thread-title-row">
								<span className="sb-thread-title">{item.title}</span>
							</div>
						)}
						<div className="sb-thread-meta">
							<span className="sb-thread-time">{relativeTime(item.updatedAt)}</span>
							{modelName && (
								<span className="sb-thread-badge" title={`绑定模型: ${modelName}`}>
									{modelName.split("/").pop()}
								</span>
							)}
							{item.thread?.activeTools && item.thread.activeTools.size > 0 && (
								<span className="sb-thread-tool-chip">
									{Array.from(item.thread.activeTools.values())[0]?.toolName}
								</span>
							)}
						</div>
					</div>
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
										onDeleteSession(item.session.file);
									} else if (item.thread && onCloseThread) {
										onCloseThread(item.thread.key);
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

			{/* 1. 顶栏控制面：项目切换器与折叠按钮 */}
			<div className="sb-header-bar">
				<div className="sb-project-selector-wrapper">
					<button
						type="button"
						className="sb-project-current-btn"
						title={currentProjectObj ? shortPath(currentProjectObj.path) : "选择项目"}
						onClick={() => setIsProjectMenuOpen(v => !v)}
					>
						<Folder className="sb-project-current-icon" size={14} />
						<span className="sb-project-current-name">
							{currentProjectObj?.name ?? "未选择项目"}
						</span>
						<ChevronDown size={12} className={`sb-project-chev${isProjectMenuOpen ? " is-open" : ""}`} />
					</button>
				</div>
				<div className="sb-header-tools">
					<button
						type="button"
						className="sb-icon-btn"
						title="添加本地项目"
						onClick={onAddProject}
					>
						<FolderPlus size={14} />
					</button>
					<button
						type="button"
						className="sb-icon-btn"
						title="折叠侧边栏 (⌘B)"
						onClick={onToggleSidebar}
					>
						<PanelLeft size={14} />
					</button>
				</div>
			</div>

			{/* 项目切换下拉面板 */}
			{isProjectMenuOpen && (
				<div className="sb-project-dropdown-overlay" onClick={() => setIsProjectMenuOpen(false)}>
					<div className="sb-project-dropdown" onClick={e => e.stopPropagation()}>
						<div className="sb-project-dropdown-head">
							<span>切换项目工作区</span>
							<button type="button" className="sb-icon-btn" title="添加新项目" onClick={() => { setIsProjectMenuOpen(false); onAddProject(); }}>
								<FolderPlus size={13} />
							</button>
						</div>
						<div className="sb-project-dropdown-list">
							{projects.map(p => {
								const isSelected = p.path === currentProjectObj?.path;
								const count = p.sessions.length;
								return (
									<div key={p.path} className={`sb-project-dropdown-item${isSelected ? " is-selected" : ""}`}>
										<button
											type="button"
											className="sb-project-dropdown-main"
											onClick={() => {
												setIsProjectMenuOpen(false);
												onSelectProject?.(p.path);
											}}
										>
											<Folder size={13} className="sb-item-icon" />
											<div className="sb-project-item-info">
												<span className="sb-item-title">{p.name}</span>
												<span className="sb-item-meta">{count} 个会话 · {shortPath(p.path)}</span>
											</div>
										</button>
										<button
											type="button"
											className="sb-icon-btn sb-remove-proj-btn"
											title="从列表中移除"
											onClick={e => {
												e.stopPropagation();
												onRemoveProject(p.path);
											}}
										>
											<X size={12} />
										</button>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			)}

			{/* 2. 项目工程上下文徽标（Git分支与改动感知） */}
			{currentProjectObj && (
				<div className="sb-project-banner">
					<div className="sb-project-banner-left">
						{gitStatus?.isGitRepo && (
							<span className="sb-git-chip" title={`当前 Git 分支: ${gitStatus.branch ?? "未知"}`}>
								<GitBranch size={11} />
								<span className="sb-git-branch-text">{gitStatus.branch ?? "detached"}</span>
								{(gitStatus.totalChanges ?? 0) > 0 && (
									<span className="sb-git-dirty-badge" title={`${gitStatus.totalChanges} 个未提交变更`}>
										+{gitStatus.totalChanges}
									</span>
								)}
							</span>
						)}
					</div>
					<div className="sb-project-banner-right">
						<button
							type="button"
							className="sb-banner-icon-btn"
							title="在访达中显示"
							onClick={() => void window.omp.revealPath(currentProjectObj.path)}
						>
							<FolderOpen size={12} />
						</button>
					</div>
				</div>
			)}

			{/* 3. 主操作行：即时搜索过滤框 + 新对话按钮 */}
			<div className="sb-search-action-row">
				<div className="sb-search-box">
					<Search size={13} className="sb-search-icon" />
					<input
						ref={searchInputRef}
						type="text"
						className="sb-search-input"
						placeholder="快速过滤会话... (/)"
						value={searchQuery}
						onChange={e => setSearchQuery(e.target.value)}
					/>
					{searchQuery && (
						<button
							type="button"
							className="sb-search-clear"
							title="清空搜索"
							onClick={() => setSearchQuery("")}
						>
							<X size={11} />
						</button>
					)}
				</div>
				<button
					type="button"
					className="sb-new-btn"
					disabled={!currentProjectObj}
					title="在此项目中新建对话 (⌘N)"
					onClick={() => {
						if (currentProjectObj) {
							onNewThread(currentProjectObj.path);
						}
					}}
				>
					<SquarePen size={14} />
				</button>
			</div>

			{/* 4. 会话内容滚动容器 */}
			<nav className="sb-scroll">
				{/* 4.1 活跃看板 (Live Agent Hub) */}
				{liveHubItems.length > 0 && (
					<div className="sb-live-hub">
						<div className="sb-subgroup-title sb-live-title">
							<Zap size={11} className="sb-live-icon" />
							<span>执行态看板 ({liveHubItems.length})</span>
						</div>
						<ul className="sb-threads sb-live-threads">
							{liveHubItems.map(item => renderThreadItem(item))}
						</ul>
					</div>
				)}

				{/* 4.2 置顶会话 */}
				{pinnedItems.length > 0 && (
					<div className="sb-pinned-section">
						<div className="sb-subgroup-title">
							<Pin size={10} />
							<span>置顶 ({pinnedItems.length})</span>
						</div>
						<ul className="sb-threads">
							{pinnedItems.map(item => renderThreadItem(item))}
						</ul>
					</div>
				)}

				{/* 4.3 时间线分桶列表 */}
				{timelineBuckets.map(bucket => (
					<div key={bucket.key} className="sb-timeline-group">
						<div className="sb-subgroup-title">
							<span>{bucket.label}</span>
							<span className="sb-group-count">{bucket.items.length}</span>
						</div>
						<ul className="sb-threads">
							{bucket.items.map(item => renderThreadItem(item))}
						</ul>
					</div>
				))}

				{/* 空状态提示 */}
				{filteredItems.length === 0 && (
					<div className="sb-thread-empty">
						{searchQuery ? `未找到匹配 "${searchQuery}" 的对话` : "暂无对话，点击上方新建"}
					</div>
				)}

				{/* 4.4 已归档会话折叠 */}
				{archivedItems.length > 0 && (
					<div className="sb-archive-group">
						<button
							type="button"
							className="sb-archive-toggle"
							onClick={() => setArchivedExpanded(v => !v)}
							title="已归档会话"
						>
							<ChevronRight size={12} className={`sb-chev${archivedExpanded ? " is-open" : ""}`} />
							<Archive size={12} />
							<span>已归档 ({archivedItems.length})</span>
						</button>
						{archivedExpanded && (
							<ul className="sb-threads sb-threads-archived">
								{archivedItems.map(item => renderThreadItem(item, true))}
							</ul>
						)}
					</div>
				)}
			</nav>

			{/* 5. 底部信息栏 */}
			<footer className="sb-footer">
				<button
					type="button"
					className={`sb-version-btn${isSettingsActive ? " is-active" : ""}`}
					title="打开设置 (⌘,)"
					onClick={onOpenSettings}
				>
					<Settings size={13} />
					<span className="sb-version">{ompVersion ?? "设置"}</span>
				</button>
				<span className="sb-total-count" title="当前项目对话总数">
					{currentProjectItems.length} 个对话
				</span>
			</footer>

			{/* 右键上下文菜单 */}
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
								onExportSession?.(contextMenu.item, contextMenu.projectPath);
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
									onDeleteSession(item.session.file);
								} else if (item.thread && onCloseThread) {
									onCloseThread(item.thread.key);
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
