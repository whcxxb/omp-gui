import { Check, ExternalLink, FileText, Loader2, RotateCcw, Save } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { PromptFile, PromptFileId } from "@shared/ipc";

/**
 * 全局提示词 / 指令文件管理面板。
 * 展示 OMP 用户级 agent 目录下的 AGENTS.md、RULES.md、APPEND_SYSTEM.md、
 * SYSTEM.md、PERSONALITY.md，并支持就地编辑与保存。
 */
export function PromptFilesPanel(): ReactNode {
	const [files, setFiles] = useState<PromptFile[]>([]);
	const [activeId, setActiveId] = useState<PromptFileId | null>(null);
	const [draft, setDraft] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async (): Promise<void> => {
		setLoading(true);
		try {
			const list = await window.omp.readPromptFiles();
			setFiles(list);
			setActiveId(current => current ?? list[0]?.id ?? null);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const active = files.find(file => file.id === activeId) ?? null;
	const dirty = active !== null && draft !== active.content;

	useEffect(() => {
		if (active) {
			setDraft(active.content);
			setSavedAt(null);
		}
	}, [active?.id, active?.content]);

	const handleSave = async (): Promise<void> => {
		if (!active) return;
		setSaving(true);
		try {
			const result = await window.omp.writePromptFile(active.id, draft);
			if (!result.ok) {
				setError(result.error ?? "保存失败");
				return;
			}
			setError(null);
			setSavedAt(Date.now());
			await load();
		} finally {
			setSaving(false);
		}
	};

	const handleOpenInEditor = (): void => {
		if (active) void window.omp.openInEditor(active.path, "");
	};

	if (loading) {
		return (
			<div className="pf-loading">
				<Loader2 size={16} className="pf-spin" />
				<span>正在读取全局提示词文件…</span>
			</div>
		);
	}

	return (
		<div className="pf-wrap">
			<div className="pf-list">
				{files.map(file => (
					<button
						key={file.id}
						type="button"
						className={`pf-item${file.id === activeId ? " is-active" : ""}`}
						onClick={() => setActiveId(file.id)}
					>
						<span className="pf-item-icon">
							<FileText size={14} />
						</span>
						<span className="pf-item-meta">
							<span className="pf-item-name">{file.name}</span>
							<span className="pf-item-hint">{file.hint}</span>
						</span>
						<span className={`pf-badge${file.exists ? " is-on" : ""}`}>
							{file.exists ? "已生效" : "未创建"}
						</span>
					</button>
				))}
			</div>

			{active && (
				<div className="pf-editor">
					<div className="pf-editor-head">
						<div className="pf-editor-title">
							<span className="pf-editor-name">{active.name}</span>
							<code className="pf-editor-path" title={active.path}>
								{active.path}
							</code>
						</div>
						<div className="pf-editor-actions">
							{dirty && <span className="pf-dirty">未保存</span>}
							{savedAt && !dirty && (
								<span className="pf-saved">
									<Check size={12} /> 已保存
								</span>
							)}
							<button
								type="button"
								className="btn btn-sm btn-ghost"
								onClick={() => setDraft(active.content)}
								disabled={!dirty || saving}
								title="放弃当前修改，恢复到磁盘内容"
							>
								<RotateCcw size={12} />
								<span>还原</span>
							</button>
							<button type="button" className="btn btn-sm btn-ghost" onClick={handleOpenInEditor}>
								<ExternalLink size={12} />
								<span>在编辑器打开</span>
							</button>
							<button
								type="button"
								className="btn btn-sm btn-primary"
								onClick={() => void handleSave()}
								disabled={!dirty || saving}
							>
								<Save size={12} />
								<span>{saving ? "保存中…" : "保存"}</span>
							</button>
						</div>
					</div>

					<p className="pf-editor-desc">{active.description}</p>
					{error && <div className="pf-error">{error}</div>}

					<textarea
						className="pf-textarea"
						value={draft}
						spellCheck={false}
						placeholder={`在此填写 ${active.name} 的内容…\n\n留空并保存会将该文件备份为 ${active.name}.bak 并停用。`}
						onChange={e => setDraft(e.target.value)}
					/>

					<p className="pf-footnote">
						修改在下一个新会话（或 <code>/clear</code>、<code>/new</code>）时生效，无需重启 OMP。
					</p>
				</div>
			)}
		</div>
	);
}
