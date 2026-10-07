import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				external: ["original-fs"],
			},
		},
		resolve: { alias: { "@shared": resolve("src/shared") } },
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
	},
	renderer: {
		server: {
			port: 5180,
		},
		resolve: { alias: { "@shared": resolve("src/shared"), "@": resolve("src/renderer/src") } },
		plugins: [react()],
	},
});
