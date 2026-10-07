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

export type TimelineBucketKey = "today" | "yesterday" | "past7days" | "past30days" | "older";

export interface TimelineBucket<T> {
	key: TimelineBucketKey;
	label: string;
	items: T[];
}

/** 将带时间戳的数据按时间线分桶（今天、昨天、最近 7 天、最近 30 天、更早） */
export function bucketByTimeline<T>(items: T[], getTime: (item: T) => number): TimelineBucket<T>[] {
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfYesterday = startOfToday - DAY;
	const startOfPast7Days = startOfToday - 6 * DAY;
	const startOfPast30Days = startOfToday - 29 * DAY;

	const buckets: Record<TimelineBucketKey, T[]> = {
		today: [],
		yesterday: [],
		past7days: [],
		past30days: [],
		older: [],
	};

	for (const item of items) {
		const t = getTime(item);
		if (t >= startOfToday) {
			buckets.today.push(item);
		} else if (t >= startOfYesterday) {
			buckets.yesterday.push(item);
		} else if (t >= startOfPast7Days) {
			buckets.past7days.push(item);
		} else if (t >= startOfPast30Days) {
			buckets.past30days.push(item);
		} else {
			buckets.older.push(item);
		}
	}

	const result: TimelineBucket<T>[] = [];
	if (buckets.today.length > 0) result.push({ key: "today", label: "今天", items: buckets.today });
	if (buckets.yesterday.length > 0) result.push({ key: "yesterday", label: "昨天", items: buckets.yesterday });
	if (buckets.past7days.length > 0) result.push({ key: "past7days", label: "最近 7 天", items: buckets.past7days });
	if (buckets.past30days.length > 0) result.push({ key: "past30days", label: "过去 30 天", items: buckets.past30days });
	if (buckets.older.length > 0) result.push({ key: "older", label: "更早", items: buckets.older });
	return result;
}

export function shortPath(path: string): string {
	const home = path.match(/^\/Users\/[^/]+/)?.[0];
	return home ? `~${path.slice(home.length)}` : path;
}
