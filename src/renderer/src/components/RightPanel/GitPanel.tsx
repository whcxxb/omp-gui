import {
	CheckCircle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Eye,
	FileCode,
	FolderOpen,
	GitBranch,
	RefreshCw,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { GitChangedFile, GitStatusResult } from "@shared/ipc";
import { DiffView } from "./DiffView";

interface GitPanelProps {
	cwd: string;
	onInsertText?(text: string): void;
}

export function GitPanel({ cwd, onInsertText }: GitPanelProps): ReactNode {
	const [status, setStatus] = useState<GitStatusResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedFile, setSelectedFile] = useState<{ file: string; staged: boolean } | null>(null);
	const [diffContent, setDiffContent] = useState<string | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);

	const [stagedOpen, setStagedOpen] = useState(true);
	const [unstagedOpen, setUnstagedOpen] = useState(true);
	const [untrackedOpen, setUntrackedOpen] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const res = await window.omp.gitStatus(cwd);
			setStatus(res);
		} catch {
			setStatus(null);
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		void refresh();
		let timer: NodeJS.Timeout | undefined;
		const onWorkspaceChange = (): void => {
			clearTimeout(timer);
			timer = setTimeout(() => void refresh(), 300);
		};
		window.addEventListener("omp:workspace-changed", onWorkspaceChange);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("omp:workspace-changed", onWorkspaceChange);
		};
	}, [refresh]);

	const handleSelectFile = async (file: string, staged: boolean): Promise<void> => {
		if (selectedFile?.file === file && selectedFile?.staged === staged) {
			setSelectedFile(null);
			setDiffContent(null);
			return;
		}
		setSelectedFile({ file, staged });
		setDiffLoading(true);
		try {
			const diff = await window.omp.gitDiff({ cwd, file, staged });
			setDiffContent(diff);
		} catch {
			setDiffContent("无法加载代码对比");
		} finally {
			setDiffLoading(false);
		}
	};

	const handleOpenEditor = async (e: React.MouseEvent, file: string): Promise<void> => {
		e.stopPropagation();
		await window.omp.openInEditor(cwd, file);
	};

	const handleReveal = (e: React.MouseEvent, file: string): void => {
		e.stopPropagation();
		void window.omp.revealPath(`${cwd}/${file}`);
	};

	const handleAskAi = (prompt: string): void => {
		if (onInsertText) {
			onInsertText(prompt);
		}
	};

	if (!status?.isGitRepo) {
		return (
			<div className="rp-empty">
				<GitBranch size={32} className="rp-empty-icon" />
				<div className="rp-empty-title">非 Git 代码仓库</div>
				<div className="rp-empty-desc">当前目录未初始化 Git，或无 Git 访问权限</div>
			</div>
		);
	}

	const renderGroup = (
		title: string,
		files: GitChangedFile[],
		isOpen: boolean,
		setIsOpen: (fn: (v: boolean) => boolean) => void,
		staged: boolean,
	): ReactNode => {
		if (files.length === 0) return null;
		return (
			<div className="git-group">
				<button type="button" className="git-group-header" onClick={() => setIsOpen(v => !v)}>
					<div className="git-group-left">
						{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
						<span className="git-group-title">{title}</span>
					</div>
					<span className="git-group-count">{files.length}</span>
				</button>
				{isOpen && (
					<div className="git-files-list">
						{files.map(item => {
							const isSelected = selectedFile?.file === item.path && selectedFile?.staged === staged;
							return (
								<div
									key={`${staged ? "s" : "u"}-${item.path}`}
									className={`git-file-row${isSelected ? " is-selected" : ""}`}
									onClick={() => void handleSelectFile(item.path, staged)}
								>
									<span className={`git-status-badge is-${item.displayStatus}`} title={item.displayStatus}>
										{item.displayStatus[0]?.toUpperCase() ?? "M"}
									</span>
									<span className="git-file-name" title={item.path}>
										{item.path}
									</span>
									<div className="git-file-actions">
										<button
											type="button"
											className="git-action-btn"
											title="在编辑器中打开"
											onClick={e => void handleOpenEditor(e, item.path)}
										>
											<ExternalLink size={11} />
										</button>
										<button
											type="button"
											className="git-action-btn"
											title="在访达中显示"
											onClick={e => handleReveal(e, item.path)}
										>
											<FolderOpen size={11} />
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="git-panel">
			<div className="git-topbar">
				<div className="git-branch-info" title={`当前分支: ${status.branch ?? "-"}`}>
					<GitBranch size={13} className="git-branch-icon" />
					<span className="git-branch-name">{status.branch || "无分支"}</span>
					{(status.ahead > 0 || status.behind > 0) && (
						<span className="git-sync-badge">
							{status.ahead > 0 && `↑${status.ahead}`}
							{status.behind > 0 && `↓${status.behind}`}
						</span>
					)}
				</div>
				<button
					type="button"
					className={`rp-icon-btn${loading ? " is-spinning" : ""}`}
					title="刷新 Git 状态"
					onClick={() => void refresh()}
				>
					<RefreshCw size={12} />
				</button>
			</div>

			<div className="git-content">
				{status.totalChanges === 0 ? (
					<div className="rp-empty">
						<CheckCircle size={28} className="rp-empty-icon is-clean" />
						<div className="rp-empty-title">工作区已是最新状态</div>
						<div className="rp-empty-desc">没有未提交的代码改动</div>
					</div>
				) : (
					<div className="git-groups-scroll">
						{renderGroup("暂存区变更 (Staged)", status.stagedFiles, stagedOpen, setStagedOpen, true)}
						{renderGroup("更改 (Changes)", status.unstagedFiles, unstagedOpen, setUnstagedOpen, false)}
						{renderGroup("未跟踪文件 (Untracked)", status.untrackedFiles, untrackedOpen, setUntrackedOpen, false)}
					</div>
				)}

				{selectedFile && (
					<div className="git-diff-container">
						{diffLoading ? (
							<div className="rp-loading">正在读取 Diff 对比…</div>
						) : diffContent ? (
							<DiffView
								filePath={selectedFile.file}
								diff={diffContent}
								onClose={() => {
									setSelectedFile(null);
									setDiffContent(null);
								}}
								onAskAi={handleAskAi}
							/>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
