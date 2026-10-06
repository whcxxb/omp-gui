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
- [x] **Feature-13: 右侧栏 Tab 自适应收窄（窄宽度只留图标，禁止文字折行）** (已于 2026-10-06 落地)
  - *实现*：`.rp-panel` 声明 `container: rp / inline-size`，`.rp-tab` 加 `white-space: nowrap` 与 `flex: 0 0 auto`；`@container rp (max-width: 320px)` 内隐藏文字标签、收窄内边距。实测四标签齐全需 251px，260px 面板仅余 218px 可用，故阈值取 320px，默认宽度 340px 不受影响。
- [x] **Feature-14: 设置页全局提示词（指令）展示与编辑** (已于 2026-10-06 落地)
  - *实现*：新增 `src/main/prompt-files.ts` 读写 `~/.omp/agent/` 下的 `AGENTS.md`、`RULES.md`、`APPEND_SYSTEM.md`、`SYSTEM.md`、`PERSONALITY.md`；设置页新增「全局提示词」Tab（`PromptFilesPanel.tsx`），支持就地编辑、还原、在外部编辑器打开；清空保存会备份为 `.bak` 并停用该文件。已验证写入内容会被 OMP 注入系统提示并影响模型输出。
- [x] **Fix: 移除固定在底部的 Todo HUD，任务看板回归对话流** (已于 2026-10-06 落地)
  - *问题*：`TodoHud` 挂载在 `.th-column` 末尾（滚动消息列表之外），导致上一轮生成的 todo 一直钉在底部，且与上游 `todo` 工具卡内联看板重复。
  - *改动*：删除 `TodoHud.tsx` 及其 CSS，并移除 `Thread.todoPhases` / `SessionStateSnapshot.todoPhases` 整条状态链路（`threads.ts` 的 `loadEntries` 扫描、`message_end` 解析、`tool_execution_end` 刷新、`refreshState` 合并）。任务看板统一由上游 `todo` 工具卡按消息位置内联渲染，天然跟随对话、不影响继续对话。
- [x] **Feature-15: 项目待办清单（右侧栏工作区 + 模型可维护）** (已于 2026-10-06 落地)
  - *存储*：`userData/todos.json`（按 cwd 隔离，原子写）+ `userData/todo-blobs/<sha256>`（图片/附件内容寻址去重，删除时回收孤儿 blob）。刻意不写入仓库、也不复用会话级 `todo` 工具状态。
  - *交互*：右侧栏新增「待办」Tab（`⌘⇧T`），支持新增/编辑（Markdown 正文、拖拽或粘贴图片/文件作附件）、状态圆点切换、拖拽排序、按阶段分组、`未完成/全部/已归档` 过滤。
  - *开始工作*：卡片 ▶ 按钮可指定模型，新建对话并自动发送待办内容（图片转 `ImageContent`，文件按路径写入提示词）；模型切换在主进程 `RuntimePool.open()` 内完成，消除 ready 竞态；执行记录回填 `sessionFile`，点击可重新打开该会话。
  - *模型可维护*：通过 omp RPC 宿主工具通道（`set_host_tools` → `host_tool_call` → `host_tool_result`）注册 `project_todo` 工具，模型可直接 `view/add/update/done/drop/rm` 待办；写入项带 `source:"model"` 徽标，面板实时同步。工具在每次 `RuntimePool.open()` 重放注册，切审批模式重启进程后依然可用。
- [x] **Feature-16: 空对话不入列表 + 新对话置顶（Codex 式会话生命周期）** (已于 2026-10-06 落地)
  - *问题*：`newThread` 用 `!t.sessionFile` 判断「未发送消息的空对话」，但 omp 进程一启动就会创建会话文件，该条件永远不成立 —— 每次点「新对话」都新建一个线程，侧边栏堆积多个「新对话」。
  - *改动*：`SessionSummary` 增加 `hasMessages`（`readSummary` 扫描 user/assistant 消息判定）；侧边栏跳过未发送消息的会话文件，空对话仅由内存中的打开线程呈现；排序改为「当前激活项置顶，其余按最近活动时间降序」；`newThread` 复用条件改为 `entries.length === 0 && !working`。
  - *效果*：空对话在列表中只占一项且置顶高亮，发送首条消息后才成为正式会话项（与 Codex 一致）。
- [x] **Feature-17: 已完成轮次默认折叠思考与工具调用，只留结论** (已于 2026-10-06 落地)
  - *改动*：`ThreadView` 的 `AssistantBody` 在非流式（已完成）且存在正文时，默认隐藏 thinking 与 toolCall，仅保留最后一段正文，并渲染「展开过程（N 步）」开关；进行中的消息保持展开以便实时观察；切换消息时重置展开态。仅当确有正文时才折叠，避免把整轮内容藏成空回复。
  - *效果*：30 轮的会话折叠后仅 2 个思考块 + 2 个工具卡片可见（均为无正文轮），有正文的 27 轮全部只剩结论。

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
| 2026-10-05 | can1357/oh-my-pi 同步至 18.6.2 (1c0993c) | Shiki 高亮细粒度按需加载与 LRU 缓存 + marked lexer 分段重构 | 270754e / 66c857d / 5c71928 / c7ccdf8 | 已落地 |
| 2026-10-06 | — | 右侧栏 Tab 窄宽度自适应 (Feature-13) + 设置页全局提示词编辑 (Feature-14) + 移除固定底部 Todo HUD | 待提交 | 已落地 |
| 2026-10-06 | — | 项目待办清单：右侧栏工作区 + 模型可维护 (Feature-15) | 待提交 | 已落地 |
