import { type ReactNode, useState } from "react";
import { answerUiRequest } from "@/state/threads";
import type { UiRequest } from "@/state/types";

/** omp 需要用户决定的请求（工具审批、ask 工具的选择/输入等），显示在输入框上方。 */
export function UiRequestCard({ threadKey, request }: { threadKey: string; request: UiRequest }): ReactNode {
	const [value, setValue] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
	const cancel = (): void => answerUiRequest(threadKey, request.id, { cancelled: true });

	switch (request.method) {
		case "select": {
			const isApproval = request.options.length === 2 && request.options[0] === "Approve" && request.options[1] === "Deny";
			return (
				<div className="ur">
					<pre className="ur-title">{request.title}</pre>
					<div className={isApproval ? "ur-actions" : "ur-options"}>
						{request.options.map((option, i) => (
							<button
								type="button"
								key={option}
								className={isApproval ? (i === 0 ? "btn btn-primary" : "btn") : "ur-option"}
								onClick={() => answerUiRequest(threadKey, request.id, { value: option })}
							>
								<span>{isApproval ? (i === 0 ? "允许" : "拒绝") : option}</span>
								{!isApproval && request.optionDetails?.[i]?.description && (
									<span className="ur-option-desc">{request.optionDetails[i]!.description}</span>
								)}
							</button>
						))}
						{!isApproval && (
							<button type="button" className="btn btn-ghost" onClick={cancel}>
								取消
							</button>
						)}
					</div>
				</div>
			);
		}
		case "confirm":
			return (
				<div className="ur">
					<div className="ur-heading">{request.title}</div>
					<pre className="ur-title">{request.message}</pre>
					<div className="ur-actions">
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => answerUiRequest(threadKey, request.id, { confirmed: true })}
						>
							确定
						</button>
						<button
							type="button"
							className="btn"
							onClick={() => answerUiRequest(threadKey, request.id, { confirmed: false })}
						>
							取消
						</button>
					</div>
				</div>
			);
		case "input":
		case "editor":
			return (
				<form
					className="ur"
					onSubmit={e => {
						e.preventDefault();
						answerUiRequest(threadKey, request.id, { value });
					}}
				>
					<div className="ur-heading">{request.title}</div>
					{request.method === "input" ? (
						<input
							className="ur-input"
							autoFocus
							value={value}
							placeholder={request.placeholder}
							onChange={e => setValue(e.target.value)}
						/>
					) : (
						<textarea className="ur-input ur-textarea" autoFocus value={value} onChange={e => setValue(e.target.value)} />
					)}
					<div className="ur-actions">
						<button type="submit" className="btn btn-primary">
							确定
						</button>
						<button type="button" className="btn" onClick={cancel}>
							取消
						</button>
					</div>
				</form>
			);
	}
}
