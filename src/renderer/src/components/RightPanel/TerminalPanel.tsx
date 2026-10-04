import {
	Check,
	Copy,
	CornerDownLeft,
	Play,
	RefreshCw,
	Square,
	Terminal,
	Trash2,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { TerminalExitEvent, TerminalOutputEvent } from "@shared/ipc";

interface TerminalHistoryItem {
	id: string;
	command: string;
	output: string;
	startedAt: number;
	status: "running" | "success" | "error";
	exitCode?: number | null;
}

const PRESET_COMMANDS = [
	{ label: "git status", cmd: "git status" },
	{ label: "git diff", cmd: "git diff" },
	{ label: "git log", cmd: "git log -n 5 --oneline" },
	{ label: "pnpm dev", cmd: "pnpm dev" },
	{ label: "pnpm test", cmd: "pnpm test" },
	{ label: "ls -la", cmd: "ls -la" },
];

function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1B\].*?\x07/g, "");
}

export function TerminalPanel({ cwd }: { cwd: string }): ReactNode {
	const [history, setHistory] = useState<TerminalHistoryItem[]>([]);
	const [inputCommand, setInputCommand] = useState("");
	const [runningId, setRunningId] = useState<string | null>(null);
	const [commandHistory, setCommandHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const activeCmdIdRef = useRef<string | null>(null);

	activeCmdIdRef.current = runningId;

	useEffect(() => {
		const offOut = window.omp.onTerminalOutput((event: TerminalOutputEvent) => {
			setHistory(prev =>
				prev.map(item => {
					if (item.id === event.id) {
						return { ...item, output: item.output + event.data };
					}
					return item;
				}),
			);
		});

		const offExit = window.omp.onTerminalExit((event: TerminalExitEvent) => {
			if (activeCmdIdRef.current === event.id) {
				setRunningId(null);
			}
			setHistory(prev =>
				prev.map(item => {
					if (item.id === event.id) {
						return {
							...item,
							status: event.code === 0 ? "success" : "error",
							exitCode: event.code,
						};
					}
					return item;
				}),
			);
		});

		return () => {
			offOut();
			offExit();
		};
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [history]);

	const executeCommand = async (cmdToRun: string): Promise<void> => {
		const trimmed = cmdToRun.trim();
		if (!trimmed) return;

		setCommandHistory(prev => (prev.at(-1) === trimmed ? prev : [...prev, trimmed]));
		setHistoryIndex(null);
		setInputCommand("");

		const itemPlaceholderId = crypto.randomUUID();
		const newItem: TerminalHistoryItem = {
			id: itemPlaceholderId,
			command: trimmed,
			output: "",
			startedAt: Date.now(),
			status: "running",
		};

		setHistory(prev => [...prev, newItem]);
		setRunningId(itemPlaceholderId);

		try {
			const realId = await window.omp.runTerminalCommand(cwd, trimmed);
			setHistory(prev =>
				prev.map(item => (item.id === itemPlaceholderId ? { ...item, id: realId } : item)),
			);
			setRunningId(realId);
		} catch (err) {
			setHistory(prev =>
				prev.map(item =>
					item.id === itemPlaceholderId
						? {
								...item,
								status: "error",
								output: `[启动失败]: ${err instanceof Error ? err.message : String(err)}\n`,
							}
						: item,
				),
			);
			setRunningId(null);
		}
	};

	const handleKill = async (): Promise<void> => {
		if (!runningId) return;
		await window.omp.killTerminalCommand(runningId);
		setRunningId(null);
	};

	const handleClear = (): void => {
		setHistory([]);
	};

	const handleCopyAll = (): void => {
		const allText = history.map(h => `$ ${h.command}\n${stripAnsi(h.output)}`).join("\n\n");
		void navigator.clipboard.writeText(allText);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === "Enter") {
			e.preventDefault();
			void executeCommand(inputCommand);
			return;
		}

		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (commandHistory.length === 0) return;
			const nextIdx = historyIndex === null ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
			setHistoryIndex(nextIdx);
			setInputCommand(commandHistory[nextIdx] ?? "");
			return;
		}

		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (historyIndex === null) return;
			if (historyIndex < commandHistory.length - 1) {
				const nextIdx = historyIndex + 1;
				setHistoryIndex(nextIdx);
				setInputCommand(commandHistory[nextIdx] ?? "");
			} else {
				setHistoryIndex(null);
				setInputCommand("");
			}
			return;
		}

		if (e.key === "c" && e.ctrlKey) {
			if (runningId) {
				e.preventDefault();
				void handleKill();
			}
		}
	};

	return (
		<div className="term-panel">
			<div className="term-topbar">
				<div className="term-presets">
					{PRESET_COMMANDS.map(p => (
						<button
							key={p.label}
							type="button"
							className="term-preset-chip"
							disabled={Boolean(runningId)}
							onClick={() => void executeCommand(p.cmd)}
						>
							<Play size={10} className="term-play-icon" />
							<span>{p.label}</span>
						</button>
					))}
				</div>
				<div className="term-actions">
					{runningId && (
						<button
							type="button"
							className="term-icon-btn is-stop"
							title="终止当前命令 (Ctrl+C)"
							onClick={() => void handleKill()}
						>
							<Square size={11} fill="currentColor" />
							<span>终止</span>
						</button>
					)}
					<button
						type="button"
						className="term-icon-btn"
						title={copied ? "已复制终端输出" : "复制全部输出"}
						onClick={handleCopyAll}
					>
						{copied ? <Check size={12} className="is-success" /> : <Copy size={12} />}
					</button>
					<button
						type="button"
						className="term-icon-btn"
						title="清空终端记录"
						onClick={handleClear}
					>
						<Trash2 size={12} />
					</button>
				</div>
			</div>

			<div className="term-scroll" ref={scrollRef}>
				{history.length === 0 ? (
					<div className="term-empty">
						<Terminal size={32} className="term-empty-icon" />
						<div className="term-empty-title">内置项目终端</div>
						<div className="term-empty-desc">
							在下方输入命令并按 Enter 执行，命令将直接在当前项目目录下运行。
						</div>
					</div>
				) : (
					<div className="term-stream">
						{history.map(item => (
							<div key={item.id} className="term-cmd-block">
								<div className="term-cmd-header">
									<span className="term-prompt-char">$</span>
									<span className="term-cmd-text">{item.command}</span>
									<span className="term-cmd-status">
										{item.status === "running" && <RefreshCw size={11} className="is-spinning" />}
										{item.status === "success" && <span className="term-badge-ok">exit 0</span>}
										{item.status === "error" && (
											<span className="term-badge-err">exit {item.exitCode ?? 1}</span>
										)}
									</span>
								</div>
								{item.output ? (
									<pre className="term-cmd-output">{stripAnsi(item.output)}</pre>
								) : item.status === "running" ? (
									<div className="term-output-wait">运行中...</div>
								) : null}
							</div>
						))}
					</div>
				)}
			</div>

			<div className="term-input-bar">
				<span className="term-input-prompt">$</span>
				<input
					ref={inputRef}
					type="text"
					className="term-input"
					placeholder={runningId ? "任务运行中... (可按 Ctrl+C 中断)" : "输入命令，Enter 执行，↑↓ 回溯历史..."}
					value={inputCommand}
					onChange={e => setInputCommand(e.target.value)}
					onKeyDown={onKeyDown}
					autoFocus
				/>
				<button
					type="button"
					className="term-run-btn"
					disabled={!inputCommand.trim() || Boolean(runningId)}
					onClick={() => void executeCommand(inputCommand)}
					title="执行 (Enter)"
				>
					<CornerDownLeft size={13} />
				</button>
			</div>
		</div>
	);
}
