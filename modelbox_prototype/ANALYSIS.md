# Project Analysis: LlamaFront

**LlamaFront** is a desktop Electron application for managing and launching local `llama-server.exe` instances from llama.cpp. Here's a comprehensive breakdown:

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron App                           │
├─────────────────────────────────────────────────────────────┤
│  Main Process (Node.js)          │  Renderer Process (React)│
│  ───────────────────────────────  │  ─────────────────────  │
│  - IPC Handlers                  │  - React Router          │
│  - Process Management            │  - Zustand Stores        │
│  - SQLite Database               │  - Radix UI Components  │
│  - Model Scanning                │  - Tailwind CSS         │
│  - Command Building              │  - Transport Layer      │
│  - Server Queue                  │  - Chat Features        │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
llamafront/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── db/
│   │   │   ├── database.ts      # better-sqlite3 wrapper
│   │   │   ├── schema.sql       # SQLite schema
│   │   │   └── repos/           # Data repositories
│   │   │       ├── models.repo.ts
│   │   │       ├── profiles.repo.ts
│   │   │       ├── conversations.repo.ts
│   │   │       ├── messages.repo.ts
│   │   │       ├── settings.repo.ts
│   │   │       └── serverInstances.repo.ts
│   │   ├── ipc/                 # IPC handlers
│   │   │   ├── index.ts
│   │   │   ├── models.ipc.ts
│   │   │   ├── profiles.ipc.ts
│   │   │   ├── server.ipc.ts
│   │   │   ├── chat.ipc.ts
│   │   │   ├── settings.ipc.ts
│   │   │   └── sysStats.ipc.ts
│   │   ├── services/            # Business logic
│   │   │   ├── processManager.ts    # Spawn/manage llama-server
│   │   │   ├── commandBuilder.ts    # Build CLI commands
│   │   │   ├── modelScanner.ts      # Scan for GGUF files
│   │   │   ├── serverQueue.ts       # Job queue
│   │   │   ├── healthPoller.ts      # HTTP health checks
│   │   │   ├── portChecker.ts       # Port availability
│   │   │   ├── keychain.ts          # API key storage (keytar)
│   │   │   └── sysStats.ts          # GPU/CPU/RAM monitoring
│   │   └── utils/
│   │       └── ringBuffer.ts        # Bounded log storage
│   ├── renderer/                # React UI
│   │   └── src/
│   │       ├── pages/             # Route pages
│   │       │   ├── ModelsPage.tsx
│   │       │   ├── ServerPage.tsx
│   │       │   ├── ChatPage.tsx
│   │       │   ├── SettingsPage.tsx
│   │       │   └── FirstRunPage.tsx
│   │       ├── components/        # UI components
│   │       │   ├── models/        # ModelCard, ModelDetails, ProfileEditor, ProfileList
│   │       │   ├── server/        # InstancesTable, LogsViewer, QueuePanel, SystemStats
│   │       │   ├── chat/          # ChatInput, MessageThread, ConversationList, ModelPicker, ChatSettingsDrawer
│   │       │   ├── shared/        # TriStateField, TagChip, StatusBadge, ImageLightbox
│   │       │   └── layout/        # Layout, Sidebar
│   │       ├── lib/               # Utility modules
│   │       │   ├── transport.ts   # OpenAI/native API transport layer
│   │       │   ├── ipc.ts         # Typed IPC wrappers
│   │       │   └── utils.ts       # Shared utilities
│   │       └── store/             # Zustand stores
│   │           ├── chatStore.ts
│   │           ├── modelsStore.ts
│   │           ├── serverStore.ts
│   │           ├── settingsStore.ts
│   │           └── themeStore.ts
│   └── shared/
│       └── types.ts               # Shared TypeScript types
├── preload/
│   └── index.ts                   # Context bridge (ElectronAPI)
├── spec.md                        # Detailed specification
└── package.json
```

## Core Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Model Discovery** | ✅ | Scans `C:\Users\mohda\models` for `.gguf` files, auto-detects multimodal (mmproj) |
| **Profile Management** | ✅ | Multiple launch configurations per model with tri-state fields |
| **Server Management** | ✅ | Start/stop/restart llama-server instances with health polling |
| **Queue System** | ✅ | One-at-a-time launch policy for GPU-bound models |
| **Chat Interface** | ✅ | Model picker, conversation list, streaming messages |
| **Image Attachments** | ✅ | Base64 image uploads with multimodal API support |
| **Auto-Titling** | ✅ | Background title generation from first user message |
| **Message Editing** | ✅ | Edit user messages, regenerate assistant responses |
| **Thinking Blocks** | ✅ | Parse and display `<think>` blocks from reasoning models |
| **Live Metrics** | ✅ | Tokens/sec, context usage, processing/generation phases |
| **Command Preview** | ✅ | Live preview of generated CLI commands |
| **Log Viewer** | ✅ | Real-time stdout/stderr with ring buffer |
| **System Stats** | ✅ | GPU/CPU/RAM monitoring via nvidia-smi |

## Database Schema

```sql
models             → GGUF file metadata, detected files
profiles           → Launch configs (JSON), one active per model
conversations      → Chat sessions with model binding
messages           → Chat message history (with metrics)
server_instances   → Runtime instance tracking
settings           → App-wide configuration (paths, defaults)
```

## Key Design Decisions

1. **Tri-State Fields**: Unset values mean "don't pass the flag" - critical for llama-server flexibility
2. **Keychain Storage**: API keys stored via `keytar` (Windows Credential Manager)
3. **Ring Buffer**: Bounded log storage (~2000 lines) prevents memory bloat
4. **Health Poller**: HTTP polling to detect when server is truly ready
5. **Queue System**: Prevents GPU overload by serializing launches
6. **Transport Layer**: OpenAI-compatible API with fallback to native llama.cpp endpoint
7. **Auto-Titling**: Background title generation cancelled on new messages to avoid slot contention

## Tech Stack

- **Runtime**: Electron 33 + Node.js
- **Framework**: React 18 + React Router
- **Styling**: Tailwind CSS 4 + Radix UI primitives
- **State**: Zustand
- **Database**: better-sqlite3 (synchronous SQLite)
- **Secrets**: keytar (native credential storage)
- **Build**: electron-vite + electron-builder
- **Markdown**: react-markdown + remark-gfm
- **Syntax Highlighting**: react-syntax-highlighter
- **Virtualization**: react-virtuoso

## Profile Configuration Fields

The `ProfileConfig` type captures all llama-server flags:

```typescript
{
  // Model
  alias, mmproj, embeddings

  // Performance
  contextSize, gpuLayers, nCpuMoe, flashAttn,
  backendSampling, parallel, kvCacheTypeK, kvCacheTypeV

  // Networking
  host, port

  // Sampling (optional)
  temp, topP, minP, topK, repeatPenalty, presencePenalty

  // Speculative decoding
  specType, specNgramSizeN, draftMin, draftMax

  // Environment
  env, prependCudaToPath
}
```

## IPC Communication

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `models:scan` | renderer→main | Scan for GGUF files |
| `models:list` | renderer→main | List all models |
| `profiles:list` | renderer→main | List profiles for model |
| `profiles:create` | renderer→main | Create new profile |
| `profiles:update` | renderer→main | Update profile |
| `profiles:build-command` | renderer→main | Preview CLI command |
| `server:start` | renderer→main | Launch a model instance |
| `server:stop` | renderer→main | Kill an instance |
| `server:restart` | renderer→main | Restart an instance |
| `server:log-chunk` | main→renderer | Stream logs |
| `server:state-change` | main→renderer | Update running/stopped |
| `server:queue-update` | main→renderer | Queue status |
| `conversations:*` | bidirectional | CRUD operations |
| `messages:*` | bidirectional | CRUD + deleteFrom |
| `settings:get/set` | bidirectional | App settings |
| `system:stats` | renderer→main | GPU/CPU/RAM metrics |

## Chat Features

### Message Flow
1. User sends message (with optional images)
2. User message saved to DB with `<image>` markers
3. API request built with multimodal parts for images
4. Streaming response with live metrics (phase, tokens/sec, context)
5. Assistant message saved with metadata (tokenCount, tokensPerSecond, thinkDurationMs, etc.)
6. Background title generation if conversation untitled

### Message Metadata
```typescript
interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokenCount?: number
  tokensPerSecond?: number
  thinkDurationMs?: number      // Time spent in <think> block
  contextTokens?: number        // Total context used
  contextSize?: number          // Server's n_ctx
  promptProcessingMs?: number   // TTFT (time to first token)
  createdAt: string
}
```

### Transport Layer
- **OpenAICompatTransport**: Primary transport using `/v1/chat/completions`
  - Supports multimodal (image_url parts)
  - Handles `reasoning_content` for thinking blocks
  - Captures usage chunk for accurate token counts
- **LlamaCppNativeTransport**: Fallback using `/completion` endpoint
  - Simple prompt formatting (User/Assistant prefixes)
  - No multimodal support

## UI Layout

```
┌────────────────────────────────────────────────────────┐
│  Sidebar (Models | Server | Chat | Settings)           │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────┐  ┌─────────────────────────────────────┐│
│  │ Model    │  │   Model Details / Profile Editor    ││
│  │ List     │  │   or Chat Interface                 ││
│  │          │  │   or Server Instances + Logs        ││
│  └──────────┘  └─────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

## Build Commands

```bash
npm run dev          # Development mode
npm run build:win    # Build Windows installer
npm run rebuild:native # Rebuild native deps (better-sqlite3, keytar)
```

---

This is a well-structured Electron application with clean separation between main/renderer processes, proper IPC patterns, and a thoughtful design for managing local LLM servers. The chat features include modern capabilities like image attachments, message editing, and reasoning block support.