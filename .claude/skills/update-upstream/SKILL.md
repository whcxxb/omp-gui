---
name: update-upstream
description: Synchronize omp-gui with upstream Oh My Pi (omp) CLI and @oh-my-pi/collab-web updates. Use whenever updating omp core, synchronizing collab-web components, adapting breaking RPC or UI props changes, or running e2e upgrade verification.
---

# Upstream Synchronization & Adaptation Guide

This skill guides the AI assistant through safely updating `omp-gui` when upstream `omp` (Oh My Pi) releases updates, whether in the CLI/RPC core or the `@oh-my-pi/collab-web` rendering layer.

## Architectural Boundaries

1. **`src/renderer/src/collab/` (Vendor Code - READ ONLY)**:
   - Synchronized exclusively via `pnpm sync:collab`.
   - **NEVER** edit files directly inside `src/renderer/src/collab/` (except `lib/client.ts` glue).
   - Upstream metadata (commit, version, timestamp) is recorded in `src/renderer/src/collab/UPSTREAM.json`.

2. **`src/main/` & `src/renderer/src/state/` (GUI Host - OWNED)**:
   - All adaptation, translation, and glue code belongs here.
   - `src/main/omp-rpc.ts`: Process management, Protocol v2 framing (`rpc_chunk`), stdin/stdout JSONL stream.
   - `src/renderer/src/state/threads.ts`: Frame state machine, notice handling, RPC command dispatch.
   - `src/renderer/src/components/ThreadView.tsx`: Adapts our `SessionEntry` stream into upstream `ToolView` / `Markdown`.

---

## Step-by-Step Update Workflow

### Step 1: Synchronize Upstream Components
Run the sync script to pull the target tag or the latest commit:

```bash
# Sync with latest master:
pnpm sync:collab

# Or sync with a specific version tag:
node scripts/sync-collab.mjs --tag v18.4.0

# Or sync from a local directory:
node scripts/sync-collab.mjs /tmp/oh-my-pi
```

The script automatically:
- Copies `tool-render`, `components/transcript`, `wire`, and styling tokens.
- Rewrites Monorepo internal paths (`@oh-my-pi/pi-wire` etc.) to local imports.
- Updates `src/renderer/src/collab/UPSTREAM.json`.

---

### Step 2: Static Type Repair (TypeScript as Guide)
Run typecheck to discover any changed props, renamed types, or altered structures:

```bash
pnpm typecheck
```

Common upstream breaking changes and fixes:
- **`ToolView` props change**: If upstream added required props or renamed `details`, update `src/renderer/src/components/ThreadView.tsx`.
- **Wire message format change**: If `SessionEntry` or `AssistantMessage` evolved, update the adapter in `src/renderer/src/state/threads.ts`.
- **Marked/KaTeX dependency shift**: Ensure any new external utilities are reflected in `package.json`.

Continue editing until `pnpm typecheck` returns zero errors.

---

### Step 3: RPC Protocol & Frame Adaptation (If CLI updated)
If `omp` CLI introduced new events, flags, or commands:
1. Compare `/tmp/oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-types.ts` with local `src/main/omp-rpc.ts` and `src/shared/ipc.ts`.
2. **Fail-Open Invariant**:
   - In `src/renderer/src/state/threads.ts` (`applyFrame`): unknown frames must default to `return null;` (never throw).
   - Unknown tools fall back automatically to `src/renderer/src/collab/tool-render/tools/generic.tsx`.
3. If new approval modes or CLI flags were added, update `src/main/omp-rpc.ts` and `src/renderer/src/components/Composer.tsx`.

---

### Step 4: Verification & E2E Gate
Before finishing, you **MUST** run the automated verification pipeline:

```bash
# 1. Typecheck
pnpm typecheck

# 2. Production build
pnpm build

# 3. End-to-end CDP smoke test
pnpm test:e2e
```

`pnpm test:e2e` automatically spawns the Electron app on CDP, verifies sidebar project rendering, session mounting, approval mode switching, and file drag-and-drop.

---

### Step 5: Git Commit
Once verified, commit with a clear conventional commit message:

```bash
git add .
git commit -m "chore(upstream): sync collab-web and adapt to omp <version>"
```
