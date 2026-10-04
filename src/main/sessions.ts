// 扫描 omp 会话目录，按项目（cwd）分组。
import { existsSync } from "node:fs";
import { open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";

const HEAD_BYTES = 64 * 1024;
const TITLE_FALLBACK_CHARS = 60;

export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent");
}

export function sessionsDir(): string {
	return join(agentDir(), "sessions");
}

async function readHead(file: string): Promise<string> {
	const handle = await open(file, "r");
	try {
		const buf = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
		return buf.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map(block => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
			.join(" ");
	}
	return "";
}

async function readSummary(file: string): Promise<SessionSummary | null> {
	const [head, info] = await Promise.all([readHead(file), stat(file)]);
	let title: string | null = null;
	let firstPrompt: string | null = null;
	type Header = { id?: string; cwd?: string; timestamp?: string };
	let header: Header | null = null;
	for (const line of head.split("\n")) {
		if (!line.trim()) continue;
		let row: Record<string, unknown>;
		try {
			row = JSON.parse(line) as Record<string, unknown>;
		} catch {
			// 读取窗口截断的最后一行
			break;
		}
		if (row.type === "title" && typeof row.title === "string" && row.title.trim()) title = row.title.trim();
		else if (row.type === "session") header = row as Header;
		else if (row.type === "message" && firstPrompt === null) {
			const message = row.message as { role?: string; content?: unknown } | undefined;
			if (message?.role === "user") {
				const text = textOf(message.content).replace(/\s+/g, " ").trim();
				if (text) firstPrompt = text.slice(0, TITLE_FALLBACK_CHARS);
			}
		}
		if (header && title) break;
	}
	if (!header?.id || !header.cwd) return null;
	return {
		file,
		id: header.id,
		title: title ?? firstPrompt,
		cwd: header.cwd,
		createdAt: header.timestamp ? Date.parse(header.timestamp) : info.birthtimeMs,
		updatedAt: info.mtimeMs,
	};
}

export async function scanSessions(): Promise<SessionSummary[]> {
	const root = sessionsDir();
	if (!existsSync(root)) return [];
	const dirs = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const dir of dirs) {
		if (!dir.isDirectory()) continue;
		const entries = await readdir(join(root, dir.name), { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(join(root, dir.name, entry.name));
		}
	}
	const results = await Promise.all(files.map(file => readSummary(file).catch(() => null)));
	return results.filter((s): s is SessionSummary => s !== null);
}

export function groupProjects(sessions: SessionSummary[], extraPaths: string[], hidden: Set<string>): ProjectSummary[] {
	const map = new Map<string, ProjectSummary>();
	const ensure = (path: string): ProjectSummary => {
		let project = map.get(path);
		if (!project) {
			project = { path, name: basename(path) || path, missing: !existsSync(path), sessions: [], updatedAt: 0 };
			map.set(path, project);
		}
		return project;
	};
	for (const path of extraPaths) ensure(path);
	for (const session of sessions) {
		if (hidden.has(session.cwd)) continue;
		const project = ensure(session.cwd);
		project.sessions.push(session);
		project.updatedAt = Math.max(project.updatedAt, session.updatedAt);
	}
	// 仅对每个项目内部的会话按更新时间降序排序，项目文件夹保持原有的添加顺序，不随会话活动乱序
	for (const project of map.values()) {
		project.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
	}
	return [...map.values()].filter(p => !hidden.has(p.path));
}

export async function deleteSessionFile(file: string): Promise<boolean> {
	const dir = resolve(sessionsDir());
	const normalized = resolve(file);
	// 带上分隔符，避免 sessions-other 之类的同前缀目录通过校验
	if (!normalized.startsWith(dir + sep)) {
		throw new Error("非法会话路径");
	}
	if (existsSync(normalized)) {
		await unlink(normalized);
		return true;
	}
	return false;
}

export async function renameSessionFile(file: string, newTitle: string): Promise<boolean> {
	const dir = resolve(sessionsDir());
	const normalized = resolve(file);
	if (!normalized.startsWith(dir + sep)) {
		throw new Error("非法会话路径");
	}
	if (!existsSync(normalized)) return false;

	const content = await readFile(normalized, "utf8");
	const trimmedTitle = newTitle.trim();
	const newlineIndex = content.indexOf("\n");
	const firstLine = newlineIndex !== -1 ? content.slice(0, newlineIndex) : content;
	const rest = newlineIndex !== -1 ? content.slice(newlineIndex + 1) : "";

	let updated = false;
	try {
		const parsed = JSON.parse(firstLine) as Record<string, unknown>;
		if (parsed.type === "title") {
			parsed.title = trimmedTitle;
			parsed.source = "custom";
			parsed.updatedAt = new Date().toISOString();
			await writeFile(normalized, `${JSON.stringify(parsed)}\n${rest}`, "utf8");
			updated = true;
		}
	} catch {
		// first line wasn't valid JSON title
	}

	if (!updated) {
		const newTitleObj = {
			type: "title",
			v: 1,
			title: trimmedTitle,
			source: "custom",
			updatedAt: new Date().toISOString(),
		};
		await writeFile(normalized, `${JSON.stringify(newTitleObj)}\n${content}`, "utf8");
	}
	return true;
}

export async function readSessionExcerpt(file: string, maxTurns = 6): Promise<string> {
	const dir = resolve(sessionsDir());
	const normalized = resolve(file);
	if (!normalized.startsWith(dir + sep)) {
		throw new Error("非法会话路径");
	}
	if (!existsSync(normalized)) return "";

	try {
		const content = await readFile(normalized, "utf8");
		const lines = content.split("\n");
		const turns: Array<{ role: "user" | "assistant"; text: string }> = [];

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const row = JSON.parse(line) as Record<string, unknown>;
				if (row.type === "message") {
					const msg = row.message as { role?: string; content?: unknown } | undefined;
					if (msg && (msg.role === "user" || msg.role === "assistant")) {
						const text = textOf(msg.content).trim();
						if (text) {
							turns.push({
								role: msg.role as "user" | "assistant",
								text: text.length > 500 ? `${text.slice(0, 500)}...` : text,
							});
						}
					}
				}
			} catch {
				// ignore malformed line
			}
		}

		const recent = turns.slice(-maxTurns);
		if (recent.length === 0) return "";

		return recent
			.map(t => `${t.role === "user" ? "用户" : "助手"}: ${t.text}`)
			.join("\n\n");
	} catch {
		return "";
	}
}

export async function forkSession(options: {
	cwd: string;
	sourceSessionFile: string;
	targetEntryId: string;
}): Promise<string> {
	const dir = resolve(sessionsDir());
	const normalized = resolve(options.sourceSessionFile);
	if (!normalized.startsWith(dir + sep)) {
		throw new Error("非法会话路径");
	}
	if (!existsSync(normalized)) {
		throw new Error("源会话文件不存在");
	}

	const content = await readFile(normalized, "utf8");
	const lines = content.split("\n");

	type Entry = { id?: string; parentId?: string | null; type?: string; [key: string]: unknown };
	const allEntries: Entry[] = [];
	let headerRow: Entry | null = null;
	let title = "会话分支";

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line) as Entry;
			if (row.type === "title" && typeof row.title === "string") {
				title = `${row.title} (分支)`;
			} else if (row.type === "session") {
				headerRow = row;
			} else {
				allEntries.push(row);
			}
		} catch {}
	}

	// 从 targetEntryId 向上回溯到根节点
	const byId = new Map<string, Entry>();
	for (const e of allEntries) {
		if (e.id) byId.set(e.id, e);
	}

	const branchChain: Entry[] = [];
	let curr = byId.get(options.targetEntryId);
	while (curr) {
		branchChain.push(curr);
		curr = curr.parentId ? byId.get(curr.parentId) : undefined;
	}
	branchChain.reverse();

	const finalEntries = branchChain.length > 0 ? branchChain : allEntries;

	const parentDir = resolve(normalized, "..");
	const newUuid = crypto.randomUUID();
	const nowIso = new Date().toISOString();
	const timeFilePrefix = nowIso.replace(/[:.]/g, "-");
	const newFileName = `${timeFilePrefix}_${newUuid}.jsonl`;
	const newFilePath = join(parentDir, newFileName);

	const newHeader: Entry = {
		...(headerRow || {}),
		type: "session",
		version: 3,
		id: newUuid,
		timestamp: nowIso,
		cwd: options.cwd,
		title,
		titleSource: "fork",
		forkedFrom: {
			file: basename(options.sourceSessionFile),
			entryId: options.targetEntryId,
		},
	};

	const titleHeader = {
		type: "title",
		v: 1,
		title,
		source: "fork",
		updatedAt: nowIso,
	};

	const outputLines = [
		JSON.stringify(titleHeader),
		JSON.stringify(newHeader),
		...finalEntries.map(e => JSON.stringify(e)),
		"",
	];

	await writeFile(newFilePath, outputLines.join("\n"), "utf8");
	return newFilePath;
}
