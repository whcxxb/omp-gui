import {
	FolderTree,
	GitBranch,
	Terminal,
	Workflow,
	X,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useState } from "react";
import type { RightPanelTab, Thread } from "@/state/types";
import { setRightPanelOpen, setRightPanelTab } from "@/state/threads";
import { SubagentPanel } from "../SubagentPanel";
import { FileTree } from "./FileTree";
import { GitPanel } from "./GitPanel";
import { TerminalPanel } from "./TerminalPanel";
const RIGHT_PANEL_WIDTH_KEY = "omp-gui.right-panel-width";
const DEFAULT_RIGHT_PANEL_WIDTH = 340;
const MIN_WIDTH = 260;
const MAX_WIDTH = 680;

function loadRightPanelWidth(): number {
	const saved = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
	const num = saved ? Number(saved) : DEFAULT_RIGHT_PANEL_WIDTH;
	return Number.isFinite(num) && num >= MIN_WIDTH && num <= MAX_WIDTH ? num : DEFAULT_RIGHT_PANEL_WIDTH;
}

interface RightPanelProps {
	thread: Thread;
	onInsertText?(text: string): void;
}

export function RightPanel({ thread, onInsertText }: RightPanelProps): ReactNode {
	const [width, setWidth] = useState<number>(loadRightPanelWidth);
	const [isDragging, setIsDragging] = useState(false);
	const [gitChangesCount, setGitChangesCount] = useState<number>(0);

	const activeTab = thread.rightPanelTab ?? "files";

	// 监听并获取 Git 变更数量用于徽标
	useEffect(() => {
		let isMounted = true;
		const checkGit = async (): Promise<void> => {
			try {
				const status = await window.omp.gitStatus(thread.cwd);
				if (isMounted) {
					setGitChangesCount(status.totalChanges);
				}
			} catch {
				if (isMounted) setGitChangesCount(0);
			}
		};
		void checkGit();
		const onWorkspaceChange = (): void => {
			void checkGit();
		};
		window.addEventListener("omp:workspace-changed", onWorkspaceChange);
		const interval = setInterval(checkGit, 10000);
		return () => {
			isMounted = false;
			clearInterval(interval);
			window.removeEventListener("omp:workspace-changed", onWorkspaceChange);
		};
	}, [thread.cwd]);

	const updateWidth = (w: number): void => {
		const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
		setWidth(next);
		localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(next));
	};

	const onMouseDownResizer = (e: MouseEvent): void => {
		e.preventDefault();
		setIsDragging(true);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const startX = e.clientX;
		const startWidth = width;

		const onMouseMove = (moveEvent: globalThis.MouseEvent): void => {
			// 拖动左侧边缘时，往左拉(变小)宽度增加，往右拉宽度减小
			const delta = startX - moveEvent.clientX;
			updateWidth(startWidth + delta);
		};

		const onMouseUp = (): void => {
			setIsDragging(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	const onDoubleClickResizer = (): void => {
		updateWidth(DEFAULT_RIGHT_PANEL_WIDTH);
	};

	const subagentCount =
		thread.subagents.filter(s => s.status === "started" || s.status === "running").length || thread.subagents.length;

	return (
		<aside
			className={`rp-panel${isDragging ? " is-resizing" : ""}`}
			style={{ width: `${width}px` }}
		>
			<div
				className="rp-resizer"
				title="拖拽调节宽度，双击重置"
				onMouseDown={onMouseDownResizer}
				onDoubleClick={onDoubleClickResizer}
			/>

			<div className="rp-header">
				<div className="rp-tabs">
					<button
						type="button"
						className={`rp-tab${activeTab === "files" ? " is-active" : ""}`}
						onClick={() => setRightPanelTab(thread.key, "files")}
					>
						<FolderTree size={13} />
						<span>文件</span>
					</button>

					<button
						type="button"
						className={`rp-tab${activeTab === "git" ? " is-active" : ""}`}
						onClick={() => setRightPanelTab(thread.key, "git")}
					>
						<GitBranch size={13} />
						<span>Git</span>
						{gitChangesCount > 0 && <span className="rp-badge">{gitChangesCount}</span>}
					</button>

					<button
						type="button"
						className={`rp-tab${activeTab === "terminal" ? " is-active" : ""}`}
						onClick={() => setRightPanelTab(thread.key, "terminal")}
					>
						<Terminal size={13} />
						<span>终端</span>
					</button>

					<button
						type="button"
						className={`rp-tab${activeTab === "subagents" ? " is-active" : ""}`}
						onClick={() => setRightPanelTab(thread.key, "subagents")}
					>
						<Workflow size={13} />
						<span>子任务</span>
						{subagentCount > 0 && <span className="rp-badge is-sub">{subagentCount}</span>}
					</button>
				</div>

				<button
					type="button"
					className="rp-close-btn"
					title="收起右侧面板"
					onClick={() => setRightPanelOpen(thread.key, false)}
				>
					<X size={13} />
				</button>
			</div>

			<div className="rp-body">
				{activeTab === "files" && <FileTree cwd={thread.cwd} onInsertText={onInsertText} />}
				{activeTab === "git" && <GitPanel cwd={thread.cwd} onInsertText={onInsertText} />}
				{activeTab === "terminal" && <TerminalPanel cwd={thread.cwd} />}
				{activeTab === "subagents" && <SubagentPanel thread={thread} />}
			</div>
		</aside>
	);
}
