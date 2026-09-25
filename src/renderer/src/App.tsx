import { FolderOpen, FolderPlus, RotateCw, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { UiRequestCard } from "./components/UiRequestCard";
import { shortPath } from "./lib/time";
import {
	closeThread,
	createThread,
	dismissNotice,
	handleRuntimeMessage,
	openThread,
	reconnect,
	useThreads,
} from "./state/threads";
import type { Thread } from "./state/types";

export function App(): ReactNode {
	const threads = useThreads();
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const [currentProject, setCurrentProject] = useState<string | null>(null);
	const [ompVersion, setOmpVersion] = useState<string | null>(null);

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
		setCurrentProject(cwd);
		// 复用当前项目里尚未发送过消息的空对话
		const blank = threads.find(t => t.cwd === cwd && t.entries.length === 0 && !t.sessionFile && t.status !== "exited");
		setActiveKey(blank ? blank.key : createThread(cwd));
	};

	const openSession = (session: SessionSummary): void => {
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

	// 被进程池回收的对话在重新选中时自动恢复
	useEffect(() => {
		if (active?.status === "exited" && !active.error) reconnect(active.key);
	}, [active?.key, active?.status, active?.error]);

	return (
		<div className="app">
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
			/>
			<main className="main">
				{active ? (
					<ThreadPane thread={active} />
				) : (
					<Welcome
						project={activeProject}
						ompVersion={ompVersion}
						onAddProject={() => void addProject()}
						onNewThread={newThread}
					/>
				)}
			</main>
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

function ThreadPane({ thread }: { thread: Thread }): ReactNode {
	const title = thread.state?.sessionName || firstPrompt(thread) || (thread.entries.length === 0 ? "新对话" : "未���名对话");
	const empty = thread.entries.length === 0 && !thread.stream && !thread.working;
	const projectName = thread.cwd.split("/").filter(Boolean).at(-1) ?? thread.cwd;

	return (
		<>
			<header className="mh">
				<div className="mh-title">{title}</div>
				<button
					type="button"
					className="mh-path"
					title="在访达中显示"
					onClick={() => void window.omp.revealPath(thread.cwd)}
				>
					<FolderOpen size={13} />
					<span>{shortPath(thread.cwd)}</span>
				</button>
			</header>

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
				<Composer thread={thread} autoFocus />
			</div>
		</>
	);
}

function Welcome(props: {
	project: string | null;
	ompVersion: string | null;
	onAddProject(): void;
	onNewThread(cwd: string): void;
}): ReactNode {
	return (
		<>
			<header className="mh" />
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
