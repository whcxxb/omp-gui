import type { HighlighterCore, LanguageRegistration, ThemeRegistrationAny } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { loadTheme } from "./theme";

export type Highlighter = HighlighterCore;

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

const THEME_LOADERS: Record<string, () => Promise<{ default: ThemeRegistrationAny }>> = {
	"one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
	"github-light": () => import("shiki/themes/github-light.mjs"),
	"tokyo-night": () => import("shiki/themes/tokyo-night.mjs"),
	"vitesse-black": () => import("shiki/themes/vitesse-black.mjs"),
	"vitesse-dark": () => import("shiki/themes/vitesse-dark.mjs"),
	"github-light-default": () => import("shiki/themes/github-light-default.mjs"),
	"catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
	"catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
};

const LANG_LOADERS: Record<string, () => Promise<{ default: LanguageRegistration[] | LanguageRegistration }>> = {
	typescript: () => import("shiki/langs/typescript.mjs"),
	javascript: () => import("shiki/langs/javascript.mjs"),
	tsx: () => import("shiki/langs/tsx.mjs"),
	jsx: () => import("shiki/langs/jsx.mjs"),
	python: () => import("shiki/langs/python.mjs"),
	bash: () => import("shiki/langs/bash.mjs"),
	shellscript: () => import("shiki/langs/shellscript.mjs"),
	json: () => import("shiki/langs/json.mjs"),
	jsonc: () => import("shiki/langs/jsonc.mjs"),
	html: () => import("shiki/langs/html.mjs"),
	css: () => import("shiki/langs/css.mjs"),
	markdown: () => import("shiki/langs/markdown.mjs"),
	diff: () => import("shiki/langs/diff.mjs"),
	rust: () => import("shiki/langs/rust.mjs"),
	go: () => import("shiki/langs/go.mjs"),
	sql: () => import("shiki/langs/sql.mjs"),
	yaml: () => import("shiki/langs/yaml.mjs"),
	xml: () => import("shiki/langs/xml.mjs"),
	c: () => import("shiki/langs/c.mjs"),
	cpp: () => import("shiki/langs/cpp.mjs"),
	csharp: () => import("shiki/langs/csharp.mjs"),
	java: () => import("shiki/langs/java.mjs"),
	dockerfile: () => import("shiki/langs/dockerfile.mjs"),
};

// 高频代码高亮 LRU 缓存（上限 300 条），防止长会话滚动与重渲染重复解析
const highlightCache = new Map<string, string>();
const MAX_CACHE_SIZE = 300;

export function getHighlightCache(key: string): string | undefined {
	return highlightCache.get(key);
}

export function setHighlightCache(key: string, value: string): void {
	if (highlightCache.size >= MAX_CACHE_SIZE) {
		const oldest = highlightCache.keys().next().value;
		if (oldest !== undefined) highlightCache.delete(oldest);
	}
	highlightCache.set(key, value);
}

export async function ensureThemeLoaded(hl: HighlighterCore, theme: string): Promise<void> {
	const loaded = hl.getLoadedThemes();
	if (loaded.includes(theme)) return;
	const loader = THEME_LOADERS[theme];
	if (loader) {
		const mod = await loader();
		await hl.loadTheme(mod.default);
	}
}

export async function ensureLangLoaded(hl: HighlighterCore, lang: string): Promise<void> {
	if (lang === "text") return;
	const loaded = hl.getLoadedLanguages();
	if (loaded.includes(lang)) return;
	const loader = LANG_LOADERS[lang];
	if (loader) {
		const mod = await loader();
		await hl.loadLanguage(mod.default);
	}
}

export async function renderHighlightedHtml(code: string, rawLang?: string, rawTheme?: string): Promise<string> {
	const lang = normalizeLang(rawLang);
	const isDark = typeof window !== "undefined"
		? window.matchMedia("(prefers-color-scheme: dark)").matches
		: true;
	const theme = rawTheme || resolveShikiTheme(loadTheme(), isDark);

	const cacheKey = `${lang}:${theme}:${code}`;
	const cached = getHighlightCache(cacheKey);
	if (cached !== undefined) return cached;

	const hl = await initHighlighter();
	await Promise.all([
		ensureThemeLoaded(hl, theme),
		ensureLangLoaded(hl, lang),
	]);

	try {
		const html = hl.codeToHtml(code, { lang, theme });
		setHighlightCache(cacheKey, html);
		return html;
	} catch {
		return code;
	}
}

export async function initHighlighter(): Promise<Highlighter> {
	if (highlighterInstance) return highlighterInstance;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		// 初始加载最核心的 2 个基准主题与 4 个最高频语言，其余语言完全按需动态拉取
		const [defaultDarkTheme, defaultLightTheme, tsLang, bashLang, jsonLang, diffLang] = await Promise.all([
			THEME_LOADERS["one-dark-pro"]!(),
			THEME_LOADERS["github-light"]!(),
			LANG_LOADERS.typescript!(),
			LANG_LOADERS.bash!(),
			LANG_LOADERS.json!(),
			LANG_LOADERS.diff!(),
		]);

		const hl = await createHighlighterCore({
			themes: [defaultDarkTheme.default, defaultLightTheme.default],
			langs: [tsLang.default, bashLang.default, jsonLang.default, diffLang.default],
			engine: createOnigurumaEngine(import("shiki/wasm")),
		});

		highlighterInstance = hl;

		// 垫片 globalThis.hljs，令上游 collab-web 的工具卡片 (read, bash, edit, eval) 同样无缝享受语法高亮与 LRU 缓存
		try {
			const globalScope: Record<string, unknown> = globalThis as Record<string, unknown>;
			globalScope.hljs = {
				getLanguage(name: string): boolean {
					const normalized = normalizeLang(name);
					return normalized in LANG_LOADERS || hl.getLoadedLanguages().includes(normalized);
				},
				highlight(code: string, options: { language: string }): { value: string } {
					const lang = normalizeLang(options.language);
					const isDark = typeof window !== "undefined"
						? window.matchMedia("(prefers-color-scheme: dark)").matches
						: true;
					const theme = resolveShikiTheme(loadTheme(), isDark);
					const cacheKey = `${lang}:${theme}:${code}`;
					const cached = getHighlightCache(cacheKey);
					if (cached !== undefined) {
						const innerMatch = /<code>([\s\S]*?)<\/code>/i.exec(cached);
						return { value: innerMatch ? innerMatch[1] : cached };
					}

					if (hl.getLoadedLanguages().includes(lang) && hl.getLoadedThemes().includes(theme)) {
						try {
							const html = hl.codeToHtml(code, { lang, theme });
							setHighlightCache(cacheKey, html);
							const innerMatch = /<code>([\s\S]*?)<\/code>/i.exec(html);
							return { value: innerMatch ? innerMatch[1] : html };
						} catch {
							return { value: code };
						}
					}

					// 异步后台加载新语言/主题，加载完成后自动预热缓存
					void Promise.all([
						ensureThemeLoaded(hl, theme),
						ensureLangLoaded(hl, lang),
					]).then(() => {
						try {
							const html = hl.codeToHtml(code, { lang, theme });
							setHighlightCache(cacheKey, html);
						} catch {}
					});

					return { value: code };
				},
			};
		} catch {}

		return hl;
	})();

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
