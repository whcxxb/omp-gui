// 本地持久化的少量 GUI 配置（userData/omp-gui.json）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { ApprovalMode } from "@shared/ipc";

interface StoreData {
	/** 用户手动添加的项目 */
	projects: string[];
	/** 从列表中移除的项目 */
	hidden: string[];
	/** 默认审批模式 */
	defaultApprovalMode?: ApprovalMode;
}

const DEFAULTS: StoreData = { projects: [], hidden: [] };

function file(): string {
	return join(app.getPath("userData"), "omp-gui.json");
}

export function readStore(): StoreData {
	try {
		if (existsSync(file())) return { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), "utf8")) as Partial<StoreData>) };
	} catch {
		// 损坏时回退默认值
	}
	return { ...DEFAULTS };
}

export function writeStore(data: StoreData): void {
	writeFileSync(file(), JSON.stringify(data, null, 2));
}
