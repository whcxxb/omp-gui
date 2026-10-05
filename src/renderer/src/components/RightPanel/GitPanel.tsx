import {
	ArrowLeft,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Clock,
	Compass,
	ExternalLink,
	Eye,
	FileCode,
	FolderOpen,
	GitBranch,
	GitCommit,
	History,
	Layers,
	ListFilter,
	RefreshCw,
	Sparkles,
	User,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { GitChangedFile, GitCommitDetail, GitCommitSummary, GitStatusResult } from "@shared/ipc";
import { categorizeFilePath, DIFF_CATEGORIES, type DiffCategory } from "@/lib/diff-categorizer";
import { DiffView } from "./DiffView";

interface GitPanelProps {
	cwd: string;
	onInsertText?(text: string): void;
}

export function GitPanel({ cwd, onInsertText }: GitPanelProps): ReactNode {
	const [status, setStatus] = useState<GitStatusResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [activeSubTab, setActiveSubTab] = useState<"changes" | "commits">("changes");
	const [groupByScope, setGroupByScope] = useState(false);
	// 变更 Tab 状态
	const [selectedFile, setSelectedFile] = useState<{ file: string; staged: boolean } | null>(null);
	const [diffContent, setDiffContent] = useState<string | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);
	const [stagedOpen, setStagedOpen] = useState(true);
	const [unstagedOpen, setUnstagedOpen] = useState(true);
	const [untrackedOpen, setUntrackedOpen] = useState(true);
	const [scopeOpenMap, setScopeOpenMap] = useState<Record<string, boolean>>({});
	// 提交历史 Tab 状态
	const [commits, setCommits] = useState<GitCommitSummary[]>([]);
	const [commitsLoading, setCommitsLoading] = useState(false);
	const [selectedCommit, setSelectedCommit] = useState<GitCommitDetail | null>(null);
	const [commitFileDiff, setCommitFileDiff] = useState<{ file: string; diff: string } | null>(null);
	const [commitDiffLoading, setCommitDiffLoading] = useState(false);

	const refreshStatus = useCallback(async () => {
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

	const refreshCommits = useCallback(async () => {
		setCommitsLoading(true);
		try {
			const list = await window.omp.gitLog(cwd, 40);
			setCommits(list);
		} catch {
			setCommits([]);
		} finally {
			setCommitsLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		void refreshStatus();
		if (activeSubTab === "commits") {
			void refreshCommits();
		}
		let timer: NodeJS.Timeout | undefined;
		const onWorkspaceChange = (): void => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				void refreshStatus();
				if (activeSubTab === "commits") void refreshCommits();
			}, 300);
		};
		window.addEventListener("omp:workspace-changed", onWorkspaceChange);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("omp:workspace-changed", onWorkspaceChange);
		};
	}, [refreshStatus, refreshCommits, activeSubTab]);

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

	const handleSelectCommit = async (hash: string): Promise<void> => {
		setCommitFileDiff(null);
		setCommitsLoading(true);
		try {
			const detail = await window.omp.gitCommitDetail(cwd, hash);
			setSelectedCommit(detail);
		} catch {
			setSelectedCommit(null);
		} finally {
			setCommitsLoading(false);
		}
	};

	const handleSelectCommitFile = async (hash: string, file: string): Promise<void> => {
		if (commitFileDiff?.file === file) {
			setCommitFileDiff(null);
			return;
		}
		setCommitDiffLoading(true);
		try {
			const diff = await window.omp.gitCommitDiff(cwd, hash, file);
			setCommitFileDiff({ file, diff });
		} catch {
			setCommitFileDiff({ file, diff: "无法获取该提交文件差异" });
		} finally {
			setCommitDiffLoading(false);
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

	const allChanges = useMemo(() => {
		if (!status) return [];
		const list: Array<GitChangedFile & { staged: boolean; category: DiffCategory }> = [];
		for (const f of status.stagedFiles) {
			list.push({ ...f, staged: true, category: categorizeFilePath(f.path) });
		}
		for (const f of status.unstagedFiles) {
			list.push({ ...f, staged: false, category: categorizeFilePath(f.path) });
		}
		for (const f of status.untrackedFiles) {
			list.push({ ...f, staged: false, category: categorizeFilePath(f.path) });
		}
		return list;
	}, [status]);

	const scopeGroups = useMemo(() => {
		const map = new Map<DiffCategory, Array<GitChangedFile & { staged: boolean }>>();
		for (const item of allChanges) {
			const arr = map.get(item.category) ?? [];
			arr.push(item);
			map.set(item.category, arr);
		}
		return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
	}, [allChanges]);

	const handleAskAiScopeReview = (): void => {
		if (!onInsertText || allChanges.length === 0) return;
		const scopesSummary = scopeGroups
			.map(([cat, files]) => `- ${DIFF_CATEGORIES[cat].label} (${DIFF_CATEGORIES[cat].shortLabel}): ${files.length} 个文件 (${files.map(f => f.path).slice(0, 3).join(", ")}${files.length > 3 ? " 等" : ""})`)
			.join("\n");
		const prompt = `请参考 pulls.review / Linear PR Guides 风格，对当前工作区的 ${allChanges.length} 处变更进行分层审查指导：\n\n### 变更范畴分布：\n${scopesSummary}\n\n请按 Scope 梳理各模块的变更意图、架构影响、潜在隐患与测试要点。`;
		onInsertText(prompt);
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
									key={item.path}
									className={`git-file-row${isSelected ? " is-selected" : ""}`}
									onClick={() => void handleSelectFile(item.path, staged)}
								>
									<span className={`git-status-badge is-${item.displayStatus}`} title={item.displayStatus}>
										{item.displayStatus === "modified" && "M"}
										{item.displayStatus === "added" && "A"}
										{item.displayStatus === "deleted" && "D"}
										{item.displayStatus === "renamed" && "R"}
										{item.displayStatus === "copied" && "C"}
										{item.displayStatus === "untracked" && "U"}
									</span>

									{(() => {
										const cat = categorizeFilePath(item.path);
										const meta = DIFF_CATEGORIES[cat];
										return (
											<span
												className="git-scope-pill"
												style={{ color: meta.color, background: meta.bgColor, borderColor: meta.borderColor }}
												title={`${meta.label}: ${meta.description}`}
											>
												{meta.shortLabel}
											</span>
										);
									})()}

									<span className="git-file-name" title={item.path}>
										{item.path}
									</span>
									<div className="git-file-actions">
										<button
											type="button"
											className="git-action-btn"
											title="查看代码差异对比"
											onClick={e => {
												e.stopPropagation();
												void handleSelectFile(item.path, staged);
											}}
										>
											<Eye size={12} />
										</button>
										<button
											type="button"
											className="git-action-btn"
											title="在外部编辑器打开"
											onClick={e => void handleOpenEditor(e, item.path)}
										>
											<ExternalLink size={12} />
										</button>
										<button
											type="button"
											className="git-action-btn"
											title="在文件管理器中定位"
											onClick={e => handleReveal(e, item.path)}
										>
											<FolderOpen size={12} />
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

				<div className="git-subtabs">
					<button
						type="button"
						className={`git-subtab${activeSubTab === "changes" ? " is-active" : ""}`}
						onClick={() => setActiveSubTab("changes")}
					>
						<span>变更</span>
						{status.totalChanges > 0 && <span className="git-subtab-badge">{status.totalChanges}</span>}
					</button>
					<button
						type="button"
						className={`git-subtab${activeSubTab === "commits" ? " is-active" : ""}`}
						onClick={() => {
							setActiveSubTab("commits");
							void refreshCommits();
						}}
					>
						<History size={11} />
						<span>历史</span>
					</button>
				</div>

				<div className="git-top-actions">
					{activeSubTab === "changes" && status.totalChanges > 0 && (
						<button
							type="button"
							className={`rp-icon-btn${groupByScope ? " is-active" : ""}`}
							title={groupByScope ? "当前: 按 Scope 分类分组 (点击切回平铺)" : "按 Scope 智能分类分组 (pulls.review)"}
							onClick={() => setGroupByScope(v => !v)}
						>
							<Layers size={13} />
						</button>
					)}
					{status.totalChanges > 0 && (
						<button
							type="button"
							className="rp-icon-btn"
							title="基于 pulls.review 规则让 AI 分析当前变更架构与审查要点"
							onClick={handleAskAiScopeReview}
						>
							<Sparkles size={13} />
						</button>
					)}
					<button
						type="button"
						className={`rp-icon-btn${loading || commitsLoading ? " is-spinning" : ""}`}
						title="刷新"
						onClick={() => {
							void refreshStatus();
							if (activeSubTab === "commits") void refreshCommits();
						}}
					>
						<RefreshCw size={12} />
					</button>
				</div>
			</div>

			<div className="git-content">
				{activeSubTab === "changes" ? (
					<>
						{status.totalChanges === 0 ? (
							<div className="rp-empty">
								<CheckCircle size={28} className="rp-empty-icon is-clean" />
								<div className="rp-empty-title">工作区已是最新状态</div>
								<div className="rp-empty-desc">没有未提交的代码改动</div>
							</div>
						) : groupByScope ? (
							<div className="git-groups-scroll">
								{scopeGroups.map(([cat, files]) => {
									const meta = DIFF_CATEGORIES[cat];
									const isOpen = scopeOpenMap[cat] ?? true;
									return (
										<div key={cat} className="git-group">
											<button
												type="button"
												className="git-group-header"
												onClick={() => setScopeOpenMap(prev => ({ ...prev, [cat]: !isOpen }))}
											>
												<div className="git-group-left">
													{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
													<span
														className="git-scope-pill"
														style={{ color: meta.color, background: meta.bgColor, borderColor: meta.borderColor }}
													>
														{meta.shortLabel}
													</span>
													<span className="git-group-title">{meta.label}</span>
												</div>
												<span className="git-group-count">{files.length}</span>
											</button>
											{isOpen && (
												<div className="git-files-list">
													{files.map(item => {
														const isSelected = selectedFile?.file === item.path && selectedFile?.staged === item.staged;
														return (
															<div
																key={`${item.path}-${item.staged}`}
																className={`git-file-row${isSelected ? " is-selected" : ""}`}
																onClick={() => void handleSelectFile(item.path, item.staged)}
															>
																<span className={`git-status-badge is-${item.displayStatus}`} title={item.displayStatus}>
																	{item.staged ? "S" : item.displayStatus === "untracked" ? "U" : "M"}
																</span>
																<span className="git-file-name" title={item.path}>
																	{item.path}
																</span>
																<div className="git-file-actions">
																	<button
																		type="button"
																		className="git-action-btn"
																		title="查看代码差异对比"
																		onClick={e => {
																			e.stopPropagation();
																			void handleSelectFile(item.path, item.staged);
																		}}
																	>
																		<Eye size={12} />
																	</button>
																	<button
																		type="button"
																		className="git-action-btn"
																		title="在外部编辑器打开"
																		onClick={e => void handleOpenEditor(e, item.path)}
																	>
																		<ExternalLink size={12} />
																	</button>
																	<button
																		type="button"
																		className="git-action-btn"
																		title="在文件管理器中定位"
																		onClick={e => handleReveal(e, item.path)}
																	>
																		<FolderOpen size={12} />
																	</button>
																</div>
															</div>
														);
													})}
												</div>
											)}
										</div>
									);
								})}
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
					</>
				) : (
					/* 提交历史子视图 */
					<div className="git-commits-view">
						{selectedCommit ? (
							/* 选中单条提交的详情 */
							<div className="git-commit-detail">
								<div className="git-commit-detail-header">
									<button
										type="button"
										className="git-back-btn"
										onClick={() => {
											setSelectedCommit(null);
											setCommitFileDiff(null);
										}}
									>
										<ArrowLeft size={13} />
										<span>返回提交列表</span>
									</button>
									<span className="git-commit-hash-pill">{selectedCommit.shortHash}</span>
								</div>

								<div className="git-commit-meta">
									<h3 className="git-commit-subject">{selectedCommit.subject}</h3>
									{selectedCommit.body && (
										<pre className="git-commit-body">{selectedCommit.body}</pre>
									)}
									<div className="git-commit-author-row">
										<span className="git-commit-author">
											<User size={12} />
											{selectedCommit.author}
										</span>
										<span className="git-commit-time">
											<Clock size={12} />
											{selectedCommit.relativeDate}
										</span>
									</div>
								</div>

								<div className="git-commit-files-header">
									<span>修改文件 ({selectedCommit.files.length})</span>
								</div>

								<div className="git-files-list">
									{selectedCommit.files.map(f => {
										const isSelected = commitFileDiff?.file === f.path;
										return (
											<div
												key={f.path}
												className={`git-file-row${isSelected ? " is-selected" : ""}`}
												onClick={() => void handleSelectCommitFile(selectedCommit.hash, f.path)}
											>
												<span className={`git-status-badge is-${f.status}`}>{f.status[0]?.toUpperCase()}</span>
												<span className="git-file-name" title={f.path}>{f.path}</span>
												<div className="git-file-actions">
													<button
														type="button"
														className="git-action-btn"
														title="查看提交 Diff"
													>
														<Eye size={12} />
													</button>
												</div>
											</div>
										);
									})}
								</div>

								{commitFileDiff && (
									<div className="git-diff-container">
										{commitDiffLoading ? (
											<div className="rp-loading">正在读取该文件 Diff…</div>
										) : (
											<DiffView
												filePath={commitFileDiff.file}
												diff={commitFileDiff.diff}
												onClose={() => setCommitFileDiff(null)}
												onAskAi={handleAskAi}
											/>
										)}
									</div>
								)}
							</div>
						) : (
							/* 提交列表 */
							<div className="git-commits-list">
								{commits.length === 0 && !commitsLoading ? (
									<div className="rp-empty">
										<GitCommit size={28} className="rp-empty-icon" />
										<div className="rp-empty-title">暂无提交记录</div>
									</div>
								) : (
									commits.map(commit => (
										<button
											key={commit.hash}
											type="button"
											className="git-commit-row"
											onClick={() => void handleSelectCommit(commit.hash)}
										>
											<div className="git-commit-row-top">
												<span className="git-commit-hash">{commit.shortHash}</span>
												<span className="git-commit-time">{commit.relativeDate}</span>
											</div>
											<div className="git-commit-row-msg">{commit.subject}</div>
											<div className="git-commit-row-author">{commit.author}</div>
										</button>
									))
								)}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
