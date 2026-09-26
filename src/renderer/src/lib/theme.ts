/** 界面配色主题。明暗仍跟随系统，这里只切换色板。 */
import type { Theme } from "@shared/ipc";

export type { Theme };

export const THEMES: { id: Theme; label: string }[] = [
	{ id: "default", label: "默认" },
	{ id: "claude", label: "Claude" },
];

const STORAGE_KEY = "omp-gui.theme";

export function loadTheme(): Theme {
	const saved = localStorage.getItem(STORAGE_KEY);
	return saved === "claude" ? "claude" : "default";
}

export function applyTheme(theme: Theme): void {
	if (theme === "default") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
	void window.omp.setTheme(theme);
}
