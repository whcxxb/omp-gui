// 扫描 omp 会话目录，按项目（cwd）分组。
import { existsSync } from "node:fs";
import { open, readdir, stat, unlink } from "node:fs/promises";
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
	for (const project of map.values()) project.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
	return [...map.values()].filter(p => !hidden.has(p.path)).sort((a, b) => b.updatedAt - a.updatedAt);
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
