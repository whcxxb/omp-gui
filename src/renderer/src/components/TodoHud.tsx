import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { Thread, TodoItem, TodoPhase, TodoStatus } from "@/state/types";

interface TodoHudProps {
	thread: Thread;
}

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
	[10, "X"],
	[9, "IX"],
	[5, "V"],
	[4, "IV"],
	[1, "I"],
];

function toRoman(n: number): string {
	if (n <= 0) return "";
	let out = "";
	let rem = n;
	for (const [val, sym] of ROMAN_NUMERALS) {
		while (rem >= val) {
			out += sym;
			rem -= val;
		}
	}
	return out;
}

export function TodoHud({ thread }: TodoHudProps): ReactNode {
	const [collapsed, setCollapsed] = useState(false);

	const phases = useMemo(() => {
		const raw = thread.todoPhases;
		if (!Array.isArray(raw)) return [];
		return raw.filter(p => p && Array.isArray(p.tasks) && p.tasks.length > 0);
	}, [thread.todoPhases]);

	const { totalTasks, completedTasks, inProgressTasks } = useMemo(() => {
		let total = 0;
		let completed = 0;
		let inProgress = 0;
		for (const phase of phases) {
			for (const task of phase.tasks) {
				total++;
				if (task.status === "completed") completed++;
				else if (task.status === "in_progress") inProgress++;
			}
		}
		return { totalTasks: total, completedTasks: completed, inProgressTasks: inProgress };
	}, [phases]);

	if (totalTasks === 0) return null;

	const multiPhase = phases.length > 1;

	return (
		<div className={`todo-hud${collapsed ? " is-collapsed" : ""}`}>
			<button
				type="button"
				className="todo-hud-head"
				onClick={() => setCollapsed(prev => !prev)}
				title={collapsed ? "展开任务看板" : "收起任务看板"}
			>
				<span className="todo-hud-status-glyph">☑</span>
				<span className="todo-hud-title">Todo</span>
				<span className="todo-hud-count">
					{completedTasks === totalTasks ? `${totalTasks} tasks` : `${completedTasks}/${totalTasks} tasks`}
				</span>
				<span className="todo-hud-rule" />
				<span className="todo-hud-toggle">
					{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
				</span>
			</button>

			{!collapsed && (
				<div className="todo-hud-tree">
					{phases.map((phase, pIdx) => {
						const isLastPhase = pIdx === phases.length - 1;
						return (
							<div key={phase.name || pIdx} className="todo-hud-phase">
								{multiPhase && (
									<div className="todo-hud-phase-header">
										<span className="todo-hud-branch">{isLastPhase ? "└─" : "├─"}</span>
										<span className="todo-hud-phase-name">
											{toRoman(pIdx + 1)}. {phase.name}
										</span>
									</div>
								)}
								<div className={`todo-hud-phase-tasks${multiPhase ? " is-nested" : ""}`}>
									{phase.tasks.map((task: TodoItem, tIdx: number) => {
										const isLastTask = tIdx === phase.tasks.length - 1;
										const branch = isLastTask ? "└─" : "├─";
										return (
											<div key={tIdx} className={`todo-hud-item is-${task.status}`}>
												<span className="todo-hud-branch">{branch}</span>
												<span className="todo-hud-item-icon">
													{task.status === "completed" && "☑"}
													{task.status === "in_progress" && "→"}
													{task.status === "pending" && "☐"}
													{task.status === "abandoned" && "✕"}
												</span>
												<span className="todo-hud-item-text">{task.content}</span>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
