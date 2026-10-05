import type mermaid from "mermaid";
import { Check, Copy, Maximize2, Minimize2, ZoomIn, ZoomOut, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

type MermaidInstance = typeof mermaid;
let mermaidPromise: Promise<MermaidInstance> | null = null;

function getMermaid(): Promise<MermaidInstance> {
	if (!mermaidPromise) {
		mermaidPromise = import("mermaid").then(m => {
			const instance = (m.default || m) as MermaidInstance;
			instance.initialize({
				startOnLoad: false,
				theme: "dark",
				securityLevel: "loose",
				fontFamily: "inherit",
				suppressErrorRendering: true,
			});
			return instance;
		});
	}
	return mermaidPromise;
}

interface MermaidBlockProps {
	code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps): ReactNode {
	const rawId = useId().replace(/:/g, "_");
	const containerId = useMemo(() => `mermaid_${rawId}_${Math.random().toString(36).slice(2, 7)}`, [rawId]);
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [zoom, setZoom] = useState(1);

	const isDark = typeof document !== "undefined"
		? document.documentElement.dataset.theme === "pure-black" || !window.matchMedia("(prefers-color-scheme: light)").matches
		: true;

	useEffect(() => {
		let isCancelled = false;
		setError(null);

		const theme = isDark ? "dark" : "default";
		getMermaid()
			.then(mermaid => {
				if (isCancelled) return null;
				mermaid.initialize({
					startOnLoad: false,
					theme,
					securityLevel: "loose",
					fontFamily: "inherit",
					suppressErrorRendering: true,
					themeVariables: isDark
						? {
								primaryColor: "#222533",
								primaryTextColor: "#e2e8f0",
								primaryBorderColor: "#475569",
								lineColor: "#64748b",
								secondaryColor: "#1e293b",
								tertiaryColor: "#0f172a",
							}
						: {
								primaryColor: "#f1f5f9",
								primaryTextColor: "#1e293b",
								primaryBorderColor: "#cbd5e1",
								lineColor: "#94a3b8",
							},
				});
				return mermaid.render(containerId, code);
			})
			.then(result => {
				if (result && !isCancelled) {
					setSvg(result.svg);
					setError(null);
				}
			})
			.catch(err => {
				if (!isCancelled) {
					// 流式生成中语法不完整时静默保留错误信息并回退到代码视图
					setError(err instanceof Error ? err.message : String(err));
					setSvg(null);
				}
			});

		return () => {
			isCancelled = true;
			const el = document.getElementById(containerId);
			if (el) el.remove();
		};
	}, [code, containerId, isDark]);

	const handleCopy = (): void => {
		void navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleZoomIn = (): void => setZoom(z => Math.min(2.5, z + 0.2));
	const handleZoomOut = (): void => setZoom(z => Math.max(0.5, z - 0.2));
	const handleResetZoom = (): void => setZoom(1);

	// 若处于语法解析错误状态（如流式未结束），展示优雅的代码块兜底
	if (error || !svg) {
		return (
			<div className="mermaid-fallback-box">
				<div className="mermaid-bar">
					<span className="mermaid-tag">Mermaid 架构图</span>
					{error && <span className="mermaid-status-hint">正在生成或语法校验中...</span>}
					<div className="mermaid-tools">
						<button type="button" className="mermaid-btn" onClick={handleCopy} title="复制代码">
							{copied ? <Check size={12} className="is-success" /> : <Copy size={12} />}
							<span>{copied ? "已复制" : "复制"}</span>
						</button>
					</div>
				</div>
				<pre className="mermaid-code-pre">
					<code>{code}</code>
				</pre>
			</div>
		);
	}

	return (
		<div className={`mermaid-card${isFullscreen ? " is-fullscreen" : ""}`}>
			<div className="mermaid-bar">
				<span className="mermaid-tag">Mermaid 图表</span>
				<div className="mermaid-tools">
					<button type="button" className="mermaid-btn" onClick={handleZoomOut} title="缩小">
						<ZoomOut size={12} />
					</button>
					<button type="button" className="mermaid-btn" onClick={handleResetZoom} title="重置缩放">
						<span style={{ fontSize: "10px" }}>{Math.round(zoom * 100)}%</span>
					</button>
					<button type="button" className="mermaid-btn" onClick={handleZoomIn} title="放大">
						<ZoomIn size={12} />
					</button>
					<button type="button" className="mermaid-btn" onClick={handleCopy} title="复制 Mermaid 源码">
						{copied ? <Check size={12} className="is-success" /> : <Copy size={12} />}
						<span>{copied ? "已复制" : "复制"}</span>
					</button>
					<button
						type="button"
						className="mermaid-btn"
						onClick={() => setIsFullscreen(v => !v)}
						title={isFullscreen ? "退出全屏" : "全屏放大查看"}
					>
						{isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
					</button>
				</div>
			</div>

			<div
				className="mermaid-svg-container"
				style={{
					transform: `scale(${zoom})`,
					transformOrigin: "top center",
					transition: "transform 120ms ease",
				}}
				dangerouslySetInnerHTML={{ __html: svg }}
			/>

			{isFullscreen && (
				<button
					type="button"
					className="mermaid-close-fullscreen-btn"
					onClick={() => setIsFullscreen(false)}
				>
					关闭全屏 (ESC)
				</button>
			)}
		</div>
	);
}

export default MermaidBlock;
