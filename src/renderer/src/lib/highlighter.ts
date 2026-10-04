import { createHighlighter, type Highlighter } from "shiki";
import { loadTheme } from "./theme";

let highlighterInstance: Highlighter | null = null;
let initPromise: Promise<Highlighter> | null = null;

export const SHIKI_THEMES = [
	"one-dark-pro",
	"github-light",
	"tokyo-night",
	"vitesse-black",
	"vitesse-dark",
	"github-light-default",
	"catppuccin-latte",
	"catppuccin-mocha",
] as const;

export const SHIKI_LANGS = [
	"typescript",
	"javascript",
	"tsx",
	"jsx",
	"python",
	"bash",
	"shell",
	"sh",
	"json",
	"jsonc",
	"html",
	"css",
	"markdown",
	"diff",
	"rust",
	"go",
	"sql",
	"yaml",
	"xml",
	"c",
	"cpp",
	"csharp",
	"java",
	"dockerfile",
] as const;

export async function initHighlighter(): Promise<Highlighter> {
	if (highlighterInstance) return highlighterInstance;
	if (initPromise) return initPromise;

	initPromise = createHighlighter({
		themes: SHIKI_THEMES as unknown as string[],
		langs: SHIKI_LANGS as unknown as string[],
	}).then(hl => {
		highlighterInstance = hl;

		// 垫片 globalThis.hljs，令上游 collab-web 的工具卡片 (read, bash, edit, eval) 同样无缝享受语法高亮
		try {
			const langs = new Set(hl.getLoadedLanguages());
			const globalScope: Record<string, unknown> = globalThis as Record<string, unknown>;
			globalScope.hljs = {
				getLanguage(name: string): boolean {
					const normalized = normalizeLang(name);
					return langs.has(normalized);
				},
				highlight(code: string, options: { language: string }): { value: string } {
					const lang = normalizeLang(options.language);
					const isDark = typeof window !== "undefined"
						? window.matchMedia("(prefers-color-scheme: dark)").matches
						: true;
					const theme = resolveShikiTheme(loadTheme(), isDark);
					try {
						// 提取 inner html，去除外部 pre/code 容器以适配 collab-web 的 .tv-pre 容器
						const html = hl.codeToHtml(code, { lang, theme });
						const innerMatch = /<code>([\s\S]*?)<\/code>/i.exec(html);
						return { value: innerMatch ? innerMatch[1] : html };
					} catch {
						return { value: code };
					}
				},
			};
		} catch {}

		return hl;
	});

	return initPromise;
}

export function getHighlighterSync(): Highlighter | null {
	return highlighterInstance;
}

export function normalizeLang(lang?: string): string {
	if (!lang) return "text";
	const lower = lang.toLowerCase().trim();
	if (lower === "js") return "javascript";
	if (lower === "ts") return "typescript";
	if (lower === "py") return "python";
	if (lower === "sh" || lower === "zsh") return "bash";
	if (lower === "yml") return "yaml";
	if (lower === "rb") return "ruby";
	if (lower === "rs") return "rust";
	return lower;
}

export function resolveShikiTheme(appTheme: string | undefined, isDark: boolean): string {
	if (appTheme === "tokyo-night") {
		return isDark ? "tokyo-night" : "github-light";
	}
	if (appTheme === "claude") {
		return isDark ? "catppuccin-mocha" : "catppuccin-latte";
	}
	if (appTheme === "pure-black") {
		return isDark ? "vitesse-black" : "github-light-default";
	}
	// default
	return isDark ? "one-dark-pro" : "github-light";
}
