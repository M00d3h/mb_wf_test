import { useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  Check,
  MessageSquare,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore } from "../../store/chatStore";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";
import type { Conversation } from "@shared/types";

interface ArchivedChatsMenuProps {
  onClose: () => void;
}

function formatDateCreated(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
}

export function ArchivedChatsMenu({
  onClose,
}: ArchivedChatsMenuProps): JSX.Element {
  const {
    archivedConversations,
    fetchArchived,
    unarchiveConversation,
    selectArchivedConversation,
    deleteConversation,
    selectedConvId,
    setNavigationTarget,
  } = useChatStore();
  const { theme } = useThemeStore();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  const filteredArchived = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return archivedConversations;
    return archivedConversations.filter((c) =>
      (c.title || "Untitled").toLowerCase().includes(q),
    );
  }, [archivedConversations, searchQuery]);

  const openConversation = async (conv: Conversation): Promise<void> => {
    await selectArchivedConversation(conv.id);
    onClose();
    setNavigationTarget("/chat");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archived-chats-title"
        className={cn(
          "relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl ring-1 ring-white/[0.08]",
          archivedConversations.length > 0
            ? "h-[min(560px,85vh)]"
            : "max-h-[min(560px,85vh)]",
        )}
      >
        <header className="flex shrink-0 items-center justify-between px-4 py-3">
          <h2
            id="archived-chats-title"
            className="text-[15px] font-semibold tracking-tight text-zinc-100"
          >
            Archived chats
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {archivedConversations.length > 0 ? (
          <div className="shrink-0 px-4 pb-2 pt-0.5">
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl border border-zinc-700/55 bg-zinc-950/50 px-2.5 py-1.5",
                "ring-1 ring-inset ring-white/[0.04]",
              )}
            >
              <Search
                className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                strokeWidth={2}
                aria-hidden
              />
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search archived chats…"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
                aria-label="Search archived chats"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="rounded-md p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {archivedConversations.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-zinc-500">
              No archived conversations
            </p>
          ) : filteredArchived.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-zinc-500">
              No chats match &ldquo;{searchQuery.trim()}&rdquo;
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Name
                  </th>
                  <th className="hidden w-[11rem] px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 sm:table-cell">
                    Date created
                  </th>
                  <th className="w-20 px-2 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredArchived.map((conv) => (
                  <tr
                    key={conv.id}
                    className={cn(
                      "border-b border-white/[0.04] transition-colors last:border-b-0",
                      selectedConvId === conv.id
                        ? "bg-cyan-500/[0.07]"
                        : "hover:bg-white/[0.03]",
                    )}
                  >
                    <td className="max-w-0 px-4 py-2.5 align-middle">
                      <button
                        type="button"
                        onClick={() => void openConversation(conv)}
                        className="group flex min-w-0 w-full items-start gap-2 text-left"
                      >
                        <MessageSquare
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 shrink-0",
                            theme === "light"
                              ? "text-cyan-600"
                              : "text-cyan-500/90",
                          )}
                        />
                        <span
                          className={cn(
                            "min-w-0 truncate text-[13px] font-medium underline-offset-2 group-hover:underline",
                            theme === "light"
                              ? "text-cyan-600"
                              : "text-cyan-400/95",
                          )}
                          title={conv.title || "Untitled"}
                        >
                          {conv.title || "Untitled"}
                        </span>
                      </button>
                      <p className="mt-1 pl-[1.375rem] text-xs text-zinc-500 sm:hidden">
                        {formatDateCreated(conv.createdAt)}
                      </p>
                    </td>
                    <td className="hidden align-middle px-2 py-2.5 text-[13px] text-zinc-400 sm:table-cell">
                      {formatDateCreated(conv.createdAt)}
                    </td>
                    <td className="align-middle px-2 py-2">
                      {pendingDeleteId === conv.id ? (
                        <div
                          className="flex items-center justify-end gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="mr-1 text-[10px] text-zinc-500">
                            Delete?
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              void deleteConversation(conv.id);
                              setPendingDeleteId(null);
                            }}
                            className="rounded-md p-1.5 text-emerald-400 hover:bg-white/[0.06]"
                            title="Confirm"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              unarchiveConversation(conv.id);
                            }}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-cyan-400"
                            title="Unarchive"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteId(conv.id);
                            }}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
