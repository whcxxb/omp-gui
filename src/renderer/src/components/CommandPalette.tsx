import {
	Command,
	Folder,
	MessageSquare,
	PanelLeft,
	Plus,
	Search,
	Settings,
	SunMoon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary, SessionSummary } from "@shared/ipc";
import { relativeTime, shortPath } from "@/lib/time";

export interface CommandPaletteProps {
	isOpen: boolean;
	onClose(): void;
	projects: ProjectSummary[];
	activeProject: string | null;
	onNewThread(cwd: string): void;
	onOpenSession(session: SessionSummary): void;
	onToggleTheme(): void;
	onToggleSidebar(): void;
	onOpenSettings?(): void;
}

interface PaletteItem {
	id: string;
	group: "操作" | "项目" | "会话";
	title: string;
	sub?: string;
	icon: ReactNode;
	shortcut?: string;
	onSelect(): void;
}

export function CommandPalette(props: CommandPaletteProps): ReactNode {
	const {
		isOpen,
		onClose,
		projects,
		activeProject,
		onNewThread,
		onOpenSession,
		onToggleTheme,
		onToggleSidebar,
		onOpenSettings,
	} = props;

	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (isOpen) {
			setQuery("");
			setSelectedIndex(0);
			setTimeout(() => inputRef.current?.focus(), 20);
		}
	}, [isOpen]);
	useEffect(() => {
		if (!isOpen) return;
		const handleGlobalKeyDown = (e: KeyboardEvent): void => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", handleGlobalKeyDown);
		return () => window.removeEventListener("keydown", handleGlobalKeyDown);
	}, [isOpen, onClose]);

	const items = useMemo<PaletteItem[]>(() => {
		const list: PaletteItem[] = [];
		const fallbackProject = activeProject ?? projects[0]?.path ?? "";

		// 1. 系统操作
		if (fallbackProject) {
			list.push({
				id: "action-new-thread",
				group: "操作",
				title: "新建对话",
				sub: shortPath(fallbackProject),
				icon: <Plus size={15} />,
				shortcut: "⌘N",
				onSelect: () => onNewThread(fallbackProject),
			});
		}
		if (onOpenSettings) {
			list.push({
				id: "action-open-settings",
				group: "操作",
				title: "打开设置",
				icon: <Settings size={15} />,
				shortcut: "⌘,",
				onSelect: onOpenSettings,
			});
		}
		list.push({
			id: "action-toggle-sidebar",
			group: "操作",
			title: "显示 / 折叠侧边栏",
			icon: <PanelLeft size={15} />,
			shortcut: "⌘B",
			onSelect: onToggleSidebar,
		});
		list.push({
			id: "action-toggle-theme",
			group: "操作",
			title: "切换配色主题 (Default / Claude)",
			icon: <SunMoon size={15} />,
			onSelect: onToggleTheme,
		});

		// 2. 项目
		for (const p of projects) {
			list.push({
				id: `project-${p.path}`,
				group: "项目",
				title: p.name,
				sub: shortPath(p.path),
				icon: <Folder size={15} />,
				onSelect: () => onNewThread(p.path),
			});
		}

		// 3. 历史会话
		for (const p of projects) {
			for (const s of p.sessions) {
				list.push({
					id: `session-${s.file}`,
					group: "会话",
					title: s.title || "未命名对话",
					sub: `${p.name} · ${relativeTime(s.updatedAt)}`,
					icon: <MessageSquare size={15} />,
					onSelect: () => onOpenSession(s),
				});
			}
		}

		return list;
	}, [projects, activeProject, onNewThread, onOpenSession, onToggleTheme, onToggleSidebar, onOpenSettings]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter(
			item =>
				item.title.toLowerCase().includes(q) ||
				(item.sub && item.sub.toLowerCase().includes(q)) ||
				item.group.toLowerCase().includes(q),
		);
	}, [items, query]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	useEffect(() => {
		if (!listRef.current) return;
		const el = listRef.current.querySelector<HTMLElement>(".cmd-item.is-selected");
		el?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	if (!isOpen) return null;

	const handleKeyDown = (e: React.KeyboardEvent): void => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : 0));
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : Math.max(0, filtered.length - 1)));
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			const activeItem = filtered[selectedIndex];
			if (activeItem) {
				onClose();
				activeItem.onSelect();
			}
		}
	};

	return (
		<div
			className="cmd-overlay"
			onClick={e => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="cmd-dialog" role="dialog" aria-modal="true">
				<div className="cmd-search-bar">
					<Search size={16} className="cmd-search-icon" />
					<input
						ref={inputRef}
						className="cmd-input"
						value={query}
						placeholder="搜索项目、会话或命令... (Esc 关闭)"
						onChange={e => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
					<div className="cmd-esc-hint">
						<kbd>ESC</kbd>
					</div>
				</div>

				<div ref={listRef} className="cmd-list">
					{filtered.length === 0 ? (
						<div className="cmd-empty">未找到匹配项</div>
					) : (
						(() => {
							let lastGroup = "";
							return filtered.map((item, index) => {
								const showGroup = item.group !== lastGroup;
								lastGroup = item.group;
								return (
									<div key={item.id}>
										{showGroup && <div className="cmd-group-title">{item.group}</div>}
										<div
											className={`cmd-item${index === selectedIndex ? " is-selected" : ""}`}
											onClick={() => {
												onClose();
												item.onSelect();
											}}
											onMouseEnter={() => setSelectedIndex(index)}
										>
											<span className="cmd-item-icon">{item.icon}</span>
											<span className="cmd-item-title">{item.title}</span>
											{item.sub && <span className="cmd-item-sub">{item.sub}</span>}
											{item.shortcut && <kbd className="cmd-item-shortcut">{item.shortcut}</kbd>}
										</div>
									</div>
								);
							});
						})()
					)}
				</div>
				<footer className="cmd-footer">
					<span className="cmd-footer-tip">
						<kbd>↑</kbd> <kbd>↓</kbd> 移动 · <kbd>↵</kbd> 选择 · <kbd>ESC</kbd> 关闭
					</span>
				</footer>
			</div>
		</div>
	);
}
