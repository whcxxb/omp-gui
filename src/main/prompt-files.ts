// 全局提示词 / 指令文件管理：读写 OMP 用户级 agent 目录下的
// AGENTS.md（上下文指令）、RULES.md（常驻粘性规则）、APPEND_SYSTEM.md（追加系统提示）、
// SYSTEM.md（整体替换系统提示）以及 PERSONALITY.md（人格覆写）。
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptFile, PromptFileId } from "@shared/ipc";
import { agentDir } from "./sessions";

interface PromptFileDef {
	id: PromptFileId;
	name: string;
	description: string;
	/** 单行用途说明，用于设置页卡片副标题 */
	hint: string;
}

export const PROMPT_FILE_DEFS: readonly PromptFileDef[] = [
	{
		id: "AGENTS",
		name: "AGENTS.md",
		description: "用户级上下文指令，每个会话开始时注入 <repo-rules>，适合长期项目约定与背景说明。",
		hint: "会话上下文指令",
	},
	{
		id: "RULES",
		name: "RULES.md",
		description: "常驻粘性规则，完整正文随每次请求下发，长会话中也不会被挤出上下文。",
		hint: "常驻硬性规则",
	},
	{
		id: "APPEND_SYSTEM",
		name: "APPEND_SYSTEM.md",
		description: "追加到系统提示末尾，保留默认提示词的全部内容，只补充额外要求。",
		hint: "系统提示追加",
	},
	{
		id: "SYSTEM",
		name: "SYSTEM.md",
		description: "以纯文本整体替换默认指令块；工具清单与工作流指引将不再注入。",
		hint: "替换默认提示词",
	},
	{
		id: "PERSONALITY",
		name: "PERSONALITY.md",
		description: "替换内置人格段落，只影响语气与表达风格。",
		hint: "人格语气覆写",
	},
];

function pathOf(id: PromptFileId): string {
	const def = PROMPT_FILE_DEFS.find(item => item.id === id);
	if (!def) throw new Error(`未知的提示词文件：${id}`);
	return join(agentDir(), def.name);
}

/** 读取全部提示词文件内容与元信息 */
export function readPromptFiles(): PromptFile[] {
	return PROMPT_FILE_DEFS.map(def => {
		const path = pathOf(def.id);
		let content = "";
		let exists = false;
		try {
			if (existsSync(path)) {
				content = readFileSync(path, "utf8");
				exists = true;
			}
		} catch {
			// 读取失败按空内容处理，保留可编辑入口
		}
		return {
			id: def.id,
			name: def.name,
			path,
			description: def.description,
			hint: def.hint,
			content,
			exists,
		};
	});
}

/** 写入指定提示词文件；空内容时备份并删除该文件 */
export function writePromptFile(id: PromptFileId, content: string): { ok: boolean; path: string; error?: string } {
	try {
		const path = pathOf(id);
		if (!content.trim()) {
			if (existsSync(path)) renameSync(path, `${path}.bak`);
			return { ok: true, path };
		}
		writeFileSync(path, content, "utf8");
		return { ok: true, path };
	} catch (err) {
		return { ok: false, path: "", error: err instanceof Error ? err.message : String(err) };
	}
}
