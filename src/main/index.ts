import { createLocalSkill, deleteLocalSkill, installSkillshare, listLocalSkills, readSkillContent, saveSkillContent, searchSkillshare } from "./skills";
import { execFile } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ApprovalMode, GitDiffOptions, OpenSessionOptions, Theme } from "@shared/ipc";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { gitDiff, gitStatus, listDir, openInEditor } from "./git-fs";
import { detectDefaultApprovalMode, loginEnv, ompVersion, resolveOmp, RuntimePool } from "./runtimes";
import { deleteSessionFile, groupProjects, readSessionExcerpt, renameSessionFile, scanSessions, sessionsDir } from "./sessions";
import { readStore, writeStore } from "./store";

let win: BrowserWindow | null = null;

const pool = new RuntimePool((runtimeId, message) => {
	win?.webContents.send("omp:runtime", runtimeId, message);
});

/** 与 tokens.css 的 --bg 保持一致，供窗口首次绘制使用。 */
const WINDOW_BACKGROUND: Record<Theme, { dark: string; light: string }> = {
	default: { dark: "#121314", light: "#fdfdfd" },
	claude: { dark: "#252523", light: "#faf9f5" },
};

function windowBackground(): string {
	const colors = WINDOW_BACKGROUND[readStore().theme ?? "default"] ?? WINDOW_BACKGROUND.default;
	return nativeTheme.shouldUseDarkColors ? colors.dark : colors.light;
}

function cleanTitle(raw: string): string | null {
	if (!raw) return null;
	let text = raw.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
	text = text.replace(/^(?:Working|Thinking|Loading)\.{3,}\s*/i, "");
	text = text.replace(/<\/?title>/gi, "");
	text = text.replace(/^[#*\-•\s]+|[*\s]+$/g, "");
	text = text.replace(/^(?:会话标题|对话标题|简短标题|标题|Title)\s*[:：]\s*/i, "");
	text = text.replace(/^[“"‘'《「『【]+|[”"’'》」』】\s]+$/g, "");
	text = text.replace(/[。？！?!,.，、\s]+$/g, "");
	text = text.trim();
	const firstLine = text.split("\n").map(l => l.trim()).find(l => l.length > 0) || "";
	return firstLine.slice(0, 24).trim() || null;
}

function createWindow(): void {
	win = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 820,
		minHeight: 520,
		show: false,
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 14, y: 14 },
		icon: join(import.meta.dirname, "../../build/icon.png"),
		backgroundColor: windowBackground(),
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
		},
	});
	win.once("ready-to-show", () => win?.show());
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (url !== win?.webContents.getURL()) {
			event.preventDefault();
			if (/^https?:/.test(url)) void shell.openExternal(url);
		}
	});
	if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	win.on("closed", () => {
		win = null;
	});
}

function watchSessions(): void {
	let timer: NodeJS.Timeout | null = null;
	try {
		watch(sessionsDir(), { recursive: true }, (_event, name) => {
			if (name && !name.endsWith(".jsonl")) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => win?.webContents.send("omp:projects-changed"), 400);
		});
	} catch {
		// 目录不存在时不监听
	}
}

function registerIpc(): void {
	ipcMain.handle("omp:list-projects", async () => {
		const store = readStore();
		return groupProjects(await scanSessions(), store.projects, new Set(store.hidden));
	});
	ipcMain.handle("omp:pick-project", async () => {
		const result = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] });
		const path = result.canceled ? null : (result.filePaths[0] ?? null);
		if (path) {
			const store = readStore();
			writeStore({
				...store,
				projects: [...new Set([path, ...store.projects])],
				hidden: store.hidden.filter(p => p !== path),
			});
		}
		return path;
	});
	ipcMain.handle("omp:remove-project", (_e, path: string) => {
		const store = readStore();
		writeStore({ ...store, projects: store.projects.filter(p => p !== path), hidden: [...new Set([...store.hidden, path])] });
	});
	ipcMain.handle("omp:delete-session", async (_e, file: string) => {
		const success = await deleteSessionFile(file);
		win?.webContents.send("omp:projects-changed");
		return success;
	});
	ipcMain.handle("omp:rename-session", async (_e, file: string, title: string) => {
		const success = await renameSessionFile(file, title);
		win?.webContents.send("omp:projects-changed");
		return success;
	});
	ipcMain.handle("omp:read-session-excerpt", async (_e, file: string, maxTurns?: number) => {
		return readSessionExcerpt(file, maxTurns);
	});
	ipcMain.handle("omp:open-session", (_e, options: OpenSessionOptions) => {
		const store = readStore();
		if (store.hidden.includes(options.cwd)) writeStore({ ...store, hidden: store.hidden.filter(p => p !== options.cwd) });
		return pool.open(options);
	});
	ipcMain.handle("omp:close-runtime", (_e, runtimeId: string) => pool.close(runtimeId));
	ipcMain.handle("omp:request", (_e, runtimeId: string, command: Record<string, unknown>) => {
		const { type, ...payload } = command;
		return pool.get(runtimeId).request(String(type), payload);
	});
	ipcMain.handle("omp:send", (_e, runtimeId: string, frame: Record<string, unknown>) => pool.get(runtimeId).send(frame));
	ipcMain.handle("omp:version", () => ompVersion());
	ipcMain.handle("omp:default-approval-mode", () => {
		const store = readStore();
		return store.defaultApprovalMode ?? detectDefaultApprovalMode();
	});
	ipcMain.handle("omp:set-default-approval-mode", (_e, mode: ApprovalMode) => {
		const store = readStore();
		writeStore({ ...store, defaultApprovalMode: mode });
	});
	ipcMain.handle("omp:get-configs", async () => {
		try {
			const { stdout } = await promisify(execFile)("omp", ["config", "list", "--json"]);
			const all = JSON.parse(stdout) as Record<string, { value?: unknown }>;
			const result: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(all)) {
				if (v && typeof v === "object" && "value" in v) {
					result[k] = v.value;
				}
			}
			return result;
		} catch {
			return {};
		}
	});
	ipcMain.handle("omp:set-config", async (_e, key: string, value: string) => {
		try {
			await promisify(execFile)("omp", ["config", "set", key, String(value)]);
			return true;
		} catch {
			return false;
		}
	});
	ipcMain.handle("omp:set-theme", (_e, theme: Theme) => {
		const store = readStore();
		if (store.theme !== theme) writeStore({ ...store, theme });
		win?.setBackgroundColor(windowBackground());
	});
	ipcMain.handle("omp:reveal", (_e, path: string) => shell.showItemInFolder(path));
	ipcMain.handle("omp:list-dir", (_e, cwd: string, subpath?: string) => listDir(cwd, subpath));
	ipcMain.handle("omp:git-status", (_e, cwd: string) => gitStatus(cwd));
	ipcMain.handle("omp:git-diff", (_e, options: GitDiffOptions) => gitDiff(options));
	ipcMain.handle("omp:open-in-editor", (_e, cwd: string, file: string) => openInEditor(cwd, file));
	ipcMain.handle("omp:list-skills", (_e, cwd?: string) => listLocalSkills(cwd));
	ipcMain.handle("omp:create-skill", (_e, options) => createLocalSkill(options));
	ipcMain.handle("omp:delete-skill", (_e, path: string) => deleteLocalSkill(path));
	ipcMain.handle("omp:read-skill", (_e, path: string) => readSkillContent(path));
	ipcMain.handle("omp:save-skill", (_e, path: string, content: string) => saveSkillContent(path, content));
	ipcMain.handle("omp:search-registry-skills", (_e, query: string) => searchSkillshare(query));
	ipcMain.handle("omp:install-registry-skill", (_e, name: string, isGlobal?: boolean, cwd?: string) => installSkillshare(name, isGlobal, cwd));
	ipcMain.handle("omp:generate-title", async (_e, prompt: string) => {
		const ompPath = resolveOmp();
		if (!ompPath) return null;
		const cleanPrompt = prompt.replace(/\s+/g, " ").trim().slice(0, 300);
		if (!cleanPrompt) return null;

		try {
			const { stdout } = await promisify(execFile)(
				ompPath,
				[
					"-p",
					"--no-tools",
					"--thinking=off",
					`请用4到10个字概括以下需求的简短标题，只输出标题文字本身，不要标点符号、书名号或任何解释：\n${cleanPrompt}`,
				],
				{ env: loginEnv(), timeout: 15000 },
			);
			return cleanTitle(stdout);
		} catch {
			return null;
		}
	});
}

app.whenReady().then(() => {
	registerIpc();
	if (process.platform === "darwin" && app.dock) {
		const iconPath = join(import.meta.dirname, "../../build/icon.png");
		if (existsSync(iconPath)) app.dock.setIcon(iconPath);
	}
	createWindow();
	watchSessions();
	nativeTheme.on("updated", () => win?.setBackgroundColor(windowBackground()));
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => pool.disposeAll());
