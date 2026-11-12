# Llama Desktop (Windows) — Electron Spec Sheet (spec.md)

## 1) Goal
Build a Windows Electron desktop app that helps you **discover**, **configure**, **run**, and **chat with** local `llama-server.exe` instances from `llama.cpp`, using a **model library** at:

- `C:\Users\mohda\models`

The app must:
- List all models found in that folder (including multi-file GGUF sets).
- Let you create **multiple saved profiles per model** (launch configurations) and set one as **Active**.
- Generate and run the correct `llama-server.exe` command line (including env vars).
- Provide a **Server** view for active instances (ports, status, logs, queue).
- Provide a **Chat** view with easy model selection (and optionally auto-start).

Non-goals:
- Training or fine-tuning UI.
- Hosting remote inference providers (only local llama.cpp server processes).

---

## 2) Target Environment
- OS: Windows 10/11
- Runtime: Electron (Chromium + Node)
- Default llama.cpp server path (user-configurable):
  - `C:\src\llama.cpp\build\bin\Release\llama-server.exe`
- CUDA path prepending:
  - `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.1\bin`
- Primary usage is **PowerShell-style** env var behavior, but the app should set env vars via Node `spawn` `env`.

---

## 3) Key Concepts & Objects

### 3.1 Model
A “Model” is a runnable entry that maps to a GGUF file (and optional mmproj).

Minimum fields:
- `id` (uuid)
- `name` (derived from folder/file)
- `ggufPath` (main model file)
- `modelDir` (folder containing model)
- `isEmbeddingModel` (boolean; profile-level override allowed)
- `isMultimodal` (true if mmproj present and configured)
- `detectedFiles` (list of relevant files in modelDir)

Detection rules:
- Scan `C:\Users\mohda\models\**\*.gguf`
- Identify the “main” GGUF by:
  1) Prefer filenames containing `MOE` or `Instruct` (optional heuristic)
  2) Otherwise choose largest `.gguf` file in folder
- If `mmproj-*.gguf` exists in same folder, mark as multimodal-capable.

### 3.2 Profile (per Model)
A Profile is a saved configuration for launching that model.
- `profileId` (uuid)
- `modelId` (fk)
- `profileName` (e.g., “200k ctx + graphs”, “IQ2 quick test”, “Embeddings 8k”)
- `active` (boolean; exactly one active profile per model)
- `createdAt`, `updatedAt`

### 3.3 Server Instance (Runtime)
Represents a running `llama-server.exe` process.
- `instanceId` (uuid)
- `modelId`, `profileId`
- `pid`
- `host` (default `0.0.0.0`)
- `port`
- `state` (`starting | running | stopped | error`)
- `startedAt`, `stoppedAt`
- `stdoutRingBuffer`, `stderrRingBuffer` (bounded logs)
- `apiKey` (stored securely; see security)
- `endpoints`:
  - base: `http://{host}:{port}`
  - health: `/health` (or app-defined probe)
  - openai-like: `/v1/...` (if used by your llama.cpp build)

---

## 4) Features

## 4.1 Models Section
### 4.1.1 Model Library
- Left panel: searchable list of models detected under `C:\Users\mohda\models`
- Each row shows:
  - Model name
  - Tags (e.g., `MOE`, `Embedding`, `Multimodal`, quant type hints from filename like `MXFP4`, `Q4_K_M`)
  - Status indicator: `Running on :8502` / `Stopped`

### 4.1.2 Model Details + Profiles
When selecting a model:
- Show:
  - GGUF path
  - Detected mmproj candidates
  - Profiles list for this model
  - Active profile clearly marked (radio/select)
- Actions:
  - `Create profile`
  - `Duplicate profile`
  - `Rename profile`
  - `Delete profile` (not if it’s active; require switch first)
  - `Set Active`

### 4.1.3 Profile Editor UI (Config Builder)
A form-based UI that maps directly to llama-server flags/env.

**Important behavior: “unset means not passed”**
- Any field left empty/disabled must result in **no CLI flag emitted** for it.
  - Example: if `temp` empty -> no `--temp` in command.
- Use per-setting tri-state:
  - `unset` (default)
  - `set` with value
  - (optional) `set to default` shortcut that writes value explicitly

#### Required/commonly used flags (based on your commands)
- Model:
  - `-m` (GGUF path) — always present
  - `-a` alias (optional but common)
  - `--mmproj` (optional)
  - `--embeddings` (boolean)

- Context / performance:
  - `-c` context size (number)
  - `-ngl` or `--n-gpu-layers` (numbers; support both; store canonical mapping)
  - `--n-cpu-moe` (number)
  - `-fa on/off` (boolean or enum)
  - `--backend-sampling` (boolean)
  - `--parallel` (number)
  - KV cache quant:
    - `-ctk` (enum)
    - `-ctv` (enum)

- Networking:
  - `--host` (default `0.0.0.0`)
  - `--port` (number)
  - `--api-key` (string; default “dummy”, but ideally user-managed)

- Sampling (all optional/unsettable):
  - `--temp` (number)
  - `--top-p` (number)
  - `--min-p` (number)
  - `--top-k` (number)
  - `--repeat-penalty` (number)

- Speculative decoding (optional):
  - `--spec-type` (enum e.g. `ngram-mod`)
  - `--spec-ngram-size-n` (number)
  - `--draft-min` (number)
  - `--draft-max` (number)

#### Environment variables (per profile)
- `GGML_CUDA_GRAPH_OPT` (0/1)
- `GGML_CUDA_DISABLE_GRAPHS` (0/1)
- Any additional env overrides in a key/value list
- `PATH prepend` option:
  - prepend CUDA bin to PATH for the spawned process

#### Validation rules
- `port` must be numeric and free (app should check)
- `context` must be numeric; warn if extremely high (e.g., 1,000,000) but allow.
- Mutually relevant warnings (not hard errors):
  - Embeddings mode + sampling parameters set -> warn “sampling ignored for embeddings”
  - Multimodal model selected but `mmproj` unset -> warn
  - `-ngl 999` and `--n-gpu-layers 99` both set -> disallow, store one canonical

#### “Command Preview”
Always show a live, copyable preview:
- Effective env block
- Final `llama-server.exe` command
- Exact arguments list (for debugging)

---

## 4.2 Server Section
### 4.2.1 Active Instances Table
Show all running/starting/stopped (recent) instances:
- Model name
- Profile name
- Host:Port
- PID
- Uptime
- State
- Buttons:
  - `Start`
  - `Stop`
  - `Restart`
  - `Open API Docs` (optional)
  - `Copy base URL`
  - `Copy command`

### 4.2.2 Logs Viewer
- Tail logs from stdout/stderr with:
  - pause/resume
  - search
  - auto-scroll toggle
  - export logs to file
- Bounded memory: ring buffer (e.g., last 5–20 MB or last N lines)

### 4.2.3 Port Management
- Start flow must handle:
  - If requested port is busy:
    - Offer next available port (scan upward) OR show error
  - Ability to reserve a port per profile

### 4.2.4 Queueing / “One GPU at a time” mode (Optional but recommended)
Because you often run heavyweight models on GPU, add an app-level queue:
- Toggle: `Enable queue`
- Policy options:
  - `Only one running instance total`
  - `Only one GPU-heavy instance` (heuristic: `ngl` / `n-gpu-layers` > 0)
- Queue display:
  - Pending jobs list (model + profile + requested port)
  - Cancel pending job
- Auto-start next when current stops.

### 4.2.5 Health & State Detection
- Determine “running” by:
  - Process alive (PID)
  - AND health probe HTTP success (poll every 2–5s while starting)
- If process dies during startup:
  - Mark as `error`
  - Surface last 200 lines of log

---

## 4.3 Chat Section
### 4.3.1 Model Selection UX
You want an easy way to select model in Chat + Server:
- Use a shared “Model Picker” component:
  - Searchable dropdown
  - Shows running status and ports
  - Lets you choose:
    - A running instance (preferred)
    - Or a model+profile (and optionally start it)

Chat selection rules:
- If selected model has a running instance:
  - Use that instance automatically
- If not running:
  - Prompt:
    - `Start selected active profile and chat`
    - OR `Choose a profile to start`
    - OR `Connect to existing host:port`

### 4.3.2 Chat Capabilities
- Standard chat UI:
  - conversation list (left)
  - messages (center)
  - settings (right drawer)
- Per-conversation:
  - model instance binding (host:port)
  - system prompt (optional)
  - temperature/top-p overrides (optional; if unset do not send)
- Support streaming responses (if llama.cpp server supports it via API)
- Include:
  - “Stop generating” button
  - token/speed stats if available

### 4.3.3 API Compatibility Strategy
To minimize coupling:
- Implement a small “Transport” layer:
  - `LlamaCppOpenAICompatTransport` (preferred if your server supports OpenAI-like endpoints)
  - `LlamaCppNativeTransport` (fallback if not)
- Store per server instance what API style worked last.

---

## 5) UX Flows

### 5.1 First Run
- Ask for/auto-detect:
  - Models directory (default `C:\Users\mohda\models`)
  - `llama-server.exe` path (default `C:\src\llama.cpp\build\bin\Release\llama-server.exe`)
  - CUDA bin path (optional; default provided)
- Scan models
- For each model: auto-create a “Default” profile with sensible defaults:
  - host `0.0.0.0`
  - port suggestion (8502 + index)
  - api-key “dummy”
  - leave sampling unset

### 5.2 Start a Model
- From Models > click “Start” on active profile
- App validates:
  - port free
  - file exists
- Spawn process with env and args
- Move to Server view with logs and state updates

### 5.3 Chat with a Model
- From Chat:
  - Choose a model (running instance recommended)
  - Send message
  - Stream response
- If instance not running:
  - Offer to start active profile

### 5.4 Switch Profile
- Models view: set Active profile
- Server view: Restart instance using new active profile (optional prompt)
- Chat view: can rebind conversation to new instance.

---

## 6) Command Generation Rules (Critical)

### 6.1 “Unset means not passed”
The command builder must:
- Include **only** flags explicitly enabled/set in the profile.
- If a numeric/text field is empty => do not include that flag.
- For toggles:
  - If toggle disabled => do not include (unless flag requires explicit off)
  - If llama.cpp requires explicit `-fa on`, model it as an enum:
    - `unset | on | off`
    - emit `-fa on` only when set to `on`, emit `-fa off` only when set to `off`

### 6.2 Canonical Flag Mapping
Support user mental model:
- Accept inputs like:
  - `-ngl 999`
  - OR `--n-gpu-layers 99`
Store canonical internal fields:
- `gpuLayers` (int, optional)
- Emit **one** of the supported flags based on user preference:
  - Default emit `--n-gpu-layers` (or `-ngl` if you prefer parity with your existing commands)

### 6.3 Env Var Handling
Spawn env should be:
- `env = { ...process.env, ...profile.env }`
- If `prependCudaToPath` is enabled:
  - `env.PATH = "{cudaBin};" + env.PATH`
- Support explicit disabling graphs (as in your qwen3-vl example):
  - `GGML_CUDA_DISABLE_GRAPHS=1`
  - `GGML_CUDA_GRAPH_OPT=0`

---

## 7) Data Storage
Use a local DB (recommended):
- SQLite via better-sqlite3 or Prisma + SQLite

Entities:
- `Settings` (paths, defaults)
- `Models`
- `Profiles`
- `Conversations`
- `Messages`
- `ServerInstances` (runtime + last-known, but runtime state not persisted across reboot except “last config”)

Secrets:
- API keys stored via OS keychain:
  - Windows Credential Manager via `keytar`

---

## 8) Security & Safety
- Do not log API keys in plaintext in UI logs/command preview by default:
  - Show `--api-key "••••••"` with “reveal” toggle
- Path traversal:
  - Only allow models within configured models dir unless user explicitly browses elsewhere
- Process management:
  - Provide clean termination:
    - `SIGTERM` equivalent on Windows (use `taskkill` or child process kill)
    - allow graceful shutdown endpoint if available

---

## 9) Performance Requirements
- Model scan should complete within:
  - < 2 seconds for up to ~500 GGUF files (target), using async fs scan + caching
- Logs viewer must remain responsive:
  - ring buffer + virtualization
- Chat streaming should handle:
  - long outputs without freezing UI

---

## 10) UI Structure (Proposed)
Left Nav:
- **Models**
- **Server**
- **Chat**
- Settings

Shared header:
- Global model picker (optional)
- Quick actions: Start/Stop selected

### Models page layout
- Left: Model list + search
- Right: Model details + tabs:
  - Profiles
  - Files
  - Advanced

### Server page layout
- Top: Instances table
- Bottom: Logs panel (select instance)

### Chat page layout
- Left: Conversations + “New Chat”
- Top: Model picker (running instances first)
- Center: messages
- Right drawer: chat parameters (overrides)

---

## 11) Settings
- Models directory path (default `C:\Users\mohda\models`)
- llama-server.exe path
- Default host
- Default base port start (e.g., 8502)
- CUDA bin path
- Default env presets:
  - “Graphs ON” preset: `GGML_CUDA_GRAPH_OPT=1`
  - “Graphs OFF” preset: `GGML_CUDA_DISABLE_GRAPHS=1`, `GGML_CUDA_GRAPH_OPT=0`
- Queue settings

---

## 12) Acceptance Criteria
1. App lists all models under `C:\Users\mohda\models` with correct main GGUF selection.
2. You can create multiple profiles per model and switch active profile.
3. Profile editor supports sliders + numeric inputs (context, n-cpu-moe, gpu layers, etc.).
4. Leaving `temp/top-k/top-p/min-p/repeat-penalty` empty results in those flags **not** being included in the command.
5. Server page shows active instances with ports, status, PID, and logs.
6. Chat page can select a model easily and chat against a running instance (or start it).
7. Command preview matches the executed process arguments + env.

---

## 13) Example Profiles (Derived from your commands)

### GLM 4.7 Flash MXFP4 — “Spec decode ngram”
- model: `...\GLM-4.7-Flash-MXFP4_MOE.gguf`
- alias: `glm-4.7-flash-mxfp4`
- context: `200000`
- gpuLayers: `999` (or `--n-gpu-layers 999`)
- flashAttn: `on`
- backendSampling: `true`
- parallel: `1`
- host: `0.0.0.0`
- port: `8502`
- apiKey: `dummy`
- temp: `0.7`
- topP: `1.0`
- repeatPenalty: `1.0`
- specType: `ngram-mod`
- specNgramSize: `24`
- draftMin: `48`
- draftMax: `64`
- env: `GGML_CUDA_GRAPH_OPT=1`, prepend CUDA bin to PATH

### Embedding Gemma 300m — “Embeddings 8k”
- model: `...\embeddinggemma-300m-qat-Q8_0.gguf`
- embeddings: `true`
- context: `8192`
- gpuLayers: `999`
- flashAttn: `on`
- host: `0.0.0.0`
- port: `8503`
- apiKey: `dummy`
- sampling unset (not emitted)

### Qwen3-Coder-Next MXFP4 — “Coder 200k”
- model: `...\Qwen3-Coder-Next-MXFP4_MOE.gguf`
- alias: `Qwen3-Coder-Next-MXFP4`
- context: `200000`
- nCpuMoe: `20`
- gpuLayers: `99`
- flashAttn: `on`
- backendSampling: `true`
- parallel: `1`
- host: `0.0.0.0`
- port: `8502`
- apiKey: `dummy`
- temp: `1.0`
- topP: `0.95`
- minP: `0.01`
- topK: `40`

### Qwen3-VL-30B — “VL graphs off”
- model: `...\Qwen3-VL-30B-A3B-Instruct-Q4_K_M.gguf`
- mmproj: `...\mmproj-...-F16.gguf`
- context: `50000`
- gpuLayers: `999`
- flashAttn: `on`
- backendSampling: `true`
- parallel: `1`
- host: `0.0.0.0`
- port: `8502`
- apiKey: `dummy`
- env:
  - `GGML_CUDA_DISABLE_GRAPHS=1`
  - `GGML_CUDA_GRAPH_OPT=0`

---

## 14) Open Questions (Documented, but proceed with assumptions)
- Which API endpoints to use for chat:
  - Assume OpenAI-compatible routes are available; otherwise implement native fallback.
- Exact health endpoint:
  - Assume `/health` or implement a simple GET to base and parse response.

(These are not blockers; implement with detection + fallback.)

---