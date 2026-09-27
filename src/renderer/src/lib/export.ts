import type { SessionEntry } from "@/collab/wire/index";
import type { Thread } from "@/state/types";

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map(c => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && "text" in c) return String(c.text);
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

export function buildThreadMarkdown(thread: Thread): string {
	const title = thread.state?.sessionName || "对话记录";
	const lines: string[] = [
		`# ${title}`,
		"",
		`- **工作目录**: \`${thread.cwd}\``,
		`- **导出时间**: ${new Date().toLocaleString()}`,
		`- **消息数量**: ${thread.entries.length}`,
		"",
		"---",
		"",
	];

	for (const entry of thread.entries as SessionEntry[]) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				if (msg.synthetic) continue;
				lines.push("## 🧑 用户\n");
				lines.push(extractText(msg.content));
				lines.push("\n");
			} else if (msg.role === "assistant") {
				lines.push("## 🤖 助手\n");
				for (const block of msg.content) {
					if (block.type === "thinking" && block.thinking.trim()) {
						lines.push("<details><summary>💭 思考过程</summary>\n");
						lines.push(block.thinking);
						lines.push("\n</details>\n");
					} else if (block.type === "text" && block.text) {
						lines.push(block.text);
						lines.push("\n");
					} else if (block.type === "toolCall") {
						lines.push(`> 🛠️ **调用工具**: \`${block.name}\`\n>`);
						lines.push("> ```json");
						lines.push(`> ${JSON.stringify(block.arguments, null, 2).replace(/\n/g, "\n> ")}`);
						lines.push("> ```\n");
					}
				}
				lines.push("\n");
			}
		}
	}

	return lines.join("\n");
}

export function exportThreadToMarkdown(thread: Thread): void {
	const title = thread.state?.sessionName || "未命名对话";
	const md = buildThreadMarkdown(thread);
	const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	const safeName = title.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 50);
	a.download = `${safeName}.md`;
	a.click();
	URL.revokeObjectURL(url);
}
