import {
	Brain,
	Database,
	Layers,
	Network,
	RefreshCw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { MemoryGraphData, MemoryItem } from "@shared/ipc";

interface MemoryGraphViewProps {
	activeProject: string | null;
}

export function MemoryGraphView({ activeProject }: MemoryGraphViewProps): ReactNode {
	const [data, setData] = useState<MemoryGraphData | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedBank, setSelectedBank] = useState<string>("all");
	const [viewMode, setViewMode] = useState<"graph" | "list">("graph");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const res = await window.omp.getMemoryOverview(activeProject ?? undefined);
			setData(res);
		} catch (e) {
			console.error("Failed to load memory overview:", e);
		} finally {
			setLoading(false);
		}
	}, [activeProject]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const handleDelete = async (bankId: string, id: string, type: "fact" | "episode") => {
		setDeletingId(id);
		try {
			const ok = await window.omp.deleteMemory(bankId, id, type);
			if (ok) {
				setData(prev => {
					if (!prev) return null;
					return {
						...prev,
						totalFacts: Math.max(0, prev.totalFacts - 1),
						memories: prev.memories.filter(m => m.id !== id),
						nodes: prev.nodes.filter(n => n.id !== `fact:${id}`),
						edges: prev.edges.filter(e => e.source !== `fact:${id}` && e.target !== `fact:${id}`),
					};
				});
				if (selectedNodeId === `fact:${id}`) setSelectedNodeId(null);
			}
		} catch (e) {
			console.error("Failed to delete memory:", e);
		} finally {
			setDeletingId(null);
		}
	};

	// 过滤事实列表
	const filteredMemories = useMemo(() => {
		if (!data) return [];
		let list = data.memories;
		if (selectedBank !== "all") {
			list = list.filter(m => m.bankId === selectedBank);
		}
		const q = searchQuery.trim().toLowerCase();
		if (q) {
			list = list.filter(
				m =>
					m.content.toLowerCase().includes(q) ||
					m.bankName.toLowerCase().includes(q) ||
					(m.subject && m.subject.toLowerCase().includes(q)) ||
					(m.predicate && m.predicate.toLowerCase().includes(q)),
			);
		}
		return list;
	}, [data, selectedBank, searchQuery]);

	// 计算图谱节点与连线
	const graphLayout = useMemo(() => {
		if (!data) return { nodes: [], edges: [], width: 700, height: 420 };
		const activeBankIds = selectedBank === "all" ? data.banks.map(b => b.id) : [selectedBank];

		// 选中的 Bank 节点与关联事实
		const bankNodes = data.nodes.filter(n => n.type === "bank" && activeBankIds.includes(n.bankId));
		let factNodes = data.nodes.filter(n => n.type === "fact" && activeBankIds.includes(n.bankId));

		const q = searchQuery.trim().toLowerCase();
		if (q) {
			factNodes = factNodes.filter(n => (n.content ?? n.label).toLowerCase().includes(q));
		}

		// 限制图谱渲染节点数量（取前 45 个）防止密集卡顿
		const visibleFacts = factNodes.slice(0, 45);
		const visibleNodeIds = new Set([...bankNodes.map(b => b.id), ...visibleFacts.map(f => f.id)]);

		const width = 760;
		const height = 440;
		const centerX = width / 2;
		const centerY = height / 2;

		interface PositionedNode {
			id: string;
			label: string;
			type: "bank" | "fact";
			bankName: string;
			content?: string;
			x: number;
			y: number;
		}

		const positionedNodes: PositionedNode[] = [];

		if (bankNodes.length === 1) {
			// 单个 Bank 辐射布局
			const b = bankNodes[0];
			positionedNodes.push({
				id: b.id,
				label: b.label,
				type: "bank",
				bankName: b.bankName,
				x: centerX,
				y: centerY,
			});

			const count = visibleFacts.length;
			const radius = Math.min(centerX - 90, centerY - 60, 160);
			visibleFacts.forEach((f, idx) => {
				const angle = (idx / Math.max(1, count)) * 2 * Math.PI - Math.PI / 2;
				positionedNodes.push({
					id: f.id,
					label: f.label,
					type: "fact",
					bankName: f.bankName,
					content: f.content,
					x: centerX + radius * Math.cos(angle),
					y: centerY + radius * Math.sin(angle),
				});
			});
		} else {
			// 多个 Bank 环形布局
			const bCount = bankNodes.length;
			const bRadius = Math.min(centerX, centerY) * 0.45;
			const bankPositions = new Map<string, { x: number; y: number }>();

			bankNodes.forEach((b, bIdx) => {
				const bAngle = (bIdx / Math.max(1, bCount)) * 2 * Math.PI - Math.PI / 2;
				const bx = centerX + bRadius * Math.cos(bAngle);
				const by = centerY + bRadius * Math.sin(bAngle);
				bankPositions.set(b.bankId, { x: bx, y: by });
				positionedNodes.push({
					id: b.id,
					label: b.label,
					type: "bank",
					bankName: b.bankName,
					x: bx,
					y: by,
				});
			});

			// 事实围绕各自 Bank 分布
			visibleFacts.forEach((f, fIdx) => {
				const parentPos = bankPositions.get(f.bankId) ?? { x: centerX, y: centerY };
				const fAngle = (fIdx * 1.37) % (2 * Math.PI);
				const dist = 55 + (fIdx % 3) * 18;
				positionedNodes.push({
					id: f.id,
					label: f.label,
					type: "fact",
					bankName: f.bankName,
					content: f.content,
					x: parentPos.x + dist * Math.cos(fAngle),
					y: parentPos.y + dist * Math.sin(fAngle),
				});
			});
		}

		// 连线
		const nodeMap = new Map(positionedNodes.map(n => [n.id, n]));
		const edges = data.edges
			.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
			.map(e => ({
				sourceNode: nodeMap.get(e.source),
				targetNode: nodeMap.get(e.target),
				label: e.label,
			}))
			.filter(e => e.sourceNode && e.targetNode);

		return { nodes: positionedNodes, edges, width, height };
	}, [data, selectedBank, searchQuery]);

	// 当前点击节点详情
	const activeDetailMemory = useMemo(() => {
		if (!data || !selectedNodeId) return null;
		const factId = selectedNodeId.replace(/^fact:/, "");
		return data.memories.find(m => m.id === factId) ?? null;
	}, [data, selectedNodeId]);

	return (
		<div className="mg-wrap">
			{/* 1. 整体指标概览 */}
			<div className="mg-metrics-row">
				<div className="mg-metric-card">
					<div className="mg-metric-icon">
						<Database size={15} />
					</div>
					<div>
						<div className="mg-metric-val">{data?.banks.length ?? 0}</div>
						<div className="mg-metric-lbl">项目记忆库 (Banks)</div>
					</div>
				</div>
				<div className="mg-metric-card">
					<div className="mg-metric-icon is-accent">
						<Brain size={15} />
					</div>
					<div>
						<div className="mg-metric-val">{data?.totalFacts ?? 0}</div>
						<div className="mg-metric-lbl">已持久化实体事实</div>
					</div>
				</div>
				<div className="mg-metric-card">
					<div className="mg-metric-icon is-ok">
						<Network size={15} />
					</div>
					<div>
						<div className="mg-metric-val">{data?.totalEdges ?? 0}</div>
						<div className="mg-metric-lbl">知识关联图谱边</div>
					</div>
				</div>
			</div>

			{/* 2. 筛选与控制栏 */}
			<div className="mg-toolbar">
				<div className="mg-bank-select-box">
					<span className="mg-select-label">记忆库范围:</span>
					<select
						className="sp-select mg-select"
						value={selectedBank}
						onChange={e => {
							setSelectedBank(e.target.value);
							setSelectedNodeId(null);
						}}
					>
						<option value="all">所有项目库 (全局整体视图)</option>
						{data?.banks.map(b => (
							<option key={b.id} value={b.id}>
								{b.name} ({b.factsCount} 条事实)
							</option>
						))}
					</select>
				</div>

				<div className="mg-search-box">
					<Search size={13} className="mg-search-icon" />
					<input
						type="text"
						className="mg-search-input"
						placeholder="搜索实体、事实或技术偏好..."
						value={searchQuery}
						onChange={e => setSearchQuery(e.target.value)}
					/>
					{searchQuery && (
						<button type="button" className="mg-search-clear" onClick={() => setSearchQuery("")}>
							<X size={12} />
						</button>
					)}
				</div>

				<div className="mg-view-toggle">
					<button
						type="button"
						className={`mg-view-btn${viewMode === "graph" ? " is-active" : ""}`}
						onClick={() => setViewMode("graph")}
						title="拓扑图模式"
					>
						<Network size={13} />
						<span>图谱网络</span>
					</button>
					<button
						type="button"
						className={`mg-view-btn${viewMode === "list" ? " is-active" : ""}`}
						onClick={() => setViewMode("list")}
						title="结构化清单模式"
					>
						<Layers size={13} />
						<span>事实卡片 ({filteredMemories.length})</span>
					</button>
				</div>

				<button
					type="button"
					className={`btn-icon mg-refresh-btn${loading ? " is-spinning" : ""}`}
					onClick={() => void loadData()}
					title="重新拉取记忆图谱"
				>
					<RefreshCw size={13} />
				</button>
			</div>

			{/* 3. 主视图展示区 */}
			<div className="mg-stage">
				{loading && !data ? (
					<div className="mg-empty">正在加载整体 OMP 记忆图谱...</div>
				) : viewMode === "graph" ? (
					<div className="mg-canvas-container">
						<svg
							className="mg-svg-canvas"
							viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
							onClick={() => setSelectedNodeId(null)}
						>
							<defs>
								<radialGradient id="bankGlow" cx="50%" cy="50%" r="50%">
									<stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
									<stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
								</radialGradient>
							</defs>

							{/* 连线层 */}
							{graphLayout.edges.map((e, idx) => {
								if (!e.sourceNode || !e.targetNode) return null;
								const midX = (e.sourceNode.x + e.targetNode.x) / 2;
								const midY = (e.sourceNode.y + e.targetNode.y) / 2;
								return (
									<g key={idx} className="mg-edge-group">
										<line
											x1={e.sourceNode.x}
											y1={e.sourceNode.y}
											x2={e.targetNode.x}
											y2={e.targetNode.y}
											className="mg-edge-line"
										/>
										{e.label && (
											<text x={midX} y={midY} className="mg-edge-label">
												{e.label}
											</text>
										)}
									</g>
								);
							})}

							{/* 节点层 */}
							{graphLayout.nodes.map(n => {
								const isSelected = selectedNodeId === n.id;
								const isBank = n.type === "bank";
								const r = isBank ? 22 : 12;
								return (
									<g
										key={n.id}
										className={`mg-node-group is-${n.type}${isSelected ? " is-selected" : ""}`}
										transform={`translate(${n.x}, ${n.y})`}
										onClick={e => {
											e.stopPropagation();
											setSelectedNodeId(n.id);
										}}
									>
										{isBank && <circle r={r + 8} fill="url(#bankGlow)" pointerEvents="none" />}
										<circle r={r} className="mg-node-circle" />
										<text y={isBank ? 36 : 22} className="mg-node-text">
											{n.label.length > 14 ? `${n.label.slice(0, 14)}…` : n.label}
										</text>
									</g>
								);
							})}
						</svg>

						{/* 浮动节点详情卡片 */}
						{activeDetailMemory && (
							<div className="mg-node-popover">
								<div className="mg-pop-head">
									<div className="mg-pop-meta">
										<span className="mem-badge is-fact">事实实体</span>
										<span className="mg-pop-bank">{activeDetailMemory.bankName}</span>
									</div>
									<button
										type="button"
										className="mg-pop-close"
										onClick={() => setSelectedNodeId(null)}
									>
										<X size={12} />
									</button>
								</div>
								<p className="mg-pop-body">{activeDetailMemory.content}</p>
								<div className="mg-pop-footer">
									<span className="mg-pop-time">{activeDetailMemory.createdAt}</span>
									<button
										type="button"
										className="mem-item-del"
										title="删除该事实"
										disabled={deletingId === activeDetailMemory.id}
										onClick={() =>
											void handleDelete(activeDetailMemory.bankId, activeDetailMemory.id, "fact")
										}
									>
										<Trash2 size={13} />
									</button>
								</div>
							</div>
						)}
					</div>
				) : (
					/* 列表视图 */
					<div className="mg-list-view">
						{filteredMemories.length === 0 ? (
							<div className="mg-empty">未找到匹配的记忆条目</div>
						) : (
							<div className="mem-list">
								{filteredMemories.map(item => (
									<div key={item.id} className="mem-item">
										<div className="mem-item-main">
											<div className="mem-item-meta">
												<span className="mem-badge is-fact">
													{item.bankName}
												</span>
												{item.subject && (
													<span className="mg-chip">
														{item.subject} &gt; {item.predicate}
													</span>
												)}
												<span className="mem-time">{item.createdAt}</span>
											</div>
											<p className="mem-item-text">{item.content}</p>
										</div>
										<button
											type="button"
											className="mem-item-del"
											title="从记忆库物理删除"
											disabled={deletingId === item.id}
											onClick={() => void handleDelete(item.bankId, item.id, "fact")}
										>
											<Trash2 size={13} />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
