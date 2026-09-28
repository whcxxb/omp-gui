import {
	Code,
	Download,
	ExternalLink,
	Eye,
	Folder,
	Globe,
	Layers,
	Plus,
	RefreshCw,
	Save,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { RegistrySkillHit, SkillItem } from "@shared/ipc";
import { playSound } from "@/lib/sound";

export interface SkillManagerProps {
	activeProject?: string | null;
}

export function SkillManager({ activeProject }: SkillManagerProps): ReactNode {
	const [skills, setSkills] = useState<SkillItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [filterQuery, setFilterQuery] = useState("");
	const [activeSubTab, setActiveSubTab] = useState<"installed" | "registry">("installed");

	// 正在查看或编辑的 Skill
	const [viewingSkill, setViewingSkill] = useState<SkillItem | null>(null);
	const [skillContent, setSkillContent] = useState("");
	const [isEditing, setIsEditing] = useState(false);
	const [saving, setSaving] = useState(false);

	// 新建 Skill 模态
	const [isCreating, setIsCreating] = useState(false);
	const [newSkillName, setNewSkillName] = useState("");
	const [newSkillDesc, setNewSkillDesc] = useState("");
	const [newSkillScope, setNewSkillScope] = useState<"project" | "global">(activeProject ? "project" : "global");
	const [createError, setCreateError] = useState<string | null>(null);

	// Skillshare 注册表搜索
	const [registryQuery, setRegistryQuery] = useState("");
	const [registryHits, setRegistryHits] = useState<RegistrySkillHit[]>([]);
	const [searchingRegistry, setSearchingRegistry] = useState(false);
	const [installingName, setInstallingName] = useState<string | null>(null);
	const [registryNotice, setRegistryNotice] = useState<string | null>(null);

	const loadSkills = useCallback(async () => {
		setLoading(true);
		try {
			const list = await window.omp.listSkills(activeProject || undefined);
			setSkills(list);
		} finally {
			setLoading(false);
		}
	}, [activeProject]);

	useEffect(() => {
		void loadSkills();
	}, [loadSkills]);

	const handleOpenInEditor = async (skill: SkillItem) => {
		try {
			await window.omp.openInEditor(skill.dir, "SKILL.md");
			playSound("toggle");
		} catch {
			// fallback reveal
			void window.omp.revealPath(skill.path);
		}
	};

	const handleReveal = async (skill: SkillItem) => {
		await window.omp.revealPath(skill.path);
		playSound("toggle");
	};

	const handleViewDetail = async (skill: SkillItem) => {
		setViewingSkill(skill);
		setIsEditing(false);
		try {
			const content = await window.omp.readSkill(skill.path);
			setSkillContent(content);
		} catch (e: unknown) {
			setSkillContent(`读取技能文件失败: ${(e as Error)?.message || String(e)}`);
		}
	};

	const handleSaveContent = async () => {
		if (!viewingSkill) return;
		setSaving(true);
		try {
			await window.omp.saveSkill(viewingSkill.path, skillContent);
			setIsEditing(false);
			playSound("complete");
			void loadSkills();
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (skill: SkillItem) => {
		const confirmed = window.confirm(`确定要删除技能「${skill.name}」吗？此操作无法撤销。`);
		if (!confirmed) return;
		try {
			const ok = await window.omp.deleteSkill(skill.path);
			if (ok) {
				if (viewingSkill?.path === skill.path) setViewingSkill(null);
				playSound("toggle");
				void loadSkills();
			} else {
				alert("删除技能失败，请检查文件权限");
			}
		} catch (e: unknown) {
			alert((e as Error)?.message || "删除技能失败");
		}
	};

	const handleCreateSkill = async (e: React.FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newSkillName.trim()) {
			setCreateError("请输入技能名称");
			return;
		}

		const result = await window.omp.createSkill({
			name: newSkillName.trim(),
			description: newSkillDesc.trim(),
			scope: newSkillScope,
			cwd: activeProject || undefined,
		});

		if (result.ok && result.path) {
			setIsCreating(false);
			setNewSkillName("");
			setNewSkillDesc("");
			playSound("complete");
			await loadSkills();
			// 自动在编辑器中打开新创建的 Skill
			void window.omp.revealPath(result.path);
		} else {
			setCreateError(result.error || "创建技能失败");
		}
	};

	const handleSearchRegistry = async (e?: React.FormEvent) => {
		if (e) e.preventDefault();
		if (!registryQuery.trim()) return;
		setSearchingRegistry(true);
		setRegistryNotice(null);
		try {
			const hits = await window.omp.searchRegistrySkills(registryQuery.trim());
			setRegistryHits(hits);
			if (hits.length === 0) {
				setRegistryNotice(`未在官方注册表搜索到与「${registryQuery.trim()}」相关的技能。`);
			}
		} catch (err: unknown) {
			setRegistryNotice(`搜索出错: ${(err as Error)?.message || String(err)}`);
		} finally {
			setSearchingRegistry(false);
		}
	};

	const handleInstallRegistrySkill = async (name: string, isGlobal: boolean) => {
		setInstallingName(name);
		try {
			const res = await window.omp.installRegistrySkill(name, isGlobal, activeProject || undefined);
			if (res.ok) {
				playSound("complete");
				alert(`技能 ${name} 安装成功！`);
				void loadSkills();
			} else {
				alert(`安装失败: ${res.message}`);
			}
		} finally {
			setInstallingName(null);
		}
	};

	const filteredSkills = useMemo(() => {
		const q = filterQuery.trim().toLowerCase();
		if (!q) return skills;
		return skills.filter(
			s => s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q)),
		);
	}, [skills, filterQuery]);

	const projectSkills = useMemo(() => filteredSkills.filter(s => s.scope === "project"), [filteredSkills]);
	const globalSkills = useMemo(() => filteredSkills.filter(s => s.scope === "global"), [filteredSkills]);

	return (
		<div className="sk-container">
			{/* 顶栏介绍与主操作 */}
			<div className="sk-hero">
				<div className="sk-hero-info">
					<h2 className="sp-section-heading">Skill 技能扩展管理</h2>
					<p className="sp-section-sub">
						Skills 为 Oh My Pi 提供垂直领域的专业能力、工作流指引与工具调度规范。
					</p>
				</div>
				<div className="sk-hero-actions">
					<button
						type="button"
						className="btn btn-primary sk-create-btn"
						onClick={() => {
							setIsCreating(true);
							setCreateError(null);
						}}
					>
						<Plus size={14} />
						<span>新建 Skill</span>
					</button>
					<button
						type="button"
						className="btn btn-ghost"
						onClick={() => void loadSkills()}
						disabled={loading}
						title="刷新技能列表"
					>
						<RefreshCw size={13} className={loading ? "spin" : ""} />
						<span>刷新</span>
					</button>
				</div>
			</div>

			{/* 子选项卡切换 */}
			<div className="sk-tabs-row">
				<div className="sk-tabs">
					<button
						type="button"
						className={`sk-tab${activeSubTab === "installed" ? " is-active" : ""}`}
						onClick={() => setActiveSubTab("installed")}
					>
						<Layers size={13} />
						<span>已安装技能 ({skills.length})</span>
					</button>
					<button
						type="button"
						className={`sk-tab${activeSubTab === "registry" ? " is-active" : ""}`}
						onClick={() => setActiveSubTab("registry")}
					>
						<Globe size={13} />
						<span>Skillshare 官方技能库</span>
					</button>
				</div>

				{activeSubTab === "installed" && (
					<div className="sk-filter-box">
						<Search size={13} className="sk-filter-icon" />
						<input
							type="text"
							className="sk-filter-input"
							placeholder="按技能名称或描述过滤..."
							value={filterQuery}
							onChange={e => setFilterQuery(e.target.value)}
						/>
						{filterQuery && (
							<button type="button" className="sk-filter-clear" onClick={() => setFilterQuery("")}>
								<X size={12} />
							</button>
						)}
					</div>
				)}
			</div>

			{/* Tab 1: 已安装技能列表 */}
			{activeSubTab === "installed" && (
				<div className="sk-installed-view">
					{skills.length === 0 && !loading && (
						<div className="sk-empty-state">
							<Sparkles size={32} className="sk-empty-icon" />
							<div className="sk-empty-title">暂未安装或发现任何 Skill</div>
							<div className="sk-empty-desc">
								Skills 可存放于当前项目的 <code>.omp/skills/</code> 或用户目录 <code>~/.omp/skills/</code> 中。
							</div>
							<button
								type="button"
								className="btn btn-primary"
								onClick={() => setIsCreating(true)}
								style={{ marginTop: "12px" }}
							>
								<Plus size={14} />
								<span>立即创建第一个技能</span>
							</button>
						</div>
					)}

					{/* 1. 当前活动项目技能 */}
					{projectSkills.length > 0 && (
						<div className="sk-group">
							<div className="sk-group-header">
								<Folder size={14} className="sk-group-icon is-project" />
								<span className="sk-group-title">当前项目专属技能 ({projectSkills.length})</span>
								<span className="sk-group-path">.omp/skills &amp; .claude/skills</span>
							</div>
							<div className="sk-grid">
								{projectSkills.map(skill => (
									<div key={skill.path} className="sk-card">
										<div className="sk-card-top">
											<div className="sk-card-meta">
												<span className="sk-badge is-project">Project</span>
												<h3 className="sk-card-name">{skill.name}</h3>
											</div>
											<div className="sk-card-actions">
												<button
													type="button"
													className="sk-action-btn"
													title="查看与编辑文档"
													onClick={() => void handleViewDetail(skill)}
												>
													<Eye size={13} />
												</button>
												<button
													type="button"
													className="sk-action-btn"
													title="在 VS Code / 编辑器中打开"
													onClick={() => void handleOpenInEditor(skill)}
												>
													<ExternalLink size={13} />
												</button>
												<button
													type="button"
													className="sk-action-btn is-danger"
													title="删除技能"
													onClick={() => void handleDelete(skill)}
												>
													<Trash2 size={13} />
												</button>
											</div>
										</div>
										<p className="sk-card-desc">
											{skill.description || "暂无描述信息（可在 SKILL.md frontmatter 中配置）"}
										</p>
										<div className="sk-card-footer">
											<code className="sk-card-path" title={skill.path}>
												{skill.path}
											</code>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* 2. 全局通用技能 */}
					{globalSkills.length > 0 && (
						<div className="sk-group" style={{ marginTop: projectSkills.length > 0 ? "24px" : "0" }}>
							<div className="sk-group-header">
								<Globe size={14} className="sk-group-icon is-global" />
								<span className="sk-group-title">全局通用技能 ({globalSkills.length})</span>
								<span className="sk-group-path">~/.omp/skills &amp; ~/.claude/skills</span>
							</div>
							<div className="sk-grid">
								{globalSkills.map(skill => (
									<div key={skill.path} className="sk-card">
										<div className="sk-card-top">
											<div className="sk-card-meta">
												<span className="sk-badge is-global">Global</span>
												<h3 className="sk-card-name">{skill.name}</h3>
											</div>
											<div className="sk-card-actions">
												<button
													type="button"
													className="sk-action-btn"
													title="查看与编辑文档"
													onClick={() => void handleViewDetail(skill)}
												>
													<Eye size={13} />
												</button>
												<button
													type="button"
													className="sk-action-btn"
													title="在 VS Code / 编辑器中打开"
													onClick={() => void handleOpenInEditor(skill)}
												>
													<ExternalLink size={13} />
												</button>
												<button
													type="button"
													className="sk-action-btn is-danger"
													title="删除技能"
													onClick={() => void handleDelete(skill)}
												>
													<Trash2 size={13} />
												</button>
											</div>
										</div>
										<p className="sk-card-desc">
											{skill.description || "暂无描述信息（可在 SKILL.md frontmatter 中配置）"}
										</p>
										<div className="sk-card-footer">
											<code className="sk-card-path" title={skill.path}>
												{skill.path}
											</code>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Tab 2: Skillshare 官方技能库 */}
			{activeSubTab === "registry" && (
				<div className="sk-registry-view">
					<form className="sk-reg-search-form" onSubmit={handleSearchRegistry}>
						<div className="sk-reg-input-wrap">
							<Search size={15} className="sk-reg-search-icon" />
							<input
								type="text"
								className="sk-reg-input"
								placeholder="输入关键词搜索官方技能（例如 git, docker, test, python...）"
								value={registryQuery}
								onChange={e => setRegistryQuery(e.target.value)}
							/>
						</div>
						<button type="submit" className="btn btn-primary" disabled={searchingRegistry || !registryQuery.trim()}>
							{searchingRegistry ? "搜索中..." : "在 Skillshare 搜索"}
						</button>
					</form>

					{registryNotice && <div className="sk-reg-notice">{registryNotice}</div>}

					{registryHits.length > 0 && (
						<div className="sk-grid" style={{ marginTop: "16px" }}>
							{registryHits.map(hit => {
								const isInstalling = installingName === hit.name;
								return (
									<div key={hit.name} className="sk-card">
										<div className="sk-card-top">
											<div className="sk-card-meta">
												<h3 className="sk-card-name">{hit.name}</h3>
												{hit.version && <span className="sk-badge">{hit.version}</span>}
											</div>
											<div className="sk-card-actions">
												<button
													type="button"
													className="btn btn-sm btn-primary"
													disabled={isInstalling}
													onClick={() => void handleInstallRegistrySkill(hit.name, false)}
													title="安装到当前项目"
												>
													<Download size={12} />
													<span>{isInstalling ? "安装中..." : "安装至项目"}</span>
												</button>
												<button
													type="button"
													className="btn btn-sm btn-ghost"
													disabled={isInstalling}
													onClick={() => void handleInstallRegistrySkill(hit.name, true)}
													title="全局安装"
												>
													<span>全局安装</span>
												</button>
											</div>
										</div>
										<p className="sk-card-desc">{hit.description || "官方技能包"}</p>
										{hit.publisher && (
											<div className="sk-card-footer">
												<span className="sk-muted-text">发布者: {hit.publisher.username}</span>
												{hit.weeklyDownloads !== undefined && (
													<span className="sk-muted-text">周下载量: {hit.weeklyDownloads}</span>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

			{/* 详情与代码查看抽屉/弹窗 */}
			{viewingSkill && (
				<div className="sk-drawer-backdrop" onClick={() => setViewingSkill(null)}>
					<div className="sk-drawer" onClick={e => e.stopPropagation()}>
						<div className="sk-drawer-header">
							<div className="sk-drawer-title-box">
								<Code size={16} />
								<span className="sk-drawer-title">{viewingSkill.name}</span>
								<span className={`sk-badge is-${viewingSkill.scope}`}>{viewingSkill.scope}</span>
							</div>
							<div className="sk-drawer-header-actions">
								{!isEditing ? (
									<button type="button" className="btn btn-sm btn-ghost" onClick={() => setIsEditing(true)}>
										编辑内容
									</button>
								) : (
									<button
										type="button"
										className="btn btn-sm btn-primary"
										onClick={() => void handleSaveContent()}
										disabled={saving}
									>
										<Save size={13} />
										<span>{saving ? "保存中..." : "保存修改"}</span>
									</button>
								)}
								<button
									type="button"
									className="btn btn-sm btn-ghost"
									onClick={() => void handleOpenInEditor(viewingSkill)}
								>
									在 VS Code 打开
								</button>
								<button type="button" className="set-close-btn" onClick={() => setViewingSkill(null)}>
									<X size={15} />
								</button>
							</div>
						</div>
						<div className="sk-drawer-body">
							{isEditing ? (
								<textarea
									className="sk-editor-textarea"
									value={skillContent}
									onChange={e => setSkillContent(e.target.value)}
									spellCheck={false}
								/>
							) : (
								<pre className="sk-viewer-pre">
									<code>{skillContent}</code>
								</pre>
							)}
						</div>
					</div>
				</div>
			)}

			{/* 新建 Skill 模态框 */}
			{isCreating && (
				<div className="sk-modal-backdrop" onClick={() => setIsCreating(false)}>
					<div className="sk-modal" onClick={e => e.stopPropagation()}>
						<div className="sk-modal-header">
							<div className="sk-modal-title">新建 Skill 技能</div>
							<button type="button" className="set-close-btn" onClick={() => setIsCreating(false)}>
								<X size={15} />
							</button>
						</div>
						<form onSubmit={handleCreateSkill} className="sk-modal-form">
							{createError && <div className="sk-form-error">{createError}</div>}
							<div className="sk-form-item">
								<label className="sk-form-label">技能标识名称 (name)</label>
								<input
									type="text"
									className="sk-form-input"
									placeholder="例如: test-runner, docker-ops"
									value={newSkillName}
									onChange={e => setNewSkillName(e.target.value)}
									autoFocus
								/>
								<span className="sk-form-hint">仅支持英文、数字与短横线。将自动生成对应目录与 SKILL.md。</span>
							</div>

							<div className="sk-form-item">
								<label className="sk-form-label">技能简述 (description)</label>
								<textarea
									className="sk-form-textarea"
									placeholder="用一句话描述该技能解决的问题、适用的指令以及核心规范..."
									value={newSkillDesc}
									onChange={e => setNewSkillDesc(e.target.value)}
									rows={3}
								/>
							</div>

							<div className="sk-form-item">
								<label className="sk-form-label">安装存储位置 (scope)</label>
								<div className="sk-radio-group">
									<label className="sk-radio-label">
										<input
											type="radio"
											name="skillScope"
											value="project"
											checked={newSkillScope === "project"}
											onChange={() => setNewSkillScope("project")}
											disabled={!activeProject}
										/>
										<span>当前项目专属 (.omp/skills)</span>
									</label>
									<label className="sk-radio-label">
										<input
											type="radio"
											name="skillScope"
											value="global"
											checked={newSkillScope === "global"}
											onChange={() => setNewSkillScope("global")}
										/>
										<span>用户全局通用 (~/.omp/skills)</span>
									</label>
								</div>
							</div>

							<div className="sk-modal-footer">
								<button type="button" className="btn btn-ghost" onClick={() => setIsCreating(false)}>
									取消
								</button>
								<button type="submit" className="btn btn-primary" disabled={!newSkillName.trim()}>
									创建并在编辑器中编辑
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
