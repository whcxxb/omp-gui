import type { ReactNode } from "react";

export type DiffCategory =
	| "ui"
	| "api"
	| "core"
	| "data"
	| "cli"
	| "security"
	| "tests"
	| "docs"
	| "deps"
	| "build"
	| "scripts"
	| "config"
	| "i18n"
	| "assets"
	| "other";

export interface CategoryMeta {
	key: DiffCategory;
	label: string;
	shortLabel: string;
	description: string;
	color: string;
	bgColor: string;
	borderColor: string;
}

export const DIFF_CATEGORIES: Record<DiffCategory, CategoryMeta> = {
	ui: {
		key: "ui",
		label: "前端界面与组件",
		shortLabel: "UI",
		description: "组件、视图、布局与视觉样式",
		color: "oklch(0.72 0.18 350)",
		bgColor: "oklch(0.72 0.18 350 / 12%)",
		borderColor: "oklch(0.72 0.18 350 / 28%)",
	},
	core: {
		key: "core",
		label: "核心业务逻辑",
		shortLabel: "Core",
		description: "核心业务功能、状态流转与领域模型",
		color: "oklch(0.72 0.16 280)",
		bgColor: "oklch(0.72 0.16 280 / 12%)",
		borderColor: "oklch(0.72 0.16 280 / 28%)",
	},
	api: {
		key: "api",
		label: "接口协议与通信",
		shortLabel: "API",
		description: "RPC 协议、API 路由、IPC 通信契约",
		color: "oklch(0.72 0.15 240)",
		bgColor: "oklch(0.72 0.15 240 / 12%)",
		borderColor: "oklch(0.72 0.15 240 / 28%)",
	},
	data: {
		key: "data",
		label: "数据与存储模型",
		shortLabel: "Data",
		description: "数据库、Schema 定义、数据持久化",
		color: "oklch(0.75 0.16 70)",
		bgColor: "oklch(0.75 0.16 70 / 12%)",
		borderColor: "oklch(0.75 0.16 70 / 28%)",
	},
	cli: {
		key: "cli",
		label: "终端与命令行",
		shortLabel: "CLI",
		description: "命令入口、参数解析与终端交互",
		color: "oklch(0.75 0.16 130)",
		bgColor: "oklch(0.75 0.16 130 / 12%)",
		borderColor: "oklch(0.75 0.16 130 / 28%)",
	},
	security: {
		key: "security",
		label: "权限与安全策略",
		shortLabel: "Sec",
		description: "鉴权、权限门禁、安全校验与敏感处理",
		color: "oklch(0.68 0.22 25)",
		bgColor: "oklch(0.68 0.22 25 / 12%)",
		borderColor: "oklch(0.68 0.22 25 / 28%)",
	},
	tests: {
		key: "tests",
		label: "自动化测试",
		shortLabel: "Test",
		description: "单元测试、端到端测试与测试桩",
		color: "oklch(0.75 0.16 150)",
		bgColor: "oklch(0.75 0.16 150 / 12%)",
		borderColor: "oklch(0.75 0.16 150 / 28%)",
	},
	docs: {
		key: "docs",
		label: "工程文档说明",
		shortLabel: "Docs",
		description: "README、使用指南与架构说明文档",
		color: "oklch(0.72 0.14 210)",
		bgColor: "oklch(0.72 0.14 210 / 12%)",
		borderColor: "oklch(0.72 0.14 210 / 28%)",
	},
	deps: {
		key: "deps",
		label: "项目依赖管理",
		shortLabel: "Deps",
		description: "包依赖声明、版本锁定清单",
		color: "oklch(0.72 0.16 45)",
		bgColor: "oklch(0.72 0.16 45 / 12%)",
		borderColor: "oklch(0.72 0.16 45 / 28%)",
	},
	build: {
		key: "build",
		label: "编译构建配置",
		shortLabel: "Build",
		description: "打包器、编译器、发布打包流水线",
		color: "oklch(0.78 0.14 90)",
		bgColor: "oklch(0.78 0.14 90 / 12%)",
		borderColor: "oklch(0.78 0.14 90 / 28%)",
	},
	scripts: {
		key: "scripts",
		label: "工程与自动化脚本",
		shortLabel: "Scripts",
		description: "开发运维脚本、代码生成与同步工具",
		color: "oklch(0.74 0.16 165)",
		bgColor: "oklch(0.74 0.16 165 / 12%)",
		borderColor: "oklch(0.74 0.16 165 / 28%)",
	},
	config: {
		key: "config",
		label: "运行配置与环境",
		shortLabel: "Config",
		description: "TS 配置、Linter、环境变量与 CI/CD",
		color: "oklch(0.72 0.13 185)",
		bgColor: "oklch(0.72 0.13 185 / 12%)",
		borderColor: "oklch(0.72 0.13 185 / 28%)",
	},
	i18n: {
		key: "i18n",
		label: "国际化多语言",
		shortLabel: "i18n",
		description: "翻译文案与多语言定义",
		color: "oklch(0.72 0.15 260)",
		bgColor: "oklch(0.72 0.15 260 / 12%)",
		borderColor: "oklch(0.72 0.15 260 / 28%)",
	},
	assets: {
		key: "assets",
		label: "静态资源文件",
		shortLabel: "Assets",
		description: "图片、字体、图标与多媒体静态资源",
		color: "oklch(0.72 0.18 320)",
		bgColor: "oklch(0.72 0.18 320 / 12%)",
		borderColor: "oklch(0.72 0.18 320 / 28%)",
	},
	other: {
		key: "other",
		label: "其他未分类改动",
		shortLabel: "Other",
		description: "生成代码或通用文件",
		color: "oklch(0.68 0.02 260)",
		bgColor: "oklch(0.68 0.02 260 / 10%)",
		borderColor: "oklch(0.68 0.02 260 / 20%)",
	},
};

/**
 * 基于 pulls.review (Linear PR Guides) 规则的极速无依赖文件分类器
 */
export function categorizeFilePath(filePath: string): DiffCategory {
	const p = filePath.toLowerCase();

	// 1. 测试文件
	if (
		/\.(test|spec)\.[a-z0-9]+$/.test(p) ||
		/(^|\/)__tests__\//.test(p) ||
		/(^|\/)tests?\//.test(p) ||
		/(^|\/)e2e\//.test(p)
	) {
		return "tests";
	}

	// 2. 文档说明
	if (
		/\.(md|mdx|markdown)$/.test(p) ||
		/(^|\/)docs?\//.test(p) ||
		/(^|\/)readme/i.test(p) ||
		/(^|\/)changelog/i.test(p) ||
		/(^|\/)roadmap/i.test(p)
	) {
		return "docs";
	}

	// 3. 依赖声明与锁文件
	if (
		/(^|\/)package\.json$/.test(p) ||
		/(^|\/)pnpm-lock\.yaml$/.test(p) ||
		/(^|\/)yarn\.lock$/.test(p) ||
		/(^|\/)package-lock\.json$/.test(p) ||
		/(^|\/)cargo\.(toml|lock)$/.test(p) ||
		/(^|\/)go\.(mod|sum)$/.test(p) ||
		/(^|\/)requirements\.txt$/.test(p)
	) {
		return "deps";
	}

	// 4. 构建与编译
	if (
		/(^|\/)(vite|rollup|webpack|esbuild|tsdown|electron\.vite)\.config\./.test(p) ||
		/(^|\/)electron-builder\./.test(p) ||
		/(^|\/)dist\//.test(p) ||
		/(^|\/)out\//.test(p) ||
		/(^|\/)build\//.test(p)
	) {
		return "build";
	}

	// 5. 脚本工具
	if (
		/(^|\/)scripts\//.test(p) ||
		/(^|\/)tools\//.test(p) ||
		/(^|\/)tasks\//.test(p) ||
		/(^|\/)makefile$/i.test(p) ||
		/\.(sh|bash|zsh)$/.test(p)
	) {
		return "scripts";
	}

	// 6. 配置环境与 CI/CD
	if (
		/(^|\/)tsconfig.*\.json$/.test(p) ||
		/(^|\/)\.[a-z0-9_-]+rc(\.[a-z0-9]+)?$/.test(p) ||
		/(^|\/)\.github\//.test(p) ||
		/(^|\/)\.omp\//.test(p) ||
		/(^|\/)\.gitignore$/.test(p) ||
		/(^|\/)\.env(\.[a-z0-9_-]+)?$/.test(p) ||
		/(^|\/)dockerfile/i.test(p) ||
		/(^|\/)docker-compose/i.test(p) ||
		/(^|\/)uno\.config\./.test(p) ||
		/(^|\/)tailwind\.config\./.test(p)
	) {
		return "config";
	}

	// 7. 静态资源
	if (
		/\.(png|jpe?g|gif|webp|svg|ico|icns|woff2?|ttf|eot|mp3|wav|ogg)$/.test(p) ||
		/(^|\/)public\//.test(p) ||
		/(^|\/)assets\//.test(p)
	) {
		return "assets";
	}

	// 8. 国际化多语言
	if (/(^|\/)locales?\//.test(p) || /(^|\/)i18n\//.test(p)) {
		return "i18n";
	}

	// 9. API / RPC / 契约通信
	if (
		/(^|\/)api\//.test(p) ||
		/(^|\/)routes?\//.test(p) ||
		/(^|\/)ipc(\.|\/)/.test(p) ||
		/(^|\/)rpc(\.|\/)/.test(p) ||
		/(^|\/)wire\//.test(p) ||
		/(^|\/)controllers?\//.test(p) ||
		/(^|\/)collab\//.test(p)
	) {
		return "api";
	}

	// 10. 数据模型与存储
	if (
		/(^|\/)models?\//.test(p) ||
		/(^|\/)schemas?\//.test(p) ||
		/(^|\/)db\//.test(p) ||
		/(^|\/)database\//.test(p) ||
		/(^|\/)store\//.test(p) ||
		/(^|\/)state\//.test(p) ||
		/\.sql$/.test(p)
	) {
		return "data";
	}

	// 11. 命令行 CLI
	if (/(^|\/)bin\//.test(p) || /(^|\/)cli(\.|\/)/.test(p) || /(^|\/)cmd\//.test(p)) {
		return "cli";
	}

	// 12. 前端界面与视图
	if (
		/\.(css|scss|sass|less|styl)$/.test(p) ||
		/(^|\/)components\//.test(p) ||
		/(^|\/)views\//.test(p) ||
		/(^|\/)styles\//.test(p) ||
		/(^|\/)pages\//.test(p) ||
		/\.(tsx|jsx|vue|svelte)$/.test(p)
	) {
		return "ui";
	}

	// 13. 核心业务代码（常规代码文件兜底）
	if (/\.(ts|js|py|rs|go|c|cpp|h|hpp|java|kt|swift|rb|php)$/.test(p)) {
		return "core";
	}

	return "other";
}
