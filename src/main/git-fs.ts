import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { FileItem, GitChangedFile, GitDiffOptions, GitFileStatus, GitStatusResult } from "@shared/ipc";
import { shell } from "electron";

const exec = promisify(execFile);

const IGNORED_NAMES: Record<string, true> = {
	".git": true,
	".DS_Store": true,
};
function mapGitCode(code: string): GitFileStatus {
	switch (code.toUpperCase()) {
		case "M":
			return "modified";
		case "A":
			return "added";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		case "?":
		default:
			return "untracked";
	}
}

export async function listDir(cwd: string, subpath = ""): Promise<FileItem[]> {
	const targetDir = subpath ? join(cwd, subpath) : cwd;
	try {
		const entries = await readdir(targetDir, { withFileTypes: true });
		const items: FileItem[] = [];

		for (const entry of entries) {
			if (IGNORED_NAMES[entry.name]) continue;
			const fullPath = join(targetDir, entry.name);
			const relPath = relative(cwd, fullPath).replace(/\\/g, "/");
			const isDirectory = entry.isDirectory();

			let size: number | undefined;
			let mtimeMs: number | undefined;
			try {
				const info = await stat(fullPath);
				size = isDirectory ? undefined : info.size;
				mtimeMs = info.mtimeMs;
			} catch {
				// 忽略无权限或已删除的文件
			}

			items.push({
				name: entry.name,
				path: relPath,
				isDirectory,
				size,
				mtimeMs,
				extension: isDirectory ? undefined : extname(entry.name).toLowerCase(),
			});
		}

		// 排序：文件夹优先，同类按名称字母排序（不区分大小写）
		items.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});

		return items;
	} catch {
		return [];
	}
}

export async function gitStatus(cwd: string): Promise<GitStatusResult> {
	try {
		const { stdout } = await exec("git", ["status", "--porcelain=v2", "--branch"], { cwd });
		const lines = stdout.split("\n");

		let branch = "";
		let upstream = "";
		let ahead = 0;
		let behind = 0;

		const stagedFiles: GitChangedFile[] = [];
		const unstagedFiles: GitChangedFile[] = [];
		const untrackedFiles: GitChangedFile[] = [];

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;

			if (line.startsWith("# branch.head ")) {
				branch = line.slice("# branch.head ".length).trim();
			} else if (line.startsWith("# branch.upstream ")) {
				upstream = line.slice("# branch.upstream ".length).trim();
			} else if (line.startsWith("# branch.ab ")) {
				const match = /\+(\d+)\s+-(\d+)/.exec(line);
				if (match) {
					ahead = Number(match[1]) || 0;
					behind = Number(match[2]) || 0;
				}
			} else if (line.startsWith("1 ")) {
				// 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
				const parts = line.split(/\s+/);
				const xy = parts[1] ?? "..";
				const x = xy[0] ?? ".";
				const y = xy[1] ?? ".";
				const filePath = parts.slice(8).join(" ");

				if (x !== ".") {
					stagedFiles.push({
						path: filePath,
						stagedStatus: x,
						worktreeStatus: y,
						displayStatus: mapGitCode(x),
						staged: true,
					});
				}
				if (y !== ".") {
					unstagedFiles.push({
						path: filePath,
						stagedStatus: x,
						worktreeStatus: y,
						displayStatus: mapGitCode(y),
						staged: false,
					});
				}
			} else if (line.startsWith("2 ")) {
				// 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><sep><origPath>
				const parts = line.split("\t");
				const meta = (parts[0] ?? "").split(/\s+/);
				const xy = meta[1] ?? "..";
				const x = xy[0] ?? ".";
				const y = xy[1] ?? ".";
				const filePath = meta.slice(9).join(" ");
				const origPath = parts[1] ?? "";

				if (x !== ".") {
					stagedFiles.push({
						path: filePath,
						oldPath: origPath,
						stagedStatus: x,
						worktreeStatus: y,
						displayStatus: mapGitCode(x),
						staged: true,
					});
				}
				if (y !== ".") {
					unstagedFiles.push({
						path: filePath,
						oldPath: origPath,
						stagedStatus: x,
						worktreeStatus: y,
						displayStatus: mapGitCode(y),
						staged: false,
					});
				}
			} else if (line.startsWith("? ")) {
				const filePath = line.slice(2).trim();
				untrackedFiles.push({
					path: filePath,
					stagedStatus: "?",
					worktreeStatus: "?",
					displayStatus: "untracked",
					staged: false,
				});
			}
		}

		return {
			isGitRepo: true,
			branch: branch === "(detached)" ? "detached" : branch,
			upstream,
			ahead,
			behind,
			stagedFiles,
			unstagedFiles,
			untrackedFiles,
			totalChanges: stagedFiles.length + unstagedFiles.length + untrackedFiles.length,
		};
	} catch {
		return {
			isGitRepo: false,
			ahead: 0,
			behind: 0,
			stagedFiles: [],
			unstagedFiles: [],
			untrackedFiles: [],
			totalChanges: 0,
		};
	}
}

export async function gitDiff(options: GitDiffOptions): Promise<string> {
	const { cwd, file, staged } = options;
	try {
		const args = staged ? ["diff", "--cached", "--", file] : ["diff", "--", file];
		const { stdout } = await exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
		if (stdout.trim()) {
			return stdout;
		}

		// 若无 diff 且为未跟踪文件，直接读内容显示为全增
		const fullPath = join(cwd, file);
		const content = await readFile(fullPath, "utf-8");
		const lines = content.split("\n");
		const diffHeader = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n`;
		return diffHeader + lines.map(l => `+${l}`).join("\n");
	} catch (e: unknown) {
		return (e as Error)?.message || "无法获取 Diff";
	}
}

export async function openInEditor(cwd: string, file: string): Promise<boolean> {
	const fullPath = join(cwd, file);
	try {
		// 优先尝试使用 code (VS Code) 打开文件
		await exec("code", [fullPath]);
		return true;
	} catch {
		try {
			await shell.openPath(fullPath);
			return true;
		} catch {
			return false;
		}
	}
}
