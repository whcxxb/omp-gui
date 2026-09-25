import { watch } from "node:fs";
import { join } from "node:path";
import type { OpenSessionOptions } from "@shared/ipc";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { ompVersion, RuntimePool } from "./runtimes";
import { groupProjects, scanSessions, sessionsDir } from "./sessions";
import { readStore, writeStore } from "./store";

let win: BrowserWindow | null = null;

const pool = new RuntimePool((runtimeId, message) => {
	win?.webContents.send("omp:runtime", runtimeId, message);
});

function createWindow(): void {
	win = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 820,
		minHeight: 520,
		show: false,
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 14, y: 14 },
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#17151a" : "#fbfbfc",
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
				projects: [...new Set([path, ...store.projects])],
				hidden: store.hidden.filter(p => p !== path),
			});
		}
		return path;
	});
	ipcMain.handle("omp:remove-project", (_e, path: string) => {
		const store = readStore();
		writeStore({ projects: store.projects.filter(p => p !== path), hidden: [...new Set([...store.hidden, path])] });
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
	ipcMain.handle("omp:reveal", (_e, path: string) => shell.showItemInFolder(path));
}

app.whenReady().then(() => {
	registerIpc();
	createWindow();
	watchSessions();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => pool.disposeAll());
