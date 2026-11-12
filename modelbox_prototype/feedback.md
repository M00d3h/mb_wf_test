# LlamaFront / ModelBox — Code Review Feedback

## What's Done Well

- **Clean IPC architecture** — Handlers organized by domain (`server.ipc.ts`, `mcp.ipc.ts`, `profiles.ipc.ts`, etc.), preload mirrors the API surface, renderer uses typed `window.api` calls. No raw event-based IPC leaking into the renderer.
- **Tri-state profile fields** — `undefined` means "omit the flag" is handled correctly in `src/main/services/commandBuilder.ts` (lines 172-207). Custom command line system with `stripBuilderArgs` preserves user overrides.
- **Keytar keychain fallback** — `src/main/services/keychain.ts` gracefully falls back to in-memory store when keytar is unavailable, with no credential leaks.
- **Process log coalescing** — `src/main/services/processManager.ts` (lines 107-155) uses a 48ms flush timer to coalesce rapid stdout/stderr writes. Good UX.
- **Queue protection** — `src/main/services/serverQueue.ts` enforces one-at-a-time launches. `portsBeingStarted` set prevents concurrent duplicate port allocation.
- **Embedded schema** — Correctly uses `db.exec(SCHEMA)` (not `db.prepare` loop) as required by semicolons in triggers. Additive migrations with try/catch in `src/main/db/database.ts`.
- **vLLM WSL path handling** — `unwrapInnerArgs` / `unwrapShellLayers` in `src/main/services/vllmCommandBuilder.ts` is sophisticated for nested `wsl.exe bash -ic "..."` wrappers.

---

## HIGH PRIORITY

### 1. Massive code duplication in chatStore.ts (~600 lines)

`sendMessage` (lines 471-882) and `regenerateFrom` (lines 1068-1355) share nearly identical code:
- UI interval polling every 50ms
- TPS calculation
- Tool call handling with approval flow
- `think` block tracking
- Message persistence logic

**Fix:** Extract a shared `streamChat` helper that accepts conversation ID, message history, and a post-stream callback.

**Files:** `src/renderer/src/store/chatStore.ts`

---

### 2. No DB indexes on frequently filtered columns

Schema in `src/main/db/database.ts` (lines 55-131) defines tables without any indexes beyond primary keys. Queries filtering by `is_archived`, `conversation_id`, `model_id`, or `instance_kind` will do full table scans as data grows.

**Missing indexes:**
```sql
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_conversations_is_archived ON conversations(is_archived);
CREATE INDEX idx_conversations_model_id ON conversations(model_id);
CREATE INDEX idx_instances_kind ON server_instances(instance_kind);
```

**File:** `src/main/db/database.ts`

---

### 3. No React error boundaries

The renderer has no `<ErrorBoundary>` wrapping the app. A single unhandled promise rejection or render exception crashes the entire UI with a white screen — no "reload page" option in a desktop app.

**File:** `src/renderer/src/App.tsx` (or entry point)

---

## MEDIUM PRIORITY

### 4. WSL distro/username injected into shell commands

`src/main/services/runtimeManager.ts` parses WSL distro name and username from `wsl.exe --list --verbose` output, then interpolates directly into shell commands:

- Line 481, 496 — distro name in `wsl.exe -d ${distro} -- ...`
- Line 635 — distro name in `wsl.exe -d ${distro} -- python3 -c "..."`
- Line 655 — distro name in another `wsl.exe -d ${distro}` call
- Line 659 — username in path construction
- Line 762 — distro name in another command

A crafted distro name like `Ubuntu'; rm -rf /; '` would execute arbitrary commands.

**Fix:** Sanitize with a regex (`/^[a-zA-Z0-9._-]+$/`) or use `execFile` with positional arguments.

**File:** `src/main/services/runtimeManager.ts`

---

### 5. MCP args/env not type-validated after JSON.parse

`src/main/services/mcpManager.ts` (lines 182-185):
```typescript
const parsedArgs: string[] = config.args ? (JSON.parse(config.args) as string[]) : []
```

A malicious DB entry with `"args": {"key": "value"}` would pass `as string[]` even though it's an object. `StdioClientTransport` would receive malformed input.

**Fix:** Validate with `Array.isArray(parsedArgs)` after `JSON.parse`. Same for `env`.

**File:** `src/main/services/mcpManager.ts`

---

### 6. SSE transport Authorization header not validated

`src/main/services/mcpManager.ts` (line 196):
```typescript
if (config.token) headers['Authorization'] = `Bearer ${config.token}`
```

`config.token` comes from the user's MCP server config stored in the DB. Should be validated (e.g., not contain newlines) to prevent header injection.

**File:** `src/main/services/mcpManager.ts`

---

### 7. HuggingFace download: partial file cleanup on error

`src/main/services/huggingface.ipc.ts` (line 398): When a download fails, the meta file is written with `failed: message`, but files already downloaded in earlier loop iterations remain on disk. Subsequent resume attempts will find orphan files that may corrupt the download.

**Fix:** Clean up all partial files on failure, or remove them before resuming.

**File:** `src/main/ipc/huggingface.ipc.ts`

---

### 8. Log state syncs to Zustand on every log line

`src/renderer/src/store/serverStore.ts` (lines 102-127):
```typescript
onLogChunk: (line) => {
  set((s) => {
    const existing = s.logs[line.instanceId] ?? []
    if (line.replacesLast && existing.length > 0) { ... }
    const { replacesLast: _r, ...rest } = line
    return {
      logs: {
        ...s.logs,
        [line.instanceId]: [...existing, rest as LogLine].slice(-5000)
      }
    }
  })
}
```

During heavy output (e.g., vLLM weight loading), `[...existing, rest].slice(-5000)` creates a new array copy dozens of times per second. Consider a ref-backed buffer that only syncs to Zustand on state-change events (running, stopped, error).

**File:** `src/renderer/src/store/serverStore.ts`

---

## LOW PRIORITY

### 9. transportCache never evicts stale entries

`src/renderer/src/lib/transport.ts` (line 421):
```typescript
const transportCache = new Map<string, CacheEntry>()
```

Entries are never removed unless `clearTransportCache` is explicitly called. Over the lifetime of a long-running session with many port changes, the cache grows unbounded.

**File:** `src/renderer/src/lib/transport.ts`

---

### 10. No logging middleware on IPC handlers

When an IPC handler throws, Electron surfaces it as a rejection to the renderer, but the main process logs nothing beyond what the handler explicitly throws. Adding a try/catch wrapper in `src/main/ipc/index.ts` (lines 13-25) that logs the channel name, error, and stack would help debug production issues.

**File:** `src/main/ipc/index.ts`

---

### 11. VllmStore profile cache can become stale

`src/renderer/src/store/vllmStore.ts`: The `profiles: Record<string, VllmProfile[]>` cache is keyed by model ID. A DB trigger modifying an active profile won't automatically invalidate this cache. The `updateProfile` action calls `fetchProfiles` for the right model, but cross-store interactions (e.g., `mcpStore` triggering a full MCP reconnect) don't invalidate it.

**File:** `src/renderer/src/store/vllmStore.ts`

---

### 12. Docker extra args split by whitespace

`src/main/services/vllmCommandBuilder.ts` (lines 387, 421):
```typescript
args.push(...extra.split(/\s+/g).filter(Boolean));
```

If `dockerExtraArgs` contains values with spaces, they get split into separate arguments. Low risk since the user controls this setting, but worth noting.

**File:** `src/main/services/vllmCommandBuilder.ts`

---

## UNCOMMITTED CHANGES

### `src/main/db/database.ts` (line 49)

Adding `vllm-shards`, `vllm-compile`, and `vllm-cudagraph` to the list of states that are cleaned up on startup. This is a **good fix** — previously, a vLLM server that crashed during shard loading would leave a "zombie" `server_instance` record that persisted after restart.

---

## SUMMARY TABLE

| Priority | Issue | File | Lines |
|---|---|---|---|
| HIGH | Duplicated streaming logic (~600 lines) | `src/renderer/src/store/chatStore.ts` | 471-882, 1068-1355 |
| HIGH | No DB indexes on filter columns | `src/main/db/database.ts` | 55-131 |
| HIGH | No React error boundaries | `src/renderer/src/App.tsx` | — |
| MEDIUM | WSL distro/username shell injection | `src/main/services/runtimeManager.ts` | 481, 496, 635, 655, 762 |
| MEDIUM | MCP args/env not type-validated | `src/main/services/mcpManager.ts` | 182-185 |
| MEDIUM | SSE token not validated for injection | `src/main/services/mcpManager.ts` | 196 |
| MEDIUM | Partial HF download files not cleaned | `src/main/ipc/huggingface.ipc.ts` | 398 |
| MEDIUM | Log state syncs too frequently | `src/renderer/src/store/serverStore.ts` | 102-127 |
| LOW | transportCache never evicts | `src/renderer/src/lib/transport.ts` | 421 |
| LOW | No IPC logging middleware | `src/main/ipc/index.ts` | 13-25 |
| LOW | VllmStore cache can stale | `src/renderer/src/store/vllmStore.ts` | — |
| LOW | Docker args split by whitespace | `src/main/services/vllmCommandBuilder.ts` | 387, 421 |
