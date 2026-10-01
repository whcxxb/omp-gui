# OMP-GUI 演进路线图（对标 PI-Desktop 学习计划）

## 一、 核心定位与原则
- **底座唯一核心**：坚决以 **Oh My Pi (omp)** 的 RPC 协议（`omp --mode rpc`）及本地会话/工具体系为唯一底层驱动。
- **对标学习目标**：学习 `vastsa/pi-desktop` 优秀的桌面级 GUI 工作流设计（侧边栏交互、会话机制、审阅权限层、多模式流转等），打磨现代化 AI 编程桌面体验。

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

### 待实现候选功能（每日筛选 2 条实施）
- [x] **Feature-01: 侧边栏会话置顶 (Pin) 与归档 (Archive)**
  - *价值*：高频核心会话置顶到项目顶部；阶段性完成的会话归档折叠，保持左栏清爽。 (已于 2026-10-01 落地)
- [ ] **Feature-02: 输入框 `@` 文件/目录模糊匹配提示**
  - *价值*：在 Composer 输入框输入 `@` 时唤出当前项目文件列表弹窗，支持拼音/字符模糊匹配快速填入文件相对路径。
- [ ] **Feature-03: 会话分支派生 (Branch / Fork Session)**
  - *价值*：在会话任意历史消息节点上支持一键 Fork 创建新会话分支，尝试不同方案且不污染主干上下文。
- [ ] **Feature-04: Agent / Plan 双模式切换门禁**
  - *价值*：引入 Plan 规划模式（只读研究与生成步骤计划，待用户确认后再切回 Agent 执行）。
- [ ] **Feature-05: 全局会话与提问全文检索 (Omni Search)**
  - *价值*：扩展 Command Palette，支持跨项目、跨会话搜索以往提出的问题与模型答复。
- [ ] **Feature-06: Diff 审查层逐文件丢弃与单文件对比**
  - *价值*：在 DiffView 中支持对单文件进行 Revert（丢弃工作区修改）与差异折叠。
- [ ] **Feature-07: Markdown 渲染层原生 Mermaid 流程图与架构图**
  - *价值*：渲染模型生成的 ````mermaid```` 代码块为矢量图表，大幅提升系统设计与逻辑梳理体验。
- [ ] **Feature-08: 会话导出快照 (Export Markdown/HTML)**
  - *价值*：一键将完整 Transcript、思考过程与代码片段导出为独立 Markdown 文档。

---

## 四、 每日演进执行记录 (Daily Log)
| 日期 | 上游更新内容 | 今日新增功能 (2条) | Git Commit | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-10-01 | can1357/oh-my-pi 同步至 18.4.8 (717f97f) | 侧边栏会话置顶(Pin)与归档(Archive) | a9beee4 / e576764 | 已落地 |
