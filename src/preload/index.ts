import type { OmpApi, RuntimeMessage } from "@shared/ipc";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: OmpApi = {
	listProjects: () => ipcRenderer.invoke("omp:list-projects"),
	pickProject: () => ipcRenderer.invoke("omp:pick-project"),
	removeProject: path => ipcRenderer.invoke("omp:remove-project", path),
	deleteSession: file => ipcRenderer.invoke("omp:delete-session", file),
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
