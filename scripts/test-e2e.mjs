// 端到端自动化冒烟测试（通过 Chrome 调试协议 CDP 驱动真实 Electron 实例）
//
// 隔离：测试会向会话注入提示词，必须与真实用户数据完全隔离，否则会污染
// ~/.omp/agent/sessions 下的真实会话（历史上已多次发生）。
//   - PI_CODING_AGENT_DIR：omp 的会话/配置目录（src/main/sessions.ts 读取）
//   - --user-data-dir：Electron 的 userData，即 todos.json / omp-gui.json 所在处
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 9499;
const SANDBOX = mkdtempSync(join(tmpdir(), "omp-e2e-"));
const AGENT_DIR = join(SANDBOX, "agent");
const USER_DATA_DIR = join(SANDBOX, "userdata");

/** 空沙箱里没有任何项目，测试需要至少一个可打开的项目目录。 */
function seedSandbox() {
	mkdirSync(AGENT_DIR, { recursive: true });
	mkdirSync(USER_DATA_DIR, { recursive: true });
	writeFileSync(
		join(USER_DATA_DIR, "omp-gui.json"),
		JSON.stringify({ projects: [process.cwd()], hidden: [] }, null, 2),
	);
}

/**
 * 断言沙箱确实在真实数据目录之外。
 * 若未来有人删掉 PI_CODING_AGENT_DIR / --user-data-dir，测试会直接失败，
 * 而不是把伪造的 user 消息写进 ~/.omp/agent/sessions 下的真实会话。
 */
function assertIsolated() {
	const realAgent = join(homedir(), ".omp", "agent");
	for (const [label, dir] of [["agent", AGENT_DIR], ["userdata", USER_DATA_DIR]]) {
		const resolved = resolve(dir);
		if (resolved === resolve(realAgent) || resolved.startsWith(`${resolve(realAgent)}/`)) {
			throw new Error(`测试未隔离：${label} 目录指向真实数据 ${resolved}`);
		}
		if (!resolved.startsWith(resolve(tmpdir()))) {
			throw new Error(`测试未隔离：${label} 目录不在临时目录内 ${resolved}`);
		}
	}
}

/**
 * 写入一个固定的夹具会话，供「折叠思考与工具调用」用例使用。
 * 不依赖模型真实输出：结果确定、不消耗 token、不触网。
 * 内容含 thinking + text + toolCall，覆盖折叠逻辑的两条分支。
 */
function seedCollapseFixture() {
	const projectDir = join(process.cwd());
	const dirName = `-${projectDir.replace(/^\//, "").replace(/\//g, "-")}`;
	const dir = join(AGENT_DIR, "sessions", dirName);
	mkdirSync(dir, { recursive: true });
	const now = new Date().toISOString();
	// id 必须是 UUID 形式；且首行不能放 title 槽——该槽是 256 字节定长结构，
	// 格式不符时 omp 会把 title 行当成会话头并报 "session header is missing or malformed"。
	const sessionId = crypto.randomUUID();
	const rows = [
		{ type: "session", version: 3, id: sessionId, timestamp: now, cwd: projectDir },
		{
			type: "message",
			id: "fx-u1",
			parentId: null,
			timestamp: now,
			message: { role: "user", content: "折叠夹具会话：请给出结论", timestamp: Date.now() },
		},
		{
			type: "message",
			id: "fx-a1",
			parentId: "fx-u1",
			timestamp: now,
			message: {
				role: "assistant",
				api: "fixture",
				provider: "fixture",
				model: "fixture",
				stopReason: "stop",
				timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				content: [
					{ type: "thinking", thinking: "第一轮中间思考，应当默认折叠。" },
					{ type: "toolCall", id: "fx-tc1", name: "bash", arguments: { command: "echo fixture" } },
				],
			},
		},
		{
			type: "message",
			id: "fx-tr1",
			parentId: "fx-a1",
			timestamp: now,
			message: { role: "toolResult", toolCallId: "fx-tc1", toolName: "bash", content: [{ type: "text", text: "fixture" }], isError: false, timestamp: Date.now() },
		},
		{
			type: "message",
			id: "fx-a2",
			parentId: "fx-tr1",
			timestamp: now,
			message: {
				role: "assistant",
				api: "fixture",
				provider: "fixture",
				model: "fixture",
				stopReason: "stop",
				timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				content: [
					{ type: "thinking", thinking: "第二轮思考，也应折叠。" },
					{ type: "text", text: "这是最终结论：夹具验证通过。" },
				],
			},
		},
	];
	writeFileSync(join(dir, `${now.slice(0, 10)}T00-00-00-000Z_${sessionId}.jsonl`), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
}

async function run() {
	assertIsolated();
	seedSandbox();
	seedCollapseFixture();
	console.log("沙箱目录:", SANDBOX);
	console.log("启动 Electron 测试实例 (CDP 端口", PORT, ")...");
	const electron = spawn(
		"npx",
		["electron", ".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA_DIR}`],
		{
			stdio: ["ignore", "pipe", "pipe"],
			// 独立进程组：结束时连同 npx 拉起的 Electron 子进程一起清理
			detached: true,
			env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR },
		},
	);
	const exited = new Promise(r => electron.once("exit", r));

	await new Promise(r => setTimeout(r, 2500));

	try {
		let list;
		for (let i = 0; i < 40 && !list; i++) {
			list = await fetch(`http://127.0.0.1:${PORT}/json`)
				.then(r => r.json())
				.catch(() => null);
			if (!list) await new Promise(r => setTimeout(r, 250));
		}
		if (!list) throw new Error("Electron CDP 端口未就绪");
		const page = list.find(t => t.type === "page");
		if (!page) throw new Error("未找到 Electron 渲染页面的 CDP 目标");

		const ws = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise(r => (ws.onopen = r));
		let seq = 0;
		const send = (method, params = {}) =>
			new Promise(resolve => {
				const id = ++seq;
				const onMsg = evt => {
					const data = JSON.parse(evt.data);
					if (data.id === id) {
						ws.removeEventListener("message", onMsg);
						resolve(data.result);
					}
				};
				ws.addEventListener("message", onMsg);
				ws.send(JSON.stringify({ id, method, params }));
			});

		ws.addEventListener("message", evt => {
			const d = JSON.parse(evt.data);
			if (d.method === "Runtime.exceptionThrown") {
				console.error("PAGE EXCEPTION:", JSON.stringify(d.params));
			}
		});
		await send("Runtime.enable");

		const evalJs = async expr => {
			const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
			return res?.result?.value;
		};

		console.log("1. 检查侧边栏与页面加载...");
		// CDP 目标可能早于文档加载完成就出现，轮询等待标题
		let title;
		for (let i = 0; i < 50; i++) {
			title = await evalJs("document.title");
			if (title === "OMP") break;
			await new Promise(r => setTimeout(r, 200));
		}
		if (title !== "OMP") throw new Error(`页面标题不匹配: ${title}`);

		console.log("2. 等待项目加载并打开会话...");
		// 顶部「新对话」按钮启动即存在，先等项目列表中的会话出现，避免在项目加载前误点
		for (let i = 0; i < 50; i++) {
			const ready = await evalJs('!!document.querySelector(".sb-thread")');
			if (ready) break;
			await new Promise(r => setTimeout(r, 200));
		}

		await evalJs(`(() => {
			const threadBtn = document.querySelector(".sb-thread");
			if (threadBtn) threadBtn.click();
			else {
				const newBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("新对话"));
				if (newBtn) newBtn.click();
			}
		})()`);

		let hasCp = false;
		for (let i = 0; i < 75; i++) {
			hasCp = await evalJs('!!document.querySelector(".cp")');
			if (hasCp) break;
			await new Promise(r => setTimeout(r, 200));
		}
		if (!hasCp) throw new Error("会话加载超时，未找到输入框 .cp");
		console.log("3. 测试审批模式选择器...");
		const initialMode = await evalJs('document.querySelector(".mh-mode")?.textContent');
		console.log("   当前模式:", initialMode);

		console.log("4. 测试拖拽附件托盘与文件处理...");
		const dropResult = await evalJs(`(async () => {
			const cp = document.querySelector(".cp");
			if (!cp) return null;
			const pngBytes = new Uint8Array([
				137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
				8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0,
				5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
			]);
			const imgFile = new File([pngBytes], "test-avatar.png", { type: "image/png" });
			const dt = new DataTransfer();
			dt.items.add(imgFile);
			cp.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			await new Promise(r => setTimeout(r, 500));
			return document.querySelectorAll(".cp-att-item").length;
		})()`);

		if (dropResult !== 1) throw new Error(`附件拖拽失败，期望 1 个附件，实得: ${dropResult}`);
		console.log("   附件拖拽成功，解析出", dropResult, "个附件");

		// 清理附件
		await evalJs('document.querySelector(".cp-att-remove")?.click()');
		await new Promise(r => setTimeout(r, 200));

		console.log("5. 测试右侧面板与子任务看板...");
		// 展开右侧面板
		await evalJs('document.querySelector(".mh-sidebar-toggle")?.click()');
		await new Promise(r => setTimeout(r, 300));
		const rpOpen = await evalJs('!!document.querySelector(".rp-panel")');
		if (!rpOpen) throw new Error("未能成功展开右侧面板 .rp-panel");

		// 切换到子任务 Tab
		const findSubTab = `[...document.querySelectorAll(".rp-tab")].find(b => b.textContent.includes("子任务"))`;
		await evalJs(`${findSubTab}?.click()`);
		await new Promise(r => setTimeout(r, 200));
		const subagentActive = await evalJs(`!!document.querySelector(".rp-tab.is-active")?.textContent.includes("子任务")`);
		if (!subagentActive) throw new Error("子任务 Tab 切换失败");
		console.log("   右侧面板与子任务 Tab 展开成功");

		// Tab 头部布局：标签常显、按内容定宽铺满、收窄才降级为纯图标。
		// 历史缺陷：阈值设在 460px 导致默认 340px 面板下标签全被隐藏，仅剩图标与
		// 游离的数字徽标；且徽标排在标签前渲染成「12Git」。
		const tabLayout = await evalJs(`(async () => {
			const panel = document.querySelector(".rp-panel");
			const strip = document.querySelector(".rp-tabs");
			const snapshot = () => {
				const tabs = [...document.querySelectorAll(".rp-tab")];
				return {
					stripW: +strip.getBoundingClientRect().width.toFixed(1),
					used: +tabs.reduce((a, t) => a + t.getBoundingClientRect().width, 0).toFixed(1),
					labels: tabs.map(t => {
						const label = t.querySelector(".rp-tab-label");
						return {
							text: label.textContent,
							hidden: getComputedStyle(label).display === "none",
							clipped: label.scrollWidth > label.clientWidth + 1,
							hasIcon: !!t.querySelector(".rp-tab-icon svg"),
						};
					}),
					gitOrder: (() => {
						const t = [...tabs].find(b => b.title.startsWith("Git"));
						return [...t.children].map(c => c.className);
					})(),
				};
			};
			const prev = panel.style.width;
			panel.style.width = "340px";
			await new Promise(r => setTimeout(r, 250));
			const wide = snapshot();
			panel.style.width = "300px";
			await new Promise(r => setTimeout(r, 250));
			const narrow = snapshot();
			panel.style.width = prev;
			await new Promise(r => setTimeout(r, 200));
			return { wide, narrow };
		})()`);

		const { wide, narrow } = tabLayout;
		if (wide.labels.some(l => l.hidden)) {
			throw new Error(`默认宽度下标签被隐藏：${JSON.stringify(wide.labels)}`);
		}
		if (wide.labels.some(l => l.clipped)) {
			throw new Error(`默认宽度下标签被截断：${JSON.stringify(wide.labels.filter(l => l.clipped))}`);
		}
		if (wide.stripW - wide.used > 20) {
			throw new Error(`Tab 未铺满头部，空白 ${(wide.stripW - wide.used).toFixed(1)}px（条宽 ${wide.stripW}，用量 ${wide.used}）`);
		}
		if (wide.gitOrder[wide.gitOrder.length - 1] !== "rp-badge") {
			throw new Error(`数量徽标未排在标签之后：${JSON.stringify(wide.gitOrder)}`);
		}
		if (!narrow.labels.every(l => l.hidden && l.hasIcon)) {
			throw new Error(`收窄到 300px 未降级为纯图标：${JSON.stringify(narrow.labels)}`);
		}
		console.log(`   Tab 头部布局正常：340px 标签全显且铺满（${wide.used}/${wide.stripW}），300px 降级为图标`);

		// 收起右侧面板
		await evalJs('document.querySelector(".rp-close-btn")?.click()');
		await new Promise(r => setTimeout(r, 200));
		const rpClosed = await evalJs('!document.querySelector(".rp-panel")');
		if (!rpClosed) throw new Error("右侧面板关闭失败");
		console.log("   右侧面板关闭成功");

		console.log("6. 测试全局快捷键与命令面板 (Cmd+K)...");
		await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))`);
		await new Promise(r => setTimeout(r, 200));
		const cmdOpen = await evalJs('!!document.querySelector(".cmd-dialog")');
		if (!cmdOpen) throw new Error("未能通过 Cmd+K 打开命令面板 .cmd-dialog");
		console.log("   命令面板打开成功");

		// 测试在命令面板中搜索
		await evalJs(`(() => {
			const input = document.querySelector(".cmd-input");
			if (input) {
				input.value = "新建";
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
		})()`);
		await new Promise(r => setTimeout(r, 100));
		const matchCount = await evalJs('document.querySelectorAll(".cmd-item").length');
		if (matchCount === 0) throw new Error("命令面板搜索未返回匹配项");
		console.log("   命令面板搜索正常，匹配到", matchCount, "项");

		// 按 Esc 关闭命令面板
		await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await new Promise(r => setTimeout(r, 200));
		const cmdClosed = await evalJs('!document.querySelector(".cmd-dialog")');
		if (!cmdClosed) throw new Error("按 Escape 未能关闭命令面板");
		console.log("   命令面板关闭成功");

		console.log("7. 测试输入框 Prompt 历史回溯 (↑/↓)...");
		await evalJs(`(() => {
			localStorage.setItem("omp:prompt-history", JSON.stringify(["echo 'hello prompt history'"]));
			const input = document.querySelector(".cp-input");
			if (input) {
				input.focus();
				input.selectionStart = 0;
				input.selectionEnd = 0;
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
			}
		})()`);
		await new Promise(r => setTimeout(r, 200));
		const recalledPrompt = await evalJs('document.querySelector(".cp-input")?.value');
		if (recalledPrompt !== "echo 'hello prompt history'") {
			throw new Error(`历史 Prompt 回溯失败，实际得到: ${recalledPrompt}`);
		}
		console.log("   Prompt 历史回溯成功:", recalledPrompt);

		console.log("8. 测试侧边栏折叠快捷键 (Cmd+B)...");
		await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }))`);
		await new Promise(r => setTimeout(r, 200));
		const sbCollapsed = await evalJs('document.querySelector(".app")?.classList.contains("sb-collapsed")');
		if (!sbCollapsed) throw new Error("未能通过 Cmd+B 折叠侧边栏");
		console.log("   侧边栏折叠成功");
		await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }))`);
		await new Promise(r => setTimeout(r, 200));
		console.log("   侧边栏展开成功");

		console.log("9. 测试鼠标拖拽调整侧边栏宽度与双击复位...");
		const resizerFound = await evalJs('!!document.querySelector(".sb-resizer")');
		if (!resizerFound) throw new Error("未找到侧边栏拖拽手柄 .sb-resizer");
		await evalJs(`(() => {
			const resizer = document.querySelector(".sb-resizer");
			resizer.dispatchEvent(new MouseEvent("mousedown", { clientX: 272, bubbles: true }));
			window.dispatchEvent(new MouseEvent("mousemove", { clientX: 360, bubbles: true }));
			window.dispatchEvent(new MouseEvent("mouseup", { clientX: 360, bubbles: true }));
		})()`);
		await new Promise(r => setTimeout(r, 100));
		const resizedWidth = await evalJs('Math.round(document.querySelector(".sb").getBoundingClientRect().width)');
		if (resizedWidth !== 360) throw new Error(`拖拽调宽失败，期望 360，实得: ${resizedWidth}`);
		console.log("   拖拽调宽成功，当前宽度:", resizedWidth);

		await evalJs(`(() => {
			const resizer = document.querySelector(".sb-resizer");
			resizer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		})()`);
		await new Promise(r => setTimeout(r, 100));
		const resetWidth = await evalJs('Math.round(document.querySelector(".sb").getBoundingClientRect().width)');
		if (resetWidth !== 272) throw new Error(`双击复位失败，期望 272，实得: ${resetWidth}`);
		console.log("   双击复位成功，恢复至:", resetWidth);

		console.log("10. 测试点击左下角版本号打开双栏设置弹窗、切换主题与关闭...");
		await evalJs('document.querySelector(".sb-version-btn")?.click()');
		await new Promise(r => setTimeout(r, 200));
		const setOpen = await evalJs('!!document.querySelector(".set-dialog-wide")');
		if (!setOpen) throw new Error("未能通过点击版本号打开双栏设置弹窗 .set-dialog-wide");
		console.log("   双栏设置弹窗成功打开");

		// 切换到 Claude 主题卡片
		await evalJs(`(() => {
			const cards = document.querySelectorAll(".set-theme-card");
			if (cards[1]) cards[1].click();
		})()`);
		await new Promise(r => setTimeout(r, 100));
		const themeAttr = await evalJs('document.documentElement.dataset.theme');
		if (themeAttr !== "claude") throw new Error(`主题切换失败，期望 claude，实得: ${themeAttr}`);
		console.log("   在设置弹窗中切换主题成功:", themeAttr);

		// 测试切换到“记忆与知识”选项卡
		await evalJs(`(() => {
			const navItems = document.querySelectorAll(".set-split-nav-item");
			const memTab = [...navItems].find(item => item.textContent.includes("记忆与知识"));
			if (memTab) memTab.click();
		})()`);
		await new Promise(r => setTimeout(r, 100));
		const hasMemorySection = await evalJs('!!document.querySelector(".sp-section-heading") && document.querySelector(".sp-section-heading").textContent.includes("记忆")');
		if (!hasMemorySection) throw new Error("切换记忆与知识选项卡失败，未找到标题");
		console.log("   切换记忆与知识选项卡并加载记忆配置成功");

		// 测试切换到“Skill 技能管理”选项卡
		await evalJs(`(() => {
			const navItems = document.querySelectorAll(".set-split-nav-item");
			const skillTab = [...navItems].find(item => item.textContent.includes("Skill"));
			if (skillTab) skillTab.click();
		})()`);
		await new Promise(r => setTimeout(r, 300));
		const hasSkillSection = await evalJs('!!document.querySelector(".sk-container")');
		if (!hasSkillSection) throw new Error("切换 Skill 技能管理选项卡失败，未找到 .sk-container");
		const skillCountText = await evalJs('document.querySelector(".sk-tab")?.textContent');
		console.log("   切换 Skill 技能管理选项卡成功，标签展示:", skillCountText);
		await evalJs('document.querySelector(".set-close-btn")?.click()');
		await new Promise(r => setTimeout(r, 200));
		const setClosed = await evalJs('!document.querySelector(".set-dialog-wide")');
		if (!setClosed) throw new Error("点击关闭按钮未能关闭设置弹窗");
		console.log("   成功关闭设置弹窗返回主视图");
		console.log("11. 测试任务执行中发送新需求挂起排队、直接干预与编辑回填...");
		const queueTestRes = await evalJs(`(() => {
			try {
				if (!window.__ompThreads) return { error: "window.__ompThreads not defined" };
				const threads = window.__ompThreads.getThreads();
				if (!threads || threads.length === 0) return { error: "No threads found" };
				const key = threads[0].key;
				window.__ompThreads.enqueuePrompt(key, "排查出勤状态弹窗输入框高度问题", "排查出勤状态弹窗输入框高度问题");
				return { ok: true, key };
			} catch (err) {
				return { error: String(err) };
			}
		})()`);
		console.log("   Queue test result:", JSON.stringify(queueTestRes));
		if (!queueTestRes?.ok) throw new Error("触发 enqueuePrompt 失败: " + JSON.stringify(queueTestRes));
		await new Promise(r => setTimeout(r, 200));

		const cardRendered = await evalJs('!!document.querySelector(".qp-card")');
		if (!cardRendered) throw new Error("挂起卡片未能渲染在输入框上方 .qp-card");
		const cardText = await evalJs('document.querySelector(".qp-text")?.textContent');
		if (cardText !== "排查出勤状态弹窗输入框高度问题") {
			throw new Error("挂起卡片内容不匹配: " + cardText);
		}
		console.log("   挂起排队卡片渲染成功，展示待发送需求:", cardText);

		// 测试点击编辑按钮，放回输入框
		await evalJs('document.querySelector(".qp-actions .qp-btn:nth-child(2)")?.click()');
		await new Promise(r => setTimeout(r, 200));
		const restoredText = await evalJs('document.querySelector(".cp-input")?.value');
		if (restoredText !== "排查出勤状态弹窗输入框高度问题") {
			throw new Error("点击编辑未将排队内容恢复到输入框，当前输入框内容: " + restoredText);
		}
		const cardRemovedOnEdit = await evalJs('!document.querySelector(".qp-card")');
		if (!cardRemovedOnEdit) throw new Error("编辑后排队卡片未移除");
		console.log("   编辑回填输入框成功，排队卡片正常出队");

		// 再次挂起一条并测试【直接发送 (修改当前任务)】
		await evalJs(`(() => {
			const threads = window.__ompThreads.getThreads();
			const key = threads[0].key;
			window.__ompThreads.enqueuePrompt(key, "立即调整为红色按钮", "立即调整为红色按钮");
		})()`);
		await new Promise(r => setTimeout(r, 200));
		const steerBtn = await evalJs('!!document.querySelector(".qp-btn.is-steer")');
		if (!steerBtn) throw new Error("未找到【直接发送 (修改当前任务)】按钮 .qp-btn.is-steer");
		await evalJs('document.querySelector(".qp-btn.is-steer")?.click()');
		await new Promise(r => setTimeout(r, 200));
		const cardSteered = await evalJs('!document.querySelector(".qp-card")');
		if (!cardSteered) throw new Error("直接发送干预后卡片未移除");
		console.log("   直接发送干预当前任务成功，卡片正常出队");
		console.log("12. 测试对话重命名功能 (侧边栏与标题栏)...");
		const renameSidebarResult = await evalJs(`(async () => {
			const renameBtn = document.querySelector(".sb-thread-rename");
			if (!renameBtn) return { error: "未找到侧边栏重命名按钮 .sb-thread-rename" };
			renameBtn.click();
			await new Promise(r => setTimeout(r, 200));
			const input = document.querySelector(".sb-thread-rename-input");
			if (!input) return { error: "未进入侧边栏重命名输入状态 .sb-thread-rename-input" };
			input.value = "E2E测试重命名会话";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			await new Promise(r => setTimeout(r, 400));
			const newTitle = document.querySelector(".sb-thread-title")?.textContent;
			return { success: true, newTitle };
		})()`);
		if (renameSidebarResult.error) throw new Error(renameSidebarResult.error);
		console.log("   侧边栏重命名成功, 当前标题:", renameSidebarResult.newTitle);

		console.log("13. 测试拖拽对话记录到对话框 (引入会话)...");
		const dropSessionResult = await evalJs(`(async () => {
			const cp = document.querySelector(".cp");
			if (!cp) return { error: "未找到输入框 .cp" };
			const sessionPayload = {
				type: "session",
				title: "E2E测试重命名会话",
				file: "/fake/path/session.jsonl",
				threadKey: "dummy-key",
				cwd: "/fake/cwd"
			};
			const dt = new DataTransfer();
			dt.setData("application/x-omp-session", JSON.stringify(sessionPayload));
			cp.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			await new Promise(r => setTimeout(r, 400));
			const sessionAtt = document.querySelector(".cp-att-item.is-session");
			return {
				found: !!sessionAtt,
				title: sessionAtt?.textContent?.trim()
			};
		})()`);
		if (!dropSessionResult.found) throw new Error("拖拽会话记录到对话框失败，未生成 .cp-att-item.is-session");
		console.log("   会话记录拖拽引入成功, 附件显示:", dropSessionResult.title);

		// 清理拖入的会话附件
		await evalJs('document.querySelector(".cp-att-remove")?.click()');
		await new Promise(r => setTimeout(r, 200));

		console.log("14. 测试拖拽单条消息记录到对话框 (引用消息)...");
		const dropMessageResult = await evalJs(`(async () => {
			const cp = document.querySelector(".cp");
			if (!cp) return { error: "未找到输入框 .cp" };
			const msgPayload = {
				type: "message-record",
				role: "user",
				content: "这是用户在测试会话中提出的需求内容",
				summary: "这是用户在测试会话中提出的需求内容"
			};
			const dt = new DataTransfer();
			dt.setData("application/x-omp-message", JSON.stringify(msgPayload));
			cp.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			await new Promise(r => setTimeout(r, 400));
			const msgAtt = document.querySelector(".cp-att-item.is-message");
			return {
				found: !!msgAtt,
				title: msgAtt?.textContent?.trim()
			};
		})()`);
		if (!dropMessageResult.found) throw new Error("拖拽消息记录到对话框失败，未生成 .cp-att-item.is-message");
		console.log("   单条消息记录拖拽引入成功, 附件显示:", dropMessageResult.title);

		// 清理附件
		await evalJs('document.querySelector(".cp-att-remove")?.click()');
		await new Promise(r => setTimeout(r, 200));

		console.log("15. 测试项目待办清单面板（新增 / 持久化 / 排序 / 删除）...");
		// 打开右侧栏并切到「待办」Tab
		await evalJs('document.querySelector(".mh-sidebar-toggle")?.click()');
		await new Promise(r => setTimeout(r, 300));
		const todoTabClicked = await evalJs(`(() => {
			const tab = [...document.querySelectorAll(".rp-tab")].find(b => b.textContent.includes("待办"));
			if (!tab) return false;
			tab.click();
			return true;
		})()`);
		if (!todoTabClicked) throw new Error("未找到「待办」Tab");
		await new Promise(r => setTimeout(r, 300));
		const todoPanelOpen = await evalJs('!!document.querySelector(".td-panel")');
		if (!todoPanelOpen) throw new Error("待办面板 .td-panel 未渲染");

		// 新增一条待办
		const created = await evalJs(`(async () => {
			const setVal = (el, val) => {
				const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
				Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
				el.dispatchEvent(new Event("input", { bubbles: true }));
			};
			document.querySelector(".td-add-btn")?.click();
			await new Promise(r => setTimeout(r, 300));
			const titleInput = document.querySelector(".td-editor-title");
			if (!titleInput) return { error: "未进入新增编辑器 .td-editor-title" };
			setVal(titleInput, "E2E 待办：验证面板");
			setVal(document.querySelector(".td-editor-detail"), "由 e2e 冒烟测试创建");
			await new Promise(r => setTimeout(r, 150));
			document.querySelector(".td-editor-save")?.click();
			await new Promise(r => setTimeout(r, 700));
			const cards = [...document.querySelectorAll(".td-card-title")].map(el => el.textContent);
			return { cards };
		})()`);
		if (created.error) throw new Error(created.error);
		if (!created.cards?.some(t => t.includes("E2E 待办：验证面板"))) {
			throw new Error("新增待办后卡片未出现，当前卡片: " + JSON.stringify(created.cards));
		}
		console.log("   待办新增成功，面板现有卡片:", JSON.stringify(created.cards));

		// 通过 IPC 校验已落盘（重启后仍在的等价证据）
		const persisted = await evalJs(`(async () => {
			const threads = window.__ompThreads.getThreads();
			const cwd = threads[0].cwd;
			const items = await window.omp.listTodos(cwd);
			return items.map(i => ({ title: i.title, status: i.status, phase: i.phase, source: i.source }));
		})()`);
		const stored = persisted?.find(i => i.title === "E2E 待办：验证面板");
		if (!stored) throw new Error("待办未写入 todos.json: " + JSON.stringify(persisted));
		console.log("   待办已持久化:", JSON.stringify(stored));

		// 状态切换：待办 -> 进行中
		await evalJs(`(() => {
			const card = [...document.querySelectorAll(".td-card")].find(c => c.textContent.includes("E2E 待办：验证面板"));
			card?.querySelector(".td-status-dot")?.click();
		})()`);
		await new Promise(r => setTimeout(r, 400));
		const statusAfter = await evalJs(`(async () => {
			const threads = window.__ompThreads.getThreads();
			const items = await window.omp.listTodos(threads[0].cwd);
			return items.find(i => i.title === "E2E 待办：验证面板")?.status;
		})()`);
		if (statusAfter !== "doing") throw new Error("点击状态圆点未把待办切到 doing，实得: " + statusAfter);
		console.log("   状态切换成功:", statusAfter);

		// 删除待办
		await evalJs(`(() => {
			const card = [...document.querySelectorAll(".td-card")].find(c => c.textContent.includes("E2E 待办：验证面板"));
			card?.querySelector(".td-icon-btn.is-danger")?.click();
		})()`);
		await new Promise(r => setTimeout(r, 400));
		const afterDelete = await evalJs(`(async () => {
			const threads = window.__ompThreads.getThreads();
			const items = await window.omp.listTodos(threads[0].cwd);
			return items.filter(i => i.title === "E2E 待办：验证面板").length;
		})()`);
		if (afterDelete !== 0) throw new Error("删除待办失败，仍存在 " + afterDelete + " 条");
		console.log("   待办删除成功，已从 todos.json 移除");

		console.log("16. 测试新建待办时粘贴截图（截图仅走 clipboardData.items）...");
		const pasteResult = await evalJs(`(async () => {
			const setVal = (el, val) => {
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, val);
				el.dispatchEvent(new Event("input", { bubbles: true }));
			};
			document.querySelector(".td-add-btn")?.click();
			await new Promise(r => setTimeout(r, 300));
			setVal(document.querySelector(".td-editor-title"), "E2E 粘贴截图待办");
			const pngBytes = new Uint8Array([
				137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
				8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0,
				5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
			]);
			const file = new File([pngBytes], "screenshot.png", { type: "image/png" });
			const dt = new DataTransfer();
			dt.items.add(file);
			// Electron 里截图粘贴的真实形态：items 有文件但 files 为空
			Object.defineProperty(dt, "files", { value: [] });
			document.querySelector(".td-editor")?.dispatchEvent(
				new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }),
			);
			await new Promise(r => setTimeout(r, 600));
			const staged = document.querySelectorAll(".td-editor-att.is-staged").length;
			document.querySelector(".td-editor-save")?.click();
			await new Promise(r => setTimeout(r, 1200));
			const threads = window.__ompThreads.getThreads();
			const items = await window.omp.listTodos(threads[0].cwd);
			const saved = items.find(i => i.title === "E2E 粘贴截图待办");
			return { staged, attachments: saved?.attachments?.map(a => ({ kind: a.kind, blob: !!a.blob })) ?? null };
		})()`);
		if (pasteResult.staged !== 1) {
			throw new Error(`新建待办粘贴截图未暂存附件，实得: ${JSON.stringify(pasteResult)}`);
		}
		if (pasteResult.attachments?.[0]?.kind !== "image" || !pasteResult.attachments[0].blob) {
			throw new Error("粘贴的截图未随待办落盘为 blob: " + JSON.stringify(pasteResult));
		}
		console.log("   粘贴截图成功，已随新建待办落盘:", JSON.stringify(pasteResult.attachments));

		// 缩略图渲染 + 清理
		const thumbCount = await evalJs('document.querySelectorAll(".td-att-thumb").length');
		if (thumbCount < 1) throw new Error("待办卡片未渲染图片缩略图");
		console.log("   卡片缩略图渲染正常:", thumbCount);
		await evalJs(`(async () => {
			const threads = window.__ompThreads.getThreads();
			const items = await window.omp.listTodos(threads[0].cwd);
			for (const it of items) if (it.title === "E2E 粘贴截图待办") await window.omp.deleteTodo(threads[0].cwd, it.id);
		})()`);

		console.log("17. 测试新建对话不堆积（Codex 式：空对话复用、发送后才入列）...");
		const newThreadFlow = await evalJs(`(async () => {
			const titles = () => [...document.querySelectorAll(".sb-thread-title")].map(t => t.textContent);
			const blankCount = () => titles().filter(t => t === "新对话").length;

			// 连点两次「新对话」，应复用同一个空对话而不是堆积
			document.querySelector(".sb-action")?.click();
			await new Promise(r => setTimeout(r, 1800));
			const afterFirst = blankCount();
			document.querySelector(".sb-action")?.click();
			await new Promise(r => setTimeout(r, 1800));
			const afterSecond = blankCount();

			// 空对话应排在项目第一位，且处于高亮态
			const firstTitle = titles()[0];
			const firstIsActive = document.querySelector(".sb-thread-li .sb-thread")?.classList.contains("is-active");

			// 发一条消息后，它应变成正常会话项（标题来自首条消息）
			const ta = document.querySelector(".cp-input");
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "回复：收到");
			ta.dispatchEvent(new Event("input", { bubbles: true }));
			await new Promise(r => setTimeout(r, 300));
			document.querySelector(".cp-send")?.click();
			await new Promise(r => setTimeout(r, 6000));
			return { afterFirst, afterSecond, firstTitle, firstIsActive, afterSend: titles().slice(0, 2) };
		})()`);
		if (newThreadFlow.afterSecond > 1) {
			throw new Error(`空对话堆积：连点两次后出现 ${newThreadFlow.afterSecond} 个「新对话」`);
		}
		if (!newThreadFlow.firstIsActive) {
			throw new Error("新建的空对话未排在项目第一位 / 未高亮");
		}
		console.log("   空对话复用正常（1 个），且置顶高亮:", JSON.stringify(newThreadFlow.afterSend));

		console.log("18. 测试已完成轮次默认折叠思考与工具调用，只留结论...");
		// 打开夹具会话（由 seedSandbox 预写入沙箱，含 thinking + toolCall + text）
		await evalJs(`[...document.querySelectorAll(".sb-thread")].find(b => b.textContent.includes("夹具会话"))?.click()`);
		let fixtureReady = false;
		for (let i = 0; i < 80; i++) {
			fixtureReady = await evalJs('document.querySelectorAll(".th-assistant").length > 0');
			if (fixtureReady) break;
			await new Promise(r => setTimeout(r, 300));
		}
		if (!fixtureReady) throw new Error("夹具会话未渲染出任何助手消息");
		await new Promise(r => setTimeout(r, 800));

		const collapse = await evalJs(`(() => {
			const rows = [...document.querySelectorAll(".th-assistant")].map(el => ({
				thinks: el.querySelectorAll(".th-think").length,
				tools: el.querySelectorAll(".tv-card").length,
				mdCount: el.querySelectorAll(".tr-md").length,
				toggle: el.querySelector(".th-details-toggle")?.textContent.trim() ?? null,
			}));
			const withText = rows.filter(r => r.mdCount > 0);
			return {
				turns: rows.length,
				withText: withText.length,
				leakedThink: withText.filter(r => r.thinks > 0).length,
				leakedTool: withText.filter(r => r.tools > 0).length,
				toggles: rows.filter(r => r.toggle).length,
			};
		})()`);
		if (collapse.withText === 0) throw new Error("夹具会话未渲染出正文，无法校验折叠");
		if (collapse.leakedThink > 0 || collapse.leakedTool > 0) {
			throw new Error(`折叠失效：有正文的轮仍显示 think=${collapse.leakedThink} tool=${collapse.leakedTool}`);
		}
		if (collapse.toggles === 0) throw new Error("未渲染「展开过程」开关");
		console.log("   折叠正常（只留结论）:", JSON.stringify(collapse));

		// 点开「展开过程」应还原思考与工具卡片
		const expanded = await evalJs(`(async () => {
			const before = document.querySelectorAll(".tv-card").length;
			document.querySelector(".th-details-toggle")?.click();
			await new Promise(r => setTimeout(r, 500));
			return { before, after: document.querySelectorAll(".tv-card").length };
		})()`);
		if (expanded.after <= expanded.before) {
			throw new Error(`展开过程无效：工具卡片 ${expanded.before} -> ${expanded.after}`);
		}
		console.log("   展开过程正常：工具卡片", expanded.before, "->", expanded.after);

		console.log("19. 冒烟测试全部通过！");
		ws.close();
	} finally {
		try {
			process.kill(-electron.pid, "SIGTERM");
		} catch {}
		await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]);
		try {
			rmSync(SANDBOX, { recursive: true, force: true });
		} catch {}
	}
}

run()
	.then(() => process.exit(0))
	.catch(err => {
		console.error("测试失败:", err);
		process.exit(1);
	});
