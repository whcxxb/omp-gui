import { play, setEnabled, setVolume, type SoundName } from "cuelume";

export type SoundCue =
	| "send" // 发送消息
	| "complete" // 任务完成 / 执行就绪
	| "request" // 工具审批 / 用户交互请求
	| "error" // 报错 / 执行中止
	| "switch" // 打开/新建对话
	| "toggle" // 开关/折叠/主题切换
	| "export"; // 导出 Markdown 成功

const SOUND_MAP: Record<SoundCue, SoundName> = {
	send: "droplet",
	complete: "chime",
	request: "pulse",
	error: "error",
	switch: "page",
	toggle: "toggle",
	export: "success",
};

const STORAGE_KEY_ENABLED = "omp-gui.sound-enabled";
const STORAGE_KEY_VOLUME = "omp-gui.sound-volume";

const DEFAULT_VOLUME = 0.35;

export function isSoundEnabled(): boolean {
	try {
		const saved = localStorage.getItem(STORAGE_KEY_ENABLED);
		return saved !== "false";
	} catch {
		return true;
	}
}

export function setSoundEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
		setEnabled(enabled);
	} catch {}
}

export function getSoundVolume(): number {
	try {
		const saved = localStorage.getItem(STORAGE_KEY_VOLUME);
		const num = saved ? Number(saved) : DEFAULT_VOLUME;
		return Number.isFinite(num) && num >= 0 && num <= 1 ? num : DEFAULT_VOLUME;
	} catch {
		return DEFAULT_VOLUME;
	}
}

export function setSoundVolume(volume: number): void {
	try {
		const clamped = Math.max(0, Math.min(1, volume));
		localStorage.setItem(STORAGE_KEY_VOLUME, String(clamped));
		setVolume(clamped);
	} catch {}
}

// 首次初始化
try {
	setEnabled(isSoundEnabled());
	setVolume(getSoundVolume());
} catch {}

/** 播放语义化提示音效 */
export function playSound(cue: SoundCue): void {
	if (!isSoundEnabled()) return;
	const name = SOUND_MAP[cue];
	try {
		play(name);
	} catch (e) {
		console.debug("Failed to play sound cue:", cue, e);
	}
}
