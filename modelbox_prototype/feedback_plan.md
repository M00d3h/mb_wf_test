# LlamaFront — Feedback Remediation Plan

All 12 issues in `feedback.md` are confirmed real and present. The verification also found
three additional issues not in the original document (see the end of this file).

One correction to the original report: **Issue 4 (WSL injection)** — lines 655 and 762 are
actually safe because they use `spawnAndStream` with a positional argv array. Only lines 496
and 635 are genuinely vulnerable.

---

## HIGH PRIORITY

---

### 1. Massive code duplication in chatStore.ts

**What:** `sendMessage` (471–882) and `regenerateFrom` (1068–1355) are ~700 lines of nearly
identical streaming logic: UI interval polling, TPS calculation, think-block tracking, tool call
approval flow, and message persistence.

**One difference to handle:** `sendMessage` accepts an `onToken` streaming callback;
`regenerateFrom` does not expose one. The shared helper must make this optional.

**Plan:**
1. Extract a `streamChat(options: StreamChatOptions): Promise<void>` helper inside
   `chatStore.ts` (keep it unexported — it is an internal implementation detail).
2. `StreamChatOptions` carries: `conversationId`, `messages`, `instanceUrl`, `apiKey`,
   `profileSettings`, optional `onToken`, and a `postStreamCallback` for the diverging
   post-completion logic (saving message, triggering title gen, etc.).
3. Move the shared interval loop, TPS logic, think-block tracking, tool call handling, and
   persistence into `streamChat`.
4. Rewrite `sendMessage` and `regenerateFrom` as thin wrappers that build the options object
   and call `streamChat`.
5. Run `npm run typecheck` and manually verify both send and regenerate paths in dev mode.

**File:** `src/renderer/src/store/chatStore.ts`

---

### 2. No DB indexes on frequently filtered columns

**What:** The schema has no indexes beyond primary keys. As messages and conversations grow,
`WHERE conversation_id = ?` and `WHERE is_archived = 0` will full-scan.

**Plan:**
1. Add a new additive migration entry in the `migrations` array in `database.ts`.
2. The migration runs the following CREATE INDEX statements (each inside its own try/catch
   so a re-run on an already-indexed DB is silently skipped, consistent with the existing
   migration pattern):

```sql
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_conversations_is_archived ON conversations(is_archived);
CREATE INDEX idx_conversations_model_id ON conversations(model_id);
CREATE INDEX idx_instances_kind ON server_instances(instance_kind);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
```

   The last one (`created_at`) is not in the original report but is needed for the default
   conversation list sort.
3. Test by opening a DB in `sqlite3` CLI and running `EXPLAIN QUERY PLAN` on the queries
   in `conversations.repo.ts` and `messages.repo.ts`.

**File:** `src/main/db/database.ts`

---

### 3. No React error boundaries

**What:** Any unhandled render exception causes a blank white screen with no recovery path.

**Plan:**
1. Create `src/renderer/src/components/ErrorBoundary.tsx` — a class component implementing
   `componentDidCatch`, showing a minimal "Something went wrong — reload" fallback UI with
   a button that calls `window.location.reload()`.
2. Wrap the entire app in `src/renderer/src/main.tsx` (outermost render) with
   `<ErrorBoundary>`.
3. Optionally also wrap each top-level `<Route>` element in `App.tsx` so a crash in one
   page doesn't take down the sidebar or settings panel.
4. No third-party library needed — a 30-line class component is sufficient.

**Files:** `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`

---

## MEDIUM PRIORITY

---

### 4. WSL distro/username shell injection

**What:** `distro` (from `wsl.exe --list --verbose` output) is interpolated into `execAsync`
template strings without sanitization.

**Verified vulnerable locations:**
- Line 496 — `execAsync(\`wsl.exe ${args.join(" ")}\`, ...)` where args contains `distro`
- Line 635 — `execAsync(\`wsl.exe -d ${distro} -- python3 ...\`, ...)`
- Lines 659–661 — `username` in path construction (lower-risk since it goes into a path
  string, not a shell command, but still worth sanitizing)

**Lines 655 and 762 are safe** — they already use `spawnAndStream("wsl.exe", ["-d", distro, ...])`,
which passes args as a positional array and avoids shell injection.

**Plan:**
1. Add a `sanitizeWslIdentifier(value: string): string` helper near the top of
   `runtimeManager.ts`:
   ```typescript
   function sanitizeWslIdentifier(value: string): string {
     if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
       throw new Error(`Invalid WSL identifier: "${value}"`)
     }
     return value
   }
   ```
2. Call it immediately after parsing distro name and username from `wsl.exe` output, before
   either value is used anywhere.
3. Convert lines 496 and 635 from `execAsync` template string interpolation to
   `spawnAndStream` / `execFile` with positional argv arrays, matching the safe pattern
   already used at lines 655 and 762.

**File:** `src/main/services/runtimeManager.ts`

---

### 5. MCP args/env not type-validated after JSON.parse

**What:** `JSON.parse(config.args) as string[]` uses a TypeScript assertion with no runtime
check. A DB row with `args = '{"key":"val"}'` would pass the type-check at compile time but
break `StdioClientTransport` at runtime.

**Plan:**
1. After `JSON.parse(config.args)`, add:
   ```typescript
   if (!Array.isArray(parsedArgs) || parsedArgs.some(a => typeof a !== 'string')) {
     throw new Error(`MCP server "${config.name}": args must be a JSON array of strings`)
   }
   ```
2. For `parsedEnv`, validate it is a plain object with string values:
   ```typescript
   if (typeof parsedEnv !== 'object' || parsedEnv === null || Array.isArray(parsedEnv) ||
       Object.values(parsedEnv).some(v => typeof v !== 'string')) {
     throw new Error(`MCP server "${config.name}": env must be a JSON object of string values`)
   }
   ```
3. Surface the error back to the renderer via the `mcp:status` event so the user sees a
   clear message rather than a silent failure.

**File:** `src/main/services/mcpManager.ts` (lines 182–185)

---

### 6. SSE token not validated for header injection

**What:** `config.token` is placed directly into the `Authorization` header value. A token
containing `\r\n` allows injecting arbitrary HTTP headers.

**Plan:**
1. Before using the token, strip or reject control characters:
   ```typescript
   if (config.token) {
     if (/[\r\n]/.test(config.token)) {
       throw new Error(`MCP server "${config.name}": token contains invalid characters`)
     }
     headers['Authorization'] = `Bearer ${config.token}`
   }
   ```
2. Consider the same check for `config.url` — pass it through `new URL(config.url)` (which
   already throws on malformed URLs) before using it; that is already done on line 196 so no
   extra work needed there.

**File:** `src/main/services/mcpManager.ts` (line 196)

---

### 7. HuggingFace download — partial file cleanup on error

**What:** When a multi-file download fails mid-loop, files successfully downloaded in earlier
iterations remain on disk. A subsequent resume may find orphan partial blobs.

**Plan:**
1. Collect `savedPaths` as the loop progresses (this likely already happens — verify).
2. In the catch block that handles non-abort errors, iterate over `savedPaths` and unlink
   each file using `fs.unlink` (wrapped in a try/catch to ignore already-deleted files).
3. Also delete the `.meta` file for the download so a fresh retry starts clean.
4. Alternatively, keep the files but mark them individually as "partial" in the meta so
   resume logic can detect and re-download only the failed shards. This is more complex but
   gives better UX for large multi-shard models.

   For now, the simpler full-cleanup approach is preferred.

**File:** `src/main/ipc/huggingface.ipc.ts`

---

### 8. Log state syncs to Zustand on every log line

**What:** Every log line calls `set(...)` on the Zustand store, spreading the entire logs
object and creating a new 5000-element array. Under heavy vLLM output this fires dozens of
times per second.

**Plan:**
1. Replace the per-line `set(...)` call with a **ref-backed buffer**: keep a module-level
   `Map<instanceId, LogLine[]>` in `serverStore.ts` (outside Zustand state).
2. On each `onLogChunk` event, push to the buffer map (O(1), no React re-render).
3. Use a debounced flush (e.g., `setTimeout(..., 80ms)` resetting on each push) that calls
   `set(...)` once with the buffered lines, then clears the buffer. The 80ms window is
   coarser than the existing 48ms process-manager flush, so the two effects compound rather
   than fight each other.
4. On `onServerStopped` and `onServerError`, flush immediately (no debounce) so the final
   state is always committed.
5. Keep the `-5000` cap logic in the flush, not the hot path.

**File:** `src/renderer/src/store/serverStore.ts`

---

## LOW PRIORITY

---

### 9. transportCache never evicts stale entries

**What:** `transportCache` (a module-level `Map`) grows for every unique `host:port` pair
over the app's lifetime. `clearTransportCache` exists but is only called from chatStore
immediately before a new message send/regenerate.

**Plan:**
1. Add a TTL to each cache entry: `{ transport, apiKey, createdAt: Date.now() }`.
2. In `resolveTransport`, before returning a cached entry, check
   `Date.now() - cached.createdAt > 30 * 60 * 1000` (30 minutes) and evict if stale.
3. Alternatively, call `clearTransportCache` whenever a server instance transitions to
   `stopped` or `error` state (from `serverStore`'s event handlers). This is more correct
   than a TTL because the transport is invalid the moment the server stops.

   Option 2 is preferred — it evicts at exactly the right time and requires only a small
   change in `serverStore.ts`.

**Files:** `src/renderer/src/lib/transport.ts`, `src/renderer/src/store/serverStore.ts`

---

### 10. No logging middleware on IPC handlers

**What:** When an IPC handler throws, the error propagates as a renderer-side rejection but
is never logged in the main process with the channel name or stack trace.

**Plan:**
1. Add a `wrapIpc` higher-order function in `src/main/ipc/index.ts`:
   ```typescript
   function wrapIpc<T>(
     channel: string,
     handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T>
   ) {
     return ipcMain.handle(channel, async (event, ...args) => {
       try {
         return await handler(event, ...args)
       } catch (err) {
         console.error(`[IPC] ${channel} failed:`, err)
         throw err  // re-throw so renderer still gets the rejection
       }
     })
   }
   ```
2. Replace all `ipcMain.handle(channel, handler)` calls across the ipc modules with
   `wrapIpc(channel, handler)`.
3. If a structured logger (e.g., electron-log) is added later, swap `console.error` for it
   — the wrapper centralizes the change to one place.

**File:** `src/main/ipc/index.ts` (and all `*.ipc.ts` modules)

---

### 11. VllmStore profile cache can become stale

**What:** `profiles: Record<string, VllmProfile[]>` is re-fetched by `updateProfile` and
`deleteProfile`, but not by `setActiveProfile` or `duplicateProfile` before the async IPC
call completes — leaving a brief window where the cache is inconsistent.

**Plan:**
1. After every mutating action (`setActiveProfile`, `duplicateProfile`, `deleteProfile`,
   `updateProfile`), ensure `fetchProfiles(modelId)` is always `await`ed before the action
   resolves.
2. Audit whether cross-store interactions can trigger a profile mutation without going
   through `vllmStore` — if so, subscribe to the relevant IPC push event
   (`vllm:profile-changed` or similar) and call `fetchProfiles` in response.
3. This is low-risk today but worth fixing before adding collaborative/sync features.

**File:** `src/renderer/src/store/vllmStore.ts`

---

### 12. Docker extra args split by whitespace

**What:** `extra.split(/\s+/g)` naively splits on whitespace, breaking any arg value that
contains a space (e.g., `--label my label`).

**Plan:**
1. Use a simple shell-quote parser. The `shell-quote` npm package (~1 KB, no deps) handles
   single-quoted, double-quoted, and escaped tokens correctly.
2. Replace `extra.split(/\s+/g).filter(Boolean)` with `shellQuote.parse(extra)` (which
   returns `string[]` directly).
3. If adding a dependency is undesirable, a hand-rolled parser that respects `'...'` and
   `"..."` is ~20 lines and sufficient for this use case.

**File:** `src/main/services/vllmCommandBuilder.ts` (lines 387, 421)

---

## ADDITIONAL ISSUES (not in original feedback.md)

---

### A. Missing `onToken` callback in `regenerateFrom`

**What:** `sendMessage` exposes an `onToken` callback parameter that streams each token to
the caller. `regenerateFrom` has no equivalent, so callers cannot receive token-by-token
streaming during regeneration. This appears to be an accidental omission rather than a
deliberate design choice.

**Plan:** When extracting the shared `streamChat` helper (Issue 1), ensure `onToken` is an
optional parameter and wire it through for both callers.

**File:** `src/renderer/src/store/chatStore.ts`

---

### B. Silent failure on background title generation

**What:** Title generation (chatStore.ts around line 967) runs as a fire-and-forget async
call. If it throws (e.g., server restarted between message send and title gen), the error is
silently swallowed with no log and no user notification.

**Plan:** Wrap the title generation `await` in a try/catch and log the failure to
`console.warn`. No user-visible toast is needed — a missing title is acceptable — but the
error should be observable.

**File:** `src/renderer/src/store/chatStore.ts`

---

### C. Null username fallback in WSL path construction

**What:** `getWslUsername(distro)` can return `null` (e.g., if `whoami` fails). The code
falls back to `/root/.cache/...` silently. This is functionally OK for root WSL installs but
could produce a confusing setup path for users with non-root distros where `/root` is not
writable.

**Plan:** Log a warning when `username` is null so it is visible in the runtime setup log.
No hard error needed since the fallback is intentional.

**File:** `src/main/services/runtimeManager.ts`

---

## Implementation Order

| Order | Issue | Priority | Effort |
|-------|-------|----------|--------|
| 1 | Issue 4 — WSL shell injection | MEDIUM (security) | Small |
| 2 | Issue 5 — MCP args type validation | MEDIUM (security) | Small |
| 3 | Issue 6 — SSE token header injection | MEDIUM (security) | Small |
| 4 | Issue 2 — DB indexes | HIGH | Small |
| 5 | Issue 3 — React error boundary | HIGH | Small |
| 6 | Issue 10 — IPC logging middleware | LOW | Small |
| 7 | Issue 7 — HF partial file cleanup | MEDIUM | Medium |
| 8 | Issue 8 — Log state debounce | MEDIUM | Medium |
| 9 | Issue 9 — transportCache eviction | LOW | Small |
| 10 | Issue 12 — Docker args whitespace | LOW | Small |
| 11 | Issue 11 — VllmStore cache staleness | LOW | Small |
| 12 | Issue 1 — chatStore deduplication | HIGH | Large |
| 13 | Issue A — onToken in regenerateFrom | — | Bundled with 12 |
| 14 | Issue B — Silent title gen failure | — | Trivial |
| 15 | Issue C — Null WSL username warning | — | Trivial |

Security fixes first (4, 5, 6), then quick wins (2, 3, 10), then medium effort items
(7, 8, 9, 12), then the large refactor (1) last to minimize review surface area per PR.

---

---

# Unit Test Plan

**Current state:** Zero test files, zero test dependencies, no test runner configured.

---

## Infrastructure Setup (do this first, before any test files)

### Package additions

```bash
npm install --save-dev vitest @vitest/coverage-v8 happy-dom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  msw
```

**Why Vitest over Jest:** The project already uses `electron-vite` (Vite-based). Vitest
reuses the same Vite config and module resolution (including `@shared`, `@main`, `@renderer`
path aliases) with zero extra glue. Jest requires `ts-jest` + a separate module-name-mapper
to replicate those aliases.

**`msw` (Mock Service Worker)** for network-level mocking of the OpenAI-compatible API
in transport tests — cleaner than mocking `fetch` directly.

### `vitest.config.ts` (new file at repo root)

```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',          // default for main/shared tests
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/main/services/**',
        'src/main/db/**',
        'src/renderer/src/store/**',
        'src/renderer/src/lib/**',
        'src/shared/**'
      ],
      exclude: ['src/main/ipc/**', 'src/preload/**']
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main':   resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
```

A second config block (or a `vitest.renderer.config.ts`) sets `environment: 'happy-dom'`
for renderer-side tests that use React or DOM APIs.

### `package.json` additions

```json
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage",
"test:ui":       "vitest --ui"
```

### `tsconfig.test.json` (new file — inherits from `tsconfig.json`)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  }
}
```

### Shared test helpers (`src/__tests__/helpers/`)

- **`makeDb.ts`** — creates an in-memory `better-sqlite3` database, runs the full schema +
  migrations from `database.ts`, and returns a teardown function. Used by all repo tests.
- **`makeProfile.ts`** — factory for `ProfileConfig` with sensible defaults. Avoids
  repetitive setup in command-builder tests.
- **`makeSettings.ts`** — factory for `AppSettings`.
- **`makeVllmConfig.ts`** — factory for `VllmModelConfig`.
- **`mockIpc.ts`** — stubs `window.api.*` for renderer store tests.

---

## Phase 1 — Pure Functions (no mocking required)

These tests can be written and run immediately once the infrastructure is in place.

---

### `src/main/services/commandLineParse.ts`

**What to test:**
- Empty string → `[]`
- Single unquoted token
- Multiple space-separated tokens
- Single-quoted string preserves inner spaces: `'foo bar'` → `['foo bar']`
- Double-quoted string: `"foo bar"` → `['foo bar']`
- Escaped space: `foo\ bar` → `['foo bar']`
- Escaped quote inside double-quoted string
- Mixed quoted and unquoted tokens in one string
- Trailing whitespace ignored
- Consecutive spaces collapse
- Unclosed quote — document expected behavior (throw or return partial)

**File:** `src/__tests__/services/commandLineParse.test.ts`
**Estimate:** 15–20 tests

---

### `src/shared/hostPortMatch.ts`

**What to test:**
- `127.0.0.1` matches `localhost`
- `localhost` matches `127.0.0.1`
- `0.0.0.0` matches `localhost`
- `0.0.0.0` matches `127.0.0.1`
- `::1` matches `localhost`
- Non-loopback address (`192.168.1.1`) does not match `localhost`
- Port mismatch returns false even when host matches
- Both host and port match → true

**File:** `src/__tests__/shared/hostPortMatch.test.ts`
**Estimate:** 10–12 tests

---

### `src/renderer/src/lib/serverInstanceMatch.ts`

**What to test:**
- Exact host:port match
- Loopback equivalence (via `hostPortMatch`)
- Instance in `stopped` state → no match
- Instance in `running` state with matching port → match
- Multiple instances, only one matches

**File:** `src/__tests__/lib/serverInstanceMatch.test.ts`
**Estimate:** 8–12 tests

---

### `src/renderer/src/lib/vllmModelPath.ts`

**What to test:**
- Windows absolute path → WSL path (`C:\foo\bar` → `/mnt/c/foo/bar`)
- Already-unix path returned unchanged
- Drive letter lowercase normalization
- Path with spaces
- Trailing slash handling
- UNC paths (`\\wsl$\Ubuntu\...`) round-trip

**File:** `src/__tests__/lib/vllmModelPath.test.ts`
**Estimate:** 12–15 tests

---

### `src/renderer/src/lib/modelCapabilities.ts`

**What to test (per capability flag):**
- Model names that should enable vision
- Model names that should not enable vision
- Thinking capability detection
- Tool use capability detection
- Speculative decoding capability
- Case insensitivity of model name matching
- Edge case: empty model name

**File:** `src/__tests__/lib/modelCapabilities.test.ts`
**Estimate:** 15–20 tests

---

### `src/main/services/commandBuilder.ts`

This is the highest-value pure-function target. The command builder assembles the argv
array passed to `llama-server`. A wrong flag silently breaks inference.

**What to test:**

*Basic flag assembly:*
- Context length flag (`--ctx-size N`) included when set, omitted when `undefined`
- GPU layers flag (`--ngl N`)
- Threads (`--threads N`)
- Model path (`-m /path/to/model.gguf`)
- Host and port (`--host 127.0.0.1 --port 8080`)
- Flash attention (`--flash-attn`)
- mmap disable (`--no-mmap`)
- All boolean flags: emit when `true`, omit when `false`, omit when `undefined`
- All numeric flags: emit when set, omit when `undefined`, do not emit `NaN` or empty string

*API key handling:*
- API key present → `--api-key KEY` in argv
- API key absent → no `--api-key` flag at all
- `maskArgsForDisplay()` replaces key value with `[MASKED]`
- Masked output does not contain the real key
- Masking works for both `--api-key KEY` and `--api-key=KEY` forms

*Custom command mode:*
- Custom command string parsed and merged correctly
- Builder-managed flags stripped from custom command before re-adding
- `stripBuilderArgs()` removes all known flags, preserves unknown flags
- Custom command with `--port` override respected
- Empty custom command falls back to builder output

*Edge cases:*
- Path with spaces on Windows (backslash escaping)
- All fields `undefined` → minimal valid command
- Profile with all fields set → full command

**File:** `src/__tests__/services/commandBuilder.test.ts`
**Estimate:** 40–50 tests

---

### `src/main/services/vllmCommandBuilder.ts`

The most complex pure-function target. Branches across docker, WSL+conda, WSL+venv,
native conda, native venv, and direct python paths.

**What to test:**

*Native venv path:*
- `venv` runtime → `. /path/to/venv/bin/activate && python -m vllm.entrypoints...`
- Port correctly injected
- Model path passed as `--model`
- All numeric params (tensor-parallel, max-model-len, etc.) included when set, omitted
  when `undefined`

*Docker path:*
- `docker` runtime → `docker run --rm -p PORT:PORT --gpus all IMAGE python -m vllm...`
- Volume mount for model directory included
- `dockerExtraArgs` appended after other docker flags
- Port collision detection (host port = container port)

*WSL conda path:*
- `wsl-conda` runtime → `wsl.exe bash -ic "conda activate ENV && python -m vllm..."`
- Conda env name shell-escaped correctly
- Distro name passed with `-d DISTRO`

*WSL venv path:*
- `wsl-venv` runtime → `wsl.exe bash -ic ". /path/venv/bin/activate && python ..."`
- WSL path translation applied to model path

*Shell escaping:*
- Model path with spaces escaped correctly in bash single-quote context
- Environment variables in extra args preserved
- JSON sampling params (speculative) not double-escaped

*Port patching:*
- Port replaced in nested shell script string
- Custom command containing hardcoded port gets patched

*`unwrapShellLayers`:*
- Strips one layer of `bash -ic "..."` wrapping
- Strips one layer of `wsl.exe -d D -- bash -c "..."`
- Does not strip non-shell wrapping
- Multiple layers unwrapped correctly

**File:** `src/__tests__/services/vllmCommandBuilder.test.ts`
**Estimate:** 55–70 tests

---

## Phase 2 — Database Repos (in-memory SQLite)

All repo tests share the `makeDb.ts` helper that creates a fresh in-memory database with
the real schema and migrations. No mocking of SQL — tests run against actual queries.

---

### `src/main/db/database.ts` — schema & migrations

**What to test:**
- Schema creates all expected tables (query `sqlite_master`)
- All foreign key constraints present
- Each migration runs exactly once (idempotent when re-run)
- Trigger: exactly one active profile per model (inserting a second active profile
  deactivates the first)
- WAL mode enabled (`PRAGMA journal_mode`)
- Startup state cleanup: zombie `vllm-shards`, `vllm-compile`, `vllm-cudagraph` rows
  are deleted on `initDb()`

**File:** `src/__tests__/db/database.test.ts`
**Estimate:** 15–20 tests

---

### `src/main/db/repos/models.repo.ts`

**What to test:**
- Insert model, retrieve by ID
- Case-insensitive path lookup on Windows (`C:\Models\foo.gguf` == `c:\models\foo.gguf`)
- Duplicate path insert: unique constraint enforced
- Delete model cascades to associated profiles
- List returns all models sorted correctly
- Update model fields

**File:** `src/__tests__/db/repos/models.repo.test.ts`
**Estimate:** 20–25 tests

---

### `src/main/db/repos/conversations.repo.ts`

**What to test:**
- Create conversation, list returns it
- Archive conversation → excluded from default list
- Unarchive → reappears in default list
- Search by title substring (case-insensitive)
- Delete conversation cascades to messages
- Conversation count per model
- Ordering by `updated_at` descending

**File:** `src/__tests__/db/repos/conversations.repo.test.ts`
**Estimate:** 20–25 tests

---

### `src/main/db/repos/messages.repo.ts`

**What to test:**
- Insert message, retrieve by conversation ID
- Message ordering (ascending by `created_at`)
- Delete message
- Update message content
- Token count fields round-trip correctly (null vs 0)

**File:** `src/__tests__/db/repos/messages.repo.test.ts`
**Estimate:** 12–15 tests

---

### `src/main/db/repos/serverInstances.repo.ts`

**What to test:**
- Insert instance, retrieve by ID
- Filter by `instance_kind` (llama vs vllm)
- State transitions: `starting` → `running` → `stopped`
- Upsert behavior (instance already exists)
- Delete cleans up record

**File:** `src/__tests__/db/repos/serverInstances.repo.test.ts`
**Estimate:** 12–15 tests

---

### `src/main/db/repos/settings.repo.ts`

**What to test:**
- Read default value when key not set
- Write + read round-trip for each setting type (string, number, boolean)
- Boolean stored as `0`/`1` integer, retrieved as boolean
- Path setting with backslashes preserved on Windows
- Unknown key returns `undefined`, not throws

**File:** `src/__tests__/db/repos/settings.repo.test.ts`
**Estimate:** 15–18 tests

---

### `src/main/db/repos/mcp.repo.ts`

**What to test:**
- Insert MCP server config, retrieve by ID
- Update transport type (`stdio` → `sse`)
- Delete removes record
- List returns all in insertion order
- `args` and `env` stored as JSON strings, retrieve unchanged

**File:** `src/__tests__/db/repos/mcp.repo.test.ts`
**Estimate:** 10–12 tests

---

## Phase 3 — Services with Mocks

---

### `src/main/services/healthPoller.ts`

Mock `fetch` to simulate:
- `/health` returns 200 → state transitions to `running`
- `/health` returns 503 → stays `loading`
- `/health` throws (ECONNREFUSED) → retries up to limit
- Poller stops when `stop()` called mid-poll
- `0.0.0.0` bind address converted to `127.0.0.1` for fetch URL

**File:** `src/__tests__/services/healthPoller.test.ts`
**Estimate:** 10–15 tests

---

### `src/main/services/keychain.ts`

Mock `keytar` to simulate:
- `keytar` available: set/get/delete round-trip
- `keytar` unavailable: fallback to in-memory store
- In-memory store isolated per test (no cross-test leakage)
- `deletePassword` on non-existent key → no error

**File:** `src/__tests__/services/keychain.test.ts`
**Estimate:** 10–12 tests

---

### `src/main/services/mcpManager.ts` — validation paths

Focus on the validation logic added by Issues 5 and 6, not the full transport lifecycle:
- Valid `args` JSON array → parsed without error
- `args` JSON that is an object → throws with clear message
- `args` JSON with non-string elements → throws
- `args` that is invalid JSON → throws
- `env` JSON that is an object of strings → valid
- `env` JSON that is an array → throws
- `token` with newlines → throws
- `token` without newlines → Authorization header set correctly

**File:** `src/__tests__/services/mcpManager.test.ts`
**Estimate:** 15–18 tests

---

### `src/main/services/runtimeManager.ts` — WSL injection guards

Focus on the sanitization added by Issue 4:
- Valid distro name (`Ubuntu`, `Ubuntu-22.04`) → passes
- Distro name with semicolon → throws
- Distro name with spaces → throws
- Distro name with shell special chars (`$`, `\``) → throws
- Username with valid chars → passes
- Username with path traversal (`../`) → throws

**File:** `src/__tests__/services/runtimeManager.test.ts`
**Estimate:** 10–12 tests (focused on sanitization, not the full runtime)

---

### `src/main/services/ggufMetadata.ts`

Use small synthetic binary fixtures (constructed in test setup) for:
- Valid GGUF magic + version → parses correctly
- Wrong magic bytes → throws `InvalidGGUFError`
- Correct context length extracted from metadata kv
- Correct vocab size extracted
- File truncated mid-header → throws
- Large metadata values (test 4-byte vs 8-byte length fields)

**File:** `src/__tests__/services/ggufMetadata.test.ts`
**Estimate:** 15–20 tests, with synthetic binary fixtures in `src/__tests__/fixtures/`

---

## Phase 4 — Transport Protocol

`transport.ts` is the only renderer-side file that contains significant pure protocol logic
testable without a DOM. Use `msw` to mock the OpenAI-compatible HTTP server.

### `src/renderer/src/lib/transport.ts`

**Token estimation:**
- `estimatePromptTokensFromMessages([])` → 0
- Single short message → approx token count (within 20% of actual)
- Long message → scales linearly
- Image messages → image token overhead accounted for

**Streaming (mock server with `msw`):**
- Normal SSE stream → tokens collected, final message assembled
- Stream aborted mid-way via `AbortSignal` → generator stops, no further tokens
- `[DONE]` sentinel terminates stream correctly
- Malformed SSE line (missing `data:` prefix) → skipped gracefully
- `reasoning_content` wrapped in `<think>...</think>`
- Newline-only chunks not double-counted in token TPS calc

**Tool call flow (mock server):**
- Single tool call in stream → `onToolCall` invoked with correct name + args
- Tool call result injected → second request made with result in messages
- Tool call denied → stream ends without second request
- Malformed tool call JSON in stream → handled without crash (error logged or skipped)

**Transport caching:**
- Same host:port + apiKey → returns cached transport
- Different apiKey → evicts and creates new transport
- `clearTransportCache` removes entry
- After server stops (Issue 9 fix) → entry evicted

**File:** `src/__tests__/lib/transport.test.ts`
**Estimate:** 40–50 tests

---

## Phase 5 — Zustand Stores (renderer)

Stores require mocked `window.api` IPC calls. Use `mockIpc.ts` helper that replaces
`window.api` with a `vi.fn()`-backed stub before each test and restores after.

---

### `src/renderer/src/store/serverStore.ts` — log buffering (Issue 8)

After the debounced-flush refactor:
- 10 rapid `onLogChunk` calls → single Zustand `set` called (debounce works)
- Logs appear in store after flush interval
- `onServerStopped` triggers immediate flush (no debounce)
- 5001 log lines → store holds at most 5000 (cap enforced)
- `replacesLast: true` replaces the last line, not appends

**File:** `src/__tests__/store/serverStore.test.ts`
**Estimate:** 12–15 tests

---

### `src/renderer/src/store/chatStore.ts`

This is the largest and most important store test. After the `streamChat` refactor (Issue 1),
the shared helper can be tested directly.

**Message sending:**
- `sendMessage` persists user message before streaming
- Draft conversation promoted to real conversation on first send
- Abort signal cancels the stream mid-generation
- TPS calculation: tokens / elapsed seconds (mock timer)

**Streaming state:**
- `isStreaming` set to `true` during stream, `false` after
- Think-block open/close tracked correctly (`<think>...</think>`)
- Pause/resume tracking (when tool approval requested)
- Token count accumulated and persisted to message row

**Title generation:**
- Title gen IPC called after first assistant message
- Title gen aborted when new message arrives before it completes
- Title gen failure (IPC throws) → `console.warn`, no crash

**Regeneration:**
- `regenerateFrom` replaces assistant message from given index
- Regeneration uses same streaming path as sendMessage
- `onToken` callback fires for both send and regenerate (Issue A fix)

**Tool calls:**
- `onToolCall` triggers approval UI state
- Denied tool call ends stream
- Approved tool call continues with tool result injected

**File:** `src/__tests__/store/chatStore.test.ts`
**Estimate:** 60–80 tests

---

### `src/renderer/src/store/vllmStore.ts` — cache invalidation (Issue 11)

- `updateProfile` awaits `fetchProfiles` before resolving
- `setActiveProfile` calls `fetchProfiles` and cache is fresh after
- `duplicateProfile` invalidates correct model's cache
- No stale profile returned after mutating action completes

**File:** `src/__tests__/store/vllmStore.test.ts`
**Estimate:** 10–12 tests

---

## Phase 6 — Security-Focused Regression Tests

These tests specifically verify the fixes from the feedback issues. They should be written
at the same time as the fixes so the fix cannot be accidentally reverted.

| Fix | Test file | Key assertions |
|-----|-----------|---------------|
| Issue 4 — WSL sanitization | `runtimeManager.test.ts` | Shell metachar in distro name throws |
| Issue 5 — MCP args validation | `mcpManager.test.ts` | Non-array args throws with message |
| Issue 6 — SSE token validation | `mcpManager.test.ts` | `\r\n` in token throws |
| Issue 7 — HF cleanup | `huggingface.cleanup.test.ts` | Partial files deleted on failure |
| Issue 2 — DB indexes | `database.test.ts` | `EXPLAIN QUERY PLAN` uses index |

---

## Test File Layout

```
src/
  __tests__/
    helpers/
      makeDb.ts
      makeProfile.ts
      makeSettings.ts
      makeVllmConfig.ts
      mockIpc.ts
    fixtures/
      minimal.gguf          (synthetic 64-byte binary fixture)
      truncated.gguf
    shared/
      hostPortMatch.test.ts
    services/
      commandBuilder.test.ts
      vllmCommandBuilder.test.ts
      commandLineParse.test.ts
      healthPoller.test.ts
      keychain.test.ts
      mcpManager.test.ts
      runtimeManager.test.ts
      ggufMetadata.test.ts
    db/
      database.test.ts
      repos/
        models.repo.test.ts
        conversations.repo.test.ts
        messages.repo.test.ts
        serverInstances.repo.test.ts
        settings.repo.test.ts
        mcp.repo.test.ts
    lib/
      transport.test.ts
      vllmModelPath.test.ts
      modelCapabilities.test.ts
      serverInstanceMatch.test.ts
    store/
      chatStore.test.ts
      serverStore.test.ts
      vllmStore.test.ts
```

---

## Coverage Targets

| Tier | Modules | Line coverage goal |
|------|---------|-------------------|
| Must-have | commandBuilder, vllmCommandBuilder, commandLineParse, hostPortMatch | ≥ 90% |
| Must-have | DB repos, database schema/migrations | ≥ 85% |
| Must-have | transport.ts (protocol logic) | ≥ 85% |
| Should-have | chatStore (post-refactor streamChat) | ≥ 75% |
| Should-have | serverStore, vllmStore | ≥ 75% |
| Should-have | ggufMetadata, keychain, healthPoller | ≥ 75% |
| Nice-to-have | runtimeManager (sanitization paths only) | ≥ 60% |
| Excluded | IPC handlers, preload | — (integration layer) |
| Excluded | runtimeManager (I/O paths) | — (integration tests) |

---

## Estimated Test Count Summary

| Phase | Area | Tests |
|-------|------|-------|
| 1 | Pure functions (commandBuilder, vllmCommandBuilder, parsers, path utils) | 170–220 |
| 2 | DB repos + schema | 105–130 |
| 3 | Services with mocks (healthPoller, keychain, mcpManager, ggufMetadata) | 50–65 |
| 4 | Transport protocol | 40–50 |
| 5 | Zustand stores | 85–110 |
| 6 | Security regression | 20–25 |
| **Total** | | **~470–600 tests** |

---

## Updated Implementation Order (combining bug fixes + tests)

| Step | Work | Type |
|------|------|------|
| 1 | Add vitest + testing-library + msw, create `vitest.config.ts` | Infra |
| 2 | Write `makeDb.ts`, `makeProfile.ts`, factory helpers | Infra |
| 3 | commandBuilder + commandLineParse tests (Phase 1) | Tests |
| 4 | Fix Issue 4 (WSL injection) + add sanitizer tests | Fix + Test |
| 5 | Fix Issue 5 + 6 (MCP validation) + tests | Fix + Test |
| 6 | Fix Issue 2 (DB indexes) + schema/migration tests (Phase 2) | Fix + Test |
| 7 | Remaining repo tests | Tests |
| 8 | Fix Issue 3 (ErrorBoundary) | Fix |
| 9 | vllmCommandBuilder tests (Phase 1) | Tests |
| 10 | Fix Issue 10 (IPC logging middleware) | Fix |
| 11 | Fix Issue 7 (HF cleanup) + test | Fix + Test |
| 12 | Transport + hostPortMatch tests (Phase 4) | Tests |
| 13 | Fix Issue 8 (log debounce) + serverStore tests (Phase 5) | Fix + Test |
| 14 | Fix Issue 9 (transportCache eviction) | Fix |
| 15 | Fix Issue 12 (docker args) | Fix |
| 16 | Fix Issue 11 (vllmStore staleness) + store tests | Fix + Test |
| 17 | Fix Issue 1 (chatStore refactor) + chatStore tests | Fix + Test |
| 18 | ggufMetadata, keychain, healthPoller tests (Phase 3) | Tests |
| 19 | Security regression tests (Phase 6) | Tests |
