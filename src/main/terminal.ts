import { spawn, type ChildProcess } from "node:child_process";
import { BrowserWindow, ipcMain } from "electron";
import { loginEnv } from "./runtimes";

interface RunningProcess {
	id: string;
	child: ChildProcess;
}

const activeProcesses = new Map<string, RunningProcess>();

export function registerTerminalIpc(getWin: () => BrowserWindow | null): void {
	ipcMain.handle("omp:terminal-exec", (_event, { cwd, command }: { cwd: string; command: string }) => {
		const id = crypto.randomUUID();
		const env = loginEnv();
		const isWin = process.platform === "win32";
		const shell = isWin ? process.env.COMSPEC || "cmd.exe" : env.SHELL || "/bin/zsh";
		const flag = isWin ? "/c" : "-ilc";

		try {
			const child = spawn(shell, [flag, command], {
				cwd,
				env,
				stdio: ["pipe", "pipe", "pipe"],
			});

			activeProcesses.set(id, { id, child });

			child.stdout?.on("data", (chunk: Buffer) => {
				const win = getWin();
				win?.webContents.send("omp:terminal-output", {
					id,
					data: chunk.toString("utf8"),
					isStderr: false,
				});
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				const win = getWin();
				win?.webContents.send("omp:terminal-output", {
					id,
					data: chunk.toString("utf8"),
					isStderr: true,
				});
			});

			child.on("close", (code, signal) => {
				activeProcesses.delete(id);
				const win = getWin();
				win?.webContents.send("omp:terminal-exit", {
					id,
					code,
					signal,
				});
			});

			child.on("error", (err) => {
				activeProcesses.delete(id);
				const win = getWin();
				win?.webContents.send("omp:terminal-output", {
					id,
					data: `\r\n[执行错误]: ${err.message}\r\n`,
					isStderr: true,
				});
				win?.webContents.send("omp:terminal-exit", {
					id,
					code: 1,
					signal: null,
				});
			});

			return id;
		} catch (err) {
			const win = getWin();
			win?.webContents.send("omp:terminal-output", {
				id,
				data: `\r\n[进程启动失败]: ${err instanceof Error ? err.message : String(err)}\r\n`,
				isStderr: true,
			});
			return id;
		}
	});

	ipcMain.handle("omp:terminal-kill", (_event, { id }: { id: string }) => {
		const proc = activeProcesses.get(id);
		if (proc) {
			try {
				proc.child.kill("SIGINT");
				setTimeout(() => {
					if (activeProcesses.has(id)) {
						proc.child.kill("SIGKILL");
						activeProcesses.delete(id);
					}
				}, 1000);
				return true;
			} catch {
				return false;
			}
		}
		return false;
	});
}

export function cleanupTerminalProcesses(): void {
	for (const proc of activeProcesses.values()) {
		try {
			proc.child.kill("SIGKILL");
		} catch {}
	}
	activeProcesses.clear();
}
