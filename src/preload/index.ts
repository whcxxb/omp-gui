import type { OmpApi, RuntimeMessage } from "@shared/ipc";
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
