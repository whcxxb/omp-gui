import { Check, Copy, ExternalLink, Send, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

interface DiffViewProps {
	filePath: string;
	diff: string;
	onClose(): void;
	onAskAi?(prompt: string): void;
}

export function DiffView({ filePath, diff, onClose, onAskAi }: DiffViewProps): ReactNode {
	const [copied, setCopied] = useState(false);

	const parsedLines = useMemo(() => {
		const rawLines = diff.split("\n");
		let oldLine = 0;
		let newLine = 0;

		return rawLines.map((line, index) => {
			if (line.startsWith("@@")) {
				// @@ -1,4 +1,5 @@
				const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
				if (match) {
					oldLine = parseInt(match[1]!, 10) - 1;
					newLine = parseInt(match[2]!, 10) - 1;
				}
				return { type: "hunk", text: line, oldNum: null, newNum: null, key: index };
			}
			if (line.startsWith("+") && !line.startsWith("+++")) {
				newLine++;
				return { type: "add", text: line, oldNum: null, newNum: newLine, key: index };
			}
			if (line.startsWith("-") && !line.startsWith("---")) {
				oldLine++;
				return { type: "del", text: line, oldNum: oldLine, newNum: null, key: index };
			}
			if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
				return { type: "meta", text: line, oldNum: null, newNum: null, key: index };
			}
			oldLine++;
			newLine++;
			return { type: "context", text: line, oldNum: oldLine, newNum: newLine, key: index };
		});
	}, [diff]);

	const handleCopy = async (): Promise<void> => {
		await navigator.clipboard.writeText(diff);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleAskAi = (): void => {
		if (onAskAi) {
			onAskAi(`请帮我审查文件 \`${filePath}\` 的这次代码改动：\n\`\`\`diff\n${diff}\n\`\`\``);
		}
	};

	return (
		<div className="diff-view">
			<div className="diff-header">
				<div className="diff-title" title={filePath}>
					<span className="diff-filename">{filePath}</span>
				</div>
				<div className="diff-actions">
					{onAskAi && (
						<button type="button" className="diff-btn" title="让 AI 审查本次修改" onClick={handleAskAi}>
							<Send size={11} />
							<span>审查</span>
						</button>
					)}
					<button type="button" className="diff-btn" title="复制完整 Diff" onClick={handleCopy}>
						{copied ? <Check size={11} /> : <Copy size={11} />}
						<span>{copied ? "已复制" : "复制"}</span>
					</button>
					<button type="button" className="diff-btn is-close" title="关闭 Diff" onClick={onClose}>
						<X size={12} />
					</button>
				</div>
			</div>
			<div className="diff-body">
				{parsedLines.map(line => (
					<div key={line.key} className={`diff-line is-${line.type}`}>
						<span className="diff-num old-num">{line.oldNum ?? ""}</span>
						<span className="diff-num new-num">{line.newNum ?? ""}</span>
						<span className="diff-code">{line.text}</span>
					</div>
				))}
			</div>
		</div>
	);
}
