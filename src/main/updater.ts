import { app, BrowserWindow } from "electron";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { get as httpGet } from "node:https";
import type { UpdateReleaseInfo, UpdateStatus } from "@shared/ipc";

const GITHUB_OWNER = "whcxxb";
const GITHUB_REPO = "omp-gui";
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 小时静默轮询

interface GitHubReleaseAsset {
	name: string;
	size: number;
	browser_download_url: string;
}

interface GitHubReleaseResponse {
	tag_name: string;
	name?: string;
	body?: string;
	published_at?: string;
	html_url?: string;
	assets?: GitHubReleaseAsset[];
}

export class AppUpdater {
	private status: UpdateStatus = { state: "idle" };
	private timer: NodeJS.Timeout | null = null;
	private pendingAsarPath: string | null = null;
	private currentDownloadInfo: UpdateReleaseInfo | null = null;
	private isDownloading = false;
	private consecutiveFailures = 0;

	constructor(
		private readonly getWindow: () => BrowserWindow | null,
		private readonly isBusy?: () => boolean,
	) {}

	public init(): void {
		// 开发环境（未打包）不自动执行静默更新检测，仅允许手动检查
		if (!app.isPackaged) {
			return;
		}

		// 启动 5 秒后首次静默检查更新
		setTimeout(() => {
			void this.checkForUpdates(false);
		}, 5000);

		// 定时轮询
		this.timer = setInterval(() => {
			void this.checkForUpdates(false);
		}, CHECK_INTERVAL_MS);
	}
	public destroy(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	public getStatus(): UpdateStatus {
		return this.status;
	}

	public getAppVersion(): string {
		try {
			return app.getVersion();
		} catch {
			return "0.1.0";
		}
	}

	private setStatus(status: UpdateStatus): void {
		this.status = status;
		const win = this.getWindow();
		if (win && !win.isDestroyed()) {
			win.webContents.send("omp:update-status", status);
		}
	}

	public async checkForUpdates(manual = false): Promise<UpdateStatus> {
		if (this.status.state === "downloading") {
			return this.status;
		}

		this.setStatus({ state: "checking" });
		const currentVersion = this.getAppVersion();

		try {
			const release = await this.fetchLatestRelease();
			if (!release) {
				const res: UpdateStatus = { state: "up-to-date", currentVersion };
				this.setStatus(res);
				return res;
			}

			const latestVersion = release.tag_name.replace(/^v/, "");
			const isNewer = this.compareSemver(latestVersion, currentVersion) > 0;

			if (!isNewer) {
				const res: UpdateStatus = { state: "up-to-date", currentVersion };
				this.setStatus(res);
				return res;
			}

			const assets = release.assets ?? [];
			const asarAsset = assets.find(a => a.name === "app.asar");
			const dmgAsset = assets.find(a => a.name.endsWith(".dmg"));

			// 检查当前应用运行位置（吸收 Magpie 的 AppTranslocation / Readonly 探测）
			let warning: string | undefined;
			const execPath = process.execPath;
			if (execPath.includes("/AppTranslocation/")) {
				warning = "当前应用运行在 macOS 临时隔离区，建议将 OMP 拖移到「应用程序」以确保稳定更新。";
			}

			const info: UpdateReleaseInfo = {
				version: latestVersion,
				currentVersion,
				releaseName: release.name || release.tag_name,
				releaseNotes: release.body || "",
				publishedAt: release.published_at,
				hasAsar: Boolean(asarAsset),
				asarSize: asarAsset?.size,
				asarDownloadUrl: asarAsset?.browser_download_url,
				dmgDownloadUrl: dmgAsset?.browser_download_url,
				htmlUrl: release.html_url,
			};

			this.consecutiveFailures = 0;
			const availableStatus: UpdateStatus = { state: "available", info, warning };
			this.setStatus(availableStatus);
			return availableStatus;
		} catch (error) {
			this.consecutiveFailures++;
			const message = error instanceof Error ? error.message : String(error);
			const errStatus: UpdateStatus = {
				state: "error",
				message,
				canRetry: this.consecutiveFailures < 3,
			};
			this.setStatus(errStatus);
			return errStatus;
		}
	}

	public async startUpdate(): Promise<boolean> {
		if (this.status.state !== "available" && this.status.state !== "error") {
			return false;
		}
		const info = this.status.state === "available" ? this.status.info : this.status.info;
		if (!info) return false;

		// 如果没有 asar 资源，则无法直接热更新，保留状态由用户前往页面下载 DMG
		if (!info.hasAsar || !info.asarDownloadUrl) {
			this.setStatus({
				state: "error",
				message: "当前版本未附带热更新 asar 包，请下载 DMG 全新安装。",
				info,
			});
			return false;
		}

		if (this.isDownloading) return false;
		this.isDownloading = true;
		this.currentDownloadInfo = info;
		this.setStatus({ state: "downloading", progress: 0, info });

		try {
			const updateDir = join(app.getPath("userData"), "updates");
			if (!existsSync(updateDir)) {
				mkdirSync(updateDir, { recursive: true });
			}

			const tempFilePath = join(updateDir, `pending-${info.version}.asar`);
			await this.downloadFile(info.asarDownloadUrl, tempFilePath, progress => {
				this.setStatus({ state: "downloading", progress, info });
			});

			this.pendingAsarPath = tempFilePath;
			this.isDownloading = false;
			const busy = this.isBusy ? this.isBusy() : false;
			this.setStatus({ state: "downloaded", info, busy });
			return true;
		} catch (error) {
			this.isDownloading = false;
			this.consecutiveFailures++;
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ state: "error", message, info, canRetry: this.consecutiveFailures < 3 });
			return false;
		}
	}

	public async applyUpdateAndRestart(options?: { force?: boolean }): Promise<{ ok: boolean; busy?: boolean }> {
		if (!this.pendingAsarPath || !existsSync(this.pendingAsarPath)) {
			throw new Error("找不到已下载的更新包");
		}

		// 吸收 Synara/Magpie 的会话任务防打断机制
		if (!options?.force && this.isBusy && this.isBusy()) {
			if (this.status.state === "downloaded") {
				this.setStatus({ ...this.status, busy: true });
			}
			return { ok: false, busy: true };
		}

		// 定位当前运行的应用内 app.asar
		// 开发环境 process.resourcesPath 可能是 node_modules/electron/dist/Electron.app/Contents/Resources
		// 生产环境在 /Applications/OMP.app/Contents/Resources/app.asar
		const targetAsar = join(process.resourcesPath, "app.asar");
		const backupAsar = join(process.resourcesPath, "app.asar.bak");

		try {
			if (existsSync(targetAsar)) {
				copyFileSync(targetAsar, backupAsar);
			}
			copyFileSync(this.pendingAsarPath, targetAsar);
			// 成功后清理下载的临时 asar
			try {
				unlinkSync(this.pendingAsarPath);
			} catch {}

			// 重启应用
			app.relaunch();
			app.exit(0);
			return { ok: true };
		} catch (error) {
			if (existsSync(backupAsar)) {
				try {
					copyFileSync(backupAsar, targetAsar);
				} catch {}
			}
			throw new Error(`应用更新失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"User-Agent": "OMP-GUI-Updater",
			Accept: "application/vnd.github.v3+json",
		};
		const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		return headers;
	}

	private fetchLatestRelease(): Promise<GitHubReleaseResponse | null> {
		const { promise, resolve, reject } = Promise.withResolvers<GitHubReleaseResponse | null>();
		const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
		const req = httpGet(
			url,
			{
				headers: this.getHeaders(),
			},
			res => {
				if (res.statusCode === 301 || res.statusCode === 302) {
					const redirectUrl = res.headers.location;
					if (redirectUrl) {
						httpGet(
							redirectUrl,
							{
								headers: {
									"User-Agent": "OMP-GUI-Updater",
									Accept: "application/vnd.github.v3+json",
								},
							},
							r => {
								this.handleReleaseBody(r, resolve, reject);
							},
						).on("error", reject);
						return;
					}
				}

				if (res.statusCode === 404) {
					return resolve(null);
				}

				if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
					return reject(new Error(`GitHub 请求失败: HTTP ${res.statusCode}`));
				}

				this.handleReleaseBody(res, resolve, reject);
			},
		);
		req.on("error", reject);
		return promise;
	}

	private handleReleaseBody(
		res: NodeJS.ReadableStream,
		resolve: (val: GitHubReleaseResponse | null) => void,
		reject: (err: Error) => void,
	): void {
		let data = "";
		res.setEncoding("utf8");
		res.on("data", chunk => {
			data += chunk;
		});
		res.on("end", () => {
			try {
				const json = JSON.parse(data) as GitHubReleaseResponse;
				resolve(json);
			} catch (e) {
				reject(new Error("解析 GitHub Release 数据失败"));
			}
		});
	}

	private downloadFile(url: string, dest: string, onProgress: (progress: number) => void): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const request = (targetUrl: string): void => {
			const headers: Record<string, string> = { "User-Agent": "OMP-GUI-Updater" };
			const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
			// 如果是 GitHub API 资源下载且携带 token
			if (token && targetUrl.includes("api.github.com")) {
				headers.Authorization = `Bearer ${token}`;
				headers.Accept = "application/octet-stream";
			}
			httpGet(
				targetUrl,
				{ headers },
				res => {
					if (res.statusCode === 301 || res.statusCode === 302) {
						const redirectUrl = res.headers.location;
						if (!redirectUrl) return reject(new Error("下载地址重定向失效"));
						return request(redirectUrl);
					}

					if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
						return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
					}

					const totalBytes = Number(res.headers["content-length"]) || 0;
					let receivedBytes = 0;
					const fileStream = createWriteStream(dest);

					res.on("data", chunk => {
						receivedBytes += (chunk as Buffer).length;
						if (totalBytes > 0) {
							const progress = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
							onProgress(progress);
						}
					});

					res.pipe(fileStream);

					fileStream.on("finish", () => {
						fileStream.close(() => resolve());
					});

					fileStream.on("error", err => {
						try {
							unlinkSync(dest);
						} catch {}
						reject(err);
					});
				},
			).on("error", reject);
		};

		request(url);
		return promise;
	}

	private compareSemver(v1: string, v2: string): number {
		const parts1 = v1.split(".").map(p => Number.parseInt(p, 10) || 0);
		const parts2 = v2.split(".").map(p => Number.parseInt(p, 10) || 0);
		const maxLen = Math.max(parts1.length, parts2.length);

		for (let i = 0; i < maxLen; i++) {
			const num1 = parts1[i] ?? 0;
			const num2 = parts2[i] ?? 0;
			if (num1 > num2) return 1;
			if (num1 < num2) return -1;
		}
		return 0;
	}
}
