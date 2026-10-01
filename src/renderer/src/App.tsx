import { FolderOpen, FolderPlus, PanelLeft, PanelRight, Pencil, RotateCw, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";
import { Composer } from "./components/Composer";
import { Sidebar, type SidebarThreadItem } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { RightPanel } from "./components/RightPanel";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsModal } from "./components/SettingsModal";
import { TodoHud } from "./components/TodoHud";
import { UiRequestCard } from "./components/UiRequestCard";
import { exportThreadToMarkdown } from "./lib/export";
import { playSound } from "./lib/sound";
import { applyTheme, loadTheme } from "./lib/theme";
import { shortPath } from "./lib/time";
import {
	closeThread,
	createThread,
	dismissNotice,
	getThread,
	handleRuntimeMessage,
	openThread,
	reconnect,
	renameThread,
	toggleRightPanel,
	toggleSubagentPanel,
	useThreads,
} from "./state/threads";
import type { Thread } from "./state/types";

const DEFAULT_SIDEBAR_WIDTH = 272;
const SIDEBAR_WIDTH_KEY = "omp-gui.sidebar-width";

function loadSidebarWidth(): number {
	const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
	const num = saved ? Number(saved) : DEFAULT_SIDEBAR_WIDTH;
	return Number.isFinite(num) && num >= 180 && num <= 500 ? num : DEFAULT_SIDEBAR_WIDTH;
}

export function App(): ReactNode {
	const threads = useThreads();
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const [currentProject, setCurrentProject] = useState<string | null>(null);
	const [ompVersion, setOmpVersion] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);

	const updateSidebarWidth = (w: number): void => {
		setSidebarWidth(w);
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
	};

	const resetSidebarWidth = (): void => {
		setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
	};

	const refreshProjects = useCallback(() => {
		void window.omp.listProjects().then(setProjects);
	}, []);

	useEffect(() => {
		refreshProjects();
		void window.omp.ompVersion().then(setOmpVersion);
		const offRuntime = window.omp.onRuntime(handleRuntimeMessage);
		const offProjects = window.omp.onProjectsChanged(refreshProjects);
		return () => {
			offRuntime();
			offProjects();
		};
	}, [refreshProjects]);

	const active = threads.find(t => t.key === activeKey) ?? null;
	const activeProject = active?.cwd ?? currentProject ?? projects[0]?.path ?? null;

	const newThread = (cwd: string): void => {
		playSound("switch");
		setCurrentProject(cwd);
		// 复用当前项目里尚未发送过消息的空对话
		const blank = threads.find(t => t.cwd === cwd && t.entries.length === 0 && !t.sessionFile && t.status !== "exited");
		setActiveKey(blank ? blank.key : createThread(cwd));
	};

	const openSession = (session: SessionSummary): void => {
		playSound("switch");
		setCurrentProject(session.cwd);
		setActiveKey(openThread(session.cwd, session.file));
	};

	const selectThread = (key: string): void => {
		const thread = threads.find(t => t.key === key);
		if (thread) setCurrentProject(thread.cwd);
		if (thread?.status === "exited") reconnect(key);
		setActiveKey(key);
	};

	const addProject = async (): Promise<void> => {
		const path = await window.omp.pickProject();
		if (!path) return;
		refreshProjects();
		newThread(path);
	};

	const removeProject = async (path: string): Promise<void> => {
		for (const thread of threads.filter(t => t.cwd === path)) await closeThread(thread.key);
		if (active?.cwd === path) setActiveKey(null);
		if (currentProject === path) setCurrentProject(null);
		await window.omp.removeProject(path);
		refreshProjects();
	};

	const deleteSession = async (file: string): Promise<void> => {
		const confirmed = window.confirm("确定要删除该对话记录吗？此操作将永久删除会话文件。");
		if (!confirmed) return;
		const openThreadForFile = threads.find(t => t.sessionFile === file);
		if (openThreadForFile) {
			await closeThread(openThreadForFile.key);
			if (activeKey === openThreadForFile.key) setActiveKey(null);
		}
		await window.omp.deleteSession(file);
		refreshProjects();
	};

	const handleRenameSession = async (item: SidebarThreadItem, newTitle: string): Promise<void> => {
		const trimmed = newTitle.trim();
		if (!trimmed || trimmed === item.title) return;

		if (item.thread) {
			await renameThread(item.thread.key, trimmed);
		}
		if (item.session?.file) {
			await window.omp.renameSession(item.session.file, trimmed);
			const matchingThread = threads.find(t => t.sessionFile === item.session?.file);
			if (matchingThread && (!item.thread || matchingThread.key !== item.thread.key)) {
				await renameThread(matchingThread.key, trimmed);
			}
		}
		refreshProjects();
	};

	const handleCloseThread = async (key: string): Promise<void> => {
		await closeThread(key);
		if (activeKey === key) {
			const remaining = threads.filter(t => t.key !== key && t.cwd === activeProject);
			setActiveKey(remaining[0]?.key ?? null);
		}
	};

	const toggleTheme = useCallback(() => {
		playSound("toggle");
		const current = loadTheme();
		applyTheme(current === "claude" ? "default" : "claude");
	}, []);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent): void => {
			const isMod = e.metaKey || e.ctrlKey;
			if (!isMod) return;

			if (e.key === "k" || e.key === "K") {
				e.preventDefault();
				setCmdPaletteOpen(v => !v);
				return;
			}
			if (e.key === "n" || e.key === "N") {
				e.preventDefault();
				if (activeProject) newThread(activeProject);
				return;
			}
			if (e.key === "w" || e.key === "W") {
				if (activeKey) {
					e.preventDefault();
					void closeThread(activeKey);
					setActiveKey(null);
				}
				return;
			}
			if (e.key === "b" || e.key === "B") {
				e.preventDefault();
				setSidebarOpen(v => !v);
				return;
			}
			if (e.key === "j" || e.key === "J") {
				if (activeKey) {
					e.preventDefault();
					toggleRightPanel(activeKey);
				}
				return;
			}
			if (e.shiftKey && (e.key === "e" || e.key === "E")) {
				if (activeKey) {
					e.preventDefault();
					toggleRightPanel(activeKey, "files");
				}
				return;
			}
			if (e.shiftKey && (e.key === "g" || e.key === "G")) {
				if (activeKey) {
					e.preventDefault();
					toggleRightPanel(activeKey, "git");
				}
				return;
			}
			if (e.key === "," || e.key === "，") {
				e.preventDefault();
				setSettingsOpen(v => !v);
				return;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeKey, activeProject]);
	// 被进程池回收的对话在重新选中时自动恢复
	useEffect(() => {
		if (active?.status === "exited" && !active.error) reconnect(active.key);
	}, [active?.key, active?.status, active?.error]);

	return (
		<div
			className={`app${sidebarOpen ? "" : " sb-collapsed"}`}
			style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
		>
			<Sidebar
				projects={projects}
				threads={threads}
				activeKey={activeKey}
				activeProject={activeProject}
				ompVersion={ompVersion}
				onNewThread={newThread}
				onOpenSession={openSession}
				onSelectThread={selectThread}
				onAddProject={() => void addProject()}
				onRemoveProject={path => void removeProject(path)}
				onDeleteSession={file => void deleteSession(file)}
				onCloseThread={key => void handleCloseThread(key)}
				onExportSession={(item, projectPath) => {
					playSound("export");
					if (item.thread) {
						exportThreadToMarkdown(item.thread);
					} else if (item.session) {
						const key = openThread(projectPath, item.session.file);
						setActiveKey(key);
						setTimeout(() => {
							const th = getThread(key);
							if (th) exportThreadToMarkdown(th);
						}, 250);
					}
				}}
				onRenameSession={handleRenameSession}
				onToggleSidebar={() => setSidebarOpen(v => !v)}
				sidebarWidth={sidebarWidth}
				onWidthChange={updateSidebarWidth}
				onResetWidth={resetSidebarWidth}
				isSettingsActive={settingsOpen}
				onOpenSettings={() => setSettingsOpen(v => !v)}
			/>
			<main className="main">
				{active ? (
					<ThreadPane
						thread={active}
						sidebarOpen={sidebarOpen}
						onToggleSidebar={() => setSidebarOpen(v => !v)}
					/>
				) : (
					<Welcome
						project={activeProject}
						ompVersion={ompVersion}
						sidebarOpen={sidebarOpen}
						onToggleSidebar={() => setSidebarOpen(v => !v)}
						onAddProject={() => void addProject()}
						onNewThread={newThread}
					/>
				)}
			</main>
			<CommandPalette
				isOpen={cmdPaletteOpen}
				onClose={() => setCmdPaletteOpen(false)}
				projects={projects}
				activeProject={activeProject}
				onNewThread={newThread}
				onOpenSession={openSession}
				onToggleTheme={toggleTheme}
				onToggleSidebar={() => setSidebarOpen(v => !v)}
				onOpenSettings={() => setSettingsOpen(true)}
			/>
			<SettingsModal
				isOpen={settingsOpen}
				onClose={() => setSettingsOpen(false)}
				ompVersion={ompVersion}
				onResetSidebarWidth={resetSidebarWidth}
				activeProject={activeProject}
			/>
		</div>
	);
}

/** 标题生成前用第一条用户消息兜底 */
function firstPrompt(thread: Thread): string | null {
	for (const entry of thread.entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const { content } = entry.message;
		const text = typeof content === "string" ? content : content.map(b => (b.type === "text" ? b.text : "")).join(" ");
		const line = text.replace(/\s+/g, " ").trim();
		if (line) return line.slice(0, 60);
	}
	return null;
}

function ThreadPane({
	thread,
	sidebarOpen,
	onToggleSidebar,
}: {
	thread: Thread;
	sidebarOpen: boolean;
	onToggleSidebar(): void;
}): ReactNode {
	const title = thread.state?.sessionName || firstPrompt(thread) || (thread.entries.length === 0 ? "新对话" : "未���名对话");
	const empty = thread.entries.length === 0 && !thread.stream && !thread.working;
	const projectName = thread.cwd.split("/").filter(Boolean).at(-1) ?? thread.cwd;
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [editTitleValue, setEditTitleValue] = useState("");
	const titleInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (isEditingTitle && titleInputRef.current) {
			titleInputRef.current.focus();
			titleInputRef.current.select();
		}
	}, [isEditingTitle]);

	const startRename = (): void => {
		setIsEditingTitle(true);
		setEditTitleValue(title);
	};

	const commitRename = async (): Promise<void> => {
		const trimmed = editTitleValue.trim();
		setIsEditingTitle(false);
		setEditTitleValue("");
		if (trimmed && trimmed !== title) {
			await renameThread(thread.key, trimmed);
		}
	};


	return (
		<>
			<header className="mh">
				{!sidebarOpen && (
					<>
						<div className="mh-traffic-spacer" />
						<button type="button" className="mh-sidebar-toggle" title="显示侧边栏 (⌘B)" onClick={onToggleSidebar}>
							<PanelLeft size={13} />
						</button>
					</>
				)}
				<div className="mh-title-wrap">
					{isEditingTitle ? (
						<input
							ref={titleInputRef}
							className="mh-title-input"
							value={editTitleValue}
							onChange={e => setEditTitleValue(e.target.value)}
							onKeyDown={e => {
								if (e.key === "Enter") {
									e.preventDefault();
									void commitRename();
								} else if (e.key === "Escape") {
									e.preventDefault();
									setIsEditingTitle(false);
								}
							}}
							onBlur={() => void commitRename()}
						/>
					) : (
						<>
							<div
								className="mh-title"
								title="双击或点击铅笔图标重命名当前对话"
								onDoubleClick={startRename}
							>
								{title}
							</div>
							<button
								type="button"
								className="mh-title-edit"
								title="重命名当前对话"
								onClick={startRename}
							>
								<Pencil size={11} />
							</button>
						</>
					)}
				</div>
				<div className="mh-spacer" style={{ flex: 1 }} />
				<button
					type="button"
					className="mh-path"
					title="在访达中显示"
					onClick={() => void window.omp.revealPath(thread.cwd)}
				>
					<FolderOpen size={13} />
					<span>{shortPath(thread.cwd)}</span>
				</button>
				<button
					type="button"
					className={`mh-sidebar-toggle${thread.isRightPanelOpen ? " is-active" : ""}`}
					title={thread.isRightPanelOpen ? "收起右侧栏" : "展开右侧栏"}
					onClick={() => toggleRightPanel(thread.key)}
				>
					<PanelRight size={13} />
				</button>
			</header>

			<div className="thread-stage">
				<div className="thread-content">

			{thread.notices.length > 0 && (
				<div className="nt">
					{thread.notices.slice(-3).map(n => (
						<div key={n.id} className={`nt-item is-${n.level}`}>
							<span className="nt-text">{n.message}</span>
							<button type="button" className="nt-close" title="关闭" onClick={() => dismissNotice(thread.key, n.id)}>
								<X size={12} />
							</button>
						</div>
					))}
				</div>
			)}

			{empty ? (
				<div className="hero">
					<h1 className="hero-title">要在 {projectName} 里做什么？</h1>
					{thread.status === "starting" && <p className="hero-sub">正在启动 omp</p>}
				</div>
			) : (
				<ThreadView thread={thread} />
			)}

			<div className={`dock${empty ? " is-hero" : ""}`}>
				{(thread.status === "error" || (thread.status === "exited" && thread.error)) && (
					<div className="dock-error">
						<span>{thread.error ?? "omp 进程已退出"}</span>
						<button type="button" className="btn" onClick={() => reconnect(thread.key)}>
							<RotateCw size={13} />
							重新连接
						</button>
					</div>
				)}
				{thread.uiRequests.map(request => (
					<UiRequestCard key={request.id} threadKey={thread.key} request={request} />
				))}
				<TodoHud thread={thread} />
				<Composer thread={thread} autoFocus />
			</div>
				</div>
				{thread.isRightPanelOpen && <RightPanel thread={thread} />}
			</div>
		</>
	);
}

function Welcome(props: {
	project: string | null;
	ompVersion: string | null;
	sidebarOpen: boolean;
	onToggleSidebar(): void;
	onAddProject(): void;
	onNewThread(cwd: string): void;
}): ReactNode {
	return (
		<>
			<header className="mh">
				{!props.sidebarOpen && (
					<>
						<div className="mh-traffic-spacer" />
						<button
							type="button"
							className="mh-sidebar-toggle"
							title="显示侧边栏 (⌘B)"
							onClick={props.onToggleSidebar}
						>
							<PanelLeft size={13} />
						</button>
					</>
				)}
			</header>
			<div className="hero">
				{props.ompVersion === null ? (
					<>
						<h1 className="hero-title">未检测到 omp</h1>
						<p className="hero-sub">请先安装 Oh My Pi，并确认终端里可以运行 omp 命令。</p>
					</>
				) : props.project ? (
					<>
						<h1 className="hero-title">开始新对话</h1>
						<p className="hero-sub">{shortPath(props.project)}</p>
						<button type="button" className="btn btn-primary" onClick={() => props.onNewThread(props.project!)}>
							新对话
						</button>
					</>
				) : (
					<>
						<h1 className="hero-title">添加一个项目</h1>
						<p className="hero-sub">选择代码所在的文件夹，omp 会在该目录下工作。</p>
						<button type="button" className="btn btn-primary" onClick={props.onAddProject}>
							<FolderPlus size={14} />
							添加项目
						</button>
					</>
				)}
			</div>
		</>
	);
}
