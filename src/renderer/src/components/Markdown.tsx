import { memo, type ReactNode, useMemo } from "react";
import { Markdown as CollabMarkdown } from "@/collab/components/transcript/Markdown";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";

interface EnhancedMarkdownProps {
	text: string;
}

type Segment =
	| { type: "markdown"; content: string }
	| { type: "code"; lang: string; content: string }
	| { type: "mermaid"; content: string };

function parseSegments(input: string): Segment[] {
	if (!input.includes("```")) {
		return [{ type: "markdown", content: input }];
	}

	const regex = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g;
	const segments: Segment[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(input)) !== null) {
		if (match.index > lastIndex) {
			const prose = input.slice(lastIndex, match.index);
			if (prose) {
				segments.push({ type: "markdown", content: prose });
			}
		}

		const lang = (match[1] || "").trim().toLowerCase();
		const rawCode = match[2] ?? "";
		const code = rawCode.replace(/\r?\n$/, "");

		if (lang === "mermaid") {
			segments.push({ type: "mermaid", content: code.trim() });
		} else {
			segments.push({ type: "code", lang, content: code });
		}

		lastIndex = regex.lastIndex;
	}

	if (lastIndex < input.length) {
		const tail = input.slice(lastIndex);
		if (tail) {
			segments.push({ type: "markdown", content: tail });
		}
	}

	return segments;
}

export const Markdown = memo(function Markdown({ text }: EnhancedMarkdownProps): ReactNode {
	const segments = useMemo(() => parseSegments(text), [text]);

	if (segments.length === 1 && segments[0]!.type === "markdown") {
		return <CollabMarkdown text={text} />;
	}

	return (
		<div className="tr-md-container">
			{segments.map((seg, i) => {
				switch (seg.type) {
					case "code":
						return <CodeBlock key={`code-${i}`} code={seg.content} language={seg.lang} />;
					case "mermaid":
						return <MermaidBlock key={`mmd-${i}`} code={seg.content} />;
					case "markdown":
					default:
						return <CollabMarkdown key={`md-${i}`} text={seg.content} />;
				}
			})}
		</div>
	);
});
