import { useEffect, useRef } from "react";
import { AlertTriangle, ArchiveRestore, ChevronLeft, List } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useServerStore } from "../store/serverStore";
import { useModelsStore } from "../store/modelsStore";
import { useThemeStore } from "../store/themeStore";
import { cn } from "../lib/utils";
import { conversationMatchesInstance, isActiveState } from "../lib/serverInstanceMatch";
import { ConversationList } from "../components/chat/ConversationList";
import { MessageThread } from "../components/chat/MessageThread";
import { ChatInput } from "../components/chat/ChatInput";
import { ModelPicker } from "../components/chat/ModelPicker";
import TempChatToggle from "../components/chat/TempChatToggle";

export function ChatPage(): JSX.Element {
  const {
    conversations,
    draftConv,
    archivedConversations,
    selectedConvId,
    ensureSessionConversation,
    updateConversation,
    unarchiveConversation,
    setShowArchivedMenu,
  } = useChatStore();
  const { instances, fetchInstances } = useServerStore();
  const { fetchModels } = useModelsStore();
  const { theme } = useThemeStore();

  // On mount: kick off independent fetches in parallel.
  // ensureSessionConversation handles fetchConversations internally and is
  // safe to call concurrently — the module-level guard deduplicates any
  // double-invocation from React StrictMode.
  // Skip fetchModels when the store was already populated (e.g. from Models)
  // to avoid an extra IPC round-trip on every sidebar switch.
  useEffect(() => {
    void fetchInstances();
    const { models } = useModelsStore.getState();
    if (models.length === 0) {
      void fetchModels();
    }
    void ensureSessionConversation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedConv =
    conversations.find((c) => c.id === selectedConvId) ??
    archivedConversations.find((c) => c.id === selectedConvId) ??
    (draftConv?.id === selectedConvId ? draftConv : undefined);

  // Auto-bind: once per conversation, pick a running instance when the
  // conversation has none yet. A ref gates repeated firing so that IPC
  // state-change events (which refresh `instances`) don't race with a manual
  // instance selection in the dropdown and overwrite the user's choice.
  //
  // Priority: (1) the instance the user last explicitly selected via the model
  // picker, (2) the only running instance when exactly one exists, (3) the
  // first in the list as a last resort. This prevents silently routing to the
  // wrong model when multiple instances are running.
  const autoBindFiredRef = useRef(false);
  useEffect(() => {
    autoBindFiredRef.current = false;
  }, [selectedConvId]);

  useEffect(() => {
    if (!selectedConv) return;
    const running = instances.filter((i) => isActiveState(i.state));

    // If the conversation has a bound instance, check whether it is still active.
    // UUID is definitive when present — host:port matching would falsely treat a
    // NEW instance on the same port as "the same instance still running".
    if (selectedConv.instanceId || selectedConv.instanceHost) {
      const boundIsActive = running.some((i) =>
        selectedConv.instanceId
          ? i.id === selectedConv.instanceId
          : conversationMatchesInstance(selectedConv.instanceHost, selectedConv.instancePort, i),
      );
      if (boundIsActive) return;
      // Bound instance is gone — clear the gate so we can rebind below.
      autoBindFiredRef.current = false;
    }

    if (autoBindFiredRef.current) return;
    if (running.length === 0) return;
    // Only auto-bind when there is exactly one running instance.
    // When multiple instances are running the user must pick explicitly —
    // silently routing to one of them causes API-key errors when that model
    // requires a key but the user intended a different one.
    const preferred = running.length === 1 ? running[0] : null;
    if (preferred) {
      autoBindFiredRef.current = true;
      updateConversation(selectedConv.id, {
        instanceId: preferred.id,
        instanceHost: preferred.host,
        instancePort: preferred.port,
        modelId: preferred.modelId,
      });
    }
  }, [selectedConv?.id, instances]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full min-h-0 gap-3 px-3 pb-3 pt-2">
      {/* Left: conversation list */}
      <div className="w-52 shrink-0 rounded-2xl bg-zinc-900/30 ring-1 ring-white/[0.05] min-h-0 overflow-hidden flex flex-col">
        <ConversationList />
      </div>

      {/* Right: chat area */}
      <div className="flex-1 flex flex-col overflow-hidden rounded-2xl bg-zinc-900/20 ring-1 ring-white/[0.04] min-w-0 min-h-0">
        {selectedConv ? (
          <>
            {/* Toolbar */}
            <div className="flex shrink-0 items-center gap-2 px-4 py-2 min-h-[2.75rem]">
              <ModelPicker conversationId={selectedConv.id} />
              {(() => {
                const activeInstances = instances.filter((i) => isActiveState(i.state));
                const hasMatch = activeInstances.some(
                  (i) =>
                    (selectedConv.instanceId && i.id === selectedConv.instanceId) ||
                    conversationMatchesInstance(selectedConv.instanceHost, selectedConv.instancePort, i),
                );
                return !hasMatch;
              })() && (
                <div
                  className={cn(
                    "inline-flex max-w-[min(100%,32rem)] shrink items-center gap-1.5 rounded-full px-2.5 py-1 pl-2 text-[12.5px] font-medium leading-tight ring-1 ring-inset",
                    theme === "light"
                      ? "border border-amber-600/40 bg-amber-50 text-amber-950 ring-amber-700/15 shadow-none"
                      : "border border-amber-500/25 bg-amber-500/[0.07] text-amber-200/95 ring-amber-400/10 shadow-sm shadow-black/20",
                  )}
                  role="status"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      theme === "light"
                        ? "bg-amber-200/90 text-amber-900"
                        : "bg-amber-500/15 text-amber-400",
                    )}
                  >
                    <AlertTriangle
                      className="h-3 w-3"
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 pr-0.5">
                    <span className="hidden md:inline">
                      No model selected. Pick a model from the dropdown box.
                    </span>
                    <span className="md:hidden">No model selected.</span>
                  </span>
                </div>
              )}
              {selectedConv.isArchived ? (
                <button
                  type="button"
                  onClick={() => setShowArchivedMenu(true)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
                  title="Open archived chats"
                >
                  <ChevronLeft className="h-3.5 w-3.5 text-zinc-500" />
                  <List className="h-3.5 w-3.5 text-cyan-500/90" />
                  <span className="hidden sm:inline">Archived chats</span>
                </button>
              ) : null}
              <div className="flex-1 min-w-0" />
              {selectedConv?.id === draftConv?.id && (
                <TempChatToggle conversationId={selectedConv.id} />
              )}
            </div>

            {/* Messages */}
            <MessageThread conversationId={selectedConv.id} />

            {/* Archived banner or Input */}
            {selectedConv.isArchived ? (
              <div className="mt-auto border-t border-white/[0.06] bg-zinc-950/50 px-4 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-zinc-500">
                    Archived · read-only
                  </p>
                  <button
                    type="button"
                    onClick={() => void unarchiveConversation(selectedConv.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border border-zinc-600/70 bg-zinc-800/90 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-cyan-500/40 hover:bg-zinc-800 hover:text-white",
                      theme === "light"
                        ? "shadow-none ring-1 ring-zinc-700/20"
                        : "shadow-sm",
                    )}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5 text-cyan-500/90" />
                    Unarchive
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex w-full shrink-0 justify-center">
                <div className="w-full max-w-[min(70.4rem,92%)]">
                  <ChatInput conversationId={selectedConv.id} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center flex-1 text-zinc-600 text-base">
            Select or create a conversation
          </div>
        )}
      </div>
    </div>
  );
}
