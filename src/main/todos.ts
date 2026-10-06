// 项目待办清单持久化：userData/todos.json + userData/todo-blobs/<sha256>。
// 按项目（cwd）隔离；图片等二进制以内容寻址单独存放，避免每次编辑重写整个 JSON。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type {
	TodoAttachment,
	TodoAttachmentInput,
	TodoCreateInput,
	TodoItem,
	TodoPatch,
	TodoPriority,
	TodoRun,
	TodoStatus,
} from "@shared/ipc";

interface TodosFile {
	version: 1;
	/** cwd -> 待办数组 */
	projects: Record<string, TodoItem[]>;
}

const STATUS_SET: Record<string, TodoStatus> = { todo: "todo", doing: "doing", done: "done", dropped: "dropped" };
const PRIORITY_SET: Record<string, TodoPriority> = { high: "high", normal: "normal", low: "low" };

function storePath(): string {
	return join(app.getPath("userData"), "todos.json");
}

function blobsPath(): string {
	return join(app.getPath("userData"), "todo-blobs");
}

function readAll(): TodosFile {
	try {
		const path = storePath();
		if (!existsSync(path)) return { version: 1, projects: {} };
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TodosFile>;
		const projects: Record<string, TodoItem[]> = {};
		for (const [cwd, items] of Object.entries(parsed.projects ?? {})) {
			if (Array.isArray(items)) projects[cwd] = items.filter(isTodoItem);
		}
		return { version: 1, projects };
	} catch {
		// 损坏时回退空表，避免整个功能不可用
		return { version: 1, projects: {} };
	}
}

function isTodoItem(value: unknown): value is TodoItem {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<TodoItem>;
	return typeof item.id === "string" && typeof item.cwd === "string" && typeof item.title === "string";
}

/** 原子写：先落临时文件再 rename，避免中途崩溃留下半截 JSON。 */
function writeAll(data: TodosFile): void {
	const path = storePath();
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
	renameSync(tmp, path);
}

function sortItems(items: TodoItem[]): TodoItem[] {
	return [...items].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

function normalizeStatus(value: unknown, fallback: TodoStatus): TodoStatus {
	return typeof value === "string" && value in STATUS_SET ? STATUS_SET[value]! : fallback;
}

function normalizePriority(value: unknown, fallback: TodoPriority): TodoPriority {
	return typeof value === "string" && value in PRIORITY_SET ? PRIORITY_SET[value]! : fallback;
}

/** 内容寻址写入 blob，返回 sha256；相同内容自动去重。 */
function putBlob(base64: string): { blob: string; size: number } {
	const bytes = Buffer.from(base64, "base64");
	const blob = createHash("sha256").update(bytes).digest("hex");
	const dir = blobsPath();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const target = join(dir, blob);
	if (!existsSync(target)) writeFileSync(target, bytes);
	return { blob, size: bytes.byteLength };
}

/** 读取 blob 的 base64 内容；blob 是内容寻址的 sha256，路径不可逃逸。 */
export function readAttachment(blob: string): string | null {
	if (!/^[a-f0-9]{64}$/.test(blob)) return null;
	const path = join(blobsPath(), blob);
	if (!existsSync(path)) return null;
	return readFileSync(path).toString("base64");
}

function dropBlobIfUnused(data: TodosFile, blob: string | undefined): void {
	if (!blob) return;
	for (const items of Object.values(data.projects)) {
		for (const item of items) {
			if (item.attachments.some(att => att.blob === blob)) return;
		}
	}
	rmSync(join(blobsPath(), blob), { force: true });
}

export function listTodos(cwd: string): TodoItem[] {
	return sortItems(readAll().projects[cwd] ?? []);
}

export function createTodo(input: TodoCreateInput): TodoItem {
	const data = readAll();
	const items = data.projects[input.cwd] ?? [];
	const now = Date.now();
	const todo: TodoItem = {
		id: crypto.randomUUID(),
		cwd: input.cwd,
		phase: input.phase?.trim() || "待办",
		title: input.title.trim() || "未命名待办",
		detail: input.detail ?? "",
		status: "todo",
		priority: normalizePriority(input.priority, "normal"),
		order: items.reduce((max, item) => Math.max(max, item.order), -1) + 1,
		attachments: [],
		runs: [],
		source: input.source === "model" ? "model" : "user",
		createdAt: now,
		updatedAt: now,
	};
	data.projects[input.cwd] = [...items, todo];
	writeAll(data);
	return todo;
}

export function updateTodo(cwd: string, id: string, patch: TodoPatch): TodoItem | null {
	const data = readAll();
	const items = data.projects[cwd] ?? [];
	const index = items.findIndex(item => item.id === id);
	if (index === -1) return null;
	const current = items[index]!;
	const next: TodoItem = {
		...current,
		phase: patch.phase === undefined ? current.phase : patch.phase.trim() || current.phase,
		title: patch.title === undefined ? current.title : patch.title.trim() || current.title,
		detail: patch.detail === undefined ? current.detail : patch.detail,
		status: patch.status === undefined ? current.status : normalizeStatus(patch.status, current.status),
		priority: patch.priority === undefined ? current.priority : normalizePriority(patch.priority, current.priority),
		updatedAt: Date.now(),
	};
	items[index] = next;
	data.projects[cwd] = items;
	writeAll(data);
	return next;
}

export function deleteTodo(cwd: string, id: string): boolean {
	const data = readAll();
	const items = data.projects[cwd] ?? [];
	const target = items.find(item => item.id === id);
	if (!target) return false;
	data.projects[cwd] = items.filter(item => item.id !== id);
	writeAll(data);
	for (const att of target.attachments) dropBlobIfUnused(data, att.blob);
	return true;
}

export function reorderTodos(cwd: string, orderedIds: string[]): TodoItem[] {
	const data = readAll();
	const items = data.projects[cwd] ?? [];
	const rank = new Map(orderedIds.map((id, index) => [id, index]));
	const next = items.map(item => {
		const position = rank.get(item.id);
		return position === undefined ? item : { ...item, order: position, updatedAt: Date.now() };
	});
	data.projects[cwd] = next;
	writeAll(data);
	return sortItems(next);
}

export function addAttachment(input: TodoAttachmentInput): TodoItem | null {
	const data = readAll();
	const items = data.projects[input.cwd] ?? [];
	const index = items.findIndex(item => item.id === input.todoId);
	if (index === -1) return null;
	// 无内容（例如拖入的目录）时退化为纯路径引用，仍然记录在案
	const stored = input.data ? putBlob(input.data) : null;
	const attachment: TodoAttachment = {
		id: crypto.randomUUID(),
		kind: input.mimeType.startsWith("image/") ? "image" : "file",
		name: input.name,
		mimeType: input.mimeType,
		blob: stored?.blob,
		size: stored?.size ?? 0,
		path: input.path,
	};
	const current = items[index]!;
	const next: TodoItem = { ...current, attachments: [...current.attachments, attachment], updatedAt: Date.now() };
	items[index] = next;
	data.projects[input.cwd] = items;
	writeAll(data);
	return next;
}

export function removeAttachment(cwd: string, todoId: string, attachmentId: string): TodoItem | null {
	const data = readAll();
	const items = data.projects[cwd] ?? [];
	const index = items.findIndex(item => item.id === todoId);
	if (index === -1) return null;
	const current = items[index]!;
	const target = current.attachments.find(att => att.id === attachmentId);
	const next: TodoItem = {
		...current,
		attachments: current.attachments.filter(att => att.id !== attachmentId),
		updatedAt: Date.now(),
	};
	items[index] = next;
	data.projects[cwd] = items;
	writeAll(data);
	if (target) dropBlobIfUnused(data, target.blob);
	return next;
}

/** 追加一条执行记录；同时把待办推进到「进行中」。 */
export function recordRun(cwd: string, todoId: string, run: Omit<TodoRun, "id">): TodoItem | null {
	const data = readAll();
	const items = data.projects[cwd] ?? [];
	const index = items.findIndex(item => item.id === todoId);
	if (index === -1) return null;
	const current = items[index]!;
	const next: TodoItem = {
		...current,
		// 只保留最近 10 次执行记录
		runs: [...current.runs, { ...run, id: crypto.randomUUID() }].slice(-10),
		status: current.status === "done" || current.status === "dropped" ? current.status : "doing",
		updatedAt: Date.now(),
	};
	items[index] = next;
	data.projects[cwd] = items;
	writeAll(data);
	return next;
}
