/** 界面配色主题。明暗仍跟随系统，这里只切换色板。 */
import type { Theme } from "@shared/ipc";

export type { Theme };

export const THEMES: { id: Theme; label: string; desc: string }[] = [
	{ id: "default", label: "默认中性", desc: "现代极简灰阶，护眼均衡对比度" },
	{ id: "claude", label: "Claude 暖陶", desc: "Anthropic 经典暖灰调与陶土橙" },
	{ id: "tokyo-night", label: "Tokyo Night", desc: "经典赛博冷调深紫蓝" },
	{ id: "pure-black", label: "Pure Black", desc: "OLED 纯黑极高对比度" },
];

const STORAGE_KEY = "omp-gui.theme";

export function loadTheme(): Theme {
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved === "claude" || saved === "tokyo-night" || saved === "pure-black") return saved;
	return "default";
}

export function applyTheme(theme: Theme): void {
	if (theme === "default") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
	void window.omp.setTheme(theme);
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("omp:theme-changed", { detail: { theme } }));
	}
}
