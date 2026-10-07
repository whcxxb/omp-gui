import type { MemorySavedEvent, OmpApi, RuntimeMessage, TerminalExitEvent, TerminalOutputEvent, UpdateStatus } from "@shared/ipc";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: OmpApi = {
	listProjects: () => ipcRenderer.invoke("omp:list-projects"),
	pickProject: () => ipcRenderer.invoke("omp:pick-project"),
	removeProject: path => ipcRenderer.invoke("omp:remove-project", path),
	deleteSession: file => ipcRenderer.invoke("omp:delete-session", file),
	renameSession: (file, title) => ipcRenderer.invoke("omp:rename-session", file, title),
	readSessionExcerpt: (file, maxTurns) => ipcRenderer.invoke("omp:read-session-excerpt", file, maxTurns),
	openSession: options => ipcRenderer.invoke("omp:open-session", options),
	closeRuntime: runtimeId => ipcRenderer.invoke("omp:close-runtime", runtimeId),
	request: (runtimeId, command) => ipcRenderer.invoke("omp:request", runtimeId, command),
	send: (runtimeId, frame) => ipcRenderer.invoke("omp:send", runtimeId, frame),
	ompVersion: () => ipcRenderer.invoke("omp:version"),
	defaultApprovalMode: () => ipcRenderer.invoke("omp:default-approval-mode"),
	setDefaultApprovalMode: mode => ipcRenderer.invoke("omp:set-default-approval-mode", mode),
	getOmpConfigs: () => ipcRenderer.invoke("omp:get-configs"),
	setOmpConfig: (key, value) => ipcRenderer.invoke("omp:set-config", key, value),
	readPromptFiles: () => ipcRenderer.invoke("omp:read-prompt-files"),
	writePromptFile: (id, content) => ipcRenderer.invoke("omp:write-prompt-file", id, content),
	setTheme: theme => ipcRenderer.invoke("omp:set-theme", theme),
	getPathForFile: file => {
		try {
			return webUtils.getPathForFile(file);
		} catch {
			return "";
		}
	},
	revealPath: path => ipcRenderer.invoke("omp:reveal", path),
	listDir: (cwd, relativePath) => ipcRenderer.invoke("omp:list-dir", cwd, relativePath),
	gitStatus: cwd => ipcRenderer.invoke("omp:git-status", cwd),
	gitDiff: options => ipcRenderer.invoke("omp:git-diff", options),
	openInEditor: (cwd, file) => ipcRenderer.invoke("omp:open-in-editor", cwd, file),
	listSkills: cwd => ipcRenderer.invoke("omp:list-skills", cwd),
	createSkill: options => ipcRenderer.invoke("omp:create-skill", options),
	deleteSkill: path => ipcRenderer.invoke("omp:delete-skill", path),
	readSkill: path => ipcRenderer.invoke("omp:read-skill", path),
	saveSkill: (path, content) => ipcRenderer.invoke("omp:save-skill", path, content),
	searchRegistrySkills: query => ipcRenderer.invoke("omp:search-registry-skills", query),
	installRegistrySkill: (name, isGlobal, cwd) => ipcRenderer.invoke("omp:install-registry-skill", name, isGlobal, cwd),
	generateTitle: prompt => ipcRenderer.invoke("omp:generate-title", prompt),
	searchProjectFiles: (cwd, query) => ipcRenderer.invoke("omp:search-project-files", cwd, query),
	forkSession: options => ipcRenderer.invoke("omp:fork-session", options),
	gitLog: (cwd, limit) => ipcRenderer.invoke("omp:git-log", cwd, limit),
	gitCommitDetail: (cwd, hash) => ipcRenderer.invoke("omp:git-commit-detail", cwd, hash),
	gitCommitDiff: (cwd, hash, file) => ipcRenderer.invoke("omp:git-commit-diff", cwd, hash, file),
	runTerminalCommand: (cwd, command) => ipcRenderer.invoke("omp:terminal-exec", { cwd, command }),
	killTerminalCommand: id => ipcRenderer.invoke("omp:terminal-kill", { id }),
	getMemoryOverview: cwd => ipcRenderer.invoke("omp:get-memory-overview", cwd),
	deleteMemory: (bankId, id, type) => ipcRenderer.invoke("omp:delete-memory", bankId, id, type),
	listTodos: cwd => ipcRenderer.invoke("omp:todos-list", cwd),
	createTodo: input => ipcRenderer.invoke("omp:todos-create", input),
	updateTodo: (cwd, id, patch) => ipcRenderer.invoke("omp:todos-update", cwd, id, patch),
	deleteTodo: (cwd, id) => ipcRenderer.invoke("omp:todos-delete", cwd, id),
	reorderTodos: (cwd, orderedIds) => ipcRenderer.invoke("omp:todos-reorder", cwd, orderedIds),
	addTodoAttachment: input => ipcRenderer.invoke("omp:todos-add-attachment", input),
	removeTodoAttachment: (cwd, todoId, attachmentId) =>
		ipcRenderer.invoke("omp:todos-remove-attachment", cwd, todoId, attachmentId),
	readTodoAttachment: blob => ipcRenderer.invoke("omp:todos-read-attachment", blob),
	recordTodoRun: (cwd, todoId, run) => ipcRenderer.invoke("omp:todos-record-run", cwd, todoId, run),
	listCatalogModels: () => ipcRenderer.invoke("omp:list-catalog-models"),
	getAppVersion: () => ipcRenderer.invoke("omp:app-version"),
	checkForUpdates: manual => ipcRenderer.invoke("omp:check-for-updates", manual),
	startUpdate: () => ipcRenderer.invoke("omp:start-update"),
	applyUpdateAndRestart: options => ipcRenderer.invoke("omp:apply-update-and-restart", options),
	getUpdateStatus: () => ipcRenderer.invoke("omp:get-update-status"),
	onUpdateStatus(listener) {
		const handler = (_e: unknown, status: UpdateStatus) => listener(status);
		ipcRenderer.on("omp:update-status", handler);
		return () => ipcRenderer.removeListener("omp:update-status", handler);
	},
	onTodosChanged(listener) {
		const handler = (_e: unknown, cwd: string) => listener(cwd);
		ipcRenderer.on("omp:todos-changed", handler);
		return () => ipcRenderer.removeListener("omp:todos-changed", handler);
	},
	onMemorySaved(listener) {
		const handler = (_e: unknown, event: MemorySavedEvent) => listener(event);
		ipcRenderer.on("omp:memory-saved", handler);
		return () => ipcRenderer.removeListener("omp:memory-saved", handler);
	},
	onTerminalOutput(listener) {
		const handler = (_e: unknown, event: TerminalOutputEvent) => listener(event);
		ipcRenderer.on("omp:terminal-output", handler);
		return () => ipcRenderer.removeListener("omp:terminal-output", handler);
	},
	onTerminalExit(listener) {
		const handler = (_e: unknown, event: TerminalExitEvent) => listener(event);
		ipcRenderer.on("omp:terminal-exit", handler);
		return () => ipcRenderer.removeListener("omp:terminal-exit", handler);
	},
	onRuntime(listener) {
		const handler = (_e: unknown, runtimeId: string, message: RuntimeMessage) => listener(runtimeId, message);
		ipcRenderer.on("omp:runtime", handler);
		return () => ipcRenderer.removeListener("omp:runtime", handler);
	},
	onProjectsChanged(listener) {
		const handler = () => listener();
		ipcRenderer.on("omp:projects-changed", handler);
		return () => ipcRenderer.removeListener("omp:projects-changed", handler);
	},
};

contextBridge.exposeInMainWorld("omp", api);
