// Mnemopi 本地记忆库读取、全量知识图谱检索与增量变动检测
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	MemoryBankSummary,
	MemoryGraphData,
	MemoryGraphEdge,
	MemoryGraphNode,
	MemoryItem,
} from "@shared/ipc";

function getMnemopiBaseDir(): string {
	return join(homedir(), ".omp", "agent", "memories", "mnemopi");
}

function cleanBankName(dirName: string): string {
	return dirName.replace(/-[a-z0-9]{10,}$/, "");
}

/** 获取所有可用的 Memory Bank */
export function listAllBanks(): MemoryBankSummary[] {
	const baseDir = getMnemopiBaseDir();
	const banksDir = join(baseDir, "banks");
	const banks: MemoryBankSummary[] = [];

	if (existsSync(banksDir)) {
		try {
			const entries = readdirSync(banksDir);
			for (const bankDir of entries) {
				const dbPath = join(banksDir, bankDir, "mnemopi.db");
				if (existsSync(dbPath)) {
					let db: DatabaseSync | null = null;
					try {
						db = new DatabaseSync(dbPath, { readOnly: true });
						const factsRow = db.prepare("SELECT count(*) as c FROM facts").get();
						const factsCount = factsRow && typeof factsRow === "object" && "c" in factsRow && typeof factsRow.c === "number" ? factsRow.c : 0;
						const edgesRow = db.prepare("SELECT count(*) as c FROM graph_edges").get();
						const edgesCount = edgesRow && typeof edgesRow === "object" && "c" in edgesRow && typeof edgesRow.c === "number" ? edgesRow.c : 0;
						banks.push({
							id: bankDir,
							name: cleanBankName(bankDir),
							path: dbPath,
							factsCount,
							edgesCount,
						});
					} catch {
						// ignore broken db
					} finally {
						try {
							db?.close();
						} catch {}
					}
				}
			}
		} catch {}
	}

	const globalDb = join(baseDir, "mnemopi.db");
	if (existsSync(globalDb)) {
		let db: DatabaseSync | null = null;
		try {
			db = new DatabaseSync(globalDb, { readOnly: true });
			const factsRow = db.prepare("SELECT count(*) as c FROM facts").get();
			const factsCount = factsRow && typeof factsRow === "object" && "c" in factsRow && typeof factsRow.c === "number" ? factsRow.c : 0;
			const edgesRow = db.prepare("SELECT count(*) as c FROM graph_edges").get();
			const edgesCount = edgesRow && typeof edgesRow === "object" && "c" in edgesRow && typeof edgesRow.c === "number" ? edgesRow.c : 0;
			banks.unshift({
				id: "global",
				name: "global (全局知识库)",
				path: globalDb,
				factsCount,
				edgesCount,
			});
		} catch {} finally {
			try {
				db?.close();
			} catch {}
		}
	}

	return banks;
}

/** 根据工作区 cwd 或 bankId 定位其对应的 Mnemopi SQLite 存储路径 */
export function resolveBankDbPath(cwdOrBankId?: string): string | null {
	if (!cwdOrBankId) {
		const globalDb = join(getMnemopiBaseDir(), "mnemopi.db");
		return existsSync(globalDb) ? globalDb : null;
	}

	const baseDir = getMnemopiBaseDir();
	const banksDir = join(baseDir, "banks");

	// 1. 如果传的是直接文件夹名或 global
	if (cwdOrBankId === "global") {
		const globalDb = join(baseDir, "mnemopi.db");
		return existsSync(globalDb) ? globalDb : null;
	}

	const directDbPath = join(banksDir, cwdOrBankId, "mnemopi.db");
	if (existsSync(directDbPath)) return directDbPath;

	// 2. 如果传的是 cwd，模糊匹配项目前缀
	if (existsSync(banksDir)) {
		try {
			const base = basename(cwdOrBankId);
			const entries = readdirSync(banksDir);
			const matching = entries.filter(e => e.startsWith(base + "-"));
			if (matching.length > 0) {
				matching.sort((a, b) => {
					try {
						const statA = statSync(join(banksDir, a));
						const statB = statSync(join(banksDir, b));
						return statB.mtimeMs - statA.mtimeMs;
					} catch {
						return 0;
					}
				});
				const dbPath = join(banksDir, matching[0], "mnemopi.db");
				if (existsSync(dbPath)) return dbPath;
			}
		} catch {}
	}

	const globalDb = join(baseDir, "mnemopi.db");
	if (existsSync(globalDb)) return globalDb;
	return null;
}

/** 读取全量 OMP 记忆图谱与知识网络数据 */
export function getOverallMemoryOverview(currentCwd?: string): MemoryGraphData {
	const banks = listAllBanks();
	let totalFacts = 0;
	let totalEdges = 0;

	const allNodes: MemoryGraphNode[] = [];
	const allEdges: MemoryGraphEdge[] = [];
	const allMemories: MemoryItem[] = [];

	for (const bank of banks) {
		totalFacts += bank.factsCount;
		totalEdges += bank.edgesCount;

		// 银行根节点
		allNodes.push({
			id: `bank:${bank.id}`,
			label: bank.name,
			bankId: bank.id,
			bankName: bank.name,
			type: "bank",
		});

		let db: DatabaseSync | null = null;
		try {
			db = new DatabaseSync(bank.path, { readOnly: true });

			// 1. 抽取事实三元组 (Facts)
			const rawFacts = db.prepare(`
				SELECT fact_id as id, object as content, subject, predicate, created_at
				FROM facts
				ORDER BY created_at DESC
				LIMIT 100
			`).all() as Array<{
				id: string;
				content: string;
				subject?: string;
				predicate?: string;
				created_at: string;
			}>;

			for (const f of rawFacts) {
				const memoryItem: MemoryItem = {
					id: String(f.id),
					bankId: bank.id,
					bankName: bank.name,
					content: String(f.content ?? ""),
					subject: f.subject ? String(f.subject) : undefined,
					predicate: f.predicate ? String(f.predicate) : undefined,
					type: "fact",
					createdAt: String(f.created_at ?? ""),
				};
				allMemories.push(memoryItem);

				// 事实节点
				allNodes.push({
					id: `fact:${f.id}`,
					label: memoryItem.content.slice(0, 32),
					bankId: bank.id,
					bankName: bank.name,
					type: "fact",
					content: memoryItem.content,
					createdAt: memoryItem.createdAt,
				});

				// Bank 到 Fact 的关联边
				allEdges.push({
					source: `bank:${bank.id}`,
					target: `fact:${f.id}`,
					label: f.predicate || "contains",
				});
			}

			// 2. 抽取图谱边 (graph_edges)
			const rawEdges = db.prepare(`
				SELECT source, target, edge_type, weight
				FROM graph_edges
				LIMIT 60
			`).all() as Array<{
				source: string;
				target: string;
				edge_type: string;
				weight: number;
			}>;

			for (const ge of rawEdges) {
				allEdges.push({
					source: `fact:${ge.source}`,
					target: `fact:${ge.target}`,
					label: ge.edge_type,
					weight: ge.weight,
				});
			}
		} catch {
			// ignore query error
		} finally {
			try {
				db?.close();
			} catch {}
		}
	}

	return {
		banks,
		totalFacts,
		totalEdges,
		nodes: allNodes,
		edges: allEdges,
		memories: allMemories,
	};
}

/** 删除一条指定记忆 */
export function deleteMemoryItem(bankId: string, id: string, type: "fact" | "episode"): boolean {
	const dbPath = resolveBankDbPath(bankId);
	if (!dbPath) return false;

	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(dbPath);
		if (type === "fact") {
			db.prepare("DELETE FROM facts WHERE fact_id = ?").run(id);
			try {
				db.prepare("DELETE FROM fts_facts WHERE rowid NOT IN (SELECT rowid FROM facts)").run();
			} catch {}
		} else {
			db.prepare("DELETE FROM working_memory WHERE id = ?").run(id);
			try {
				db.prepare("DELETE FROM fts_working WHERE id = ?").run(id);
			} catch {}
		}
		return true;
	} catch (e) {
		console.error("Failed to delete memory:", id, e);
		return false;
	} finally {
		try {
			db?.close();
		} catch {}
	}
}

// 缓存各项目最后一次检测到的记忆 ID 集合，用于计算增量
const seenMemoryIdsByCwd = new Map<string, Set<string>>();

/**
 * 初始化或比对当前项目的记忆库差量。
 * 若有新记录写入，返回新产生的新记忆条目。
 */
export function detectNewMemories(cwd: string): MemoryItem[] {
	const dbPath = resolveBankDbPath(cwd);
	if (!dbPath) return [];

	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
		const rawFacts = db.prepare(`
			SELECT fact_id as id, object as content, subject, predicate, created_at
			FROM facts
			ORDER BY created_at DESC
			LIMIT 30
		`).all() as Array<{
			id: string;
			content: string;
			subject?: string;
			predicate?: string;
			created_at: string;
		}>;

		if (rawFacts.length === 0) return [];

		const bankName = cleanBankName(basename(cwd));
		const currentList: MemoryItem[] = rawFacts.map(f => ({
			id: String(f.id),
			bankId: basename(cwd),
			bankName,
			content: String(f.content ?? ""),
			subject: f.subject ? String(f.subject) : undefined,
			predicate: f.predicate ? String(f.predicate) : undefined,
			type: "fact",
			createdAt: String(f.created_at ?? ""),
		}));

		const seen = seenMemoryIdsByCwd.get(cwd);
		if (!seen) {
			seenMemoryIdsByCwd.set(cwd, new Set(currentList.map(m => m.id)));
			return [];
		}

		const newItems: MemoryItem[] = [];
		for (const item of currentList) {
			if (!seen.has(item.id)) {
				newItems.push(item);
				seen.add(item.id);
			}
		}

		return newItems;
	} catch {
		return [];
	} finally {
		try {
			db?.close();
		} catch {}
	}
}
