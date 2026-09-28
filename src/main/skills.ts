import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { RegistrySkillHit, SkillItem } from "@shared/ipc";

const exec = promisify(execFile);

export function parseSkillMarkdown(filePath: string): { name: string; description: string } {
	try {
		const content = readFileSync(filePath, "utf-8");
		let name = basename(dirname(filePath));
		let description = "";

		if (content.startsWith("---")) {
			const endFm = content.indexOf("---", 3);
			if (endFm !== -1) {
				const fm = content.slice(3, endFm);
				for (const line of fm.split("\n")) {
					const trimmed = line.trim();
					if (trimmed.startsWith("name:")) {
						name = trimmed.slice(5).trim().replace(/^["']|["']$/g, "");
					} else if (trimmed.startsWith("description:")) {
						description = trimmed.slice(12).trim().replace(/^["']|["']$/g, "");
					}
				}
			}
		}

		return { name, description };
	} catch {
		return { name: basename(dirname(filePath)), description: "" };
	}
}

export function listLocalSkills(cwd?: string): SkillItem[] {
	const candidates: Array<{ dir: string; scope: "project" | "global" }> = [];

	if (cwd && existsSync(cwd)) {
		candidates.push({ dir: join(cwd, ".omp", "skills"), scope: "project" });
		candidates.push({ dir: join(cwd, ".claude", "skills"), scope: "project" });
	}

	const home = homedir();
	candidates.push({ dir: join(home, ".omp", "skills"), scope: "global" });
	candidates.push({ dir: join(home, ".claude", "skills"), scope: "global" });

	const items: SkillItem[] = [];
	const seenPaths = new Set<string>();

	for (const { dir, scope } of candidates) {
		if (!existsSync(dir)) continue;
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				const skillDir = join(dir, entry);
				try {
					if (!statSync(skillDir).isDirectory()) continue;
				} catch {
					continue;
				}

				const skillMd = join(skillDir, "SKILL.md");
				if (existsSync(skillMd)) {
					const normalizedPath = resolve(skillMd);
					if (seenPaths.has(normalizedPath)) continue;
					seenPaths.add(normalizedPath);

					const meta = parseSkillMarkdown(skillMd);
					items.push({
						name: meta.name || entry,
						description: meta.description,
						scope,
						path: normalizedPath,
						dir: skillDir,
					});
				}
			}
		} catch {
			// 忽略无权限或不可读目录
		}
	}

	return items;
}

export function createLocalSkill(options: {
	name: string;
	description: string;
	scope: "project" | "global";
	cwd?: string;
}): { ok: boolean; path?: string; error?: string } {
	const safeName = options.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
	if (!safeName) return { ok: false, error: "技能名称无效" };

	let targetBaseDir: string;
	if (options.scope === "project") {
		if (!options.cwd) return { ok: false, error: "未指定当前活动项目路径" };
		targetBaseDir = join(options.cwd, ".omp", "skills");
	} else {
		targetBaseDir = join(homedir(), ".omp", "skills");
	}

	const skillDir = join(targetBaseDir, safeName);
	const skillMd = join(skillDir, "SKILL.md");

	try {
		if (!existsSync(skillDir)) {
			mkdirSync(skillDir, { recursive: true });
		}

		if (existsSync(skillMd)) {
			return { ok: false, error: `技能 ${safeName} 已存在于该目录` };
		}

		const template = `---
name: ${safeName}
description: "${options.description.replace(/"/g, '\\"') || safeName}"
---

# ${options.name}

${options.description || "在此处编写该技能的具体使用指引与最佳实践。"}

## 适用场景
- 

## 操作规范与约束
1. 
`;

		writeFileSync(skillMd, template, "utf-8");
		return { ok: true, path: skillMd };
	} catch (e: unknown) {
		return { ok: false, error: (e as Error)?.message || "创建技能失败" };
	}
}

export function deleteLocalSkill(skillPath: string): boolean {
	const normalized = resolve(skillPath);
	const home = homedir();
	const allowedRoots = [
		resolve(home, ".omp", "skills"),
		resolve(home, ".claude", "skills"),
	];

	// 必须以 /skills/ 结尾的合法目录中的 SKILL.md
	if (!basename(normalized).toLowerCase().endsWith("skill.md")) {
		throw new Error("非法技能文件路径");
	}

	const skillDir = dirname(normalized);
	const parentDir = dirname(skillDir);

	// 保证父目录是某个 skills 目录
	if (!parentDir.endsWith(`${sep}skills`)) {
		throw new Error("无法删除非标准技能目录");
	}

	try {
		rmSync(skillDir, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

export function readSkillContent(skillPath: string): string {
	return readFileSync(skillPath, "utf-8");
}

export function saveSkillContent(skillPath: string, content: string): boolean {
	writeFileSync(skillPath, content, "utf-8");
	return true;
}

export async function searchSkillshare(query: string): Promise<RegistrySkillHit[]> {
	try {
		const { stdout } = await exec("omp", ["skill", "search", query, "--json"], { timeout: 10000 });
		const data = JSON.parse(stdout) as { hits?: RegistrySkillHit[] };
		return data.hits ?? [];
	} catch {
		return [];
	}
}

export async function installSkillshare(name: string, isGlobal = false, cwd?: string): Promise<{ ok: boolean; message: string }> {
	try {
		const args = ["skill", "install", name];
		if (isGlobal) args.push("-g");
		args.push("--yes");
		const { stdout, stderr } = await exec("omp", args, { cwd: cwd || undefined, timeout: 30000 });
		return { ok: true, message: stdout || stderr || "安装成功" };
	} catch (e: unknown) {
		return { ok: false, message: (e as Error)?.message || "安装失败" };
	}
}
