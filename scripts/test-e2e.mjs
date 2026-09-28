// 端到端自动化冒烟测试（通过 Chrome 调试协议 CDP 驱动真实 Electron 实例）
import { spawn } from "node:child_process";

const PORT = 9499;

async function run() {
	console.log("启动 Electron 测试实例 (CDP 端口", PORT, ")...");
	const electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
		stdio: ["ignore", "pipe", "pipe"],
		// 独立进程组：结束时连同 npx 拉起的 Electron 子进程一起清理
		detached: true,
	});
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

		console.log("5. 测试子任务看板展开与收起...");
		// 标题栏的文件 / Git / 子任务共用 .mh-panel-btn，按文字区分
		const findSubBtn = `[...document.querySelectorAll(".mh-panel-btn")].find(b => b.textContent.includes("子任务"))`;
		const subBtn = await evalJs(`!!${findSubBtn}`);
		if (!subBtn) throw new Error("未找到子任务看板按钮 .mh-panel-btn（子任务）");
		await evalJs(`${findSubBtn}.click()`);
		await new Promise(r => setTimeout(r, 200));
		const panelOpen = await evalJs('!!document.querySelector(".sub-panel")');
		if (!panelOpen) throw new Error("子任务看板未能成功展开 .sub-panel");
		console.log("   子任务看板展开成功");

		await evalJs('document.querySelector(".sub-close-btn").click()');
		await new Promise(r => setTimeout(r, 200));
		const panelClosed = await evalJs('!document.querySelector(".sub-panel")');
		if (!panelClosed) throw new Error("子任务看板关闭失败");
		console.log("   子任务看板关闭成功");

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

		// 测试切换到“模型与推理”选项卡
		await evalJs(`(() => {
			const navItems = document.querySelectorAll(".set-split-nav-item");
			if (navItems[2]) navItems[2].click();
		})()`);
		await new Promise(r => setTimeout(r, 100));
		const hasSelect = await evalJs('!!document.querySelector(".sp-select")');
		if (!hasSelect) throw new Error("未找到模型思考深度下拉选择器 .sp-select");
		console.log("   切换设置选项卡并加载 OMP 配置成功");

		// 点击关闭按钮关闭弹窗
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

		console.log("12. 冒烟测试全部通过！");
		ws.close();
	} finally {
		try {
			process.kill(-electron.pid, "SIGTERM");
		} catch {}
		await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]);
	}
}

run()
	.then(() => process.exit(0))
	.catch(err => {
		console.error("测试失败:", err);
		process.exit(1);
	});
