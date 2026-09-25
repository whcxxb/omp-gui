import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		resolve: { alias: { "@shared": resolve("src/shared") } },
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
	},
	renderer: {
		resolve: { alias: { "@shared": resolve("src/shared"), "@": resolve("src/renderer/src") } },
		plugins: [react()],
	},
});
