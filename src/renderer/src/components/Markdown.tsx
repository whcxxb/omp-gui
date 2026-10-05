import { Marked } from "marked";
import { lazy, memo, Suspense, type ReactNode, useMemo } from "react";
import { Markdown as CollabMarkdown } from "@/collab/components/transcript/Markdown";
import { CodeBlock } from "./CodeBlock";

const LazyMermaidBlock = lazy(() => import("./MermaidBlock"));

interface EnhancedMarkdownProps {
	text: string;
}

type Segment =
	| { type: "markdown"; content: string }
	| { type: "code"; lang: string; content: string }
	| { type: "mermaid"; content: string };

const lexerMd = new Marked({ gfm: true, breaks: true });

function parseSegments(input: string): Segment[] {
	if (!input || (!input.includes("```") && !input.includes("~~~"))) {
		return [{ type: "markdown", content: input }];
	}

	try {
		const tokens = lexerMd.lexer(input);
		const segments: Segment[] = [];
		let proseBuffer = "";

		const flushProse = (): void => {
			if (proseBuffer.trim()) {
				segments.push({ type: "markdown", content: proseBuffer });
			}
			proseBuffer = "";
		};

		for (const token of tokens) {
			if (token.type === "code") {
				flushProse();
				const lang = (token.lang || "").trim().toLowerCase();
				if (lang === "mermaid") {
					segments.push({ type: "mermaid", content: token.text.trim() });
				} else {
					segments.push({ type: "code", lang, content: token.text });
				}
			} else {
				proseBuffer += token.raw;
			}
		}
		flushProse();

		return segments.length > 0 ? segments : [{ type: "markdown", content: input }];
	} catch {
		return [{ type: "markdown", content: input }];
	}
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
						return (
							<Suspense
								key={`mmd-${i}`}
								fallback={
									<div className="mermaid-fallback-box">
										<div className="mermaid-bar">
											<span className="mermaid-tag">Mermaid 架构图</span>
											<span className="mermaid-status-hint">正在加载图表引擎...</span>
										</div>
										<pre className="mermaid-code-pre">
											<code>{seg.content}</code>
										</pre>
									</div>
								}
							>
								<LazyMermaidBlock code={seg.content} />
							</Suspense>
						);
					case "markdown":
					default:
						return <CollabMarkdown key={`md-${i}`} text={seg.content} />;
				}
			})}
		</div>
	);
});
