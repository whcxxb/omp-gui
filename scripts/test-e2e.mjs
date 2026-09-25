// 端到端自动化冒烟测试（通过 Chrome 调试协议 CDP 驱动真实 Electron 实例）
import { spawn } from "node:child_process";

const PORT = 9499;

async function run() {
	console.log("启动 Electron 测试实例 (CDP 端口", PORT, ")...");
	const electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
		stdio: ["ignore", "pipe", "pipe"],
	});

	await new Promise(r => setTimeout(r, 2500));

	try {
		const list = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json());
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
			const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: true });
			return res?.result?.value;
		};

		console.log("1. 检查侧边栏与页面加载...");
		const title = await evalJs("document.title");
		if (title !== "OMP") throw new Error(`页面标题不匹配: ${title}`);

		console.log("2. 等待项目加载并打开会话...");
		for (let i = 0; i < 30; i++) {
			const ready = await evalJs(
				'!!document.querySelector(".sb-thread") || !!Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("新对话"))',
			);
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
		for (let i = 0; i < 30; i++) {
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

		console.log("5. 冒烟测试全部通过！");
		ws.close();
	} finally {
		electron.kill();
	}
}

run()
	.then(() => process.exit(0))
	.catch(err => {
		console.error("测试失败:", err);
		process.exit(1);
	});
