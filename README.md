# Oh My Pi (OMP) GUI 客户端方案设计

本项目旨在为 **Oh My Pi (omp)** 构建轻量、现代化的图形化交互应用，核心解决官方 TUI 目前缺乏的**「项目管理、多对话新建与切换」**能力，同时最大化复用官方主分支生态。

---

## 一、 背景与选型依据

### 1. 为什么不能直接使用原版 Pi 扩展
2026 年 9 月后，`can1357/oh-my-pi` 与原版 `earendil-works/pi` 已实质分家：
- 包体系全量迁移为 `@oh-my-pi/*`，引入约 8 万行 Rust 内核。
- 原版 Pi 生态的扩展（如 `pi-gui-extension`、`@firstpick/pi-package-webui`、`@hhyy668/pi-desktop-ui`）由于底层包名和运行时契约不兼容，无法在 omp 上直接加载。

### 2. 官方现存资产分析
官方 monorepo 自带 `@oh-my-pi/collab-web`（位于 `packages/collab-web`），这是一个极具价值的前端资产：
- **完整交互能力**：支持流式输出、Thinking 思维链折叠、30+ 原生内置工具卡片渲染（文件读写、AST 语法树编辑、Bash 执行、Diff 对比等）、Subagent 实时监控面板。
- **协议契约**：采用端到端 AES-256-GCM 加密，通过 WebSocket Relay 进行单会话投屏与控制。
- **固有局限**：设计定位为单会话协同工具，不具备跨项目的会话创建、多会话目录树管理能力。

因此，自制 GUI 最优解是：**不重复造消息和工具渲染的轮子，只实现外壳调度层（Supervisor / Manager），借力官方原生 WebUI 或其组件。**

---

## 二、 两种技术路线对比

| 评估维度 | 方案 A：Webview 嵌入 Collab（推荐优先验证） | 方案 B：RPC 协议驱动 + 移植组件 |
| :--- | :--- | :--- |
| **架构定位** | 进程级调度外壳 + 内嵌 Collab Web 视图 | 深度集成客户端，直接通过 stdio 通讯 |
| **开发周期** | 1 ~ 2 天即可跑通完整 MVP | 3 ~ 5 天，需编写 RPC 状态机与进程管道 |
| **主分支跟随度** | 100% 同步（官方一旦更新只需重新构建静态包） | 极高（需保证 RPC 事件接口稳定） |
| **界面形态** | 左侧项目与会话列表，右侧内嵌 Webview | 类似 Codex Desktop / Cursor 的单页原生体验 |
| **技术栈推荐** | Tauri 2 (Rust) / Electron + 本地静态托管 | Tauri 2 (Rust) / Electron + React |

---

## 三、 方案 A 详细实施路径（外壳调度 + Collab 嵌入）

### 1. 系统架构
```text
┌─────────────────────────────────────────────────────────────┐
│                       GUI 宿主窗口                          │
│ ┌──────────────────────┐ ┌────────────────────────────────┐ │
│ │   侧边栏 (Sidebar)   │ │      主交互区 (Webview)        │ │
│ │                      │ │                                │ │
│ │ - 项目切换 (Project) │ │  加载当前激活会话的            │ │
│ │ - 新建对话 (+ New)   │ │  Collab Web 客户端             │ │
│ │ - 会话历史 (Sessions)│ │  (http://localhost:3000/#...) │ │
│ └──────────────────────┘ └────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ 进程调用 / 发现
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 后台进程池 (Daemon Pool)                                     │
│  ├── Session 1: omp --cwd /proj1 (Collab Room A)             │
│  └── Session 2: omp --cwd /proj2 (Collab Room B)             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 核心工作流
1. **自动托管配置**：
   在用户全局配置文件 `~/.omp/agent/config.yml` 中确保开启自动协同功能：
   ```yaml
   collab:
     autoStart: control
     relayUrl: wss://my.omp.sh # 或自建本地 Relay
   ```
2. **新建对话逻辑**：
   - 用户选择项目路径 `dir`，点击「新建对话」。
   - 宿主程序直接启动子进程：
     ```bash
     omp --cwd "<project_dir>"
     ```
   - 启动后，读取本地注册表拿到生成的连接地址：
     ```bash
     omp collab list --json
     omp collab link <instance_id>
     ```
   - 将返回的 Web 链接直接赋给右侧 Webview 容器。
3. **多对话管理与恢复**：
   - omp 会话默认以 JSONL 形式存储在 `~/.omp/agent/sessions/<path_hash>/`。
   - 宿主程序扫描该目录读取历史记录，展示标题、更新时间。
   - 用户点击历史对话时，后台执行 `omp --resume <session_file>`，Webview 重定向至新房间。

---

## 四、 方案 B 详细实施路径（RPC 驱动 + 组件复用）

### 1. 协议规范与调用
启动子进程进入 RPC 模式：
```bash
omp --mode rpc --cwd "<project_dir>"
```
通讯通过 `stdin` 发送 JSONL，`stdout` 接收事件流。
- **协议协商**：启动时协商 Protocol v2（支持大帧 lossless chunk 传输）。
- **新建会话**：向 stdin 写入 `{"id": "req_1", "type": "new_session"}`。
- **切换会话**：向 stdin 写入 `{"id": "req_2", "type": "switch_session", "sessionPath": "..."}`。
- **发送提示**：向 stdin 写入 `{"id": "req_3", "type": "prompt", "message": "..."}`。
- **中断执行**：向 stdin 写入 `{"id": "req_4", "type": "abort"}`。

### 2. 前端组件提取与复用
官方 `packages/collab-web`（MIT 协议）内部组件拆分非常清晰：
- `packages/collab-web/src/tool-render/`：包含全套工具卡片渲染器（`read`、`edit`、`bash` 等）。
- `packages/collab-web/src/components/transcript/`：流式渲染、Thinking 展开收起逻辑。
- `packages/collab-web/src/components/agents/`：Subagent 运行状态看板。
直接把这部分 React 组件抽离到项目中，将数据源从 WebSocket 改为前端消费的 RPC Event Stream。

---

## 五、 项目落地演进建议

1. **第一阶段（MVP 验证）**：
   - 采用方案 A。使用 Electron 或 Tauri 创建一个极简双栏窗口。
   - 左侧使用原生 Web 技术实现工作区目录树和会话历史。
   - 右侧通过 Webview 加载 `collab-web` 页面，验证多会话管理与新建体验。
2. **第二阶段（性能与交互优化）**：
   - 将 `collab-web` 静态资源直接打包进桌面端本地托管，避免外部网络依赖。
   - 完善后台进程保活与自动清理逻辑，当会话关闭时及时释放资源。
3. **第三阶段（深度定制，可选）**：
   - 若对多进程开销敏感，切换至方案 B（RPC 模式），实现单进程内无缝切会话与深度主题适配。

---

## 六、 当前实现（方案 B）

Electron + React + TypeScript，通过 `omp --mode rpc` 与 omp 通信（协议 v2），不依赖 relay 或外网。

```bash
pnpm install
pnpm dev          # 开发模式
pnpm build        # 构建到 out/
pnpm typecheck
pnpm sync:collab  # 从官方仓库同步 collab-web 渲染组件（可传本地仓库路径）
```

目录结构：
- `src/main/`：主进程。`omp-rpc.ts` 单个 RPC 进程（分帧、分块重组、请求配对），`runtimes.ts` 进程池（空闲进程按最近使用回收，最多保留 4 个），`sessions.ts` 扫描 `~/.omp/agent/sessions` 并按项目分组。
- `src/preload/`：通过 `window.omp` 暴露 IPC。
- `src/renderer/src/collab/`：从官方 `packages/collab-web` 同步的工具卡片与 Markdown 渲染，不要手改，版本见 `UPSTREAM.json`。
- `src/renderer/src/state/threads.ts`：把 RPC 事件归并为对话状态。

跟随 omp 更新：升级 omp 后运行 `pnpm sync:collab`，再 `pnpm typecheck` 确认兼容。
