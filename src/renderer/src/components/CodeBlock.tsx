import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { normalizeLang, renderHighlightedHtml, resolveShikiTheme } from "../lib/highlighter";
import { loadTheme } from "../lib/theme";

interface CodeBlockProps {
	code: string;
	language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps): ReactNode {
	const [copied, setCopied] = useState(false);
	const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

	const normalized = normalizeLang(language);
	const displayLang = (language || "code").toUpperCase();

	const [themeState, setThemeState] = useState<string>(loadTheme);
	const [isDarkState, setIsDarkState] = useState<boolean>(() =>
		typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : true
	);

	useEffect(() => {
		const onTheme = (): void => setThemeState(loadTheme());
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onDark = (e: MediaQueryListEvent): void => setIsDarkState(e.matches);

		window.addEventListener("omp:theme-changed", onTheme);
		media.addEventListener("change", onDark);
		return () => {
			window.removeEventListener("omp:theme-changed", onTheme);
			media.removeEventListener("change", onDark);
		};
	}, []);

	const shikiTheme = resolveShikiTheme(themeState, isDarkState);

	useEffect(() => {
		let isCancelled = false;
		void renderHighlightedHtml(code, normalized, shikiTheme).then(html => {
			if (!isCancelled) {
				setHighlightedHtml(html);
			}
		});
		return () => {
			isCancelled = true;
		};
	}, [code, normalized, shikiTheme]);

	const handleCopy = (): void => {
		void navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="code-block-card">
			<div className="code-block-header">
				<span className="code-block-lang">{displayLang}</span>
				<button
					type="button"
					className="code-block-copy-btn"
					title="复制代码"
					onClick={handleCopy}
				>
					{copied ? <Check size={12} className="is-success" /> : <Copy size={12} />}
					<span>{copied ? "已复制" : "复制"}</span>
				</button>
			</div>

			<div className="code-block-body">
				{highlightedHtml ? (
					<div
						className="code-block-content"
						dangerouslySetInnerHTML={{ __html: highlightedHtml }}
					/>
				) : (
					<pre className="code-block-fallback">
						<code>{code}</code>
					</pre>
				)}
			</div>
		</div>
	);
}
