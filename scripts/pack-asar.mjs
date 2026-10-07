#!/usr/bin/env node
/**
 * scripts/pack-asar.mjs
 * 将 out/ 目录与 package.json 打包为 app.asar，供本地部署和 GitHub Release 产物发布使用。
 */

import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { createPackage } from "@electron/asar";

const ROOT = resolve(".");
const OUT_DIR = join(ROOT, "out");
const STAGING_DIR = join(ROOT, ".asar-staging");
const DIST_DIR = join(ROOT, "dist");
const ASAR_OUTPUT = process.argv[2] ? resolve(process.argv[2]) : join(DIST_DIR, "app.asar");

if (!existsSync(OUT_DIR)) {
	console.error("❌ 找不到 out/ 目录，请先运行 electron-vite build");
	process.exit(1);
}

try {
	if (existsSync(STAGING_DIR)) {
		rmSync(STAGING_DIR, { recursive: true, force: true });
	}
	mkdirSync(STAGING_DIR, { recursive: true });

	// 复制 out/
	cpSync(OUT_DIR, join(STAGING_DIR, "out"), { recursive: true });
	// 复制 package.json
	cpSync(join(ROOT, "package.json"), join(STAGING_DIR, "package.json"));
	// 复制 build/icon.png
	const iconPath = join(ROOT, "build", "icon.png");
	if (existsSync(iconPath)) {
		mkdirSync(join(STAGING_DIR, "build"), { recursive: true });
		cpSync(iconPath, join(STAGING_DIR, "build", "icon.png"));
	}
	mkdirSync(join(ASAR_OUTPUT, ".."), { recursive: true });
	console.log(`📦 正在打包 asar 到: ${ASAR_OUTPUT}`);
	await createPackage(STAGING_DIR, ASAR_OUTPUT);
	console.log("✅ app.asar 打包完成！");
} finally {
	if (existsSync(STAGING_DIR)) {
		rmSync(STAGING_DIR, { recursive: true, force: true });
	}
}
