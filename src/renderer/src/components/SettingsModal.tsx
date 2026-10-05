import {
	ArrowLeft,
	Bot,
	Brain,
	Check,
	Cpu,
	Folder,
	GitBranch,
	Info,
	Keyboard,
	Palette,
	RotateCw,
	Search,
	Settings,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Volume2,
	X,
	Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ApprovalMode } from "@shared/ipc";
import { THEMES, type Theme, applyTheme, loadTheme } from "@/lib/theme";
import { getSoundVolume, isSoundEnabled, playSound, setSoundEnabled, setSoundVolume } from "@/lib/sound";
import { SkillManager } from "./SkillManager";
import { MemoryGraphView } from "./MemoryGraphView";

import upstreamMeta from "@/collab/UPSTREAM.json";
export interface SettingsModalProps {
	isOpen: boolean;
	onClose(): void;
	ompVersion: string | null;
	onResetSidebarWidth(): void;
	activeProject?: string | null;
	initialTab?: SettingsTab;
}

export type SettingsTab =
	| "appearance"
	| "approvals"
	| "reasoning"
	| "memory"
	| "skills"
	| "engine"
	| "sound"
	| "shortcuts"
	| "about";
interface TabItem {
	id: SettingsTab;
	label: string;
	desc: string;
	icon: ReactNode;
}

const TABS: TabItem[] = [
	{ id: "appearance", label: "外观与主题", desc: "配色风格与界面布局", icon: <Palette size={15} /> },
	{ id: "approvals", label: "权限与审批", desc: "工具调用与安全策略", icon: <Shield size={15} /> },
	{ id: "reasoning", label: "模型与推理", desc: "思考深度与推理设置", icon: <Bot size={15} /> },
	{ id: "memory", label: "记忆与知识", desc: "长效记忆 (Mnemopi/Hermes)", icon: <Brain size={15} /> },
	{ id: "skills", label: "Skill 技能管理", desc: "项目与全局专业技能扩展", icon: <Sparkles size={15} /> },
	{ id: "engine", label: "OMP 核心工具", desc: "LSP、终端与环境感知", icon: <Cpu size={15} /> },
	{ id: "sound", label: "交互音效", desc: "Cuelume 声音反馈", icon: <Volume2 size={15} /> },
	{ id: "shortcuts", label: "快捷键速查", desc: "全局与高频快捷键速查", icon: <Keyboard size={15} /> },
	{ id: "about", label: "关于与环境", desc: "版本信息与运行时诊断", icon: <Info size={15} /> },
];

const APPROVAL_OPTIONS: Array<{ mode: ApprovalMode; label: string; desc: string; icon: typeof Shield }> = [
	{
		mode: "yolo",
		label: "全自动",
		desc: "跳过工具审批，自动执行全部操作",
		icon: Shield,
	},
	{
		mode: "write",
		label: "写入审批",
		desc: "只读自动允许，修改文件与终端命令需确认",
		icon: ShieldCheck,
	},
	{
		mode: "always-ask",
		label: "全部审批",
		desc: "最高安全级别，所有工具调用均需手动确认",
		icon: ShieldAlert,
	},
];

const THINKING_LEVELS = [
	{ id: "off", label: "关闭思考 (off)", desc: "不执行思维链推理，直接输出" },
	{ id: "low", label: "低深度 (low)", desc: "极简思考，适合简单查询" },
	{ id: "medium", label: "中等 (medium)", desc: "常规思考，平衡质量与速度" },
	{ id: "high", label: "高深度 (high)", desc: "推荐默认，适合复杂编码与重构" },
	{ id: "max", label: "极限思考 (max)", desc: "全力推理，深度解决疑难架构问题" },
];

const MEMORY_BACKENDS = [
	{ id: "off", label: "关闭记忆 (off)", desc: "不启用任何长效记忆系统" },
	{ id: "mnemopi", label: "Mnemopi 神经记忆 (类似 Hermes，推荐)", desc: "本地 SQLite 向量/图谱/全文检索，支持 recall/retain 工具" },
	{ id: "local", label: "Local 文档摘要", desc: "定期提取历史会话并生成 MEMORY.md 长期项目文档" },
	{ id: "hindsight", label: "Hindsight 远端记忆", desc: "连接外部 Hindsight Vectorize 服务" },
];

const MNEMOPI_SCOPINGS = [
	{ id: "per-project-tagged", label: "项目写入 + 全局共享读 (per-project-tagged，推荐)", desc: "新记忆归属当前项目，同时可检索全局跨项目经验" },
	{ id: "per-project", label: "项目完全隔离 (per-project)", desc: "每个项目的记忆独立存储与检索，互不干扰" },
	{ id: "global", label: "全局单一存储库 (global)", desc: "所有项目共享同一个记忆数据库" },
];

const EMBEDDING_VARIANTS = [
	{ id: "en", label: "英文增强模型 (bge-base-en-v1.5)" },
	{ id: "multilingual", label: "多语言模型 (multilingual-e5-large)" },
];

const SHORTCUTS = [
	{ key: "⌘ K", desc: "全局命令面板 (模糊搜索项目、会话与操作)" },
	{ key: "⌘ N", desc: "在当前活动项目下新建会话" },
	{ key: "⌘ W", desc: "关闭当前会话标签" },
	{ key: "⌘ B", desc: "折叠 / 展开左侧边栏" },
	{ key: "⌘ ,", desc: "打开 / 关闭设置弹窗" },
	{ key: "↑ / ↓", desc: "输入框为空或在首行时光标切换 Prompt 历史" },
	{ key: "ESC", desc: "关闭设置弹窗 / 关闭搜索层" },
	{ key: "双击侧边栏边缘", desc: "重置侧边栏为默认宽度 (272px)" },
];

export function SettingsModal(props: SettingsModalProps): ReactNode {
	const { isOpen, onClose, ompVersion, onResetSidebarWidth, activeProject, initialTab } = props;
	const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "appearance");
	const [navFilter, setNavFilter] = useState("");

	// GUI 偏好
	const [theme, setTheme] = useState<Theme>(loadTheme);
	const [defaultMode, setDefaultMode] = useState<ApprovalMode>("yolo");
	const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled);
	const [soundVolume, setSoundVolumeState] = useState(getSoundVolume);

	// OMP 核心配置
	const [ompConfigs, setOmpConfigs] = useState<Record<string, unknown>>({});
	const [loadingConfigs, setLoadingConfigs] = useState(false);

	useEffect(() => {
		if (isOpen) {
			if (initialTab) setActiveTab(initialTab);
			setTheme(loadTheme());
			setSoundEnabledState(isSoundEnabled());
			setSoundVolumeState(getSoundVolume());
			void window.omp.defaultApprovalMode().then(setDefaultMode);

			setLoadingConfigs(true);
			void window.omp.getOmpConfigs().then(configs => {
				setOmpConfigs(configs);
				setLoadingConfigs(false);
			});
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	const filteredTabs = useMemo(() => {
		const q = navFilter.trim().toLowerCase();
		if (!q) return TABS;
		return TABS.filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
	}, [navFilter]);
	if (!isOpen) return null;

	const updateOmpConfig = async (key: string, value: string): Promise<void> => {
		setOmpConfigs(prev => ({ ...prev, [key]: value === "true" ? true : value === "false" ? false : value }));
		await window.omp.setOmpConfig(key, value);
	};

	const handleThemeChange = (newTheme: Theme): void => {
		setTheme(newTheme);
		applyTheme(newTheme);
		playSound("toggle");
	};

	const handleModeChange = (mode: ApprovalMode): void => {
		setDefaultMode(mode);
		void window.omp.setDefaultApprovalMode(mode);
		playSound("toggle");
	};


	return (
		<div className="set-overlay">
			<div className="set-dialog set-dialog-wide" role="dialog" aria-modal="true" aria-label="设置">
				<header className="set-header">
					<div className="set-header-left">
						<button type="button" className="set-back-btn" onClick={onClose} title="返回 (Esc)">
							<ArrowLeft size={16} />
							<span>返回工作区</span>
						</button>
						<div className="set-header-divider" />
						<div className="set-header-title">
							<Settings size={16} />
							<span>应用偏好与核心设置</span>
						</div>
					</div>
					<div className="set-header-right">
						<span className="set-esc-hint">按 ESC 快速退出</span>
						<button type="button" className="set-close-btn" onClick={onClose} title="关闭 (Esc)">
							<X size={16} />
						</button>
					</div>
				</header>

				<div className="set-split-body">
					{/* 左侧分类导航 */}
					<aside className="set-split-nav">
						<div className="set-nav-filter-box">
							<Search size={13} className="set-nav-filter-icon" />
							<input
								type="text"
								className="set-nav-filter-input"
								placeholder="搜索设置项..."
								value={navFilter}
								onChange={e => setNavFilter(e.target.value)}
							/>
							{navFilter && (
								<button type="button" className="sk-filter-clear" onClick={() => setNavFilter("")}>
									<X size={11} />
								</button>
							)}
						</div>
						<div className="set-nav-list">
							{filteredTabs.map(tab => (
								<button
									key={tab.id}
									type="button"
									className={`set-split-nav-item${activeTab === tab.id ? " is-active" : ""}`}
									onClick={() => setActiveTab(tab.id)}
								>
									<span className="set-split-nav-icon">{tab.icon}</span>
									<div className="set-split-nav-meta">
										<span className="set-split-nav-label">{tab.label}</span>
										<span className="set-split-nav-desc">{tab.desc}</span>
									</div>
								</button>
							))}
						</div>
					</aside>

					{/* 右侧详细设置面板 */}
					<main className="set-split-main">
						{/* 1. 外观与主题 */}
						{activeTab === "appearance" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">界面外观与配色</h2>
								<p className="sp-section-sub">切换桌面应用配色主题，自动支持系统明暗模式自适应。</p>

								<div className="set-theme-grid">
									{THEMES.map(t => (
										<button
											key={t.id}
											type="button"
											className={`set-theme-card${theme === t.id ? " is-active" : ""}`}
											onClick={() => handleThemeChange(t.id)}
										>
											<div className={`set-theme-preview is-${t.id}`}>
												<div className="set-theme-dot" />
												<div className="set-theme-lines">
													<div className="set-theme-line" />
													<div className="set-theme-line is-short" />
												</div>
											</div>
											<div className="set-theme-info">
												<span className="set-theme-name">{t.label}</span>
												<span className="set-theme-desc">{t.desc}</span>
											</div>
											{theme === t.id && <Check size={14} className="set-check-icon" />}
										</button>
									))}
								</div>

								<div className="sp-card" style={{ marginTop: "14px" }}>
									<div className="sp-card-row">
										<div className="sp-card-info">
											<span className="sp-card-title">侧边栏布局宽度</span>
											<span className="sp-card-desc">可通过鼠标拖拽侧边栏右边缘调整，在此可一键重置为默认 272px。</span>
										</div>
										<button
											type="button"
											className="btn"
											onClick={() => {
												onResetSidebarWidth();
												playSound("toggle");
											}}
										>
											<RotateCw size={13} />
											<span>重置宽度</span>
										</button>
									</div>
								</div>
							</div>
						)}

						{/* 2. 权限与审批 */}
						{activeTab === "approvals" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">默认工具审批策略</h2>
								<p className="sp-section-sub">新建会话时采用的默认审批级别。每个会话在顶栏可临时独立切换。</p>

								<div className="set-mode-list">
									{APPROVAL_OPTIONS.map(opt => {
										const Icon = opt.icon;
										const isSelected = defaultMode === opt.mode;
										return (
											<button
												key={opt.mode}
												type="button"
												className={`set-mode-item${isSelected ? " is-active" : ""}`}
												onClick={() => handleModeChange(opt.mode)}
											>
												<div className="set-mode-icon">
													<Icon size={16} />
												</div>
												<div className="set-mode-info">
													<div className="set-mode-name">{opt.label}</div>
													<div className="set-mode-desc">{opt.desc}</div>
												</div>
												{isSelected && <Check size={14} className="set-check-icon" />}
											</button>
										);
									})}
								</div>
							</div>
						)}

						{/* 3. 模型与思考深度 */}
						{activeTab === "reasoning" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">模型思考与推理配置 (OMP Core)</h2>
								<p className="sp-section-sub">调节底层 Oh My Pi 运行时的思维链生成策略，修改后直接持久化至官方配置文件。</p>

								<div className="sp-card-group">
									<div className="sp-card">
										<div className="sp-card-info">
											<span className="sp-card-title">默认思考深度 (defaultThinkingLevel)</span>
											<span className="sp-card-desc">控制模型调用时分配给思维链推理的算力与上下文深度。</span>
										</div>
										<select
											className="sp-select"
											value={String(ompConfigs.defaultThinkingLevel ?? "high")}
											onChange={e => void updateOmpConfig("defaultThinkingLevel", e.target.value)}
										>
											{THINKING_LEVELS.map(lvl => (
												<option key={lvl.id} value={lvl.id}>
													{lvl.label}
												</option>
											))}
										</select>
									</div>

									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">隐藏思考折叠块 (hideThinkingBlock)</span>
												<span className="sp-card-desc">在对话流中完全隐藏思考过程气泡，仅显示最终回答。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={Boolean(ompConfigs.hideThinkingBlock)}
												onChange={e => void updateOmpConfig("hideThinkingBlock", String(e.target.checked))}
											/>
										</div>
									</div>

									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">超深度思考触发词 (magicKeywords.ultrathink)</span>
												<span className="sp-card-desc">提示词中包含 ultrathink 关键词时自动升级至最高思考级别。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={ompConfigs["magicKeywords.ultrathink"] !== false}
												onChange={e => void updateOmpConfig("magicKeywords.ultrathink", String(e.target.checked))}
											/>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* 4. 记忆与知识 (Mnemopi/Hermes) */}
						{activeTab === "memory" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">整体 OMP 记忆图与长效知识网络 (Mnemopi)</h2>
								<p className="sp-section-sub">
									集中呈现并可视化跨项目持久化的开发经验、实体关系与技术决策。Agent 会在此图谱中自动联想与召回上下文。
								</p>

								{/* 全局/项目记忆图谱与实体事实浏览器 */}
								<MemoryGraphView activeProject={activeProject ?? null} />

								<h3 className="sp-sub-heading" style={{ margin: "28px 0 10px", fontSize: "13px", fontWeight: 600, color: "var(--fg)" }}>
									记忆引擎配置 (Mnemopi Engine Settings)
								</h3>
								<div className="sp-card-group">
									{/* Mnemopi 记忆总开关 */}
									<div className="sp-card">
										<div className="sp-card-info">
											<span className="sp-card-title">启用长效记忆 (Mnemopi Memory 开关)</span>
											<span className="sp-card-desc">
												{ompConfigs["memory.backend"] === "mnemopi"
													? "已开启长效记忆系统（Mnemopi），项目技术决策与开发偏好将自动持久化沉淀与召回。"
													: "记忆系统已关闭。开启后 Agent 即可跨会话记住重要事实与编码习惯。"}
											</span>
										</div>
										<input
											type="checkbox"
											className="set-switch"
											checked={ompConfigs["memory.backend"] === "mnemopi"}
											onChange={e => void updateOmpConfig("memory.backend", e.target.checked ? "mnemopi" : "off")}
										/>
									</div>

									{/* 记忆后端高级选择 */}
									<div className="sp-card">
										<div className="sp-card-info">
											<span className="sp-card-title">记忆引擎后端 (memory.backend)</span>
											<span className="sp-card-desc">选择持久化记忆的存储与检索机制。</span>
										</div>
										<select
											className="sp-select"
											value={String(ompConfigs["memory.backend"] ?? "off")}
											onChange={e => void updateOmpConfig("memory.backend", e.target.value)}
										>
											{MEMORY_BACKENDS.map(b => (
												<option key={b.id} value={b.id}>
													{b.label}
												</option>
											))}
										</select>
									</div>

									{/* Mnemopi 专属配置 */}
									{ompConfigs["memory.backend"] === "mnemopi" && (
										<>
											<div className="sp-card">
												<div className="sp-card-info">
													<span className="sp-card-title">知识隔离与作用域 (mnemopi.scoping)</span>
													<span className="sp-card-desc">
														控制记忆在项目与全局间的可见性规则。
													</span>
												</div>
												<select
													className="sp-select"
													value={String(ompConfigs["mnemopi.scoping"] ?? "per-project-tagged")}
													onChange={e => void updateOmpConfig("mnemopi.scoping", e.target.value)}
												>
													{MNEMOPI_SCOPINGS.map(s => (
														<option key={s.id} value={s.id}>
															{s.label}
														</option>
													))}
												</select>
											</div>

											<div className="sp-card">
												<div className="sp-card-row">
													<div className="sp-card-info">
														<span className="sp-card-title">首轮自动召回相关记忆 (mnemopi.autoRecall)</span>
														<span className="sp-card-desc">
															会话开始或首轮提问时，自动从记忆库检索相关经验并注入提示词。
														</span>
													</div>
													<input
														type="checkbox"
														className="set-switch"
														checked={ompConfigs["mnemopi.autoRecall"] !== false}
														onChange={e => void updateOmpConfig("mnemopi.autoRecall", String(e.target.checked))}
													/>
												</div>
											</div>

											<div className="sp-card">
												<div className="sp-card-row">
													<div className="sp-card-info">
														<span className="sp-card-title">定期自动沉淀记忆 (mnemopi.autoRetain)</span>
														<span className="sp-card-desc">
															每隔若干轮对话，自动在后台抽取重要事实、决策和技术栈偏好保存入库。
														</span>
													</div>
													<input
														type="checkbox"
														className="set-switch"
														checked={ompConfigs["mnemopi.autoRetain"] !== false}
														onChange={e => void updateOmpConfig("mnemopi.autoRetain", String(e.target.checked))}
													/>
												</div>
											</div>

											<div className="sp-card">
												<div className="sp-card-row">
													<div className="sp-card-info">
														<span className="sp-card-title">纯全文检索模式 (mnemopi.noEmbeddings)</span>
														<span className="sp-card-desc">
															强制使用 SQLite FTS 全文检索；无需下载或配置向量嵌入模型。
														</span>
													</div>
													<input
														type="checkbox"
														className="set-switch"
														checked={Boolean(ompConfigs["mnemopi.noEmbeddings"])}
														onChange={e => void updateOmpConfig("mnemopi.noEmbeddings", String(e.target.checked))}
													/>
												</div>
											</div>

											{!ompConfigs["mnemopi.noEmbeddings"] && (
												<div className="sp-card">
													<div className="sp-card-info">
														<span className="sp-card-title">本地向量嵌入模型 (mnemopi.embeddingVariant)</span>
														<span className="sp-card-desc">
															本地离线计算向量所使用的模型变体（需提前下载或在线加载）。
														</span>
													</div>
													<select
														className="sp-select"
														value={String(ompConfigs["mnemopi.embeddingVariant"] ?? "en")}
														onChange={e => void updateOmpConfig("mnemopi.embeddingVariant", e.target.value)}
													>
														{EMBEDDING_VARIANTS.map(v => (
															<option key={v.id} value={v.id}>
																{v.label}
															</option>
														))}
													</select>
												</div>
											)}

											<div className="sp-card">
												<div className="sp-card-row">
													<div className="sp-card-info">
														<span className="sp-card-title">四路混合召回 (mnemopi.polyphonicRecall)</span>
														<span className="sp-card-desc">
															融合向量、知识图谱、离散事实与时间维度的 4-Voice 综合排序。
														</span>
													</div>
													<input
														type="checkbox"
														className="set-switch"
														checked={Boolean(ompConfigs["mnemopi.polyphonicRecall"])}
														onChange={e => void updateOmpConfig("mnemopi.polyphonicRecall", String(e.target.checked))}
													/>
												</div>
											</div>

											<div className="sp-card">
												<div className="sp-card-row">
													<div className="sp-card-info">
														<span className="sp-card-title">主动关系链接 (mnemopi.proactiveLinking)</span>
														<span className="sp-card-desc">
															新记忆入库时自动构建与已有实体、经验节点之间的关联图谱。
														</span>
													</div>
													<input
														type="checkbox"
														className="set-switch"
														checked={Boolean(ompConfigs["mnemopi.proactiveLinking"])}
														onChange={e => void updateOmpConfig("mnemopi.proactiveLinking", String(e.target.checked))}
													/>
												</div>
											</div>
										</>
									)}

									{/* 经验沉淀 (Autolearn) */}
									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">任务结束经验自动沉淀 (autolearn.enabled)</span>
												<span className="sp-card-desc">
													单次复杂任务完成后，提醒或自动提炼教训与技巧写入 learned.md 或 Mnemopi 记忆库。
												</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={Boolean(ompConfigs["autolearn.enabled"])}
												onChange={e => void updateOmpConfig("autolearn.enabled", String(e.target.checked))}
											/>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* 5. Skill 技能管理 */}
						{activeTab === "skills" && <SkillManager activeProject={activeProject} />}

						{/* 4. OMP 核心工具 */}
						{activeTab === "engine" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">OMP 核心能力与工具调度</h2>
								<p className="sp-section-sub">精选控制 Oh My Pi 代码分析与终端运行能力的核心参数。</p>

								<div className="sp-card-group">
									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">语言服务与代码智能 (LSP)</span>
												<span className="sp-card-desc">启用 lsp 工具，允许 agent 跨文件查找定义、引用并进行重构。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={ompConfigs["lsp.enabled"] !== false}
												onChange={e => void updateOmpConfig("lsp.enabled", String(e.target.checked))}
											/>
										</div>
									</div>

									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">写入后代码诊断 (lsp.diagnosticsOnWrite)</span>
												<span className="sp-card-desc">文件修改保存后自动返回语法与类型错误，便于 AI 自主验证。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={Boolean(ompConfigs["lsp.diagnosticsOnWrite"])}
												onChange={e => void updateOmpConfig("lsp.diagnosticsOnWrite", String(e.target.checked))}
											/>
										</div>
									</div>

									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">长耗时命令自动后台化 (bash.autoBackground)</span>
												<span className="sp-card-desc">自动将持续运行的终端命令置于后台执行，避免阻塞对话流。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={ompConfigs["bash.autoBackground.enabled"] !== false}
												onChange={e => void updateOmpConfig("bash.autoBackground.enabled", String(e.target.checked))}
											/>
										</div>
									</div>

									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">智能压缩冗长终端日志 (shellMinimizer)</span>
												<span className="sp-card-desc">压缩 git/npm/cargo 等构建工具的重复输出，极大节省上下文。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={ompConfigs["shellMinimizer.enabled"] !== false}
												onChange={e => void updateOmpConfig("shellMinimizer.enabled", String(e.target.checked))}
											/>
										</div>
									</div>

									<div className="sp-card">
										<div className="sp-card-row">
											<div className="sp-card-info">
												<span className="sp-card-title">Git 仓库与分支监控 (git.enabled)</span>
												<span className="sp-card-desc">自动感知当前分支变化、未提交状态并同步到上下文。</span>
											</div>
											<input
												type="checkbox"
												className="set-switch"
												checked={ompConfigs["git.enabled"] !== false}
												onChange={e => void updateOmpConfig("git.enabled", String(e.target.checked))}
											/>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* 5. 交互音效 */}
						{activeTab === "sound" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">交互提示音效 (Cuelume)</h2>
								<p className="sp-section-sub">通过实时微合成器提供按键、发送、任务完成与异常提醒的声音反馈。</p>

								<div className="set-sound-box">
									<div className="set-sound-row">
										<div className="set-sound-info">
											<span className="set-sound-title">启用操作音效</span>
											<span className="set-sound-desc">在消息发送、任务执行完成、审批等待与切换时播放即时提示。</span>
										</div>
										<input
											type="checkbox"
											className="set-switch"
											checked={soundEnabled}
											onChange={e => {
												const next = e.target.checked;
												setSoundEnabledState(next);
												setSoundEnabled(next);
												if (next) playSound("complete");
											}}
										/>
									</div>

									{soundEnabled && (
										<div className="set-sound-row">
											<div className="set-sound-info">
												<span className="set-sound-title">音量大小</span>
												<span className="set-sound-desc">{Math.round(soundVolume * 100)}%</span>
											</div>
											<div className="set-sound-controls">
												<input
													type="range"
													className="set-slider"
													min="0.05"
													max="1"
													step="0.05"
													value={soundVolume}
													onChange={e => {
														const val = Number(e.target.value);
														setSoundVolumeState(val);
														setSoundVolume(val);
													}}
												/>
												<button
													type="button"
													className="btn btn-ghost set-preview-btn"
													onClick={() => playSound("complete")}
													title="试听提示音"
												>
													试听音效
												</button>
											</div>
										</div>
									)}
								</div>
							</div>
						)}

						{/* 6. 快捷键速查 */}
						{activeTab === "shortcuts" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">全局快捷操作速查</h2>
								<p className="sp-section-sub">提高日常工作流效率的核心键盘快捷方式。</p>

								<div className="set-shortcuts-table">
									{SHORTCUTS.map(s => (
										<div key={s.key} className="set-shortcut-row">
											<kbd className="set-shortcut-key">{s.key}</kbd>
											<span className="set-shortcut-desc">{s.desc}</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* 7. 关于与环境 */}
						{activeTab === "about" && (
							<div className="sp-section">
								<h2 className="sp-section-heading">关于与系统环境</h2>
								<p className="sp-section-sub">Oh My Pi 核心与桌面应用运行环境信息。</p>

								<div className="set-about-box">
									<div className="set-about-row">
										<span className="set-about-label">Oh My Pi 核心版本</span>
										<span className="set-about-val">{ompVersion ?? "未检测到 omp"}</span>
									</div>
									<div className="set-about-row">
										<span className="set-about-label">OMP GUI 客户端</span>
										<span className="set-about-val">v0.1.0 (RPC v2)</span>
									</div>
									<div className="set-about-row">
										<span className="set-about-label">通信协议</span>
										<span className="set-about-val">stdio JSONL stream (lossless chunking)</span>
									</div>
									<div className="set-about-row">
										<span className="set-about-label">官方资产同步</span>
										<span className="set-about-val">@oh-my-pi/collab-web ({upstreamMeta.ompVersion})</span>
									</div>
									<div className="set-about-row">
										<span className="set-about-label">全局配置文件</span>
										<span className="set-about-val">~/.omp/agent/config.yml</span>
									</div>
								</div>
							</div>
						)}
					</main>
				</div>
			</div>
		</div>
	);
}
