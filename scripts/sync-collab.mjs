// 从 oh-my-pi 官方仓库同步 collab-web 的渲染层代码到 src/renderer/src/collab。
// 用法：pnpm sync:collab [本地仓库路径]；不传路径时浅克隆到临时目录。
// 只同步纯渲染代码，并把 monorepo 内部包的导入改写为本地路径。
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DEST = join(ROOT, "src/renderer/src/collab");
const REPO_URL = "https://github.com/can1357/oh-my-pi.git";

let tag = null;
let repo = null;
for (let i = 2; i < process.argv.length; i++) {
	if (process.argv[i] === "--tag" || process.argv[i] === "-t") {
		tag = process.argv[++i];
	} else if (!repo && !process.argv[i].startsWith("-")) {
		repo = resolve(process.argv[i]);
	}
}

if (!repo) {
	repo = join(mkdtempSync(join(tmpdir(), "omp-src-")), "oh-my-pi");
	const cloneArgs = ["clone", "--depth", "1", "-q"];
	if (tag) cloneArgs.push("--branch", tag);
	cloneArgs.push(REPO_URL, repo);
	execFileSync("git", cloneArgs, { stdio: "inherit" });
}
const WEB = join(repo, "packages/collab-web/src");
if (!existsSync(WEB)) throw new Error(`找不到 collab-web 源码：${WEB}`);

// [源路径（相对 collab-web/src 或仓库根）, 目标路径（相对 DEST）]
const COPIES = [
	["tool-render", "tool-render"],
	["components/transcript", "components/transcript"],
	["lib/format.ts", "lib/format.ts"],
	["styles/base.css", "styles/base.css"],
	["styles/tokens.css", "styles/upstream-tokens.css"],
];
const EXTRA = [
	[join(repo, "packages/wire/src/index.ts"), "wire/index.ts"],
	[join(repo, "packages/wire/src/stream.ts"), "wire/stream.ts"],
	[join(repo, "packages/wire/src/tsp.ts"), "wire/tsp.ts"],
	[join(repo, "packages/utils/src/math-delimiters.ts"), "math-delimiters.ts"],
];
// 本地维护、同步时保留的文件
const KEEP = new Set(["lib/client.ts", "README.md"]);

for (const name of readdirSync(DEST, { withFileTypes: true }).map(d => d.name)) {
	if (existsSync(join(DEST, name)) && !KEEP.has(name) && name !== "lib") rmSync(join(DEST, name), { recursive: true });
}
if (existsSync(join(DEST, "lib"))) {
	for (const f of readdirSync(join(DEST, "lib"))) if (!KEEP.has(`lib/${f}`)) rmSync(join(DEST, "lib", f));
}

for (const [from, to] of COPIES) {
	mkdirSync(dirname(join(DEST, to)), { recursive: true });
	cpSync(join(WEB, from), join(DEST, to), { recursive: true });
}
for (const [from, to] of EXTRA) {
	mkdirSync(dirname(join(DEST, to)), { recursive: true });
	cpSync(from, join(DEST, to));
}

function rel(fromFile, target) {
	let p = relative(dirname(fromFile), join(DEST, target));
	if (!p.startsWith(".")) p = `./${p}`;
	return p;
}

function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full);
		else if (/\.(ts|tsx)$/.test(entry)) {
			let src = readFileSync(full, "utf8");
			let out = src
				.replaceAll('"@oh-my-pi/pi-wire"', `"${rel(full, "wire/index")}"`)
				.replaceAll('"@oh-my-pi/pi-utils/marked"', '"marked"')
				.replaceAll('"@oh-my-pi/pi-utils/math-delimiters"', `"${rel(full, "math-delimiters")}"`);
			if (full.endsWith("math.ts")) {
				out = out
					.replace("startFrom: mathStartIndex,", "start(source) {\n				return mathStartIndex(source);\n			},")
					.replace("mathSpanInContext(this, source)", "mathSpanInContext(this as any, source)")
					.replace("mathBlockInContext(this, source)", "mathBlockInContext(this as any, source)");
			}
			if (out !== src) writeFileSync(full, out);
		}
	}
}
walk(DEST);

const commit = execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"]).toString().trim();
const version = JSON.parse(readFileSync(join(repo, "packages/coding-agent/package.json"), "utf8")).version;
writeFileSync(join(DEST, "UPSTREAM.json"), `${JSON.stringify({ repo: REPO_URL, commit, ompVersion: version, syncedAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`已同步 collab-web（omp ${version} @ ${commit}）到 ${relative(ROOT, DEST)}`);
