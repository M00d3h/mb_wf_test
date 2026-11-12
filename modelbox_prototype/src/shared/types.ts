// ─── Profile Config ───────────────────────────────────────────────────────────

export interface ProfileConfig {
  // Model flags
  alias?: string;
  mmproj?: string;
  /** When true, mmproj auto-detection is suppressed (user explicitly disabled it). */
  mmprojDisabled?: boolean;
  embeddings?: boolean;

  // Context / performance
  contextSize?: number;
  gpuLayers?: number;
  nCpuMoe?: number;
  flashAttn?: "on" | "off";
  fit?: string;
  backendSampling?: boolean;
  parallel?: number;
  kvCacheTypeK?: string;
  kvCacheTypeV?: string;

  // Networking
  host?: string;
  port?: number;
  // apiKey is stored in keychain; profile stores a keychain service name ref

  // Sampling — undefined means NOT emitted
  temp?: number;
  topP?: number;
  minP?: number;
  topK?: number;
  repeatPenalty?: number;
  presencePenalty?: number;

  // Speculative decoding
  specType?: string;
  specNgramSizeN?: number;
  draftMin?: number;
  draftMax?: number;

  // Environment
  env?: Record<string, string>;
  prependCudaToPath?: boolean;

  /** When `custom`, `customCommandLine` is parsed and spawned instead of structured flags */
  launchMode?: "builder" | "custom";
  /** Full executable + args as in a shell (first token = executable path) */
  customCommandLine?: string;
}

// ─── vLLM (runtime) ───────────────────────────────────────────────────────────

export type VllmEnvKind = "conda" | "venv" | "docker";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  downloadUrl: string | null;
}

/** Written to disk before pip install starts; cleared on success or graceful error. */
export interface VllmSetupMeta {
  distro?: string;
  startedAt: string;
}

export interface VllmRuntimeConfig {
  envKind: VllmEnvKind;
  /** conda env name */
  condaEnvName?: string;
  /** e.g. ~/miniconda3/etc/profile.d/conda.sh */
  condaShPath?: string;
  /** Python binary or venv `bin` directory */
  venvPath?: string;
  /** Docker image, e.g. vllm/vllm-openai:latest */
  dockerImage?: string;
  /** Extra `docker run` args (user-extensible) */
  dockerExtraArgs?: string;
  /**
   * WSL distro for conda/venv on Windows (e.g. Ubuntu-22.04).
   * Ignored on non-Windows; docker may use host Docker without WSL.
   */
  wslDistro?: string;
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  /** One or more roots to scan for GGUF models (e.g. fast SSD + bulk HDD). */
  modelsDirs: string[];
  /** Roots for vLLM / HuggingFace safetensor-style model folders (HuggingFace cache layout, etc.) */
  vllmModelDirs: string[];
  vllmRuntime: VllmRuntimeConfig;
  llamaServerPath: string;
  cudaBinPath: string;
  /** Default bind host for new llama.cpp profiles (`127.0.0.1` or `0.0.0.0`). */
  llamaDefaultHost: string;
  /** Default listen port for new llama.cpp profiles. */
  llamaBasePort: number;
  /** Default bind host for new vLLM profiles (`127.0.0.1` or `0.0.0.0`). */
  vllmDefaultHost: string;
  /** Default listen port for new vLLM profiles. */
  vllmBasePort: number;
  firstRun: boolean;
  fontSize: number;
  /** Windows only: when true, "Use with Claude Code" emits `export` (bash/WSL) instead of `$env:` (PowerShell). */
  wslMode: boolean;
}

// ─── DB Entities ──────────────────────────────────────────────────────────────

/** Per–vLLM-model launch metadata (stored per profile in `vllm_profiles.config_json`). */
export interface VllmModelConfig {
  /** When `custom`, `customCommandLine` is spawned instead of structured flags. */
  launchMode?: "builder" | "custom";
  customCommandLine?: string;
  host?: string;
  port?: number;
  /** `--max-model-len` */
  maxModelLen?: number;
  /** `--reasoning-parser` */
  reasoningParser?: string;
  /** `--enable-auto-tool-choice` when true */
  enableAutoToolChoice?: boolean;
  /** `--tool-call-parser` */
  toolCallParser?: string;
  /** `--served-model-name` */
  servedModelName?: string;
  /** `--max-num-seqs` */
  maxNumSeqs?: number;
  /** `--gpu-memory-utilization` (0–1 typical) */
  gpuMemoryUtilization?: number;
  /** `--kv-cache-dtype` */
  kvCacheDtype?: string;

  // Sampling — undefined means NOT emitted (packed into --override-generation-config JSON)
  /** `--override-generation-config {"temperature": …}` */
  temperature?: number;
  /** `--override-generation-config {"top_p": …}` */
  topP?: number;
  /** `--override-generation-config {"top_k": …}` */
  topK?: number;
  /** `--override-generation-config {"min_p": …}` */
  minP?: number;
  /** `--override-generation-config {"repetition_penalty": …}` */
  repetitionPenalty?: number;
  /** `--override-generation-config {"presence_penalty": …}` */
  presencePenalty?: number;
  /** `--override-generation-config {"frequency_penalty": …}` */
  frequencyPenalty?: number;
  /** `--speculative-config '{"method":"mtp","num_speculative_tokens":N}'` — raw JSON string */
  speculativeConfig?: string;
}

/** Local vLLM weight folder discovered under `vllmModelDirs` (HuggingFace-style tree or plain folder with safetensors). */
export interface VllmModel {
  id: string;
  path: string;
  displayName: string;
  /** Raw dtype from config.json: `torch_dtype` or `quantization_config.quant_type`. */
  dtype?: string | null;
  /** True when config.json contains `vision_config` or `image_token_id` — set at scan time. */
  isMultimodal?: boolean;
  /** Legacy: launch settings live on `VllmProfile.config` after migration. */
  config: VllmModelConfig;
  /** Total bytes of weight files on disk (computed at load time, 0 if unreadable). */
  diskSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface VllmProfile {
  id: string;
  vllmModelId: string;
  name: string;
  active: boolean;
  config: VllmModelConfig;
  createdAt: string;
  updatedAt: string;
}

/** Result of `vllm:scan` (disk discovery). */
export interface VllmScanResult {
  models: VllmModel[];
  warnings: string[];
}

export type ServerInstanceKind = "llama" | "vllm";

export interface Model {
  id: string;
  name: string;
  ggufPath: string;
  modelDir: string;
  isEmbedding: boolean;
  isMultimodal: boolean;
  detectedFiles: string[];
  /** From GGUF metadata (e.g. llama.context_length); caps context slider */
  maxContextTokens?: number;
  /** From GGUF metadata (e.g. llama.block_count); caps GPU layers slider */
  blockCount?: number;
  /** From GGUF `general.file_type` (llama.cpp file type); shown as quant chip when set */
  quantLabel?: string;
  /** Total bytes of all `.gguf` files in `detectedFiles` (computed when loading from DB). */
  ggufTotalBytes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  modelId: string;
  name: string;
  active: boolean;
  config: ProfileConfig;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string | null;
  instanceId: string | null;
  instanceHost: string | null;
  instancePort: number | null;
  systemPrompt: string | null;
  chatParams: ChatParams;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
  isTemp?: boolean;
  isArchived?: boolean;
}

export interface ChatParams {
  temp?: number;
  topP?: number;
  /** When true, request enable_thinking: false from the server (no reasoning / thinking tokens). */
  noThinking?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokenCount?: number;
  tokensPerSecond?: number;
  thinkDurationMs?: number;
  contextTokens?: number;
  contextSize?: number;
  promptProcessingMs?: number;
  createdAt: string;
}

export interface ServerInstance {
  id: string;
  instanceKind: ServerInstanceKind;
  /** llama.cpp server: GGUF model + profile. Null when `instanceKind === "vllm"`. */
  modelId: string | null;
  profileId: string | null;
  /** vLLM: references `vllm_models.id`. Null when `instanceKind === "llama"`. */
  vllmModelId: string | null;
  /** vLLM: launch profile. Null when `instanceKind === "llama"`. */
  vllmProfileId: string | null;
  host: string;
  port: number;
  state: ServerState;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  // runtime-only (not persisted)
  modelName?: string;
  profileName?: string;
  /** WSL2 VM IP on Windows vLLM instances. Used for actual connections; `host` is the Windows IP for display/LAN. */
  connectionHost?: string;
}

export type ServerState =
  | "starting"
  | "loading"
  | "vllm-shards"
  | "vllm-compile"
  | "vllm-cudagraph"
  | "running"
  | "stopped"
  | "error";

// ─── Log Lines ────────────────────────────────────────────────────────────────

export interface LogLine {
  instanceId: string;
  stream: "stdout" | "stderr";
  text: string;
  timestamp: number;
  /** When true, renderer replaces the last line for this instance (same stream) instead of appending. */
  replacesLast?: boolean;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export interface QueueEntry {
  id: string;
  instanceKind?: ServerInstanceKind;
  profileId?: string;
  vllmModelId?: string;
  modelName: string;
  profileName: string;
  port: number;
  enqueuedAt: number;
}

// ─── System Stats ─────────────────────────────────────────────────────────────

export interface GpuStats {
  name?: string;
  gpuPercent: number;
  memPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  temperatureC?: number;
  powerDrawW?: number;
  powerLimitW?: number;
  powerPercent?: number;
}

export interface SystemStats {
  cpu: { percent: number };
  ram: { usedMb: number; totalMb: number; percent: number };
  gpu: GpuStats[] | null;
  platform: string;
  /** GPU utilization % from Metal (macOS only). */
  macGpuPercent?: number;
}

// ─── IPC Payloads ─────────────────────────────────────────────────────────────

export interface BuildCommandResult {
  executable: string;
  args: string[];
  envDisplay: Record<string, string>;
  fullCommand: string;
}

export interface VllmBuildCommandResult {
  executable: string;
  args: string[];
  env: Record<string, string>;
  fullCommand: string;
}

export type ParseCommandLineResult =
  | { ok: true; executable: string; args: string[] }
  | { ok: false; error: string };

export interface StartServerResult {
  instance: ServerInstance;
  queued?: boolean;
}

export interface PortCheckResult {
  available: boolean;
  suggestedPort?: number;
}

// ─── Hugging Face Hub (browse / download GGUF) ────────────────────────────────

export interface HfModelSummary {
  id: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
}

/** Paginated GGUF model search (Hub `Link: rel="next"` cursor). */
export interface HfModelSearchPage {
  models: HfModelSummary[];
  nextCursorUrl: string | null;
}

/** Sidebar ordering for Hub model search (`likes7d` vs `downloads` API sort). */
export type HfModelListSort = "trending" | "downloads";

/** Hub sidebar: GGUF (llama.cpp) vs safetensor-oriented (vLLM) catalog. */
export type HfModelLibrary = "llama" | "vllm";

/** IPC payload for `hf:search-models` (avoids positional-arg issues in Electron). */
export interface HfSearchModelsPayload {
  query: string;
  limit: number;
  cursorUrl: string | null;
  listSort: HfModelListSort;
  /** Default / omitted = GGUF filter; `vllm` = safetensors filter. */
  library?: HfModelLibrary;
}

export interface HfRepoGgufFile {
  /** Display label; for sharded sets this is not a Hub path (use shardParts to download). */
  path: string;
  /** Total bytes (sum of all shards when shardParts is set). */
  size: number;
  /** true when filename suggests multimodal projector (paired GGUF) */
  isMmproj: boolean;
  /** Hub rfilenames in shard order (00001…0000N); when set, download uses these paths. */
  shardParts?: string[];
  /** Per-shard sizes (same order as shardParts); used for bundle progress. */
  shardSizes?: number[];
}

export interface HfRepoSafetensorFile {
  path: string;
  size: number;
  /** `weight` | `config` | `tokenizer` for UI grouping */
  kind: "weight" | "config" | "tokenizer" | "other";
}

/** Coalesced vLLM model: safetensor shards merged into one downloadable bundle. */
export interface HfRepoVllmModel {
  /** Display stem derived from shard filenames (e.g. "model", "consolidated"). */
  displayName: string;
  /** Ordered safetensor shard Hub rfilenames. */
  safetensorPaths: string[];
  /** Per-shard sizes (same order as safetensorPaths). */
  safetensorSizes: number[];
  /** Sum of all safetensor shard sizes. */
  totalSize: number;
  /** Auxiliary files to download alongside weights (config.json, tokenizer, etc.). */
  auxPaths: string[];
}

export type HfDownloadProgressEvent =
  | {
      downloadId: string;
      phase: "started";
      repoId: string;
      filename: string;
      filenames?: string[];
      /** Resolved models root where files will be written. */
      modelsDir: string;
    }
  | {
      downloadId: string;
      phase: "progress";
      receivedBytes: number;
      totalBytes?: number;
      fileIndex?: number;
      filesTotal?: number;
      currentFilename?: string;
      bundleReceivedBytes?: number;
      bundleTotalBytes?: number;
    }
  | {
      downloadId: string;
      phase: "complete";
      savedPath: string;
      savedPaths?: string[];
    }
  | {
      downloadId: string;
      phase: "error";
      error: string;
      aborted?: boolean;
    }
  | {
      downloadId: string;
      phase: "interrupted";
      info: HfIncompleteDownloadInfo;
    }
  | {
      downloadId: string;
      phase: "paused";
      info: HfIncompleteDownloadInfo;
    };

export interface HfDownloadResult {
  ok: boolean;
  downloadId: string;
  savedPath?: string;
  savedPaths?: string[];
  error?: string;
  aborted?: boolean;
}

/** One configured models root vs whether the full GGUF bundle exists there. */
export interface HfLocalGgufDirStatus {
  path: string;
  present: boolean;
}

export interface HfLocalGgufStatusBatchItem {
  /** Stable id for this row (e.g. shard key or hub path). */
  key: string;
  /** Hub filenames for the bundle (same order as download). */
  filenames: string[];
}

export interface HfLocalGgufStatusBatchPayload {
  repoId: string;
  items: HfLocalGgufStatusBatchItem[];
  /** Models directory roots to check (same strings as in Settings / picker). */
  roots: string[];
}

/** key → per-root presence (paths are resolved absolutes from the main process). */
export type HfLocalGgufStatusBatchResult = Record<
  string,
  HfLocalGgufDirStatus[]
>;

export interface HfRepoFileInfo {
  path: string;
  size: number;
}

export interface HfVllmModelsResult {
  models: HfRepoVllmModel[];
  allFiles: HfRepoFileInfo[];
}

export interface HfRepoReadmeResult {
  markdown: string | null;
  error: string | null;
}

export interface HfDownloadMeta {
  repoId: string;
  filenames: string[];
  fileSizes?: number[];
  modelsDir: string;
  destFolder: string;
  complete: boolean;
  vllmTarget?: boolean;
  /** Set when the download failed (not interrupted). Stores the error message. */
  failed?: string;
}

export interface HfIncompleteDownloadInfo {
  /** Absolute path of the model directory on disk */
  modelDir: string;
  meta: HfDownloadMeta;
  /** Hub filenames not yet present on disk */
  missingFilenames: string[];
  missingFileSizes?: number[];
  /** Present when this was a failed (not interrupted) download — the error message. */
  errorMessage?: string;
}

// ─── Runtime Management ───────────────────────────────────────────────────────

export type GpuTier = "cuda" | "vulkan" | "cpu" | "metal";

export interface GpuDetectionResult {
  tier: GpuTier;
  gpuName?: string;
  /** CUDA version string e.g. "12.4" — only set when tier is "cuda" */
  cudaVersion?: string;
}

export type LlamaRuntimeStatus =
  | "not-installed"
  | "installed"
  | "downloading"
  | "extracting"
  | "error";

export interface LlamaRuntimeInfo {
  status: LlamaRuntimeStatus;
  /** Build tag e.g. "b5248". Null when not installed. */
  installedBuild: string | null;
  installPath: string | null;
  tier: GpuTier | null;
  error: string | null;
}

export type VllmSetupStatus = "not-installed" | "setting-up" | "installed" | "error";

export interface VllmRuntimeInfo {
  status: VllmSetupStatus;
  /** Linux absolute venv path e.g. "/home/user/.modelbox/vllm-env". Null until installed. */
  venvPath: string | null;
  /** WSL distro name on Windows e.g. "Ubuntu-22.04". Null on Linux or when not installed. */
  wslDistro: string | null;
  error: string | null;
}

export type RuntimeProgressEvent =
  | { kind: "llama"; phase: "gpu-detect"; result: GpuDetectionResult }
  | { kind: "llama"; phase: "fetch-release"; build: string; assetName: string }
  | { kind: "llama"; phase: "download"; receivedBytes: number; totalBytes?: number }
  | { kind: "llama"; phase: "extract" }
  | { kind: "llama"; phase: "complete"; info: LlamaRuntimeInfo }
  | { kind: "llama"; phase: "error"; error: string }
  | { kind: "vllm"; phase: "env-check"; distro?: string }
  | { kind: "vllm"; phase: "dirs-set"; models: VllmModel[] }
  | { kind: "vllm"; phase: "needs-venv-confirm" }
  | { kind: "vllm"; phase: "pip-install"; line: string }
  | { kind: "vllm"; phase: "complete"; info: VllmRuntimeInfo; models: VllmModel[] }
  | { kind: "vllm"; phase: "error"; error: string };

// ─── MCP (Model Context Protocol) ────────────────────────────────────────────

export type MCPTransport = "stdio" | "sse" | "http";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  /** stdio only: path to executable */
  command?: string;
  /** stdio only: JSON-serialised string[] of args */
  args?: string;
  /** sse / http only: endpoint URL */
  url?: string;
  /** sse / http only: Bearer token for Authorization header */
  token?: string;
  /** JSON-serialised Record<string,string> of extra env vars */
  env?: string;
  enabled: boolean;
  createdAt: string;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  /** JSON Schema object for tool input */
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  /** Unique call ID generated by the model */
  id: string;
  name: string;
  serverName: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface MCPServerStatus {
  serverName: string;
  connected: boolean;
  error?: string;
  tools: MCPTool[];
}
