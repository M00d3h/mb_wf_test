# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start dev mode (hot reload for main + renderer)
npm run build         # Full build (typecheck + electron-vite bundle)
npm run build:win     # Windows installer via electron-builder
npm run typecheck     # Run both node + web TypeScript checks
npm run typecheck:node  # Check main/preload/shared only
npm run typecheck:web   # Check renderer only
npm run lint          # ESLint
npm run format        # Prettier
npm run rebuild       # Rebuild native modules (better-sqlite3, keytar) — required after npm install
```

## Architecture

LlamaFront is an Electron desktop app with three separate process bundles:

- **Main** (`src/main/`) — Node.js process: SQLite, IPC handlers, child process management, services
- **Preload** (`src/preload/index.ts`) — Context bridge: exposes typed `window.api` to renderer
- **Renderer** (`src/renderer/src/`) — React 18 app: pages, Zustand stores, chat transport

Communication path: Renderer calls `window.api.*` (via `src/renderer/src/lib/ipc.ts`) → IPC channel → Main handler → response. Events flow back via `ipcMain.emit` / `mainWindow.webContents.send`.

### IPC Structure

All handlers are registered in `src/main/ipc/index.ts` and grouped into modules (`models.ts`, `profiles.ts`, `server.ts`, `chat.ts`, `settings.ts`, `hf.ts`, `system.ts`). The preload mirrors the same namespaces. When adding a new IPC handler:
1. Add handler in `src/main/ipc/<module>.ts`
2. Add channel to preload `contextBridge` in `src/preload/index.ts`
3. Add typed wrapper in `src/renderer/src/lib/ipc.ts`

### Database

SQLite via better-sqlite3 (synchronous). The singleton is in `src/main/db/database.ts`. Schema is embedded as a string literal (`SCHEMA`) and executed with `db.exec(SCHEMA)` — do not use `db.prepare().run()` for schema (triggers contain semicolons that break statement preparation). Additive migrations live in an array in the same file and run once on startup.

Repos in `src/main/db/repos/` are plain functions returning typed objects. No ORM.

### Server Lifecycle

```
enqueue → portCheck → commandBuilder → processManager.startProcess()
→ healthPoller (3s /health polls) → state: starting → loading → running
→ process exit → state: stopped | error
```

- `serverQueue.ts` enforces one-at-a-time launches (GPU protection)
- `commandBuilder.ts` handles tri-state profile fields: `undefined` = omit flag entirely, not pass a default
- `processManager.ts` maintains a ring buffer (~5000 lines) per instance, streams logs via `server:log-chunk` events, coalesces rapid writes (48ms flush)
- Health poller converts `0.0.0.0` bind address to `127.0.0.1` for HTTP checks

### Chat Transport

`src/renderer/src/lib/transport.ts` has two transports selected by `resolveTransport()`:
- **OpenAICompatTransport** — primary, uses `v1/chat/completions`, handles images and `reasoning_content` (wraps in `<think>...</think>`)
- **LlamaCppNativeTransport** — fallback for `/completion` endpoint

Title generation runs in the background after the first assistant response and is aborted if a new message arrives (to free the server slot).

### State Management

Zustand stores in `src/renderer/src/store/`:
- `chatStore` — active conversation, messages, streaming state, title gen
- `serverStore` — instances, logs per instance, queue, event subscriptions
- `modelsStore` — model list, scan state
- `settingsStore` — app settings (paths, CUDA config)
- `hfDownloadStore` — active HF downloads
- `themeStore` — light/dark preference

### Key Constraints

- **Tri-state profile fields**: `undefined` = omit CLI flag, never pass empty string as value
- **API keys**: stored in system keychain via `keytar`, never in DB or config
- **Active profile**: DB trigger enforces exactly one active profile per model
- **Native modules**: `better-sqlite3` and `keytar` are externalized (not bundled) and must be rebuilt with `npm run rebuild` after `npm install` or Electron version changes
- **TypeScript paths**: `@shared` resolves to `src/shared/`, `@main` to `src/main/`, `@renderer` to `src/renderer/src/` — use these everywhere, not relative paths across process boundaries

### Path Aliases (electron.vite.config.ts)

| Alias | Resolves to |
|---|---|
| `@shared` | `src/shared/` (all processes) |
| `@main` | `src/main/` (main only) |
| `@renderer` | `src/renderer/src/` (renderer only) |
