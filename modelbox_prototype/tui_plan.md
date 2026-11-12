# ModelBox TUI Implementation Plan

## Context

Build a Python Textual TUI providing full feature parity with the ModelBox Electron GUI. The TUI shares the same SQLite database (`%APPDATA%\llamafront\llamafront.db`) for seamless sync, independently manages server processes, and handles chat with streaming SSE. All TUI code lives in `/tui`. The user installs nothing — the TUI is bundled as a PyInstaller binary in the Electron installer (`resources/tui/`).

Reference: `C:\Users\mohda\.vscode\coding_agent` for Textual UI patterns (layout, chat panel, status bar). **Do not copy its code** — use it as a design reference only. Backend logic must match the GUI (`src/main/services/`, `src/renderer/src/lib/transport.ts`).

**Design constraints**: No nerd font icons. Standard dark theme (clean slate/gray palette, blue accent — not Catppuccin/Monokai).

---

## File Structure

```
tui/
├── main.py                          # Entry: python -m tui or llamafront-tui CLI
├── __init__.py
├── app.py                           # ModelBoxApp(Textual App) + ContentSwitcher
├── sidebar.py                       # Navigation sidebar (plain text labels, $accent left border on active)
├── status_bar.py                    # Bottom bar: server count, queue, tokens
├── styles.tcss                      # Standard dark theme palette, layout
├── db/
│   ├── connection.py                # SQLite singleton, WAL, same path as GUI
│   ├── schema.py                    # CREATE TABLE + migrations (from database.ts)
│   ├── models_repo.py
│   ├── profiles_repo.py
│   ├── conversations_repo.py
│   ├── messages_repo.py
│   ├── instances_repo.py
│   ├── settings_repo.py
│   ├── folders_repo.py
│   ├── mcp_repo.py
│   ├── vllm_models_repo.py
│   └── vllm_profiles_repo.py
├── models/
│   ├── screen.py                    # ModelsScreen: ModelList + ModelDetail + ProfileList
│   ├── model_list.py                # Searchable list, selection event
│   ├── model_detail.py              # Path, metadata, tags
│   ├── profile_list.py              # Profile CRUD, set-active
│   ├── profile_editor.py            # Full-screen form (push_screen) for all ProfileConfig fields
│   └── scanner.py                   # Walk dirs, find .gguf, upsert to DB
├── chat/
│   ├── screen.py                    # ChatScreen: ConversationList + MessageThread + InputPanel
│   ├── conversation_list.py         # Select, rename, delete, archive, folder group
│   ├── message_thread.py            # VerticalScroll of message widgets, auto-scroll
│   ├── message_widgets.py           # UserMessage, AssistantMessage, ThinkingBlock, ToolCall, StreamingMessage
│   ├── input_panel.py               # Input + model picker + params toggle
│   ├── transport.py                 # aiohttp SSE chat (OpenAI compat + llama.cpp native fallback)
│   └── markdown_render.py           # markdown-it-py -> Rich renderables (code blocks, tables, inline)
├── server/
│   ├── screen.py                    # ServerScreen: InstanceTable + LogViewer + QueueView
│   ├── instance_table.py            # DataTable: model, profile, host:port, state, actions
│   ├── log_viewer.py                # Ring-buffered log (5000 lines), auto-scroll, pause
│   ├── queue_view.py                # Pending launches, cancel
│   ├── process_manager.py           # asyncio subprocess, health poll, queue engine, vLLM stdout parse
│   └── command_builder.py           # llama.cpp CLI flags + vLLM serve (conda/venv/docker/WSL)
├── settings/
│   ├── screen.py                    # Tabbed form: Paths, Networking, vLLM Runtime, Appearance
│   └── forms.py                     # Reusable: DirectoryPicker, PortInput, EnumSelect
├── huggingface/
│   ├── screen.py                    # Search + repo browser + download progress
│   ├── search_view.py               # Query input, sort, results list, pagination
│   ├── repo_browser.py              # File tree, GGUF/safetensors coalescing, download button
│   ├── download_manager.py          # Range downloads, .partial, resume, pause, abort
│   └── hub_client.py                # aiohttp client for huggingface.co/api
├── mcp/
│   ├── screen.py                    # Server list + editor + tool list
│   ├── server_list.py               # Enabled toggle, status indicator
│   ├── server_editor.py             # Form: name, transport, command/args/url, env, token
│   ├── tool_list.py                 # Flat tool list grouped by server
│   └── mcp_client.py                # MCP SDK client manager (stdio/sse/http)
└── folders/
    └── screen.py                    # CRUD, conversation count, assign
```

---

## Architecture Notes

### Data Layer
- **Path**: `%APPDATA%\llamafront\llamafront.db` (same as GUI)
- **Connection**: `sqlite3.connect(path, check_same_thread=False)` in WAL mode
- **Schema**: Verbatim SQL from `src/main/db/database.ts:55-131` + migrations. Python `sqlite3` understands it identically
- **Repos**: Each `*_repo.py` mirrors TS repo 1:1, returns `dict` via `sqlite3.Row`
- **JSON fields**: `json.dumps()` / `json.loads()` for profile config, chat params, vLLM config

### Keychain
- GUI uses `keytar` with service `'llamafront'`
- Python uses `keyring` (same Windows Credential Manager)
- `keyring.set_password("llamafront", profile_id, api_key)` — cross-compatible with GUI

### Server Management
- `asyncio.create_subprocess_exec()` with `CREATE_NO_WINDOW` on Windows
- Health poll: `aiohttp` GET `/health` every 3s
- vLLM stdout: parse for granular states (shards, compile, cudagraph)
- Queue: `deque`-based, one-at-a-time
- Stop: `process.kill()` + `taskkill /F /PID` fallback
- Logs: `deque(maxlen=5000)` ring buffer

### Chat Transport
- Primary: `aiohttp` POST `/v1/chat/completions` with `stream: true`
- SSE parse: line-by-line, `data:` prefix, JSON
- Reasoning: `reasoning_content` + `reasoning` (vLLM) -> ThinkingBlock
- Tool calls: multi-turn loop via MCP client
- Fallback: `/completion` (llama.cpp native)

### UI Layout
```
+----------------------------------------------------+
|  AppBar: ModelBox                                   |
+--------+-------------------------------------------+
|        |                                           |
| Sidebar|        ContentSwitcher                    |
|        |                                           |
| Models |   Active view:                            |
| Server |   models-view / server-view / chat-view   |
| Chat   |                                           |
| Settings|                                          |
| HuggingF|                                          |
| MCP    |                                           |
| Folders|                                           |
|        |                                           |
+--------+-------------------------------------------+
|  StatusBar: view  servers:2  queue:1  ctx 12k/200k |
+----------------------------------------------------+
```
- **Sidebar**: ~20 char width, text labels only (no icons), left border indicator on active
- **Navigation**: Keys 1-7 for views, q to quit
- **Mouse**: Click sidebar items, click table rows, click buttons

### Theme — Standard Dark with App Cyan-Blue Accent

Matches the GUI's primary/accent color: `hsl(185, 80%, 60%)` = `#06b6d4` (bright cyan-blue, also used in the app's think-shimmer gradient as `rgb(6, 182, 212)`). Dark backgrounds from the GUI's zinc scale.

```tcss
#define $bg           #141414       # GUI --background: HSL(222,20%,10%)
#define $surface      #212121       # GUI --card: HSL(222,20%,13%)
#define $surface-up   #27272a       # Slightly lighter surface
#define $border       #333333       # GUI --border: HSL(222,20%,20%)
#define $input-bg     #1c1c1c       # GUI --input: HSL(222,20%,16%)
#define $text         #e0e0e0       # GUI --foreground: HSL(210,20%,93%)
#define $text-dim     #888888       # GUI --muted-foreground
#define $accent       #06b6d4       # GUI --primary/--accent: HSL(185,80%,60%)
#define $accent-dim   #0897b5       # Slightly darker accent for borders
#define $green        #22c55e
#define $yellow       #eab308
#define $red          #ef4444
#define $white        #ffffff
```

Same cyan-blue accent (`#06b6d4`) throughout: sidebar active indicator, buttons, links, focus rings, progress bars, chat input border. Dark backgrounds match the GUI's zinc-900/950 range. No nerd font icons — plain text labels, standard Unicode symbols where helpful.

---

## Dependencies

```toml
[project]
name = "llamafront-tui"
requires-python = ">=3.11"
dependencies = [
    "textual>=0.80.0",
    "rich>=13.7.0",
    "aiohttp>=3.9.0",
    "markdown-it-py>=3.0.0",
    "mdit-py-plugins>=0.4.0",
    "keyring>=24.0.0",
    "mcp>=1.0.0",
    "pyperclip>=1.8.0",
]
```

## Packaging
- PyInstaller: `tui/main.py` -> `modelbox-tui.exe`
- Electron: binary in `resources/tui/` (already unpacked by `asarUnpack: resources/**`)
- Standalone: `pip install -e .` -> `llamafront-tui` CLI

---

## Implementation Checklist

### P1 — Foundation + Models + Server

- [x] `tui/__init__.py`, `tui/main.py` — Package init, entry point
- [x] `tui/pyproject.toml` — Dependencies, project metadata
- [x] `tui/styles.tcss` — Dark theme palette, base layout
- [x] `tui/app.py` — ModelBoxApp with ContentSwitcher (7 views), ProcessManager wired
- [x] `tui/sidebar.py` — Navigation sidebar (text labels, keyboard shortcuts)
- [x] `tui/status_bar.py` — Bottom status bar (set_status() API)
- [x] `tui/db/connection.py` — SQLite singleton, WAL, path resolution
- [x] `tui/db/schema.py` — Schema + migrations from database.ts
- [x] `tui/db/settings_repo.py` — Settings CRUD
- [x] `tui/db/models_repo.py` — Models CRUD
- [x] `tui/db/profiles_repo.py` — Profiles CRUD
- [x] `tui/db/instances_repo.py` — Server instances CRUD
- [x] `tui/models/scanner.py` — GGUF file scanner
- [x] `tui/models/model_list.py` — Searchable model list widget
- [x] `tui/models/model_detail.py` — Model metadata display
- [x] `tui/models/profile_list.py` — Profile list with CRUD actions
- [x] `tui/models/profile_editor.py` — Profile editor form (push_screen)
- [x] `tui/models/screen.py` — Models view: OptionList highlight → detail/profile update, _selected_model_id
- [x] `tui/server/command_builder.py` — llama.cpp CLI flag builder
- [x] `tui/server/process_manager.py` — Subprocess spawn, health poll, queue, vLLM parse (bugs fixed)
- [x] `tui/server/instance_table.py` — DataTable with row keys, Selected message, get_selected_instance_id()
- [x] `tui/server/log_viewer.py` — Ring-buffered log viewer
- [x] `tui/server/queue_view.py` — Launch queue display
- [x] `tui/server/screen.py` — Server view: start/stop/clear, ProcessManager callbacks wired; 40%/60% layout
- [x] `tui/server/system_stats.py` — CPU/RAM/GPU gauges (psutil + pynvml), 2s refresh

**P1 result**: Launch TUI, navigate views, scan models, edit profiles, start/stop server, watch logs

### P2 — Chat

- [x] `tui/db/conversations_repo.py` — Conversations CRUD
- [x] `tui/db/messages_repo.py` — Messages CRUD
- [x] `tui/chat/transport.py` — aiohttp SSE chat transport (OpenAI compat + fallback)
- [x] `tui/chat/markdown_render.py` — Markdown-to-Rich renderables
- [x] `tui/chat/message_widgets.py` — Message widgets
- [x] `tui/chat/message_thread.py` — Scrollable message area with auto-scroll
- [x] `tui/chat/conversation_list.py` — Conversation sidebar (Selected message, search, CRUD)
- [x] `tui/chat/input_panel.py` — Input bar with params (OnSend/OnStop proper Messages)
- [x] `tui/chat/screen.py` — Full streaming chat: asyncio task, OpenAICompatTransport, DB persist

**P2 result**: Full chat with streaming, thinking blocks, conversation management, temp mode

### P3 — vLLM + Settings

- [x] `tui/db/vllm_models_repo.py` — vLLM models CRUD
- [x] `tui/db/vllm_profiles_repo.py` — vLLM profiles CRUD
- [x] `tui/server/command_builder.py` — Add vLLM command building (conda/venv/docker/WSL)
- [x] `tui/models/scanner.py` — Add vLLM safetensors detection
- [x] `tui/settings/forms.py` — Reusable form widgets
- [x] `tui/settings/screen.py` — Settings view (Paths, Networking, vLLM Runtime, Appearance)

**P3 result**: vLLM server management, all settings editable

### P4 — Hugging Face

- [x] `tui/huggingface/hub_client.py` — HF API client (search, files, readme)
- [x] `tui/huggingface/download_manager.py` — Download with progress, resume, pause
- [x] `tui/huggingface/search_view.py` — Search wired to hub_client, results → repo browser
- [x] `tui/huggingface/repo_browser.py` — File list (GGUF/safetensors first), Download message
- [x] `tui/huggingface/screen.py` — Full wiring: search→browser, browser→download, 2s progress refresh

**P4 result**: Search, browse repos, download with progress/resume/pause

### P5 — MCP + Folders

- [x] `tui/db/mcp_repo.py` — MCP servers CRUD
- [x] `tui/db/folders_repo.py` — Folders CRUD
- [x] `tui/mcp/mcp_client.py` — MCP client manager (stdio/sse/http), tool caching, reconnect
- [x] `tui/mcp/server_list.py` — Server list with status indicators, get_selected_server_id()
- [x] `tui/mcp/server_editor.py` — Editor saves to DB, proper args/env conversion
- [x] `tui/mcp/tool_list.py` — Tool list grouped by server
- [x] `tui/mcp/screen.py` — Full wiring: connect-all/reconnect/disconnect, CRUD, tool refresh
- [x] `tui/folders/screen.py` — Folder CRUD with rename modal
- [ ] Chat tool call approval integration (ToolCall widget + approve/reject flow)

**P5 result**: MCP server management, folder organization, tool call approval in chat

### P6 — Polish + Packaging

- [ ] `keyring` integration for API keys (service `llamafront`, matching GUI)
- [ ] `tui/build.spec` — PyInstaller spec file
- [ ] PyInstaller build test -> `modelbox-tui.exe`
- [ ] Keyboard shortcut polish (all views, global bindings)
- [ ] Error handling (missing DB, server not found, network errors)
- [ ] Theme switching (light/dark)
- [ ] Electron integration (place binary in `resources/tui/`, verify `npm run build:win` includes it)
- [ ] DB sync verification test (GUI write -> TUI read, TUI write -> GUI read)

**P6 result**: Production-ready TUI bundled with Electron installer

---

## GUI Source Reference

Files to read when implementing each feature:

| TUI file | GUI source to reference |
|---|---|
| `db/schema.py` | `src/main/db/database.ts:55-180` |
| `db/*_repo.py` | `src/main/db/repos/*.ts` |
| `chat/transport.py` | `src/renderer/src/lib/transport.ts` |
| `server/process_manager.py` | `src/main/services/processManager.ts` |
| `server/command_builder.py` | `src/main/services/commandBuilder.ts` |
| `server/` health poll | `src/main/services/healthPoller.ts` |
| `server/` queue | `src/main/services/serverQueue.ts` |
| `models/scanner.py` | `src/main/services/modelScanner.ts` |
| `huggingface/hub_client.py` | `src/main/services/huggingfaceHub.ts` |
| `huggingface/download_manager.py` | `src/main/services/huggingfaceHub.ts` download function |
| `db/settings_repo.py` | `src/main/db/repos/settings.repo.ts` |
| keychain | `src/main/services/keychain.ts` (service `'llamafront'`) |
| types | `src/shared/types.ts` (translate to Python dataclasses) |

---

## Verification

1. **DB sync**: Start GUI, add a model/profile, launch TUI — verify model appears
2. **Server**: Start llama.cpp server from TUI, verify GUI shows it running (and vice versa)
3. **Chat**: Send message in TUI, verify message saved to DB, appears in GUI chat
4. **Keychain**: Set API key in GUI, verify TUI can read it (same `llamafront` service)
5. **Build**: Run `pyinstaller tui/build.spec`, verify `modelbox-tui.exe` launches standalone
6. **Electron**: Run `npm run build:win`, verify `resources/tui/modelbox-tui.exe` is in the installer
