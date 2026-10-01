# OMP-GUI 演进路线图（对标 PI-Desktop & MonoCode 学习计划）

## 一、 核心定位与原则
- **底座唯一核心**：坚决以 **Oh My Pi (omp)** 的 RPC 协议（`omp --mode rpc`）及本地会话/工具体系为唯一底层驱动。
- **对标学习目标**：
  1. `vastsa/pi-desktop`：优秀的桌面级工作流（侧边栏交互、会话机制、审阅权限层、Agent/Plan 模式门禁、思维导图渲染）。
  2. `hardbeat920/monocode`：多会话分屏对照 (`placement: right/down`)、全局快捷悬浮输入框 (Quick Composer)、Git Worktree 隔离开发环境、会话草稿与项目随手记 (Notes)。

---

## 二、 上游追踪配置
- **上游仓库**：`https://github.com/can1357/oh-my-pi.git`
- **同步机制**：`pnpm sync:collab`
- **关键模块**：`packages/collab-web` 渲染层、`packages/wire` 协议层、`UPSTREAM.json`

---

## 三、 功能特性候选池（Daily Feature Pool）

### 已落地基础架构
- [x] 跨项目与多会话目录树管理 (`Sidebar.tsx`)
- [x] 会话拖拽至输入框、会话就地重命名与关闭
- [x] 提示词排队机制 (`QueuedPromptTray.tsx`)
- [x] 右侧工程面板（文件树、Git 状态、Diff 变更对比）
- [x] Todo HUD 任务状态悬浮栏
- [x] 全屏设置与 Skill 技能管理、Mnemopi 记忆配置
- [x] Subagent 运行状态面板
- [x] **Feature-01: 侧边栏会话置顶 (Pin) 与归档 (Archive)** (已于 2026-10-01 落地)

### 待实现候选功能（每日筛选 2 条实施）
- [ ] **Feature-02: 输入框 `@` 文件/目录模糊匹配提示** [参考 pi-desktop]
  - *价值*：在 Composer 输入框输入 `@` 时唤出当前项目文件列表弹窗，支持拼音/字符模糊匹配快速填入文件相对路径。
- [ ] **Feature-03: 会话分支派生 (Branch / Fork Session)** [参考 pi-desktop]
  - *价值*：在会话任意历史消息节点上支持一键 Fork 创建新会话分支，尝试不同方案且不污染主干上下文。
- [ ] **Feature-04: Agent / Plan 双模式切换门禁** [参考 pi-desktop]
  - *价值*：引入 Plan 规划模式（只读研究与生成步骤计划，待用户确认后再切回 Agent 执行）。
- [ ] **Feature-05: 全局会话与提问全文检索 (Omni Search)** [参考 pi-desktop]
  - *价值*：扩展 Command Palette，支持跨项目、跨会话搜索以往提出的问题与模型答复。
- [ ] **Feature-06: Diff 审查层逐文件丢弃与单文件对比** [参考 pi-desktop]
  - *价值*：在 DiffView 中支持对单文件进行 Revert（丢弃工作区修改）与差异折叠。
- [ ] **Feature-07: Markdown 渲染层原生 Mermaid 流程图与架构图** [参考 pi-desktop]
  - *价值*：渲染模型生成的 ````mermaid```` 代码块为矢量图表，大幅提升系统设计与逻辑梳理体验。
- [ ] **Feature-08: 会话导出快照 (Export Markdown/HTML)** [参考 pi-desktop]
  - *价值*：一键将完整 Transcript、思考过程与代码片段导出为独立 Markdown 文档。
- [ ] **Feature-09: 多会话左右/上下分屏对照 (Beside / Split View)** [参考 monocode]
  - *价值*：支持两个会话左右分屏并排显示与独立交互，适合一边查阅代码/文献一边编码，或对比两个模型的不同方案。
- [ ] **Feature-10: 全局快捷悬浮极速输入窗 (Quick Floating Composer)** [参考 monocode]
  - *价值*：类似 Spotlight 的全局快捷键小窗口，随时随地快速唤出向当前项目追加指令或记录想法。
- [ ] **Feature-11: 会话级 Git Worktree 隔离工作区** [参考 monocode]
  - *价值*：支持为复杂长线任务基于当前 repo 一键新建独立 git worktree 分支工作区，多个会话并发写代码互不冲突。
- [ ] **Feature-12: 项目随手记与草稿便签 (Notes & Session Drafts)** [参考 monocode]
  - *价值*：内置轻量 Markdown 便签本，随时记录思路、任务清单或代码片段，并支持一键引入到会话输入框。

---

## 四、 每日演进执行记录 (Daily Log)
| 日期 | 上游更新内容 | 今日新增功能 (2条) | Git Commit | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-10-01 | can1357/oh-my-pi 同步至 18.4.8 (717f97f) | 侧边栏会话置顶(Pin)与归档(Archive) | a9beee4 / e576764 | 已落地 |
