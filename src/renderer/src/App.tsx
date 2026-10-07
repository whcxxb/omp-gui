import { Brain, FolderOpen, FolderPlus, GitBranch, ListTodo, PanelLeft, PanelRight, Pencil, RotateCw, Search, Sparkles, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";
import { Composer } from "./components/Composer";
import { Sidebar, type SidebarThreadItem } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { RightPanel } from "./components/RightPanel";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { UiRequestCard } from "./components/UiRequestCard";
import { ThreadSkeleton } from "./components/ThreadSkeleton";
import { MemoryToast, type MemoryToastData } from "./components/MemoryToast";
import { exportThreadToMarkdown } from "./lib/export";
import { playSound } from "./lib/sound";
import { applyTheme, loadTheme } from "./lib/theme";
import { shortPath } from "./lib/time";
import {
	checkThreadConnection,
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
const PROJECTS_CACHE_KEY = "omp-gui.projects-cache";
const LAST_SESSION_KEY = "omp_gui_last_session";

interface LastSessionInfo {
	cwd: string;
	sessionFile?: string;
}

function loadLastSession(): LastSessionInfo | null {
	try {
		const raw = localStorage.getItem(LAST_SESSION_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function saveLastSession(info: LastSessionInfo | null): void {
	try {
		if (info) localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(info));
		else localStorage.removeItem(LAST_SESSION_KEY);
	} catch {}
}


function loadCachedProjects(): ProjectSummary[] {
	try {
		const saved = localStorage.getItem(PROJECTS_CACHE_KEY);
		return saved ? JSON.parse(saved) : [];
	} catch {
		return [];
	}
}

function loadSidebarWidth(): number {
	const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
	const num = saved ? Number(saved) : DEFAULT_SIDEBAR_WIDTH;
	return Number.isFinite(num) && num >= 180 && num <= 500 ? num : DEFAULT_SIDEBAR_WIDTH;
}

export function App(): ReactNode {
	const threads = useThreads();
	const [projects, setProjects] = useState<ProjectSummary[]>(loadCachedProjects);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const [currentProject, setCurrentProject] = useState<string | null>(null);
	const [ompVersion, setOmpVersion] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
	const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);
	const [memoryToast, setMemoryToast] = useState<MemoryToastData | null>(null);

	const openSettings = (tab?: SettingsTab): void => {
		setSettingsInitialTab(tab);
		setSettingsOpen(true);
	};
	const updateSidebarWidth = (w: number): void => {
		setSidebarWidth(w);
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
	};

	const resetSidebarWidth = (): void => {
		setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
	};

	const refreshProjects = useCallback(() => {
		void window.omp.listProjects().then(list => {
			setProjects(list);
			try {
				localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(list));
			} catch {}
		});
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

	useEffect(() => {
		const handleSelect = (e: Event): void => {
			const detail = (e as CustomEvent<{ key: string }>).detail;
			if (detail?.key) {
				selectThread(detail.key);
			}
		};
		window.addEventListener("omp:select-thread", handleSelect);
		return () => window.removeEventListener("omp:select-thread", handleSelect);
	}, [threads]);

	useEffect(() => {
		const off = window.omp.onMemorySaved(event => {
			if (!event.memories || event.memories.length === 0) return;
			const first = event.memories[0];
			const count = event.memories.length;
			setMemoryToast({
				id: `${first.id}-${Date.now()}`,
				title: count === 1 ? "Mnemopi 记忆已沉淀" : `Mnemopi 沉淀了 ${count} 条记忆`,
				content: first.content,
				cwd: event.cwd,
			});
		});
		return off;
	}, []);

	useEffect(() => {
		const onMemoryWritten = (e: Event): void => {
			const detail = (e as CustomEvent<{ cwd: string; items: string[] }>).detail;
			if (!detail || !detail.items || detail.items.length === 0) return;
			const first = detail.items[0];
			const count = detail.items.length;
			setMemoryToast({
				id: `retain-${Date.now()}`,
				title: count === 1 ? "已保存记忆 (Retain)" : `已保存 ${count} 条记忆 (Retain)`,
				content: first,
				cwd: detail.cwd,
			});
		};
		window.addEventListener("omp:memory-written", onMemoryWritten);
		return () => window.removeEventListener("omp:memory-written", onMemoryWritten);
	}, []);

	const active = threads.find(t => t.key === activeKey) ?? null;
	const activeProject = active?.cwd ?? currentProject ?? projects[0]?.path ?? null;
	const newThread = useCallback((cwd: string): void => {
		playSound("switch");
		setCurrentProject(cwd);
		// 复用当前项目里尚未发送过消息的空对话。
		// 不能用 !sessionFile 判断：omp 进程一启动就会创建会话文件，该条件永远不成立，
		// 会导致每次点击都堆积一个「新对话」。
		const blank = threads.find(t => t.cwd === cwd && t.entries.length === 0 && !t.working && t.status !== "exited");
		setActiveKey(blank ? blank.key : createThread(cwd));
	}, [threads]);

	const openSession = useCallback((session: SessionSummary): void => {
		playSound("switch");
		setCurrentProject(session.cwd);
		setActiveKey(openThread(session.cwd, session.file));
	}, []);

	// 待办「执行记录」点击后打开对应会话
	useEffect(() => {
		const onOpenFile = (e: Event): void => {
			const detail = (e as CustomEvent<{ cwd: string; sessionFile: string }>).detail;
			if (!detail?.sessionFile) return;
			playSound("switch");
			setCurrentProject(detail.cwd);
			setActiveKey(openThread(detail.cwd, detail.sessionFile));
		};
		window.addEventListener("omp:open-session-file", onOpenFile);
		return () => window.removeEventListener("omp:open-session-file", onOpenFile);
	}, []);

	// 启动时自动恢复上一次打开的对话（或最新项目最新会话）
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current) return;
		if (projects.length === 0) return;
		restoredRef.current = true;

		const last = loadLastSession();
		if (last?.cwd) {
			const targetProj = projects.find(p => p.path === last.cwd);
			if (targetProj) {
				if (last.sessionFile) {
					const targetSession = targetProj.sessions.find(s => s.file === last.sessionFile);
					if (targetSession) {
						openSession(targetSession);
						return;
					}
				}
				if (targetProj.sessions.length > 0) {
					openSession(targetProj.sessions[0]);
					return;
				}
				newThread(targetProj.path);
				return;
			}
		}

		// 如果没有记住的会话，默认打开第一个项目的最新会话
		const firstProj = projects[0];
		if (firstProj.sessions.length > 0) {
			openSession(firstProj.sessions[0]);
		} else {
			newThread(firstProj.path);
		}
	}, [projects, newThread, openSession]);

	// 每当切换激活的对话或会话文件就绪时，持久化记录
	useEffect(() => {
		if (!active) return;
		saveLastSession({
			cwd: active.cwd,
			sessionFile: active.sessionFile ?? active.state?.sessionFile,
		});
	}, [active, active?.sessionFile, active?.state?.sessionFile]);

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

		const matchingThread = item.thread ?? threads.find(t => t.sessionFile === item.session?.file);
		if (matchingThread) await renameThread(matchingThread.key, trimmed);
		else if (item.session?.file) await window.omp.renameSession(item.session.file, trimmed);
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
			if (e.shiftKey && (e.key === "t" || e.key === "T")) {
				if (activeKey) {
					e.preventDefault();
					toggleRightPanel(activeKey, "todos");
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
				onSelectProject={path => {
					setCurrentProject(path);
					// 切换项目时，如果当前激活的会话不在新项目内，优先切换到新项目的首个已打开会话或首个历史会话
					if (active?.cwd !== path) {
						const openInTarget = threads.find(t => t.cwd === path);
						if (openInTarget) {
							selectThread(openInTarget.key);
						} else {
							const targetProj = projects.find(p => p.path === path);
							const firstSession = targetProj?.sessions.find(s => s.hasMessages);
							if (firstSession) {
								openSession(firstSession);
							} else {
								setActiveKey(null);
							}
						}
					}
				}}
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
				onOpenSettings={() => openSettings()}
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
				onOpenSettings={() => openSettings()}
				onOpenMemory={() => openSettings("memory")}
			/>
			<SettingsModal
				isOpen={settingsOpen}
				onClose={() => {
					setSettingsOpen(false);
					setSettingsInitialTab(undefined);
				}}
				ompVersion={ompVersion}
				onResetSidebarWidth={resetSidebarWidth}
				activeProject={activeProject}
				initialTab={settingsInitialTab}
			/>
			<MemoryToast
				toast={memoryToast}
				onClose={() => setMemoryToast(null)}
				onOpenMemoryManager={() => openSettings("memory")}
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

function ThreadPane(props: {
	thread: Thread;
	sidebarOpen: boolean;
	onToggleSidebar(): void;
}): ReactNode {
	const { thread, sidebarOpen, onToggleSidebar } = props;
	const title = thread.state?.sessionName || thread.titleOverride || firstPrompt(thread) || (thread.entries.length === 0 ? "新对话" : "未命名对话");
	const isLoadingSession = Boolean(thread.sessionFile && thread.entries.length === 0 && thread.status === "starting");
	const empty = !isLoadingSession && thread.entries.length === 0 && !thread.stream && !thread.working;
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

			{isLoadingSession ? (
				<ThreadSkeleton />
			) : empty ? (
				<div className="hero">
					<div className="hero-emblem">
						<Sparkles size={15} />
						<span>新对话工作区</span>
					</div>
					<h1 className="hero-title">要在 {projectName} 里做什么？</h1>
					<p className="hero-sub">{shortPath(thread.cwd)}</p>
					{thread.status === "starting" && <p className="hero-starting">正在启动 omp 核心引擎...</p>}
					<div className="hero-chips">
						<button
							type="button"
							className="hero-chip"
							onClick={() => {
								window.dispatchEvent(
									new CustomEvent("omp:insert-prompt", {
										detail: { text: "请概述当前项目的代码架构、核心模块以及主要技术栈" },
									}),
								);
							}}
						>
							<Search size={13} className="hero-chip-icon" />
							<span>梳理项目架构与核心模块</span>
						</button>
						<button
							type="button"
							className="hero-chip"
							onClick={() => {
								window.dispatchEvent(
									new CustomEvent("omp:insert-prompt", {
										detail: { text: "检查当前 Git 工作区的代码变动与状态，并给出审查总结" },
									}),
								);
							}}
						>
							<GitBranch size={13} className="hero-chip-icon" />
							<span>审查未提交的 Git 代码变更</span>
						</button>
						<button
							type="button"
							className="hero-chip"
							onClick={() => {
								window.dispatchEvent(
									new CustomEvent("omp:insert-prompt", {
										detail: { text: "审查当前项目潜在的代码隐患、类型错误或性能瓶颈" },
									}),
								);
							}}
						>
							<Sparkles size={13} className="hero-chip-icon" />
							<span>诊断潜在问题与改进点</span>
						</button>
						<button
							type="button"
							className="hero-chip"
							onClick={() => {
								window.dispatchEvent(
									new CustomEvent("omp:insert-prompt", {
										detail: { text: "我想为当前项目实现一个新功能：\n1. 功能目标：\n2. 涉及模块：\n请先提供规划方案与分步步骤。" },
									}),
								);
							}}
						>
							<ListTodo size={13} className="hero-chip-icon" />
							<span>规划新功能实施步骤</span>
						</button>
					</div>
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
				{thread.status === "ready" && thread.connectionError && (
					<div className="dock-error">
						<span>{thread.connectionError}</span>
						<button type="button" className="btn" onClick={() => void checkThreadConnection(thread.key)}>
							<RotateCw size={13} />
							检查连接
						</button>
					</div>
				)}
				{thread.uiRequests.map(request => (
					<UiRequestCard key={request.id} threadKey={thread.key} request={request} />
				))}
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
