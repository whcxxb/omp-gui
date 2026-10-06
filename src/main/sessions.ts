// 扫描 omp 会话目录，按项目（cwd）分组。
import { randomUUID } from "node:crypto";
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
	/** 是否存在真实对话内容（用户或助手消息）；仅有 session 头的空会话为 false */
	let hasMessages = false;
	type Header = { id?: string; cwd?: string; timestamp?: string; title?: string };
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
		else if (row.type === "session") {
			header = row as Header;
			if (!title && typeof header.title === "string" && header.title.trim()) title = header.title.trim();
		} else if (row.type === "title_change" && typeof row.title === "string" && row.title.trim()) title = row.title.trim();
		else if (row.type === "message") {
			const message = row.message as { role?: string; content?: unknown } | undefined;
			if (message?.role === "user" || message?.role === "assistant") hasMessages = true;
			if (message?.role === "user" && firstPrompt === null) {
				const text = textOf(message.content).replace(/\s+/g, " ").trim();
				if (text) firstPrompt = text.slice(0, TITLE_FALLBACK_CHARS);
			}
		}
		// hasMessages 决定侧边栏是否展示，不能因提前跳出而漏判
		if (header && title && hasMessages) break;
	}
	if (!header?.id || !header.cwd) return null;
	return {
		file,
		id: header.id,
		title: title ?? firstPrompt,
		cwd: header.cwd,
		hasMessages,
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

/** Validate the supplied journal path without modifying it. */
export async function readSessionHeader(file: string): Promise<{ file: string; id: string; cwd: string; legacyTitle: boolean }> {
	const normalized = resolve(file);
	if (!normalized.startsWith(resolve(sessionsDir()) + sep)) throw new Error("非法会话路径");
	const head = await readHead(normalized);
	const rows = head.split("\n");
	let first: Record<string, unknown>;
	let header: Record<string, unknown>;
	try {
		first = JSON.parse(rows[0]);
		header = first.type === "title" ? JSON.parse(rows[1]) : first;
	} catch { throw new Error("会话头格式无效，原文件未修改"); }
	if (header.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") {
		throw new Error("会话头格式无效，原文件未修改");
	}
	const nativeSlot = first.type === "title" && first.v === 1 && typeof first.pad === "string"
		&& typeof first.title === "string" && typeof first.updatedAt === "string"
		&& (first.source === undefined || first.source === "auto" || first.source === "user");
	const legacyTitle = first.type === "title" && !nativeSlot;
	if (legacyTitle && !(first.v === 1 && typeof first.title === "string" && typeof first.updatedAt === "string"
		&& (first.source === "custom" || first.source === "fork"))) {
		throw new Error("无法确认旧版会话格式，原文件未修改");
	}
	return { file: normalized, id: header.id, cwd: header.cwd, legacyTitle };
}

/** Recover only the recognized legacy GUI prefix into a new journal; keep the source as its byte-for-byte backup. */
export async function recoverLegacySessionCopy(file: string): Promise<string> {
	const info = await readSessionHeader(file);
	if (!info.legacyTitle) return info.file;
	const original = await readFile(info.file);
	const firstEnd = original.indexOf(10);
	const headerEnd = original.indexOf(10, firstEnd + 1);
	if (firstEnd < 0 || headerEnd < 0) throw new Error("旧会话头不完整，原文件未修改");
	const prefix = JSON.parse(original.subarray(0, firstEnd).toString("utf8")) as { title: string };
	const header = JSON.parse(original.subarray(firstEnd + 1, headerEnd).toString("utf8")) as Record<string, unknown>;
	if (header.type !== "session" || header.id !== info.id) throw new Error("会话已变化，请重新打开");
	// Confirm a complete JSONL snapshot before creating a recovered identity.
	for (const line of original.subarray(headerEnd + 1).toString("utf8").split("\n")) {
		if (line.trim()) JSON.parse(line);
	}
	if (!(await readFile(info.file)).equals(original)) throw new Error("会话仍在写入，请停止后重新打开");
	const id = randomUUID();
	const timestamp = new Date().toISOString();
	const target = join(resolve(info.file, ".."), `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
	const recovered = Buffer.concat([
		Buffer.from(`${JSON.stringify({ ...header, id, timestamp, title: prefix.title, titleSource: "user", parentSession: info.file })}\n`),
		original.subarray(headerEnd + 1),
	]);
	await writeFile(target, recovered, { flag: "wx" });
	return target;
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

