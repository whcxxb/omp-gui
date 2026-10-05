import {
	ChevronDown,
	ChevronRight,
	ExternalLink,
	File,
	FileCode,
	FileJson,
	FileSpreadsheet,
	FileText,
	Folder,
	FolderOpen,
	Image as ImageIcon,
	MessageSquarePlus,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { FileItem } from "@shared/ipc";

interface FileTreeProps {
	cwd: string;
	onInsertText?(text: string): void;
}

interface TreeNode {
	item: FileItem;
	children?: TreeNode[];
	loaded?: boolean;
	expanded?: boolean;
	loading?: boolean;
}

function getFileIcon(extension?: string, isDir = false, expanded = false): ReactNode {
	if (isDir) {
		return expanded ? (
			<FolderOpen size={14} className="tree-icon is-folder" />
		) : (
			<Folder size={14} className="tree-icon is-folder" />
		);
	}

	const ext = (extension ?? "").toLowerCase();
	switch (ext) {
		case ".ts":
		case ".tsx":
		case ".js":
		case ".jsx":
		case ".vue":
		case ".svelte":
		case ".py":
		case ".rs":
		case ".go":
		case ".c":
		case ".cpp":
		case ".sh":
			return <FileCode size={14} className="tree-icon is-code" />;
		case ".json":
		case ".yaml":
		case ".yml":
		case ".toml":
			return <FileJson size={14} className="tree-icon is-json" />;
		case ".md":
		case ".txt":
		case ".doc":
		case ".docx":
			return <FileText size={14} className="tree-icon is-text" />;
		case ".png":
		case ".jpg":
		case ".jpeg":
		case ".gif":
		case ".svg":
		case ".webp":
			return <ImageIcon size={14} className="tree-icon is-image" />;
		case ".csv":
		case ".xlsx":
			return <FileSpreadsheet size={14} className="tree-icon is-sheet" />;
		default:
			return <File size={14} className="tree-icon is-file" />;
	}
}

export function FileTree({ cwd, onInsertText }: FileTreeProps): ReactNode {
	const [nodes, setNodes] = useState<TreeNode[]>([]);
	const [loading, setLoading] = useState(false);
	const [filter, setFilter] = useState("");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const loadRoot = useCallback(async () => {
		setLoading(true);
		try {
			const items = await window.omp.listDir(cwd);
			setNodes(items.map(item => ({ item, expanded: false, loaded: false })));
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		void loadRoot();
		let timer: NodeJS.Timeout | undefined;
		const onWorkspaceChange = (): void => {
			clearTimeout(timer);
			timer = setTimeout(() => void loadRoot(), 400);
		};
		window.addEventListener("omp:workspace-changed", onWorkspaceChange);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("omp:workspace-changed", onWorkspaceChange);
		};
	}, [loadRoot]);

	const toggleFolder = async (node: TreeNode, pathParts: string[]): Promise<void> => {
		const targetPath = node.item.path;

		// 递归定位到当前点击的节点并更新
		const updateNodes = (list: TreeNode[]): TreeNode[] => {
			return list.map(n => {
				if (n.item.path === targetPath) {
					return {
						...n,
						expanded: !n.expanded,
					};
				}
				if (n.children && targetPath.startsWith(`${n.item.path}/`)) {
					return {
						...n,
						children: updateNodes(n.children),
					};
				}
				return n;
			});
		};

		if (!node.loaded) {
			// 加载子项
			const childrenItems = await window.omp.listDir(cwd, node.item.path);
			const childrenNodes: TreeNode[] = childrenItems.map(item => ({
				item,
				expanded: false,
				loaded: false,
			}));

			setNodes(prev => {
				const injectChildren = (list: TreeNode[]): TreeNode[] => {
					return list.map(n => {
						if (n.item.path === targetPath) {
							return {
								...n,
								children: childrenNodes,
								loaded: true,
								expanded: true,
							};
						}
						if (n.children && targetPath.startsWith(`${n.item.path}/`)) {
							return {
								...n,
								children: injectChildren(n.children),
							};
						}
						return n;
					});
				};
				return injectChildren(prev);
			});
		} else {
			setNodes(prev => updateNodes(prev));
		}
	};

	const handleMention = (e: React.MouseEvent, path: string): void => {
		e.stopPropagation();
		if (onInsertText) {
			onInsertText(`@${path} `);
		}
	};

	const handleReveal = (e: React.MouseEvent, path: string): void => {
		e.stopPropagation();
		void window.omp.revealPath(`${cwd}/${path}`);
	};

	const handleOpenEditor = async (e: React.MouseEvent, path: string): Promise<void> => {
		e.stopPropagation();
		await window.omp.openInEditor(cwd, path);
	};

	const renderNode = (node: TreeNode, depth = 0): ReactNode => {
		const isDir = node.item.isDirectory;
		const isSelected = selectedPath === node.item.path;

		if (filter.trim()) {
			const match = node.item.name.toLowerCase().includes(filter.toLowerCase()) || node.item.path.toLowerCase().includes(filter.toLowerCase());
			if (!match && !isDir) return null;
		}

		return (
			<div key={node.item.path} className="tree-node-group">
				<div
					className={`tree-row${isSelected ? " is-selected" : ""}`}
					style={{ paddingLeft: `${depth * 14 + 10}px` }}
					onClick={() => {
						setSelectedPath(node.item.path);
						if (isDir) void toggleFolder(node, [node.item.name]);
					}}
				>
					<span className="tree-expander">
						{isDir ? (
							node.expanded ? (
								<ChevronDown size={12} className="tree-arrow" />
							) : (
								<ChevronRight size={12} className="tree-arrow" />
							)
						) : (
							<span className="tree-spacer" />
						)}
					</span>
					{getFileIcon(node.item.extension, isDir, node.expanded)}
					<span className="tree-label" title={node.item.path}>
						{node.item.name}
					</span>

					<div className="tree-actions">
						{!isDir && (
							<button
								type="button"
								className="tree-btn"
								title="引用到对话框 (@文件)"
								onClick={e => handleMention(e, node.item.path)}
							>
								<MessageSquarePlus size={11} />
							</button>
						)}
						<button
							type="button"
							className="tree-btn"
							title="在编辑器中打开"
							onClick={e => void handleOpenEditor(e, node.item.path)}
						>
							<ExternalLink size={11} />
						</button>
						<button
							type="button"
							className="tree-btn"
							title="在访达中显示"
							onClick={e => handleReveal(e, node.item.path)}
						>
							<FolderOpen size={11} />
						</button>
					</div>
				</div>

				{isDir && node.expanded && (
					node.loading ? (
						<div className="tree-loading-row" style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}>
							<span className="th-shimmer">正在加载子目录…</span>
						</div>
					) : node.children ? (
						<div className="tree-children">
							{node.children.map(child => renderNode(child, depth + 1))}
						</div>
					) : null
				)}
			</div>
		);
	};

	return (
		<div className="file-tree-panel">
			<div className="tree-topbar">
				<div className="tree-search">
					<Search size={12} className="tree-search-icon" />
					<input
						type="text"
						className="tree-search-input"
						placeholder="快速过滤文件…"
						value={filter}
						onChange={e => setFilter(e.target.value)}
					/>
					{filter && (
						<button type="button" className="tree-search-clear" onClick={() => setFilter("")}>
							<X size={10} />
						</button>
					)}
				</div>
				<button
					type="button"
					className={`rp-icon-btn${loading ? " is-spinning" : ""}`}
					title="刷新目录"
					onClick={() => void loadRoot()}
				>
					<RefreshCw size={12} />
				</button>
			</div>

			<div className="tree-content">
				{loading && nodes.length === 0 ? (
					<div className="rp-loading">正在读取项目文件…</div>
				) : nodes.length === 0 ? (
					<div className="rp-empty">
						<Folder size={32} className="rp-empty-icon" />
						<div className="rp-empty-title">当前目录为空</div>
					</div>
				) : (
					<div className="tree-list">{nodes.map(n => renderNode(n))}</div>
				)}
			</div>
		</div>
	);
}
