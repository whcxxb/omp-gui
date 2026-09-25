const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 侧边栏用的相对时间：刚刚 / 5 分钟 / 3 小时 / 2 天 / 9月3日 */
export function relativeTime(ms: number, now = Date.now()): string {
	const diff = now - ms;
	if (diff < MINUTE) return "刚刚";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时`;
	if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天`;
	const date = new Date(ms);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return sameYear ? `${date.getMonth() + 1}月${date.getDate()}日` : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function shortPath(path: string): string {
	const home = path.match(/^\/Users\/[^/]+/)?.[0];
	return home ? `~${path.slice(home.length)}` : path;
}
