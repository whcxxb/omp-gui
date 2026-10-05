import { Brain, ChevronRight, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { playSound } from "@/lib/sound";

export interface MemoryToastData {
	id: string;
	title: string;
	content: string;
	cwd: string;
}

interface MemoryToastProps {
	toast: MemoryToastData | null;
	onClose(): void;
	onOpenMemoryManager(cwd: string): void;
}

export function MemoryToast({ toast, onClose, onOpenMemoryManager }: MemoryToastProps): ReactNode {
	const timerRef = useRef<number | undefined>(undefined);
	const [hovered, setHovered] = useState(false);

	useEffect(() => {
		if (!toast) return;
		playSound("request");
	}, [toast?.id]);

	useEffect(() => {
		if (!toast || hovered) return;
		timerRef.current = window.setTimeout(() => {
			onClose();
		}, 4800);

		return () => {
			clearTimeout(timerRef.current);
		};
	}, [toast, hovered, onClose]);

	if (!toast) return null;

	return (
		<div
			className="mem-toast"
			role="alert"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div className="mem-toast-glow" />
			<div className="mem-toast-icon">
				<Brain size={15} />
			</div>
			<div className="mem-toast-content">
				<div className="mem-toast-header">
					<span className="mem-toast-title">{toast.title}</span>
					<span className="mem-toast-tag">Mnemopi</span>
				</div>
				<p className="mem-toast-body" title={toast.content}>
					{toast.content}
				</p>
			</div>
			<div className="mem-toast-actions">
				<button
					type="button"
					className="mem-toast-btn"
					onClick={() => {
						onOpenMemoryManager(toast.cwd);
						onClose();
					}}
					title="查看并管理记忆库"
				>
					<span>查看</span>
					<ChevronRight size={12} />
				</button>
				<button type="button" className="mem-toast-close" onClick={onClose} title="关闭提示">
					<X size={13} />
				</button>
			</div>
		</div>
	);
}
