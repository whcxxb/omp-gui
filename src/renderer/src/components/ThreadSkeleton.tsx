import type { ReactNode } from "react";

export function ThreadSkeleton(): ReactNode {
	return (
		<div className="th-skeleton-container" aria-label="正在加载会话历史...">
			<div className="th-skeleton-pulse">
				{/* 用户提问骨架 */}
				<div className="th-skeleton-user">
					<div className="th-skeleton-line th-skeleton-user-line1" />
					<div className="th-skeleton-line th-skeleton-user-line2" />
				</div>

				{/* 助手思考与回复骨架 */}
				<div className="th-skeleton-assistant">
					<div className="th-skeleton-think-pill" />
					<div className="th-skeleton-line th-skeleton-text-line1" />
					<div className="th-skeleton-line th-skeleton-text-line2" />
					<div className="th-skeleton-line th-skeleton-text-line3" />
					<div className="th-skeleton-card" />
					<div className="th-skeleton-line th-skeleton-text-line4" />
				</div>

				{/* 第二轮用户与助手简短骨架 */}
				<div className="th-skeleton-user" style={{ width: "42%" }}>
					<div className="th-skeleton-line th-skeleton-user-line1" style={{ width: "80%" }} />
				</div>

				<div className="th-skeleton-assistant" style={{ opacity: 0.65 }}>
					<div className="th-skeleton-line th-skeleton-text-line1" style={{ width: "65%" }} />
					<div className="th-skeleton-line th-skeleton-text-line2" style={{ width: "88%" }} />
				</div>
			</div>
		</div>
	);
}
