#!/usr/bin/env node
/**
 * scripts/deploy-local.mjs
 * 快速热部署：
 * 1. 执行 electron-vite build 编译最新代码
 * 2. 打包生成临时 app.asar
 * 3. 覆盖到 /Applications/OMP.app/Contents/Resources/app.asar
 * 4. 如果应用正在运行，可选优雅重启
 */

import { execSync } from "node:child_process";
import { existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const APP_PATH = "/Applications/OMP.app";
const TARGET_ASAR = join(APP_PATH, "Contents", "Resources", "app.asar");

if (!existsSync(APP_PATH)) {
	console.error(`❌ 未在 /Applications 找到 OMP.app: ${APP_PATH}`);
	console.error("请先完成一次初始安装或检查路径。");
	process.exit(1);
}

console.log("🚀 [1/3] 编译前端与主进程代码 (electron-vite build)...");
execSync("pnpm build", { stdio: "inherit", cwd: ROOT });

console.log("📦 [2/3] 打包 app.asar...");
const tempAsar = join(ROOT, "dist", "temp-deploy.asar");
execSync(`node scripts/pack-asar.mjs "${tempAsar}"`, { stdio: "inherit", cwd: ROOT });

console.log(`⚡️ [3/3] 热覆盖目标应用: ${TARGET_ASAR}`);
// 备份并替换
const backupAsar = `${TARGET_ASAR}.bak`;
try {
	if (existsSync(TARGET_ASAR)) {
		copyFileSync(TARGET_ASAR, backupAsar);
	}
	copyFileSync(tempAsar, TARGET_ASAR);
	console.log("✅ 成功注入最新 app.asar 到 /Applications/OMP.app！");
} catch (err) {
	console.error("❌ 写入目标应用失败，请检查文件写权限:", err.message);
	if (existsSync(backupAsar)) {
		console.log("正在回滚...");
		copyFileSync(backupAsar, TARGET_ASAR);
	}
	process.exit(1);
} finally {
	if (existsSync(tempAsar)) {
		try { unlinkSync(tempAsar); } catch {}
	}
}

// 检查是否正在运行，若正在运行则提示或重启
const shouldRestart = process.argv.includes("--restart") || process.argv.includes("-r");
try {
	const running = execSync("pgrep -x OMP || true").toString().trim();
	if (running) {
		if (shouldRestart) {
			console.log("🔄 检测到 OMP 正在运行，正在重启...");
			execSync("killall OMP || true");
			// 等待完全退出后重新打开
			setTimeout(() => {
				execSync("open /Applications/OMP.app");
				console.log("🎉 OMP 重启成功！");
			}, 800);
		} else {
			console.log("💡 OMP 当前正在运行。可在终端按 Command+R 刷新界面，或执行 `pnpm deploy:local -r` 自动重启生效。");
		}
	} else {
		console.log("💡 OMP 当前未运行，可随时启动使用最新版本。");
	}
} catch {
	// ignore
}
