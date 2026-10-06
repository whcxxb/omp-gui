// 拖拽/粘贴文件的统一读取：Composer 与待办编辑器共用，避免两套约定。
export interface DroppedFile {
	name: string;
	/** 原生绝对路径；浏览器环境下可能为空 */
	path: string;
	/** 相对 cwd 的路径，供提示词里的 `@` 引用 */
	relativePath: string;
	isImage: boolean;
	mimeType: string;
	/** 图片的 base64（不含 data: 前缀），非图片为 undefined */
	data?: string;
	/** 图片缩略图 URL（blob:），非图片为 undefined */
	previewUrl?: string;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;

function absolutePathOf(file: File): string {
	try {
		if (window.omp.getPathForFile) {
			const resolved = window.omp.getPathForFile(file);
			if (resolved) return resolved;
		}
	} catch {
		// 非 Electron 环境（如 HTML 导出）下无此 API
	}
	return "path" in file && typeof (file as File & { path?: string }).path === "string"
		? (file as File & { path?: string }).path!
		: "";
}

function readAsDataUrl(file: File): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () => resolve(reader.result as string);
	reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
	reader.readAsDataURL(file);
	return promise;
}

/** 读取一批拖入/粘贴的文件；图片附带 base64 与预览 URL，其他文件只记录路径。 */
export async function readDroppedFiles(files: FileList | File[], cwd: string): Promise<DroppedFile[]> {
	const results: DroppedFile[] = [];
	for (const file of Array.from(files)) {
		const path = absolutePathOf(file);
		const relativePath = path ? (path.startsWith(cwd) ? path.slice(cwd.length).replace(/^[/\\]+/, "") : path) : file.name;
		const isImage = file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
		if (!isImage) {
			results.push({ name: file.name, path, relativePath, isImage: false, mimeType: file.type || "application/octet-stream" });
			continue;
		}
		try {
			const dataUrl = await readAsDataUrl(file);
			const comma = dataUrl.indexOf(",");
			results.push({
				name: file.name,
				path,
				relativePath,
				isImage: true,
				mimeType: file.type || "image/png",
				data: comma !== -1 ? dataUrl.slice(comma + 1) : dataUrl,
				previewUrl: URL.createObjectURL(file),
			});
		} catch (error) {
			console.error("Failed to read image:", error);
		}
	}
	return results;
}

/**
 * 从剪贴板事件中取出文件。
 * 截图粘贴时 `files` 可能为空（数据只在 `items` 里），两条路径都要走。
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
	if (!data) return [];
	if (data.files.length > 0) return Array.from(data.files);
	const files: File[] = [];
	for (const item of Array.from(data.items)) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file) files.push(file);
	}
	return files;
}
