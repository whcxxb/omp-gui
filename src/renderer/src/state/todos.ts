// 项目待办清单的渲染进程状态：按 cwd 缓存，变更由主进程广播驱动。
import { useSyncExternalStore } from "react";
import type { TodoAttachmentInput, TodoCreateInput, TodoItem, TodoPatch } from "@shared/ipc";

const listeners = new Set<() => void>();
/** cwd -> 待办列表（已按 order 排序） */
let byProject: Record<string, TodoItem[]> = {};
let loaded = new Set<string>();

function commit(): void {
	byProject = { ...byProject };
	for (const listener of listeners) listener();
}

export function useTodos(cwd: string): TodoItem[] {
	return useSyncExternalStore(
		listener => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => byProject[cwd] ?? EMPTY,
	);
}

const EMPTY: TodoItem[] = [];

export function isTodosLoaded(cwd: string): boolean {
	return loaded.has(cwd);
}

export async function loadTodos(cwd: string): Promise<void> {
	const items = await window.omp.listTodos(cwd);
	byProject[cwd] = items;
	loaded.add(cwd);
	commit();
}

export async function createTodo(input: TodoCreateInput): Promise<TodoItem> {
	const todo = await window.omp.createTodo(input);
	await loadTodos(input.cwd);
	return todo;
}

export async function updateTodo(cwd: string, id: string, patch: TodoPatch): Promise<TodoItem> {
	const todo = await window.omp.updateTodo(cwd, id, patch);
	await loadTodos(cwd);
	if (!todo) throw new Error("待办不存在或已被删除");
	return todo;
}

export async function deleteTodo(cwd: string, id: string): Promise<void> {
	await window.omp.deleteTodo(cwd, id);
	await loadTodos(cwd);
}

export async function reorderTodos(cwd: string, orderedIds: string[]): Promise<void> {
	byProject[cwd] = await window.omp.reorderTodos(cwd, orderedIds);
	commit();
}

export async function addTodoAttachment(input: TodoAttachmentInput): Promise<void> {
	await window.omp.addTodoAttachment(input);
	await loadTodos(input.cwd);
}

export async function removeTodoAttachment(cwd: string, todoId: string, attachmentId: string): Promise<void> {
	await window.omp.removeTodoAttachment(cwd, todoId, attachmentId);
	await loadTodos(cwd);
}

if (typeof window !== "undefined" && window.omp?.onTodosChanged) {
	window.omp.onTodosChanged(cwd => {
		void loadTodos(cwd);
	});
}
