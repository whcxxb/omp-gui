// 暴露给 omp 的宿主工具：让模型直接维护「项目待办清单」。
// 通过 RPC `set_host_tools` 注册，模型调用时服务端回调 `host_tool_call`，由主进程执行并回包。
import type { HostToolDefinition, HostToolResult, TodoItem } from "@shared/ipc";
import { createTodo, deleteTodo, listTodos, updateTodo } from "./todos";

export const PROJECT_TODO_TOOL = "project_todo";

const STATUS_MARK: Record<string, string> = {
	todo: "○",
	doing: "→",
	done: "✓",
	dropped: "✕",
};

export const PROJECT_TODO_DEFINITION: HostToolDefinition = {
	name: PROJECT_TODO_TOOL,
	label: "项目待办",
	loadMode: "essential",
	description: [
		"读取或修改**当前项目的长期待办清单**（跨会话持久保存，用户在右侧栏「待办」面板可见）。",
		"与内置 todo 工具的区别：内置 todo 是本次会话的临时任务板；本工具写入的是项目级待办，会话结束后依然保留。",
		"当用户要求「规划下一步」「把这件事记到待办清单」「列出待办」时使用本工具。",
	].join("\n"),
	parameters: {
		type: "object",
		properties: {
			op: {
				type: "string",
				enum: ["view", "add", "update", "done", "drop", "rm"],
				description:
					"view=列出全部待办；add=新增（可用 items 批量）；update=改标题/正文/分组；done=标记完成；drop=标记放弃；rm=删除。",
			},
			title: { type: "string", description: "待办标题（add 时必填，update/done/drop/rm 时用于定位）" },
			detail: { type: "string", description: "待办正文，支持 Markdown（add/update 可选）" },
			phase: { type: "string", description: "分组/阶段名，例如「第一阶段」「下一步规划」（add/update 可选）" },
			priority: { type: "string", enum: ["high", "normal", "low"], description: "优先级，默认 normal" },
			items: {
				type: "array",
				description: "add 时批量新增的标题列表，与 title 二选一",
				items: { type: "string" },
			},
			id: { type: "string", description: "待办 id（比 title 更精确的定位方式）" },
		},
		required: ["op"],
	},
};

function renderList(items: TodoItem[]): string {
	if (items.length === 0) return "当前项目待办清单为空。";
	const byPhase = new Map<string, TodoItem[]>();
	for (const item of items) {
		const bucket = byPhase.get(item.phase) ?? [];
		bucket.push(item);
		byPhase.set(item.phase, bucket);
	}
	const lines: string[] = [`当前项目待办清单（共 ${items.length} 条）：`];
	for (const [phase, bucket] of byPhase) {
		lines.push("", `## ${phase}`);
		for (const item of bucket) {
			const mark = STATUS_MARK[item.status] ?? "○";
			const flag = item.source === "model" ? " (模型写入)" : "";
			lines.push(`- [${mark}] ${item.title}${flag} · id=${item.id}`);
		}
	}
	return lines.join("\n");
}

/** 按 id 或标题精确定位；标题匹配时优先未完成项。 */
function locate(items: TodoItem[], id?: string, title?: string): TodoItem | undefined {
	if (id) return items.find(item => item.id === id);
	if (!title) return undefined;
	const exact = items.filter(item => item.title === title);
	return exact.find(item => item.status === "todo" || item.status === "doing") ?? exact[0];
}

function text(body: string): HostToolResult {
	return { content: [{ type: "text", text: body }] };
}

function fail(body: string): HostToolResult {
	return { content: [{ type: "text", text: body }], isError: true };
}

/** 执行一次 project_todo 调用。返回结果帧内容，由 RuntimePool 回写给 omp。 */
export function runProjectTodoTool(cwd: string, args: Record<string, unknown>): HostToolResult {
	const op = String(args.op ?? "");
	const title = typeof args.title === "string" ? args.title.trim() : "";
	const id = typeof args.id === "string" ? args.id.trim() : "";
	const detail = typeof args.detail === "string" ? args.detail : undefined;
	const phase = typeof args.phase === "string" ? args.phase : undefined;
	const priority = typeof args.priority === "string" ? args.priority : undefined;
	const items = listTodos(cwd);

	switch (op) {
		case "view":
			return text(renderList(items));

		case "add": {
			const titles = [
				...(title ? [title] : []),
				...(Array.isArray(args.items) ? args.items.map(item => String(item).trim()).filter(Boolean) : []),
			];
			if (titles.length === 0) return fail("add 需要 title 或 items。");
			const created = titles.map((entry, index) =>
				createTodo({
					cwd,
					title: entry,
					// 批量新增时只有第一条携带正文，避免复制出重复内容
					detail: index === 0 ? detail : undefined,
					phase,
					priority: priority === "high" || priority === "low" ? priority : "normal",
					source: "model",
				}),
			);
			return text(`已新增 ${created.length} 条待办：\n${created.map(item => `- ${item.title} · id=${item.id}`).join("\n")}`);
		}

		case "update": {
			const target = locate(items, id, title);
			if (!target) return fail(`未找到待办：${title || id}`);
			// 只给 title 时它是定位条件；同时给 id 时 title 才是新标题
			const nextTitle = id && title ? title : undefined;
			const next = updateTodo(cwd, target.id, {
				title: nextTitle,
				detail,
				phase,
				priority: priority === "high" || priority === "normal" || priority === "low" ? priority : undefined,
			});
			return text(`已更新待办「${next?.title ?? target.title}」· id=${target.id}`);
		}

		case "done":
		case "drop": {
			const located = id || title ? locate(items, id, title) : undefined;
			const targets = id || title ? (located ? [located] : []) : items.filter(item => item.status === "todo" || item.status === "doing");
			if (targets.length === 0) return fail(`未找到待办：${title || id}`);
			for (const target of targets) {
				updateTodo(cwd, target.id, { status: op === "done" ? "done" : "dropped" });
			}
			return text(`已标记 ${targets.length} 条待办为${op === "done" ? "完成" : "放弃"}。`);
		}

		case "rm": {
			const target = locate(items, id, title);
			if (!target) return fail(`未找到待办：${title || id}`);
			deleteTodo(cwd, target.id);
			return text(`已删除待办「${target.title}」。`);
		}

		default:
			return fail(`未知操作：${op || "(空)"}；可用 view/add/update/done/drop/rm。`);
	}
}
