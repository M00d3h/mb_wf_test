import { create } from "zustand";
import { api } from "../lib/ipc";
import { resolveTransport, clearTransportCache } from "../lib/transport";
import {
  estimatePromptTokensFromMessages,
  type ChatMessage,
  type ContentPart,
  type OpenAITool,
} from "../lib/transport";
import type { Conversation, Folder, Message, ChatParams } from "@shared/types";
import { useMCPStore } from "./mcpStore";
import { v4 as uuidv4 } from "uuid";
import { useServerStore } from "./serverStore";
import { conversationMatchesInstance, isActiveState } from "../lib/serverInstanceMatch";

type Transport = Awaited<ReturnType<typeof resolveTransport>>;

// Module-level deduplication guard.
// Prevents React StrictMode's double-mount (and any other concurrent callers)
// from racing to create multiple empty conversations simultaneously.
let sessionEnsurePromise: Promise<void> | null = null;

// Abort controller for any in-flight background title generation.
// Cancelled at the start of every sendMessage so the server slot is freed
// before the next real user message begins prompt-processing.
let titleGenAbort: AbortController | null = null;

// Stores the first user message per conversation so title generation can be
// retried after the next response if it was aborted mid-stream.
// Keyed by conversationId; entry deleted once title is successfully written.
const pendingTitleByConv: Record<string, string> = {};

/**
 * Resolve the actual host/port to use for a conversation's bound server.
 *
 * Resolution order (most → least precise):
 *  1. Instance UUID — exact match, immune to same-port edge cases.
 *  2. modelId + port — matches "the running instance for model X on port P",
 *     which is what the user selects from the chat model dropdown.
 *  3. modelId alone — when only one instance of that model is running.
 *  4. Stored instanceHost / instancePort — legacy / last-resort fallback
 *     (matches running instances with the same loopback / 0.0.0.0 rules as the UI).
 */
function resolveConvEndpoint(
  conv: Pick<
    Conversation,
    "instanceId" | "modelId" | "instanceHost" | "instancePort"
  >,
): { host: string; port: number; profileId?: string; instanceId?: string; connectionHost?: string } | null {
  const { instances } = useServerStore.getState();
  // Running + loading + starting are all valid targets
  const active = instances.filter((i) => isActiveState(i.state));

  // 1. Exact UUID match — always authoritative
  if (conv.instanceId) {
    const byId =
      active.find((i) => i.id === conv.instanceId) ??
      instances.find((i) => i.id === conv.instanceId); // include errored/starting
    if (byId)
      return {
        host: byId.host,
        port: byId.port,
        profileId: byId.profileId ?? undefined,
        instanceId: byId.id,
        connectionHost: byId.connectionHost,
      };
    // UUID not found in store — the instance was stopped/removed. Fall through
    // to remaining tiers so we can still find a running server to route to.
  }

  // 2. modelId + port (user's preferred strategy for the dropdown)
  if (conv.modelId && conv.instancePort) {
    const byModelPort = active.find(
      (i) =>
        i.modelId === conv.modelId &&
        Number(i.port) === Number(conv.instancePort),
    );
    if (byModelPort)
      return {
        host: byModelPort.host,
        port: byModelPort.port,
        profileId: byModelPort.profileId ?? undefined,
        instanceId: byModelPort.id,
        connectionHost: byModelPort.connectionHost,
      };
  }

  // 3. modelId alone (single running instance of this model)
  if (conv.modelId) {
    const byModel = active.filter((i) => i.modelId === conv.modelId);
    if (byModel.length === 1)
      return {
        host: byModel[0].host,
        port: byModel[0].port,
        profileId: byModel[0].profileId ?? undefined,
        instanceId: byModel[0].id,
        connectionHost: byModel[0].connectionHost,
      };
    if (byModel.length > 1) {
      // Multiple instances of same model — prefer the port hint if available
      const hint = conv.instancePort
        ? byModel.find((i) => Number(i.port) === Number(conv.instancePort))
        : null;
      const chosen = hint ?? byModel[0];
      return {
        host: chosen.host,
        port: chosen.port,
        profileId: chosen.profileId ?? undefined,
        instanceId: chosen.id,
        connectionHost: chosen.connectionHost,
      };
    }
  }

  // 4. Stored host:port (legacy / fallback)
  if (conv.instanceHost && conv.instancePort) {
    const byHostPort = active.find((i) =>
      conversationMatchesInstance(conv.instanceHost, conv.instancePort, i),
    );
    if (byHostPort) {
      return {
        host: byHostPort.host,
        port: byHostPort.port,
        profileId: byHostPort.profileId ?? undefined,
        instanceId: byHostPort.id,
        connectionHost: byHostPort.connectionHost,
      };
    }
    return { host: conv.instanceHost, port: conv.instancePort };
  }

  return null;
}

async function generateTitle(
  transport: Transport,
  firstUserMessage: string,
  signal: AbortSignal,
): Promise<string> {
  const gen = transport.chat({
    messages: [
      {
        role: "system",
        content:
          "Generate a short title (3-6 words) for this chat. Reply with ONLY the title — no quotes, no punctuation at the end.",
      },
      { role: "user", content: firstUserMessage },
    ],
    signal,
    noThinking: true,
  });
  let title = "";
  for await (const token of gen) title += token;
  // Strip <think>...</think> blocks emitted by reasoning models
  const cleaned = title.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return cleaned.replace(/^["'*]+|["'*]+$/g, "").slice(0, 60);
}

interface ChatStore {
  conversations: Conversation[];
  archivedConversations: Conversation[];
  selectedConvId: string | null;
  messages: Record<string, Message[]>;
  streaming: boolean;
  streamingContent: string;
  liveTokensPerSecond: number | null;
  liveContextTokens: number | null;
  contextSize: number | null;
  livePhase: "processing" | "generating" | null;
  liveProcessingElapsedMs: number | null;
  liveTokenCount: number | null;
  liveGenElapsedMs: number | null;
  abortController: AbortController | null;
  loading: boolean;
  inputDraft: string | null;
  isTempChat: boolean;
  /**
   * The currently active unsaved conversation (both regular and temp modes).
   * Regular draft: exists in DB after first message is sent; graduated to the
   *   sidebar (conversations[]) only after title generation completes.
   * Temp draft (isTemp: true): never persisted to DB; only saved when the user
   *   explicitly clicks the save button.
   */
  draftConv: Conversation | null;
  /** Messages for a temp draftConv (in-memory only). Empty for regular drafts. */
  draftMessages: Message[];
  showArchivedMenu: boolean;
  setShowArchivedMenu: (show: boolean) => void;
  navigationTarget: string | null;
  setNavigationTarget: (target: string | null) => void;

  fetchConversations: () => Promise<void>;
  fetchArchived: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  /**
   * Called on ChatPage mount. Selects the most recently used conversation if one
   * exists, or creates a blank draft only when the list is truly empty.
   * Idempotent — concurrent calls (React StrictMode double-mount) deduplicate
   * against the module-level promise guard and never race to create duplicates.
   */
  ensureSessionConversation: () => Promise<void>;
  createConversation: (payload: {
    title: string;
    modelId?: string;
    instanceHost?: string;
    instancePort?: number;
    systemPrompt?: string;
    chatParams?: ChatParams;
  }) => Promise<Conversation>;
  updateConversation: (
    id: string,
    patch: Partial<Omit<Conversation, "id" | "createdAt" | "updatedAt">>,
  ) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  archiveConversation: (id: string) => Promise<void>;
  unarchiveConversation: (id: string) => Promise<void>;
  selectArchivedConversation: (id: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
    imageAttachments?: Array<{ dataUrl: string; name: string }>,
    onToken?: (token: string) => void,
  ) => Promise<void>;
  stopGeneration: () => void;
  setInputDraft: (text: string | null) => void;
  deleteMessage: (messageId: string, conversationId: string) => Promise<void>;
  updateMessageContent: (
    messageId: string,
    conversationId: string,
    content: string,
  ) => Promise<void>;
  /** Deletes the user message (and everything after) then loads its text into the input. */
  editUserMessage: (messageId: string, conversationId: string) => Promise<void>;
  /** Deletes the given assistant message (and everything after) then re-runs generation. */
  regenerateFrom: (
    assistantMessageId: string,
    conversationId: string,
  ) => Promise<void>;
  toggleTempChat: () => void;
  /** Persists the current temp draftConv to the DB and adds it to the sidebar. */
  saveTempChat: () => Promise<void>;

  // ── Folders ───────────────────────────────────────────────────────────────
  folders: Folder[];
  fetchFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<Folder>;
  deleteFolder: (id: string) => Promise<void>;
  setConversationFolder: (convId: string, folderId: string | null) => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  archivedConversations: [],
  selectedConvId: null,
  messages: {},
  streaming: false,
  streamingContent: "",
  liveTokensPerSecond: null,
  liveContextTokens: null,
  contextSize: null,
  livePhase: null,
  liveProcessingElapsedMs: null,
  liveTokenCount: null,
  liveGenElapsedMs: null,
  abortController: null,
  loading: false,
  inputDraft: null,
  isTempChat: false,
  draftConv: null,
  draftMessages: [],
  folders: [],
  showArchivedMenu: false,
  setShowArchivedMenu: (show) => set({ showArchivedMenu: show }),
  navigationTarget: null,
  setNavigationTarget: (target) => set({ navigationTarget: target }),

  fetchConversations: async () => {
    const conversations = await api.conversations.list();
    // Filter out the active draft so a remount can't prematurely add it to the sidebar.
    const draftId = get().draftConv?.id;
    set({
      conversations: draftId
        ? conversations.filter((c) => c.id !== draftId)
        : conversations,
    });
  },

  fetchArchived: async () => {
    const archived = await api.conversations.listArchived();
    set({ archivedConversations: archived });
  },

  ensureSessionConversation: () => {
    // If already running, return the same promise so concurrent callers
    // (React StrictMode double-mount) all await one operation rather than racing.
    if (sessionEnsurePromise) return sessionEnsurePromise;

    const run = async (): Promise<void> => {
      // Refresh the list so the sidebar is current on every mount
      await Promise.all([get().fetchConversations(), get().fetchFolders()]);
      const {
        selectedConvId,
        conversations,
        archivedConversations,
        draftConv,
        selectConversation,
        createConversation,
      } = get();

      // User already has a valid conversation open — leave it alone
      // This includes archived conversations (for read-only preview)
      if (
        selectedConvId &&
        (conversations.find((c) => c.id === selectedConvId) ||
          archivedConversations.find((c) => c.id === selectedConvId) ||
          draftConv?.id === selectedConvId)
      )
        return;

      // Pick the most recently created conversation if any exist
      if (conversations.length > 0) {
        await selectConversation(conversations[0].id);
        return;
      }

      // Truly empty — create the very first blank draft
      const conv = await createConversation({ title: "New Chat" });
      await selectConversation(conv.id);
    };

    sessionEnsurePromise = run().finally(() => {
      sessionEnsurePromise = null;
    });
    return sessionEnsurePromise;
  },

  selectConversation: async (id) => {
    set({ selectedConvId: id });
    if (!id) return;
    // Draft conv: messages are already in draftMessages (temp) or will be fetched lazily
    if (get().draftConv?.id === id) return;
    // Regular conversation: load messages from DB if not already cached
    if (!get().messages[id]) {
      const messages = await api.messages.list(id);
      set((s) => ({ messages: { ...s.messages, [id]: messages } }));
    }
  },

  createConversation: async (payload) => {
    // Always create in-memory first — never appears in the sidebar immediately.
    // Regular drafts are persisted to DB on first sendMessage.
    // Temp drafts are only persisted when the user explicitly saves.
    const conv: Conversation = {
      id: uuidv4(),
      title: payload.title || "New Chat",
      modelId: payload.modelId ?? null,
      instanceId: null,
      instanceHost: payload.instanceHost ?? null,
      instancePort: payload.instancePort ?? null,
      systemPrompt: payload.systemPrompt ?? null,
      chatParams: payload.chatParams ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isTemp: get().isTempChat,
    };
    set({ draftConv: conv, draftMessages: [] });
    return conv;
  },

  updateConversation: async (id, patch) => {
    const draft = get().draftConv;
    if (draft?.id === id) {
      const updated = {
        ...draft,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      // Graduate regular draft to sidebar when a real title is assigned.
      // Title generation only fires after sendMessage has already persisted the
      // conv to the DB, so it is safe to call api.conversations.update here.
      // We flush the full updated state (not just patch) to capture any
      // in-memory changes (instanceHost, modelId, etc.) made before persistence.
      if (!draft.isTemp && patch.title && patch.title !== "New Chat") {
        await api.conversations.update(id, {
          title: updated.title ?? undefined,
          modelId: updated.modelId ?? undefined,
          instanceId: updated.instanceId ?? undefined,
          instanceHost: updated.instanceHost ?? undefined,
          instancePort: updated.instancePort ?? undefined,
          systemPrompt: updated.systemPrompt ?? undefined,
          chatParams: updated.chatParams,
        });
        // Phase 1: add to sidebar with "New Chat" so StreamingText mounts and
        // can detect a text change on the next render.
        set((s) => ({
          conversations: [{ ...updated, title: "New Chat" }, ...s.conversations],
          draftConv: null,
        }));
        // Phase 2: after one React render, update to the real title so the
        // StreamingText animation fires (text changed "New Chat" → title).
        setTimeout(() => {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === id ? updated : c,
            ),
          }));
        }, 0);
      } else {
        // All other updates (instanceHost, modelId, chatParams, etc.) are kept
        // in-memory only. For regular drafts these will be included in the
        // api.conversations.create call inside sendMessage. For temp drafts they
        // are never persisted until the user explicitly saves.
        set({ draftConv: updated });
      }
      return;
    }
    // Apply the patch optimistically before the async DB round-trip so that
    // sendMessage (and any other reader of get().conversations) always sees the
    // latest selection, even if called within milliseconds of this update.
    const currentConv = get().conversations.find((c) => c.id === id);
    if (currentConv) {
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id
            ? { ...c, ...patch, updatedAt: new Date().toISOString() }
            : c,
        ),
      }));
    }
    const conv = await api.conversations.update(id, patch);
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? conv : c)),
    }));
  },

  deleteConversation: async (id) => {
    await api.conversations.delete(id);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      archivedConversations: s.archivedConversations.filter((c) => c.id !== id),
      selectedConvId: s.selectedConvId === id ? null : s.selectedConvId,
    }));
  },

  archiveConversation: async (id) => {
    const conv = await api.conversations.toggleArchive(id);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      archivedConversations: [
        conv,
        ...s.archivedConversations.filter((c) => c.id !== id),
      ],
      selectedConvId: s.selectedConvId === id ? null : s.selectedConvId,
    }));
  },

  unarchiveConversation: async (id) => {
    const conv = await api.conversations.toggleArchive(id);
    const messages = await api.messages.list(id);
    set((s) => ({
      conversations: [conv, ...s.conversations.filter((c) => c.id !== id)],
      archivedConversations: s.archivedConversations.filter((c) => c.id !== id),
      selectedConvId: id,
      messages: { ...s.messages, [id]: messages },
    }));
  },

  selectArchivedConversation: async (id) => {
    const messages = await api.messages.list(id);
    set({
      selectedConvId: id,
      messages: { ...get().messages, [id]: messages },
    });
  },

  sendMessage: async (convIdParam, content, imageAttachments, onToken) => {
    // If a background title-generation request is still running, abort it now so
    // the server slot is free before this message starts prompt-processing.
    titleGenAbort?.abort();
    titleGenAbort = null;

    // Resolve which conversation we're targeting.
    // Regular drafts are persisted to DB here (before saving any messages) so
    // that messages have a valid DB conversationId. The local conversationId
    // variable is updated to the DB-returned id if it changes.
    let conversationId = convIdParam;
    const draft = get().draftConv;
    const isDraftConv = draft?.id === convIdParam;
    // A draft is treated as temp if its isTemp flag is set OR if the user
    // currently has temp mode on — this handles the case where the draft was
    // created before temp mode was enabled (e.g. on first launch).
    const isTempDraft =
      isDraftConv && (draft!.isTemp === true || get().isTempChat);
    const isRegularDraft = isDraftConv && !isTempDraft;

    if (isRegularDraft) {
      // Persist the draft conversation to the DB now
      const persistedConv = await api.conversations.create({
        title: draft!.title,
        modelId: draft!.modelId ?? undefined,
        instanceId: draft!.instanceId ?? undefined,
        instanceHost: draft!.instanceHost ?? undefined,
        instancePort: draft!.instancePort ?? undefined,
        systemPrompt: draft!.systemPrompt ?? undefined,
        chatParams: draft!.chatParams,
      });
      conversationId = persistedConv.id;
      set({ draftConv: persistedConv, selectedConvId: persistedConv.id });
    }

    const conv =
      (get().draftConv?.id === conversationId ? get().draftConv : null) ??
      get().conversations.find((c) => c.id === conversationId);
    if (!conv) throw new Error("Conversation not found");
    const endpoint = resolveConvEndpoint(conv);
    if (!endpoint) {
      throw new Error("No server instance bound to this conversation");
    }
    // Save the first user message so we can generate a title later.
    // Only recorded once (when no entry exists yet for this conversation).
    // Skipped for temp drafts — they never get auto-titled.
    if (
      !isTempDraft &&
      conv.title === "New Chat" &&
      !pendingTitleByConv[conversationId]
    ) {
      pendingTitleByConv[conversationId] = content;
    }

    // Prepend image markers to the stored content so thumbnails can be
    // reconstructed in the UI after the message is saved.
    const imagePrefix = (imageAttachments ?? [])
      .map((img) => `<image name="${img.name}">\n${img.dataUrl}\n</image>`)
      .join("\n");
    const storedContent = imagePrefix
      ? imagePrefix + "\n\n" + content
      : content;

    // Save user message (in-memory for temp drafts, DB for everything else)
    let userMsg: Message;
    if (isTempDraft) {
      userMsg = {
        id: uuidv4(),
        conversationId,
        role: "user",
        content: storedContent,
        createdAt: new Date().toISOString(),
      };
      set((s) => ({ draftMessages: [...s.draftMessages, userMsg] }));
    } else {
      userMsg = await api.messages.create({
        conversationId,
        role: "user",
        content: storedContent,
      });
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: [...(s.messages[conversationId] ?? []), userMsg],
        },
      }));
    }

    // Build message history for the API call.
    // history includes the just-saved user message as its last element.
    // Strip display-only blocks (<image>, <pdf-preview>) from historical messages —
    // they are never re-sent to the model.
    const stripDisplayBlocks = (c: string): string =>
      c
        .replace(/<image name="[^"]*">\n[\s\S]*?\n<\/image>\n*/g, "")
        .replace(/<pdf-preview name="[^"]*">\n[\s\S]*?\n<\/pdf-preview>\n*/g, "")
        .trimStart();

    const history = isTempDraft
      ? get().draftMessages
      : (get().messages[conversationId] ?? []);
    const lastContent: string | ContentPart[] =
      imageAttachments && imageAttachments.length > 0
        ? [
            { type: "text", text: content },
            ...imageAttachments.map((img) => ({
              type: "image_url" as const,
              image_url: { url: img.dataUrl },
            })),
          ]
        : stripDisplayBlocks(content);
    const apiMessages = [
      ...(conv.systemPrompt
        ? [{ role: "system" as const, content: conv.systemPrompt }]
        : []),
      ...history.slice(0, -1).map((m) => ({
        role: m.role as "user" | "assistant",
        content: stripDisplayBlocks(m.content),
      })),
      { role: "user" as const, content: lastContent },
    ];

    const abort = new AbortController();
    const requestStartTime = Date.now();
    set({
      streaming: true,
      streamingContent: "",
      abortController: abort,
      livePhase: "processing",
      liveProcessingElapsedMs: 0,
    });

    // Start the UI interval immediately so the processing timer ticks smoothly
    // during the async transport-setup awaits that follow.
    let iterationPromptEstimate = estimatePromptTokensFromMessages(
      apiMessages as ChatMessage[],
    );
    let promptTokensThisRound: number | null = null;
    let fullContent = "";
    let genStartTime: number | null = null;
    let tokenCount = 0;
    let capturedPromptTokens: number | null = null;
    // Track completion tokens per round (overwrite on each usage event) and across rounds.
    // continuous_usage_stats sends cumulative counts every chunk (1,2,3..N) — we want
    // only the final value per round, committed when the next round starts.
    let completionTokensCurrentRound = 0;
    let completionTokensPreviousRounds = 0;
    let thinkBlockStartAt: number | null = null;
    let thinkTotalMs = 0;
    let pendingFlush = false;
    let pausedMs = 0;
    let pauseStartTime: number | null = null;
    // PP tracking: reset per-iteration so stats reflect the final (largest) context PP
    let lastIterationStartMs = requestStartTime;
    let lastIterationFirstTokenMs: number | null = null;
    let awaitingIterFirstToken = true;
    let inferenceStartTime = 0;

    const uiInterval = setInterval(() => {
      const isProcessing = genStartTime === null;
      // Skip t/s update while waiting for tool approval
      if (pauseStartTime !== null) return;
      const totalPaused = pausedMs;
      const elapsed = isProcessing ? 0 : (Date.now() - inferenceStartTime - totalPaused) / 1000;
      const capturedTotal = completionTokensPreviousRounds + completionTokensCurrentRound;
      const live = (elapsed > 0 && !suppressTps) ? (capturedTotal || tokenCount) / elapsed : null;
      const liveCtx =
        (promptTokensThisRound ?? iterationPromptEstimate) + tokenCount;
      const phase: "processing" | "generating" = isProcessing
        ? "processing"
        : "generating";
      const processingElapsed = isProcessing
        ? Date.now() - requestStartTime
        : null;
      const genElapsedMs = elapsed > 0 ? elapsed * 1000 : null;
      if (pendingFlush) {
        set({
          streamingContent: fullContent,
          liveTokensPerSecond: live,
          liveContextTokens: liveCtx,
          livePhase: phase,
          liveProcessingElapsedMs: processingElapsed,
          liveTokenCount: tokenCount,
          liveGenElapsedMs: genElapsedMs,
        });
        pendingFlush = false;
      } else {
        set({
          liveTokensPerSecond: live ?? get().liveTokensPerSecond,
          liveContextTokens: liveCtx,
          livePhase: phase,
          liveProcessingElapsedMs: processingElapsed,
          liveTokenCount: tokenCount,
          liveGenElapsedMs: genElapsedMs,
        });
      }
    }, 50);

    clearTransportCache(endpoint.host, endpoint.port);
    const apiKey =
      (await api.server.getApiKey(
        endpoint.host,
        endpoint.port,
        // Use the instanceId the endpoint actually resolved to, not the
        // potentially-stale conv.instanceId (which may point to a stopped
        // instance that is still in the DB with a different profile's key).
        endpoint.instanceId ?? conv.instanceId ?? undefined,
        endpoint.profileId,
      )) ?? undefined;
    const transport = await resolveTransport(endpoint.host, endpoint.port, apiKey, endpoint.connectionHost);

    const ctxSize = await transport.getContextSize();
    set({ contextSize: ctxSize });

    // Build enabled tools for this request
    const mcpStore = useMCPStore.getState();
    const enabledTools = mcpStore.getEnabledTools();
    const openAITools: OpenAITool[] = enabledTools.map((t) => ({
      type: 'function' as const,
      function: {
        name: `${t.serverName}__${t.name}`,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
    // Suppress TPS for vLLM+MCP: buffered streaming makes client-side measurement unreliable
    const isVllmInstance = useServerStore.getState().instances.find(i => i.id === endpoint.instanceId)?.instanceKind === 'vllm';
    const suppressTps = openAITools.length > 0 && isVllmInstance;

    try {
      inferenceStartTime = Date.now();
      const gen = transport.chat({
        messages: apiMessages,
        temperature: conv.chatParams.temp,
        top_p: conv.chatParams.topP,
        signal: abort.signal,
        noThinking: conv.chatParams.noThinking === true,
        onUsage: (u) => {
          capturedPromptTokens = u.promptTokens;
          completionTokensCurrentRound = u.completionTokens;
          promptTokensThisRound = u.promptTokens;
        },
        onChatIterationStart: (msgs) => {
          completionTokensPreviousRounds += completionTokensCurrentRound;
          completionTokensCurrentRound = 0;
          iterationPromptEstimate = estimatePromptTokensFromMessages(msgs);
          promptTokensThisRound = null;
        },
        tools: openAITools.length > 0 ? openAITools : undefined,
        onToolCall: async (call) => {
          const actualToolName = call.name.includes('__')
            ? call.name.slice(call.name.indexOf('__') + 2)
            : call.name;
          const serverName = call.name.includes('__')
            ? call.name.split('__')[0]
            : call.serverName;

          if (mcpStore.isAlwaysAllowed(serverName, actualToolName)) {
            pauseStartTime = Date.now();
            const result = await api.mcp.callTool(serverName, actualToolName, call.arguments);
            if (pauseStartTime !== null) { pausedMs += Date.now() - pauseStartTime; pauseStartTime = null; }
            return result;
          }

          // Flush content to UI before pausing so the ToolCallBlock is visible
          pendingFlush = false;
          set({ streamingContent: fullContent });
          // Pause t/s for the entire duration: approval wait + tool execution
          pauseStartTime = Date.now();
          const approval = await mcpStore.requestApproval({
            id: call.id,
            name: actualToolName,
            serverName,
            arguments: call.arguments,
          });
          if (!approval) {
            if (pauseStartTime !== null) { pausedMs += Date.now() - pauseStartTime; pauseStartTime = null; }
            return { content: 'Tool call denied by user.', isError: true };
          }
          const toolResult = await api.mcp.callTool(serverName, actualToolName, call.arguments);
          if (pauseStartTime !== null) { pausedMs += Date.now() - pauseStartTime; pauseStartTime = null; }
          return toolResult;
        },
      });

      for await (const token of gen) {
        const now = Date.now();
        if (genStartTime === null) genStartTime = now;
        if (awaitingIterFirstToken) {
          lastIterationFirstTokenMs = now;
          awaitingIterFirstToken = false;
        }
        fullContent += token;
        tokenCount++;
        pendingFlush = true;
        if (token === '<think>') thinkBlockStartAt = now;
        if (token === '</think>' && thinkBlockStartAt !== null) {
          thinkTotalMs += now - thinkBlockStartAt;
          thinkBlockStartAt = null;
        }
        // <tool_result> is the last token before the transport makes the next API request.
        // Reset PP tracking here so the next iteration's first-token latency is measured correctly.
        if (token.startsWith('<tool_result ')) {
          lastIterationStartMs = now;
          awaitingIterFirstToken = true;
        }
        onToken?.(token);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        fullContent += " [stopped]";
      } else {
        throw err;
      }
    } finally {
      clearInterval(uiInterval);
      const elapsed = inferenceStartTime > 0 ? (Date.now() - inferenceStartTime - pausedMs) / 1000 : 0;
      const finalTokenCount = (completionTokensPreviousRounds + completionTokensCurrentRound) || tokenCount;
      const tokensPerSecond = (elapsed > 0 && !suppressTps) ? finalTokenCount / elapsed : undefined;
      const thinkDurationMs = thinkTotalMs > 0 ? thinkTotalMs : undefined;
      const promptProcessingMs =
        lastIterationFirstTokenMs !== null
          ? lastIterationFirstTokenMs - lastIterationStartMs
          : genStartTime !== null ? genStartTime - requestStartTime : undefined;
      const finalContextTokens =
        (capturedPromptTokens ?? iterationPromptEstimate) + finalTokenCount;

      const streamingReset = {
        streaming: false,
        streamingContent: "",
        liveTokensPerSecond: null,
        liveContextTokens: null,
        livePhase: null,
        liveProcessingElapsedMs: null,
        liveTokenCount: null,
        liveGenElapsedMs: null,
        contextSize: null,
        abortController: null,
      };

      if (isTempDraft) {
        // Temp draft: store assistant message in-memory only
        const assistantMsg: Message = {
          id: uuidv4(),
          conversationId,
          role: "assistant",
          content: fullContent,
          tokenCount: finalTokenCount,
          tokensPerSecond,
          thinkDurationMs,
          contextTokens: finalContextTokens,
          contextSize: ctxSize ?? undefined,
          promptProcessingMs,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          draftMessages: [...s.draftMessages, assistantMsg],
          ...streamingReset,
        }));
      } else {
        // Regular conv (or persisted regular draft): save to DB
        const assistantMsg = await api.messages.create({
          conversationId,
          role: "assistant",
          content: fullContent,
          tokenCount: finalTokenCount,
          tokensPerSecond,
          thinkDurationMs,
          contextTokens: finalContextTokens,
          contextSize: ctxSize ?? undefined,
          promptProcessingMs,
        });
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: [
              ...(s.messages[conversationId] ?? []),
              assistantMsg,
            ],
          },
          ...streamingReset,
        }));
      }

      // Attempt title generation after every response while the conversation
      // is still untitled. Retries automatically if a previous attempt was
      // aborted by the user sending a follow-up message.
      // Skipped for temp drafts.
      if (!isTempDraft) {
        const savedContent = pendingTitleByConv[conversationId];
        const currentConv =
          get().draftConv?.id === conversationId
            ? get().draftConv
            : get().conversations.find((c) => c.id === conversationId);
        if (savedContent && currentConv?.title === "New Chat") {
          const abort = new AbortController();
          titleGenAbort = abort;
          generateTitle(transport, savedContent, abort.signal)
            .then((title) => {
              if (titleGenAbort === abort) titleGenAbort = null;
              delete pendingTitleByConv[conversationId];
              // updateConversation graduates the draft conv to the sidebar
              return get().updateConversation(conversationId, { title });
            })
            .catch((err: unknown) => {
              if (titleGenAbort === abort) titleGenAbort = null;
              if (!abort.signal.aborted) {
                console.warn('[chat] title generation failed:', err)
                delete pendingTitleByConv[conversationId];
              }
            });
        }
      }
    }
  },

  stopGeneration: () => {
    get().abortController?.abort();
  },

  setInputDraft: (text) => set({ inputDraft: text }),

  toggleTempChat: () =>
    set((s) => ({
      isTempChat: !s.isTempChat,
      // Sync the active draft's isTemp flag with the new mode, but only when
      // no messages have been sent yet — once messages exist we leave it alone.
      draftConv:
        s.draftConv && s.draftMessages.length === 0
          ? { ...s.draftConv, isTemp: !s.isTempChat }
          : s.draftConv,
    })),

  saveTempChat: async () => {
    const { draftConv, draftMessages } = get();
    if (!draftConv?.isTemp) {
      // Not a temp draft — just turn off temp mode
      set({ isTempChat: false });
      return;
    }

    // Empty temp draft: switch back to a normal draft without writing to the DB.
    // (Turning off temp with messages still saves below — "temp → saved chat".)
    if (draftMessages.length === 0) {
      set({
        isTempChat: false,
        draftConv: { ...draftConv, isTemp: false },
      });
      return;
    }

    // Persist the temp conversation and its messages to the DB
    const regularConv = await api.conversations.create({
      title: draftConv.title,
      modelId: draftConv.modelId ?? undefined,
      instanceId: draftConv.instanceId ?? undefined,
      instanceHost: draftConv.instanceHost ?? undefined,
      instancePort: draftConv.instancePort ?? undefined,
      systemPrompt: draftConv.systemPrompt ?? undefined,
      chatParams: draftConv.chatParams,
    });

    const savedMessages: Message[] = [];
    for (const msg of draftMessages) {
      const saved = await api.messages.create({
        conversationId: regularConv.id,
        role: msg.role,
        content: msg.content,
        tokenCount: msg.tokenCount,
        tokensPerSecond: msg.tokensPerSecond,
        thinkDurationMs: msg.thinkDurationMs,
        contextTokens: msg.contextTokens,
        contextSize: msg.contextSize,
        promptProcessingMs: msg.promptProcessingMs,
      });
      savedMessages.push(saved);
    }

    set((s) => ({
      conversations: [regularConv, ...s.conversations],
      messages: { ...s.messages, [regularConv.id]: savedMessages },
      selectedConvId: regularConv.id,
      draftConv: null,
      draftMessages: [],
      isTempChat: false,
    }));

    // Fire title generation in the background (same pattern as regular chats).
    // Strip display-only blocks so only the typed text reaches the title model.
    const stripImages = (c: string): string =>
      c
        .replace(/<image name="[^"]*">\n[\s\S]*?\n<\/image>\n*/g, "")
        .replace(/<pdf-preview name="[^"]*">\n[\s\S]*?\n<\/pdf-preview>\n*/g, "")
        .trimStart();
    const firstUserText = stripImages(
      draftMessages.find((m) => m.role === "user")?.content ?? "",
    );
    const titleEndpoint = resolveConvEndpoint(regularConv);
    if (firstUserText && titleEndpoint) {
      const { host: instanceHost, port: instancePort, profileId } = titleEndpoint;
      clearTransportCache(instanceHost, instancePort);
      api.server
        .getApiKey(
          instanceHost,
          instancePort,
          regularConv.instanceId ?? undefined,
          profileId,
        )
        .then(async (apiKey) => {
          const transport = await resolveTransport(
            instanceHost,
            instancePort,
            apiKey ?? undefined,
          );
          const abort = new AbortController();
          const title = await generateTitle(
            transport,
            firstUserText,
            abort.signal,
          );
          if (title) {
            const updatedConv = await api.conversations.update(regularConv.id, { title });
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === updatedConv.id ? updatedConv : c,
              ),
            }));
          }
        })
        .catch(() => {
          /* server offline — leave as "New Chat" */
        });
    }
  },

  deleteMessage: async (messageId, conversationId) => {
    if (get().draftConv?.id === conversationId && get().draftConv!.isTemp) {
      set((s) => ({
        draftMessages: s.draftMessages.filter((m) => m.id !== messageId),
      }));
      return;
    }
    await api.messages.delete(messageId);
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).filter(
          (m) => m.id !== messageId,
        ),
      },
    }));
  },

  updateMessageContent: async (messageId, conversationId, content) => {
    if (get().draftConv?.id === conversationId && get().draftConv!.isTemp) {
      set((s) => ({
        draftMessages: s.draftMessages.map((m) =>
          m.id === messageId ? { ...m, content } : m,
        ),
      }));
      return;
    }
    await api.messages.update(messageId, { content });
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, content } : m,
        ),
      },
    }));
  },

  editUserMessage: async (messageId, conversationId) => {
    const isTempDraft =
      get().draftConv?.id === conversationId &&
      get().draftConv!.isTemp === true;
    const msgs = isTempDraft
      ? get().draftMessages
      : (get().messages[conversationId] ?? []);
    const msgIdx = msgs.findIndex((m) => m.id === messageId);
    if (msgIdx === -1) return;
    const msg = msgs[msgIdx];
    if (isTempDraft) {
      set((s) => ({ draftMessages: s.draftMessages.slice(0, msgIdx) }));
    } else {
      await api.messages.deleteFrom(conversationId, messageId);
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).slice(0, msgIdx),
        },
      }));
    }
    const displayText = msg.content
      .replace(/<image name="[^"]*">\n[\s\S]*?\n<\/image>\n*/g, "")
      .replace(/<pdf-preview name="[^"]*">\n[\s\S]*?\n<\/pdf-preview>\n*/g, "")
      .replace(/<document name="[^"]*">\n[\s\S]*?\n<\/document>\n*/g, "")
      .trimStart();
    set({ inputDraft: displayText });
  },

  regenerateFrom: async (assistantMessageId, conversationId) => {
    const isTempDraft =
      get().draftConv?.id === conversationId &&
      get().draftConv!.isTemp === true;
    const conv =
      (get().draftConv?.id === conversationId ? get().draftConv : null) ??
      get().conversations.find((c) => c.id === conversationId);
    if (!conv) return;
    const endpoint = resolveConvEndpoint(conv);
    if (!endpoint) return;

    const msgs = isTempDraft
      ? get().draftMessages
      : (get().messages[conversationId] ?? []);
    const msgIdx = msgs.findIndex((m) => m.id === assistantMessageId);
    if (msgIdx === -1) return;

    if (isTempDraft) {
      set((s) => ({ draftMessages: s.draftMessages.slice(0, msgIdx) }));
    } else {
      await api.messages.deleteFrom(conversationId, assistantMessageId);
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).slice(0, msgIdx),
        },
      }));
    }

    const history = isTempDraft
      ? get().draftMessages
      : (get().messages[conversationId] ?? []);
    if (history.length === 0) return;

    const stripImgs = (c: string): string =>
      c
        .replace(/<image name="[^"]*">\n[\s\S]*?\n<\/image>\n*/g, "")
        .replace(/<pdf-preview name="[^"]*">\n[\s\S]*?\n<\/pdf-preview>\n*/g, "")
        .trimStart();

    const apiMessages = [
      ...(conv.systemPrompt
        ? [{ role: "system" as const, content: conv.systemPrompt }]
        : []),
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: stripImgs(m.content),
      })),
    ];

    let iterationPromptEstimate = estimatePromptTokensFromMessages(
      apiMessages as ChatMessage[],
    );
    let promptTokensThisRound: number | null = null;

    clearTransportCache(endpoint.host, endpoint.port);
    const apiKey =
      (await api.server.getApiKey(
        endpoint.host,
        endpoint.port,
        // Use the instanceId the endpoint actually resolved to, not the
        // potentially-stale conv.instanceId (which may point to a stopped
        // instance that is still in the DB with a different profile's key).
        endpoint.instanceId ?? conv.instanceId ?? undefined,
        endpoint.profileId,
      )) ?? undefined;
    const transport = await resolveTransport(endpoint.host, endpoint.port, apiKey, endpoint.connectionHost);
    const ctxSize = await transport.getContextSize();
    set({ contextSize: ctxSize });

    const abort = new AbortController();
    const requestStartTime = Date.now();
    set({
      streaming: true,
      streamingContent: "",
      abortController: abort,
      livePhase: "processing",
      liveProcessingElapsedMs: 0,
    });

    let fullContent = "";
    let genStartTime: number | null = null;
    let tokenCount = 0;
    let capturedPromptTokens: number | null = null;
    let capturedCompletionTokens2: number | null = null;
    let thinkBlockStartAt2: number | null = null;
    let thinkTotalMs2 = 0;
    let pendingFlush = false;
    let pausedMs2 = 0;
    let pauseStartTime2: number | null = null;
    let lastIterationStartMs2 = requestStartTime;
    let lastIterationFirstTokenMs2: number | null = null;
    let awaitingIterFirstToken2 = true;
    let inferenceStartTime2 = 0;

    const uiInterval = setInterval(() => {
      const isProcessing = genStartTime === null;
      if (pauseStartTime2 !== null) return;
      const totalPaused2 = pausedMs2;
      const elapsed = isProcessing ? 0 : (Date.now() - inferenceStartTime2 - totalPaused2) / 1000;
      const live = (elapsed > 0 && !suppressTps2) ? (capturedCompletionTokens2 ?? tokenCount) / elapsed : null;
      const liveCtx =
        (promptTokensThisRound ?? iterationPromptEstimate) + tokenCount;
      const phase: "processing" | "generating" = isProcessing
        ? "processing"
        : "generating";
      const processingElapsed = isProcessing
        ? Date.now() - requestStartTime
        : null;
      const genElapsedMs = elapsed > 0 ? elapsed * 1000 : null;
      if (pendingFlush) {
        set({
          streamingContent: fullContent,
          liveTokensPerSecond: live,
          liveContextTokens: liveCtx,
          livePhase: phase,
          liveProcessingElapsedMs: processingElapsed,
          liveTokenCount: tokenCount,
          liveGenElapsedMs: genElapsedMs,
        });
        pendingFlush = false;
      } else {
        set({
          liveTokensPerSecond: live ?? get().liveTokensPerSecond,
          liveContextTokens: liveCtx,
          livePhase: phase,
          liveProcessingElapsedMs: processingElapsed,
          liveTokenCount: tokenCount,
          liveGenElapsedMs: genElapsedMs,
        });
      }
    }, 50);

    const mcpStore2 = useMCPStore.getState();
    const enabledTools2 = mcpStore2.getEnabledTools();
    const openAITools2: OpenAITool[] = enabledTools2.map((t) => ({
      type: 'function' as const,
      function: {
        name: `${t.serverName}__${t.name}`,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
    const isVllmInstance2 = useServerStore.getState().instances.find(i => i.id === endpoint.instanceId)?.instanceKind === 'vllm';
    const suppressTps2 = openAITools2.length > 0 && isVllmInstance2;

    try {
      inferenceStartTime2 = Date.now();
      const gen = transport.chat({
        messages: apiMessages,
        temperature: conv.chatParams.temp,
        top_p: conv.chatParams.topP,
        signal: abort.signal,
        noThinking: conv.chatParams.noThinking === true,
        onUsage: (u) => {
          capturedPromptTokens = u.promptTokens;
          capturedCompletionTokens2 = u.completionTokens;
          promptTokensThisRound = u.promptTokens;
        },
        onChatIterationStart: (msgs) => {
          iterationPromptEstimate = estimatePromptTokensFromMessages(msgs);
          promptTokensThisRound = null;
        },
        tools: openAITools2.length > 0 ? openAITools2 : undefined,
        onToolCall: async (call) => {
          const actualToolName = call.name.includes('__')
            ? call.name.slice(call.name.indexOf('__') + 2)
            : call.name;
          const serverName = call.name.includes('__')
            ? call.name.split('__')[0]
            : call.serverName;
          if (mcpStore2.isAlwaysAllowed(serverName, actualToolName)) {
            return await api.mcp.callTool(serverName, actualToolName, call.arguments);
          }
          // Flush content to UI before pausing so the ToolCallBlock is visible
          pendingFlush = false;
          set({ streamingContent: fullContent });
          // Pause t/s for the entire duration: approval wait + tool execution
          pauseStartTime2 = Date.now();
          const approval = await mcpStore2.requestApproval({
            id: call.id,
            name: actualToolName,
            serverName,
            arguments: call.arguments,
          });
          if (!approval) {
            if (pauseStartTime2 !== null) { pausedMs2 += Date.now() - pauseStartTime2; pauseStartTime2 = null; }
            return { content: 'Tool call denied by user.', isError: true };
          }
          const toolResult2 = await api.mcp.callTool(serverName, actualToolName, call.arguments);
          if (pauseStartTime2 !== null) { pausedMs2 += Date.now() - pauseStartTime2; pauseStartTime2 = null; }
          return toolResult2;
        },
      });
      for await (const token of gen) {
        const now = Date.now();
        if (genStartTime === null) genStartTime = now;
        if (awaitingIterFirstToken2) {
          lastIterationFirstTokenMs2 = now;
          awaitingIterFirstToken2 = false;
        }
        fullContent += token;
        tokenCount++;
        pendingFlush = true;
        if (token === '<think>') thinkBlockStartAt2 = now;
        if (token === '</think>' && thinkBlockStartAt2 !== null) {
          thinkTotalMs2 += now - thinkBlockStartAt2;
          thinkBlockStartAt2 = null;
        }
        if (token.startsWith('<tool_result ')) {
          lastIterationStartMs2 = now;
          awaitingIterFirstToken2 = true;
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        fullContent += " [stopped]";
      } else {
        throw err;
      }
    } finally {
      clearInterval(uiInterval);
      const elapsed = inferenceStartTime2 > 0 ? (Date.now() - inferenceStartTime2 - pausedMs2) / 1000 : 0;
      const finalTokenCount2 = capturedCompletionTokens2 ?? tokenCount;
      const tokensPerSecond = (elapsed > 0 && !suppressTps2) ? finalTokenCount2 / elapsed : undefined;
      const thinkDurationMs = thinkTotalMs2 > 0 ? thinkTotalMs2 : undefined;
      const promptProcessingMs =
        lastIterationFirstTokenMs2 !== null
          ? lastIterationFirstTokenMs2 - lastIterationStartMs2
          : genStartTime !== null ? genStartTime - requestStartTime : undefined;
      const finalContextTokens =
        (capturedPromptTokens ?? iterationPromptEstimate) + finalTokenCount2;

      const streamingReset = {
        streaming: false,
        streamingContent: "",
        liveTokensPerSecond: null,
        liveContextTokens: null,
        livePhase: null,
        liveProcessingElapsedMs: null,
        liveTokenCount: null,
        liveGenElapsedMs: null,
        contextSize: null,
        abortController: null,
      };

      if (isTempDraft) {
        const assistantMsg: Message = {
          id: uuidv4(),
          conversationId,
          role: "assistant",
          content: fullContent,
          tokenCount: finalTokenCount2,
          tokensPerSecond,
          thinkDurationMs,
          contextTokens: finalContextTokens,
          contextSize: ctxSize ?? undefined,
          promptProcessingMs,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          draftMessages: [...s.draftMessages, assistantMsg],
          ...streamingReset,
        }));
      } else {
        const assistantMsg = await api.messages.create({
          conversationId,
          role: "assistant",
          content: fullContent,
          tokenCount: finalTokenCount2,
          tokensPerSecond,
          thinkDurationMs,
          contextTokens: finalContextTokens,
          contextSize: ctxSize ?? undefined,
          promptProcessingMs,
        });
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: [
              ...(s.messages[conversationId] ?? []),
              assistantMsg,
            ],
          },
          ...streamingReset,
        }));
      }
    }
  },

  // ── Folders ─────────────────────────────────────────────────────────────────

  fetchFolders: async () => {
    try {
      const folders = await api.folders.list();
      set({ folders });
    } catch (err) {
      console.error("[Folders] Fetch failed:", err);
    }
  },

  createFolder: async (name) => {
    const folder = await api.folders.create(name);
    set((s) => ({ folders: [...s.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) }));
    return folder;
  },

  deleteFolder: async (id) => {
    await api.folders.delete(id);
    // Move conversations that were in this folder back to unfiled
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      conversations: s.conversations.map((c) =>
        c.folderId === id ? { ...c, folderId: null } : c,
      ),
    }));
  },

  setConversationFolder: async (convId, folderId) => {
    await api.conversations.setFolder(convId, folderId);
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, folderId } : c,
      ),
    }));
  },
}));
