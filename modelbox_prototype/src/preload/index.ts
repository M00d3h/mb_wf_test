import { contextBridge, ipcRenderer } from "electron";
import type {
  Model,
  Profile,
  ProfileConfig,
  AppSettings,
  ServerInstance,
  Conversation,
  Folder,
  Message,
  LogLine,
  QueueEntry,
  BuildCommandResult,
  ParseCommandLineResult,
  ChatParams,
  SystemStats,
  HfModelSearchPage,
  HfModelListSort,
  HfSearchModelsPayload,
  HfRepoFileInfo,
  HfRepoGgufFile,
  HfRepoSafetensorFile,
  HfVllmModelsResult,
  HfModelLibrary,
  VllmModel,
  VllmModelConfig,
  VllmProfile,
  VllmScanResult,
  HfDownloadResult,
  HfIncompleteDownloadInfo,
  HfLocalGgufStatusBatchPayload,
  HfLocalGgufStatusBatchResult,
  HfRepoReadmeResult,
  MCPServerConfig,
  MCPTool,
  MCPServerStatus,
  ToolCallResult,
  GpuDetectionResult,
  LlamaRuntimeInfo,
  VllmRuntimeInfo,
  VllmSetupMeta,
  UpdateCheckResult,
} from "@shared/types";

// Typed API surface exposed to renderer
const api = {
  // ── Models ────────────────────────────────────────────────────────
  models: {
    scan: (): Promise<Model[]> => ipcRenderer.invoke("models:scan"),
    list: (): Promise<Model[]> => ipcRenderer.invoke("models:list"),
    get: (id: string): Promise<Model | null> =>
      ipcRenderer.invoke("models:get", id),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke("models:delete", id),
  },

  // ── Profiles ──────────────────────────────────────────────────────
  profiles: {
    list: (modelId: string): Promise<Profile[]> =>
      ipcRenderer.invoke("profiles:list", modelId),
    create: (
      modelId: string,
      name: string,
      config: ProfileConfig,
      apiKey?: string,
    ): Promise<Profile> =>
      ipcRenderer.invoke("profiles:create", modelId, name, config, apiKey),
    update: (
      id: string,
      patch: { name?: string; config?: ProfileConfig; apiKey?: string | null },
    ): Promise<Profile> => ipcRenderer.invoke("profiles:update", id, patch),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke("profiles:delete", id),
    setActive: (id: string): Promise<void> =>
      ipcRenderer.invoke("profiles:set-active", id),
    duplicate: (id: string): Promise<Profile> =>
      ipcRenderer.invoke("profiles:duplicate", id),
    buildCommand: (
      id: string,
      opts?: {
        forceBuilder?: boolean;
        configOverride?: ProfileConfig;
        apiKeyOverride?: string | null;
      },
    ): Promise<BuildCommandResult> =>
      ipcRenderer.invoke("profiles:build-command", id, opts),
    parseCommandLine: (line: string): Promise<ParseCommandLineResult> =>
      ipcRenderer.invoke("profiles:parse-command-line", line),
    applyCustomCommandLine: (id: string, line: string): Promise<Profile> =>
      ipcRenderer.invoke("profiles:apply-custom-command-line", id, line),
    getApiKey: (id: string): Promise<string | null> =>
      ipcRenderer.invoke("profiles:get-api-key", id),
    setApiKey: (id: string, apiKey: string): Promise<void> =>
      ipcRenderer.invoke("profiles:set-api-key", id, apiKey),
  },

  // ── vLLM (local safetensor models) ────────────────────────────────
  vllm: {
    generationConfig: (modelPath: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke("vllm:generation-config", modelPath),
    configMeta: (modelPath: string): Promise<{ title: string | null; dtype: string | null; maxPositionEmbeddings: number | null } | null> =>
      ipcRenderer.invoke("vllm:config-meta", modelPath),
    list: (): Promise<VllmModel[]> => ipcRenderer.invoke("vllm:list"),
    scan: (): Promise<VllmScanResult> => ipcRenderer.invoke("vllm:scan"),
    get: (id: string): Promise<VllmModel | null> =>
      ipcRenderer.invoke("vllm:get", id),
    update: (
      id: string,
      patch: { displayName?: string; config?: Partial<VllmModelConfig> },
    ): Promise<VllmModel | null> =>
      ipcRenderer.invoke("vllm:update", id, patch),
    start: (vllmProfileId: string): Promise<ServerInstance> =>
      ipcRenderer.invoke("vllm:start", vllmProfileId),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke("vllm:delete", id),
    profiles: {
      list: (vllmModelId: string): Promise<VllmProfile[]> =>
        ipcRenderer.invoke("vllm:profiles:list", vllmModelId),
      create: (
        vllmModelId: string,
        name: string,
        config: VllmModelConfig,
      ): Promise<VllmProfile> =>
        ipcRenderer.invoke("vllm:profiles:create", vllmModelId, name, config),
      update: (
        id: string,
        patch: { name?: string; config?: VllmModelConfig },
      ): Promise<VllmProfile> =>
        ipcRenderer.invoke("vllm:profiles:update", id, patch),
      delete: (id: string): Promise<void> =>
        ipcRenderer.invoke("vllm:profiles:delete", id),
      setActive: (id: string): Promise<void> =>
        ipcRenderer.invoke("vllm:profiles:set-active", id),
      duplicate: (id: string): Promise<VllmProfile> =>
        ipcRenderer.invoke("vllm:profiles:duplicate", id),
      buildCommand: (
        id: string,
        opts?: {
          forceBuilder?: boolean;
          configOverride?: VllmModelConfig;
        },
      ): Promise<BuildCommandResult> =>
        ipcRenderer.invoke("vllm:profiles:build-command", id, opts),
      applyCustomCommandLine: (
        id: string,
        line: string,
      ): Promise<VllmProfile> =>
        ipcRenderer.invoke("vllm:profiles:apply-custom-command-line", id, line),
    },
  },

  // ── Server ────────────────────────────────────────────────────────
  server: {
    start: (
      profileId: string,
    ): Promise<{ instance: ServerInstance; queued: boolean }> =>
      ipcRenderer.invoke("server:start", profileId),
    stop: (instanceId: string): Promise<void> =>
      ipcRenderer.invoke("server:stop", instanceId),
    restart: (instanceId: string): Promise<ServerInstance> =>
      ipcRenderer.invoke("server:restart", instanceId),
    list: (): Promise<ServerInstance[]> => ipcRenderer.invoke("server:list"),
    getLogs: (instanceId: string): Promise<LogLine[]> =>
      ipcRenderer.invoke("server:get-logs", instanceId),
    queueList: (): Promise<QueueEntry[]> =>
      ipcRenderer.invoke("server:queue-list"),
    queueCancel: (id: string): Promise<void> =>
      ipcRenderer.invoke("server:queue-cancel", id),
    clearInstance: (instanceId: string): Promise<void> =>
      ipcRenderer.invoke("server:clear-instance", instanceId),
    getApiKey: (
      host: string,
      port: number,
      instanceId?: string,
      profileIdHint?: string,
    ): Promise<string | null> =>
      ipcRenderer.invoke(
        "server:get-api-key",
        host,
        port,
        instanceId,
        profileIdHint,
      ),
  },

  // ── Port ──────────────────────────────────────────────────────────
  port: {
    check: (
      port: number,
    ): Promise<{ available: boolean; suggestedPort?: number }> =>
      ipcRenderer.invoke("port:check", port),
  },

  // ── Conversations ─────────────────────────────────────────────────
  conversations: {
    list: (): Promise<Conversation[]> =>
      ipcRenderer.invoke("conversations:list"),
    listArchived: (): Promise<Conversation[]> =>
      ipcRenderer.invoke("conversations:list-archived"),
    get: (id: string): Promise<Conversation | null> =>
      ipcRenderer.invoke("conversations:get", id),
    create: (payload: {
      title: string;
      modelId?: string;
      instanceId?: string;
      instanceHost?: string;
      instancePort?: number;
      systemPrompt?: string;
      chatParams?: ChatParams;
    }): Promise<Conversation> =>
      ipcRenderer.invoke("conversations:create", payload),
    update: (
      id: string,
      patch: Partial<Omit<Conversation, "id" | "createdAt" | "updatedAt">>,
    ): Promise<Conversation> =>
      ipcRenderer.invoke("conversations:update", id, patch),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke("conversations:delete", id),
    toggleArchive: (id: string): Promise<Conversation> =>
      ipcRenderer.invoke("conversations:toggle-archive", id),
    search: (query: string): Promise<Conversation[]> =>
      ipcRenderer.invoke("conversations:search", query),
    setFolder: (convId: string, folderId: string | null): Promise<void> =>
      ipcRenderer.invoke("conversations:set-folder", convId, folderId),
  },

  // ── Folders ───────────────────────────────────────────────────────────
  folders: {
    list: (): Promise<Folder[]> => ipcRenderer.invoke("folders:list"),
    create: (name: string): Promise<Folder> =>
      ipcRenderer.invoke("folders:create", name),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke("folders:delete", id),
  },

  // ── Messages ──────────────────────────────────────────────────────
  messages: {
    list: (conversationId: string): Promise<Message[]> =>
      ipcRenderer.invoke("messages:list", conversationId),
    create: (payload: {
      conversationId: string;
      role: "user" | "assistant" | "system";
      content: string;
      tokenCount?: number;
      tokensPerSecond?: number;
      thinkDurationMs?: number;
      contextTokens?: number;
      contextSize?: number;
      promptProcessingMs?: number;
    }): Promise<Message> => ipcRenderer.invoke("messages:create", payload),
    delete: (messageId: string): Promise<void> =>
      ipcRenderer.invoke("messages:delete", messageId),
    deleteFrom: (
      conversationId: string,
      fromMessageId: string,
    ): Promise<void> =>
      ipcRenderer.invoke("messages:deleteFrom", conversationId, fromMessageId),
    update: (id: string, patch: { content?: string }): Promise<Message> =>
      ipcRenderer.invoke("messages:update", id, patch),
  },

  // ── Settings ──────────────────────────────────────────────────────
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke("settings:set", patch),
    setTheme: (theme: "system" | "light" | "dark"): void =>
      ipcRenderer.send("settings:set-theme", theme),
    pickDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("settings:pick-directory"),
    pickFile: (
      filters?: { name: string; extensions: string[] }[],
    ): Promise<string | null> =>
      ipcRenderer.invoke("settings:pick-file", filters),
  },

  // ── System ────────────────────────────────────────────────────────
  system: {
    getStats: (): Promise<SystemStats> => ipcRenderer.invoke("system:stats"),
    localIp: (): Promise<string> => ipcRenderer.invoke("system:local-ip"),
  },

  // ── Hugging Face Hub ──────────────────────────────────────────────
  hf: {
    searchModels: (
      query: string,
      limit?: number,
      cursorUrl?: string | null,
      listSort?: HfModelListSort,
      library?: HfModelLibrary,
    ): Promise<HfModelSearchPage> => {
      const payload: HfSearchModelsPayload = {
        query,
        limit: limit ?? 25,
        cursorUrl: cursorUrl ?? null,
        listSort: listSort ?? "trending",
        library: library ?? "llama",
      };
      return ipcRenderer.invoke("hf:search-models", payload);
    },
    listGgufFiles: (repoId: string): Promise<HfRepoGgufFile[]> =>
      ipcRenderer.invoke("hf:list-gguf-files", repoId),
    listSafetensorFiles: (repoId: string): Promise<HfRepoSafetensorFile[]> =>
      ipcRenderer.invoke("hf:list-safetensor-files", repoId),
    listVllmModels: (repoId: string): Promise<HfVllmModelsResult> =>
      ipcRenderer.invoke("hf:list-vllm-models", repoId),
    repoAllFiles: (repoId: string): Promise<HfRepoFileInfo[]> =>
      ipcRenderer.invoke("hf:repo-all-files", repoId),
    getPublisherAvatar: (publisher: string): Promise<string | null> =>
      ipcRenderer.invoke("hf:get-publisher-avatar", publisher),
    getPublisherAvatarsBatch: (publishers: string[]): Promise<Record<string, string | null>> =>
      ipcRenderer.invoke("hf:get-publisher-avatars-batch", publishers),
    localGgufStatusBatch: (
      payload: HfLocalGgufStatusBatchPayload,
    ): Promise<HfLocalGgufStatusBatchResult> =>
      ipcRenderer.invoke("hf:local-gguf-status-batch", payload),
    relatedMmprojExists: (payload: {
      repoId: string;
      modelRoots: string[];
    }): Promise<boolean> =>
      ipcRenderer.invoke("hf:related-mmproj-exists", payload),
    getRepoReadme: (repoId: string): Promise<HfRepoReadmeResult> =>
      ipcRenderer.invoke("hf:repo-readme", repoId),
    download: (payload: {
      downloadId: string;
      repoId: string;
      filename?: string;
      filenames?: string[];
      fileSizes?: number[];
      modelsDir?: string;
      destFolder?: string;
      vllmTarget?: boolean;
    }): Promise<HfDownloadResult> => ipcRenderer.invoke("hf:download", payload),
    cancelDownload: (downloadId: string): Promise<void> =>
      ipcRenderer.invoke("hf:cancel-download", downloadId),
    pauseDownload: (downloadId: string): Promise<void> =>
      ipcRenderer.invoke("hf:pause-download", downloadId),
    abandonDownload: (modelDir: string): Promise<void> =>
      ipcRenderer.invoke("hf:abandon-download", modelDir),
    getIncompleteMeta: (
      modelDir: string,
    ): Promise<HfIncompleteDownloadInfo | null> =>
      ipcRenderer.invoke("hf:get-incomplete-meta", modelDir),
    checkIncompleteMetas: (modelDirs: string[]): Promise<string[]> =>
      ipcRenderer.invoke("hf:check-incomplete-metas", modelDirs),
    getAllIncompleteMetas: (): Promise<HfIncompleteDownloadInfo[]> =>
      ipcRenderer.invoke("hf:get-all-incomplete-metas"),
    getToken: (): Promise<string | null> =>
      ipcRenderer.invoke("hf:get-token"),
    setToken: (token: string): Promise<void> =>
      ipcRenderer.invoke("hf:set-token", token),
  },

  // ── Runtime management ───────────────────────────────────────────
  runtime: {
    getStatus: (): Promise<{ llama: LlamaRuntimeInfo; vllm: VllmRuntimeInfo }> =>
      ipcRenderer.invoke("runtime:get-status"),
    detectGpu: (): Promise<GpuDetectionResult> =>
      ipcRenderer.invoke("runtime:detect-gpu"),
    installLlama: (): Promise<LlamaRuntimeInfo> =>
      ipcRenderer.invoke("runtime:install-llama"),
    setupVllm: (): Promise<VllmRuntimeInfo> =>
      ipcRenderer.invoke("runtime:setup-vllm"),
    updateLlama: (): Promise<LlamaRuntimeInfo> =>
      ipcRenderer.invoke("runtime:update-llama"),
    updateVllm: (): Promise<VllmRuntimeInfo> =>
      ipcRenderer.invoke("runtime:update-vllm"),
    getInterruptedVllmSetup: (): Promise<VllmSetupMeta | null> =>
      ipcRenderer.invoke("runtime:get-interrupted-vllm-setup"),
    respondVenvConfirm: (confirmed: boolean): Promise<void> =>
      ipcRenderer.invoke("runtime:respond-venv-confirm", confirmed),
  },

  // ── MCP ───────────────────────────────────────────────────────────
  mcp: {
    listServers: (): Promise<MCPServerConfig[]> =>
      ipcRenderer.invoke("mcp:servers:list"),
    createServer: (
      data: Omit<MCPServerConfig, "id" | "createdAt">,
    ): Promise<MCPServerConfig> =>
      ipcRenderer.invoke("mcp:servers:create", data),
    updateServer: (
      id: string,
      patch: Partial<Omit<MCPServerConfig, "id" | "createdAt">>,
    ): Promise<MCPServerConfig> =>
      ipcRenderer.invoke("mcp:servers:update", id, patch),
    deleteServer: (id: string): Promise<void> =>
      ipcRenderer.invoke("mcp:servers:delete", id),
    listTools: (): Promise<MCPTool[]> => ipcRenderer.invoke("mcp:tools:list"),
    getStatus: (): Promise<MCPServerStatus[]> =>
      ipcRenderer.invoke("mcp:status"),
    callTool: (
      serverName: string,
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<ToolCallResult> =>
      ipcRenderer.invoke("mcp:tools:call", serverName, toolName, args),
    reconnectAll: (): Promise<MCPServerStatus[]> =>
      ipcRenderer.invoke("mcp:reconnect-all"),
  },

  // ── Update ───────────────────────────────────────────────────────
  update: {
    check: (): Promise<UpdateCheckResult> => ipcRenderer.invoke("update:check"),
    openRelease: (url: string): Promise<void> =>
      ipcRenderer.invoke("update:open-release", url),
  },

  // ── Events ────────────────────────────────────────────────────────
  on: (
    channel:
      | "server:log-chunk"
      | "server:state-change"
      | "server:queue-update"
      | "hf:download-progress"
      | "mcp:status-update"
      | "runtime:progress",
    listener: (...args: unknown[]) => void,
  ): (() => void) => {
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("platform", process.platform);

export type ElectronAPI = typeof api;
