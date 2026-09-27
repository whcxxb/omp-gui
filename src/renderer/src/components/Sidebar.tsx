import { ChevronRight, Folder, FolderPlus, PanelLeft, Settings, SquarePen, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";
import { relativeTime, shortPath } from "@/lib/time";
import type { Thread } from "@/state/types";

const COLLAPSED_LIMIT = 6;

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
	onToggleSidebar(): void;
	sidebarWidth: number;
	onWidthChange(width: number): void;
	onResetWidth(): void;
	onOpenSettings(): void;
}

export function Sidebar(props: SidebarProps): ReactNode {
	const { projects, threads, activeKey, activeProject, ompVersion, sidebarWidth, onWidthChange, onResetWidth, onOpenSettings } = props;
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
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const toggle = (set: Set<string>, value: string): Set<string> => {
		const next = new Set(set);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		return next;
	};

	// 已打开但尚未写入会话文件的新对话
	const pendingByProject = new Map<string, Thread[]>();
	for (const thread of threads) {
		const file = thread.sessionFile ?? thread.state?.sessionFile;
		const listed = file && projects.some(p => p.sessions.some(s => s.file === file));
		if (listed) continue;
		const list = pendingByProject.get(thread.cwd) ?? [];
		list.push(thread);
		pendingByProject.set(thread.cwd, list);
	}

	const threadByFile = new Map<string, Thread>();
	for (const thread of threads) {
		const file = thread.sessionFile ?? thread.state?.sessionFile;
		if (file) threadByFile.set(file, thread);
	}

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
					const pending = pendingByProject.get(project.path) ?? [];
					const showAll = expanded.has(project.path);
					const sessions = showAll ? project.sessions : project.sessions.slice(0, COLLAPSED_LIMIT);
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
								<ul className="sb-threads">
									{pending.map(thread => (
										<li key={thread.key}>
											<button
												type="button"
												className={`sb-thread${thread.key === activeKey ? " is-active" : ""}`}
												onClick={() => props.onSelectThread(thread.key)}
											>
												<ThreadDot thread={thread} />
												<span className="sb-thread-title">{thread.state?.sessionName || "新对话"}</span>
											</button>
										</li>
									))}
									{sessions.map(session => {
										const open = threadByFile.get(session.file);
										const sessionTitle = open?.state?.sessionName || session.title || "未命名对话";
										return (
											<li key={session.file}>
												<button
													type="button"
													className={`sb-thread${open && open.key === activeKey ? " is-active" : ""}`}
													title={`${sessionTitle} · ${relativeTime(session.updatedAt)}`}
													onClick={() => props.onOpenSession(session)}
												>
													<ThreadDot thread={open} />
													<span className="sb-thread-title">{sessionTitle}</span>
													<button
														type="button"
														className="sb-thread-delete"
														title="删除此会话"
														onClick={e => {
															e.stopPropagation();
															props.onDeleteSession(session.file);
														}}
													>
														<Trash2 size={12} />
													</button>
												</button>
											</li>
										);
									})}
									{project.sessions.length > COLLAPSED_LIMIT && (
										<li>
											<button
												type="button"
												className="sb-more"
												onClick={() => setExpanded(s => toggle(s, project.path))}
											>
												{showAll ? "收起" : `显示全部 ${project.sessions.length} 个`}
											</button>
										</li>
									)}
									{pending.length === 0 && project.sessions.length === 0 && (
										<li className="sb-thread-empty">暂无对话</li>
									)}
								</ul>
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
