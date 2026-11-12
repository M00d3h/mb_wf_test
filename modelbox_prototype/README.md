# ModelBox

> ModelBox is a desktop application for Windows and macOS that lets you download, manage, and chat with large language models running entirely on your own hardware, using [llama.cpp](https://github.com/ggerganov/llama.cpp) or [vLLM](https://github.com/vllm-project/vllm) runtimes

---

## Download

Head to the [**Releases**](../../releases) page and grab the latest installer for your platform:

| Platform | File |
|---|---|
| Windows 10/11 | `modelbox-x.x.x-setup.exe` |
| macOS (Apple Silicon) | `modelbox-x.x.x-arm64.dmg` |

---

## Installation

### Windows
1. Download `modelbox-x.x.x-setup.exe` from the Releases page
2. Run the installer — Windows SmartScreen may show an "unrecognized publisher" warning; click **More info → Run anyway**
3. ModelBox launches automatically after install

### macOS
1. Download the `.dmg` for your Mac
2. Open the DMG and drag ModelBox to Applications

---

## First Run

A setup wizard walks you through everything on first launch:

1. **Download llama.cpp** — ModelBox downloads the latest llama-server binary for your platform automatically
2. **Set model directories** — Point ModelBox to the folder(s) where you store your `.gguf` model files

No config files to edit, no command lines to run.

---

## Features

### Model Management

- Scans configured directories for `.gguf` model files automatically
- Reads model metadata from GGUF files: context window length, quantization type (Q4_K_M, Q8_0, etc.), parameter count, file size
- Detects vision/multimodal models via paired `mmproj` projector files
- Supports both GGUF (llama.cpp) and HuggingFace safetensor formats (via vLLM)

### Launch Profiles

//i want profiles.png here

Create and save multiple launch configurations per model — for example, a low-temperature profile for agentic and coding tasks, and a separate one for general chat with looser sampling:

- GPU layer offload amount and flash attention toggle
- Context window size and batch size
- KV cache quantization
- Sampling parameters: temperature, top-p, top-k, min-p, repeat penalty
- Per-profile environment variables
- Custom command-line override for advanced users
- Fields left blank are omitted entirely — ModelBox never injects silent defaults

### Server Management

// i want server.png here

- Start, stop, and restart llama-server and vLLM instances from the UI
- Real-time status tracking: Starting → Loading → Running → Stopped
- Live log viewer per instance with scrollable output
- Automatic port conflict detection with suggestions
- GPU stats on the Server page: VRAM usage, temperature, power draw per GPU (NVIDIA)

### Chat

// i want chat.png here

- Multiple conversations with persistent history
- Streaming responses with token/second display and generation stats
- Auto-generated conversation titles
- **Image attachments** for vision models
- **PDF and document attachments**
- Edit and resend previous messages
- Regenerate the last assistant response
- Thinking/reasoning mode toggle (for models that support extended reasoning)
- Organize conversations into folders
- Archive conversations to keep history read-only
- Temporary (ephemeral) chat mode that doesn't save to history
- Bind a conversation to any running instance from a picker

### 🤗 HuggingFace Integration

//i want hf.png here

Download models directly from HuggingFace without leaving the app:

- Browse trending and popular Safetensor and GGUF models
- See file sizes and estimated VRAM requirements before downloading
- Pause, resume, and retry interrupted downloads
- View model cards in-app

### MCP Tool Support

Connect ModelBox to [Model Context Protocol](https://modelcontextprotocol.io/) servers to give models access to external tools (web search, file access, APIs, etc.):

- Supports local process (stdio), HTTP, and SSE transports
- Bearer token authentication for remote servers
- Enable or disable individual tools per server
- Inline tool call and result display in the chat thread
- Always-allow list to skip approval prompts for trusted tools

### Claude Code Integration

Each running model instance has a **Use with Claude Code** button in the Server page. Clicking it copies a ready-to-paste block of environment variables to your clipboard that points Claude Code at your local server:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
export ANTHROPIC_AUTH_TOKEN=sk-...
export ANTHROPIC_MODEL=your-model-name
claude
```

Paste this into your terminal and Claude Code will use your local model instead of Anthropic's API — no account or API key required.

On Windows, the copied commands use PowerShell syntax (`$env:VAR="value"`) by default. If you run Claude Code inside WSL, go to **Settings → Claude Code integration** and enable **WSL mode** to switch to `export` syntax instead.

---

### vLLM Setup

vLLM runs HuggingFace safetensor models and is a second runtime option alongside llama.cpp. Unlike llama.cpp, it is **not installed automatically** — you need to set up a conda environment manually first.

**On Windows**, this must be done inside WSL2. **On macOS/Linux**, run these commands natively:

```bash
conda create -n vllm python=3.12
conda activate vllm
uv pip install vllm --torch-backend auto
```

Once the environment is ready, open ModelBox → **Settings → vLLM** and enter the environment name in the **Conda environment** field:

// i want vllm_settings.png here

- Just type the name you gave it (e.g. `vllm`) — no full path needed
- ModelBox finds your conda installation automatically by checking `~/miniconda3`, `~/miniforge3`, `~/anaconda3`, and `/opt/conda`

---

## GPU Support

| Backend | Platforms |
|---|---|
| CUDA (NVIDIA) | Windows, Linux |
| Vulkan (AMD, Intel Arc, etc.) | Windows, Linux |
| Metal | macOS (Apple Silicon) |
| CPU-only fallback | All platforms |

ModelBox detects your GPU automatically at startup. GPU layer offload is configurable per model profile — you can partially offload a model that doesn't fully fit in VRAM.

---

## Privacy & Data

- All inference runs **locally** — no data leaves your machine during chat
- Conversations are stored in a local database under `~/.modelbox/`
- No telemetry, no usage tracking, no accounts required

---

## FAQ

**What model formats does ModelBox support?**
GGUF files (the standard format for quantized llama.cpp models) and HuggingFace safetensor models (via vLLM). You can download models from HuggingFace directly inside the app, or point ModelBox at a folder where you already have `.gguf` files.

**Do I need a GPU?**
No — models will run on CPU, but performance will be much faster on a dedicated discrete GPU.

**Can I use ModelBox offline?**
Yes, only the intital runtime binary installation during first-run setup and the HuggingFace browser and model downloads require internet; all chat and server management is fully local.