# OMP-GUI 演进路线图（对标 PI-Desktop & Synara 学习计划）

## 一、 核心定位与原则
- **底座唯一核心**：坚决以 **Oh My Pi (omp)** 的 RPC 协议（`omp --mode rpc`）及本地会话/工具体系为唯一底层驱动。
- **对标学习目标**：
  1. `vastsa/pi-desktop`：优秀的桌面级工作流（侧边栏交互、会话机制、审阅权限层、Agent/Plan 模式门禁、思维导图渲染）。
  2. `Emanuele-web04/synara`：专注于 Agent 桌面工作空间的控制面设计（Workspace Execution Surfaces 工作面分屏、Managed Git Worktrees 隔离、实时变更审查与工作流协同）。
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
- [x] **Feature-02: 输入框 `@` 文件/目录模糊匹配提示** (已于 2026-10-02 落地) [参考 pi-desktop]
- [x] **Feature-03: 会话分支派生 (Branch / Fork Session)** (已于 2026-10-02 落地) [参考 pi-desktop]
- [x] **Feature-04: Agent / Plan 双模式切换门禁 (ModePicker)** (已于 2026-10-03 落地) [参考 pi-desktop]
- [x] **Feature-07: Markdown 渲染层原生 Mermaid 流程图与架构图** (已于 2026-10-03 落地) [参考 pi-desktop]

### 待实现候选功能（每日筛选 2 条实施）
- [ ] **Feature-05: 全局会话与提问全文检索 (Omni Search)** [参考 pi-desktop]
- [ ] **Feature-06: Diff 审查层逐文件丢弃与单文件对比** [参考 pi-desktop]
- [ ] **Feature-08: 会话导出快照 (Export Markdown/HTML)** [参考 pi-desktop]
  - *价值*：一键将完整 Transcript、思考过程与代码片段导出为独立 Markdown 文档。
- [ ] **Feature-09: 会话与执行面分屏对照 (Beside / Split View)** [参考 synara]
  - *价值*：支持会话与右侧执行面（Diff审查、浏览器预览或第二个会话）并排分屏，保持编码与审查同屏无缝协作。
- [ ] **Feature-10: 独立轻量便签与任务随手记 (Notes & Task Scratchpad)** [参考 synara]
  - *价值*：在项目工作区内置便签与任务草稿，随时沉淀想法或临时指令，一键引入会话。
- [ ] **Feature-11: 托管式 Git Worktree 隔离工作区 (Managed Worktrees)** [参考 synara]
  - *价值*：为长线任务一键开辟独立 git worktree 隔离分支工作区，并发多个长任务互不干扰。
- [ ] **Feature-12: 会话任务上下文交接 (Task Handoff & Recaps)** [参考 synara]
  - *价值*：支持将当前会话的上下文进度、变更结论生成结构化交接卡片，快速分流或移交至新会话继续推进。
---

## 四、 每日演进执行记录 (Daily Log)
| 日期 | 上游更新内容 | 今日新增功能 (2条) | Git Commit | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-10-01 | can1357/oh-my-pi 同步至 18.4.8 (717f97f) | 侧边栏会话置顶(Pin)与归档(Archive) | a9beee4 / e576764 | 已落地 |
| 2026-10-02 | 基础样式重构 + 浮岛 Composer + 对话流操作栏 | 输入框 @ 文件提示 (Feature-02) + 会话分支派生 (Feature-03) | ee4a06c | 已落地 |
| 2026-10-03 | 对话框质感与遮挡修复 + Todo 随流 | 编辑/计划/问答模式门禁 (Feature-04) + Todo 归入对话流 | ee4a06c | 已落地 |
