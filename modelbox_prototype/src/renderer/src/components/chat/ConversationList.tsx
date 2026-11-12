import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  SquarePen,
  Trash2,
  MessageSquare,
  X,
  Archive,
  Search,
  FolderPlus,
  Folder,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useChatStore } from "../../store/chatStore";
import { api } from "../../lib/ipc";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";
import { SidebarChatTitle } from "./SidebarChatTitle";
import type { Conversation, Folder as ChatFolder } from "@shared/types";

const FOLDER_COLLAPSE_STORAGE_KEY = "llamafront.sidebar.folderCollapseState";

type FolderCollapsePersist = {
  collapsedIds: string[];
  knownIds: string[];
};

function persistFolderCollapse(collapsed: Set<string>, foldersList: ChatFolder[]): void {
  try {
    const knownIds = foldersList.map((f) => f.id);
    const payload: FolderCollapsePersist = {
      collapsedIds: [...collapsed].filter((id) => knownIds.includes(id)),
      knownIds,
    };
    localStorage.setItem(FOLDER_COLLAPSE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

/** Restore collapsed set; new folders default collapsed; first run (no key) = all collapsed. */
function mergeCollapsedFromStorage(foldersList: ChatFolder[]): Set<string> {
  const ids = foldersList.map((f) => f.id);
  const raw = localStorage.getItem(FOLDER_COLLAPSE_STORAGE_KEY);
  if (raw === null) {
    return new Set(ids);
  }
  try {
    const data = JSON.parse(raw) as Partial<FolderCollapsePersist>;
    const known = new Set(data.knownIds ?? []);
    const savedCollapsed = new Set(data.collapsedIds ?? []);
    const next = new Set<string>();
    for (const id of ids) {
      if (!known.has(id)) {
        next.add(id);
      } else if (savedCollapsed.has(id)) {
        next.add(id);
      }
    }
    return next;
  } catch {
    return new Set(ids);
  }
}

export function ConversationList(): JSX.Element {
  const { theme } = useThemeStore();
  const {
    conversations,
    selectedConvId,
    selectConversation,
    createConversation,
    deleteConversation,
    updateConversation,
    archiveConversation,
    toggleTempChat,
    isTempChat,
    folders,
    createFolder,
    deleteFolder,
    setConversationFolder,
  } = useChatStore();

  const [deleteDialogConvId, setDeleteDialogConvId] = useState<string | null>(null);
  const [renameDialogConvId, setRenameDialogConvId] = useState<string | null>(null);
  const [renameInputValue, setRenameInputValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Folder state (collapsed when id is in set); persisted across sessions
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const foldersIdsSig = useMemo(
    () => folders.map((f) => f.id).sort().join("\0"),
    [folders],
  );

  useLayoutEffect(() => {
    if (folders.length === 0) {
      setCollapsedFolders(new Set());
      return;
    }
    const merged = mergeCollapsedFromStorage(folders);
    if (localStorage.getItem(FOLDER_COLLAPSE_STORAGE_KEY) === null) {
      persistFolderCollapse(merged, folders);
    }
    setCollapsedFolders(merged);
  }, [foldersIdsSig]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingFolderDeleteId, setPendingFolderDeleteId] = useState<string | null>(null);
  const [folderMenuConvId, setFolderMenuConvId] = useState<string | null>(null);
  const [folderMenuFilter, setFolderMenuFilter] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuSearchRef = useRef<HTMLInputElement>(null);
  const folderMenuScrollRef = useRef<HTMLDivElement>(null);
  const [folderMenuHighlightIndex, setFolderMenuHighlightIndex] = useState(0);
  const folderMenuHighlightIndexRef = useRef(0);
  const filteredFoldersForMenuRef = useRef<typeof folders>([]);
  const prevFolderMenuConvIdRef = useRef<string | null>(null);

  // Close delete and rename dialogs when switching selection (avoids stale modal)
  useEffect(() => {
    setDeleteDialogConvId(null);
    setRenameDialogConvId(null);
  }, [selectedConvId]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setSearchQuery("");
      setSearchResults(null);
    }
  }, [searchOpen]);

  // Auto-focus rename input when opened, select all text
  useEffect(() => {
    if (renameDialogConvId) {
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    }
  }, [renameDialogConvId]);

  // Auto-focus folder name input when opened
  useEffect(() => {
    if (newFolderOpen) {
      setTimeout(() => newFolderInputRef.current?.focus(), 0);
    }
  }, [newFolderOpen]);

  // Close folder assignment menu on outside click
  useEffect(() => {
    if (!folderMenuConvId) return;
    const handler = (e: MouseEvent): void => {
      if (!folderMenuRef.current?.contains(e.target as Node)) {
        setFolderMenuConvId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [folderMenuConvId]);

  // Reset filter + highlight + focus search when opening the move-to-folder menu (not on every store update)
  useEffect(() => {
    if (!folderMenuConvId) {
      setFolderMenuFilter("");
      prevFolderMenuConvIdRef.current = null;
      return;
    }
    const opening = prevFolderMenuConvIdRef.current !== folderMenuConvId;
    prevFolderMenuConvIdRef.current = folderMenuConvId;
    if (!opening) return;

    setFolderMenuFilter("");
    const conv = conversations.find((c) => c.id === folderMenuConvId);
    let hi = 0;
    if (conv?.folderId) {
      const fi = folders.findIndex((f) => f.id === conv.folderId);
      hi = fi >= 0 ? fi + 1 : 0;
    }
    setFolderMenuHighlightIndex(hi);
    const t = window.setTimeout(() => folderMenuSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [folderMenuConvId, conversations, folders]);

  useEffect(() => {
    folderMenuHighlightIndexRef.current = folderMenuHighlightIndex;
  }, [folderMenuHighlightIndex]);

  const folderMenuFilterNorm = folderMenuFilter.trim().toLowerCase();
  const filteredFoldersForMenu = folderMenuFilterNorm
    ? folders.filter((f) => f.name.toLowerCase().includes(folderMenuFilterNorm))
    : folders;

  useEffect(() => {
    filteredFoldersForMenuRef.current = filteredFoldersForMenu;
  }, [filteredFoldersForMenu]);

  // Keep highlight in range when filter narrows the list
  useEffect(() => {
    if (!folderMenuConvId) return;
    const count = 1 + filteredFoldersForMenu.length;
    setFolderMenuHighlightIndex((h) => Math.min(h, Math.max(0, count - 1)));
  }, [folderMenuConvId, filteredFoldersForMenu.length]);

  // Arrow keys + Enter for move-to-folder menu (only while focus is inside the menu row)
  // Escape closes from anywhere so the menu can be dismissed after clicking elsewhere
  useEffect(() => {
    if (!folderMenuConvId) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const count = 1 + filteredFoldersForMenuRef.current.length;
      if (count <= 0) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setFolderMenuConvId(null);
        return;
      }

      const ae = document.activeElement;
      const focusInMenu =
        ae instanceof Node && folderMenuRef.current?.contains(ae);
      if (!focusInMenu) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFolderMenuHighlightIndex((h) => (h + 1) % count);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFolderMenuHighlightIndex((h) => (h - 1 + count) % count);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const convId = folderMenuConvId;
        if (!convId) return;
        const h = folderMenuHighlightIndexRef.current;
        const list = filteredFoldersForMenuRef.current;
        if (h === 0) {
          void setConversationFolder(convId, null);
        } else {
          const f = list[h - 1];
          if (f) void setConversationFolder(convId, f.id);
        }
        setFolderMenuConvId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [folderMenuConvId, setConversationFolder]);

  // Scroll highlighted folder row into view
  useEffect(() => {
    if (!folderMenuConvId) return;
    const el = folderMenuScrollRef.current?.querySelector(
      `[data-folder-menu-item="${String(folderMenuHighlightIndex)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [folderMenuConvId, folderMenuHighlightIndex]);

  // Debounced search
  useEffect(() => {
    if (!searchOpen) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await api.conversations.search(searchQuery.trim());
        setSearchResults(results);
      } catch (err) {
        console.error("[Search] IPC error:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, searchOpen]);

  const deleteTargetTitle = useMemo(() => {
    if (!deleteDialogConvId) return "";
    const c =
      conversations.find((x) => x.id === deleteDialogConvId) ??
      searchResults?.find((x) => x.id === deleteDialogConvId);
    return c?.title ?? "this chat";
  }, [deleteDialogConvId, conversations, searchResults]);

  const handleNew = async (): Promise<void> => {
    if (isTempChat) toggleTempChat();
    const conv = await createConversation({ title: "New Chat" });
    selectConversation(conv.id);
  };

  const handleConvClick = (convId: string): void => {
    if (isTempChat) toggleTempChat();
    setFolderMenuConvId(null);
    selectConversation(convId);
  };

  const toggleFolder = (folderId: string): void => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      persistFolderCollapse(next, folders);
      return next;
    });
  };

  const handleCreateFolder = async (): Promise<void> => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolder(name);
      setNewFolderName("");
      setNewFolderOpen(false);
    } catch (err) {
      console.error("[Folders] Create failed:", err);
    }
  };

  // Split conversations into unfiled and per-folder (always uses full list — search has its own render path)
  const unfiledConvs = conversations.filter((c) => !c.folderId);
  const folderMap = new Map(folders.map((f) => [f.id, conversations.filter((c) => c.folderId === f.id)]));

  const renderConvRow = (conv: Conversation): JSX.Element => (
    <div
      key={conv.id}
      ref={folderMenuConvId === conv.id ? folderMenuRef : undefined}
      onClick={() => handleConvClick(conv.id)}
      className={cn(
        "group relative flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
        folderMenuConvId === conv.id && "z-20",
        selectedConvId === conv.id
          ? "bg-cyan-500/10 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
      )}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0" />
      <SidebarChatTitle text={conv.title} />

      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                "rounded-md p-1 text-zinc-500 outline-none transition-[opacity,colors] duration-75",
                "opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100",
                "hover:bg-zinc-800/90 hover:text-zinc-200",
                "focus-visible:ring-2 focus-visible:ring-cyan-500/30",
                "data-[state=open]:bg-zinc-800/90 data-[state=open]:text-zinc-200",
              )}
              aria-label="Chat actions"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className={cn(
                "z-[60] flex min-w-[11rem] flex-col gap-0 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-1 backdrop-blur-md",
                theme === "light"
                  ? "shadow-sm shadow-black/10"
                  : "shadow-xl shadow-black/50",
              )}
            >
              {folders.length > 0 ? (
                <>
                  <DropdownMenu.Item
                    className={cn(
                      "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-200 outline-none",
                      "data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100",
                    )}
                    onSelect={() => {
                      setFolderMenuConvId(folderMenuConvId === conv.id ? null : conv.id);
                    }}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="flex-1 text-left">Move to folder</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-0.5 h-px shrink-0 bg-zinc-800/90" />
                </>
              ) : null}
              <DropdownMenu.Item
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-200 outline-none",
                  "data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100",
                )}
                onSelect={() => {
                  setRenameDialogConvId(conv.id);
                  setRenameInputValue(conv.title);
                }}
              >
                <SquarePen className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-200 outline-none",
                  "data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100",
                )}
                onSelect={() => {
                  void archiveConversation(conv.id);
                }}
              >
                <Archive className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                Archive
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none",
                  "text-red-400 data-[highlighted]:bg-red-500/15 data-[highlighted]:text-red-300",
                )}
                onSelect={() => setDeleteDialogConvId(conv.id)}
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {folderMenuConvId === conv.id && folders.length > 0 && (
        <div
          className={cn(
            "absolute left-0 right-0 top-full mt-1 flex w-full min-w-0 flex-col bg-zinc-900 border border-zinc-700/80 rounded-lg z-50 overflow-hidden",
            theme === "light"
              ? "shadow-sm shadow-black/10"
              : "shadow-xl shadow-black/50",
          )}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 px-2 pt-2 pb-1.5 border-b border-zinc-800/90 shrink-0">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" strokeWidth={2} aria-hidden />
            <input
              ref={folderMenuSearchRef}
              type="text"
              value={folderMenuFilter}
              onChange={(e) => setFolderMenuFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setFolderMenuConvId(null);
                }
              }}
              placeholder="Filter folders…"
              className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
              aria-label="Filter folders"
            />
          </div>
          <div
            ref={folderMenuScrollRef}
            className="overflow-y-auto max-h-[min(50vh,16rem)] py-1"
            role="listbox"
            aria-label="Folders"
            aria-activedescendant={
              folderMenuConvId === conv.id
                ? `folder-menu-opt-${conv.id}-${String(folderMenuHighlightIndex)}`
                : undefined
            }
          >
            <button
              id={`folder-menu-opt-${conv.id}-0`}
              type="button"
              data-folder-menu-item="0"
              role="option"
              aria-selected={folderMenuHighlightIndex === 0}
              onClick={() => {
                setConversationFolder(conv.id, null);
                setFolderMenuConvId(null);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors rounded-md mx-0.5",
                !conv.folderId ? "text-cyan-400" : "text-zinc-300 hover:bg-zinc-800",
                folderMenuHighlightIndex === 0 && "bg-zinc-800/90 ring-1 ring-inset ring-white/[0.07]",
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" /> No folder
            </button>
            {filteredFoldersForMenu.map((f, i) => {
              const idx = i + 1;
              return (
                <button
                  key={f.id}
                  id={`folder-menu-opt-${conv.id}-${String(idx)}`}
                  type="button"
                  data-folder-menu-item={String(idx)}
                  role="option"
                  aria-selected={folderMenuHighlightIndex === idx}
                  onClick={() => {
                    setConversationFolder(conv.id, f.id);
                    setFolderMenuConvId(null);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors truncate rounded-md mx-0.5",
                    conv.folderId === f.id ? "text-cyan-400" : "text-zinc-300 hover:bg-zinc-800",
                    folderMenuHighlightIndex === idx && "bg-zinc-800/90 ring-1 ring-inset ring-white/[0.07]",
                  )}
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" /> {f.name}
                </button>
              );
            })}
            {filteredFoldersForMenu.length === 0 && folderMenuFilterNorm ? (
              <div className="px-3 py-2 text-xs text-zinc-500">No matching folders</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header: New Chat + Search + New Folder */}
      <div className="px-3 pt-3 pb-2 shrink-0 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleNew}
          className={cn(
            "group w-full flex h-9 items-center justify-start gap-2.5 rounded-xl pl-3 pr-3 text-sm font-medium tracking-tight text-left text-zinc-400",
            "bg-zinc-900/40 border border-zinc-700/50 ring-1 ring-inset ring-white/[0.04]",
            theme === "light"
              ? "shadow-none"
              : "shadow-sm shadow-black/20",
            "hover:bg-zinc-800/55 hover:border-zinc-600/55 hover:text-zinc-200",
            "active:translate-y-px transition-[transform,background-color,color,border-color] duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
          )}
        >
          <SquarePen
            className="h-4 w-4 shrink-0 text-zinc-500 opacity-90 group-hover:text-zinc-300 transition-colors"
            strokeWidth={2}
            aria-hidden
          />
          <span>New chat</span>
        </button>

        <div className="flex gap-2">
          {/* Search toggle */}
          {searchOpen ? (
            <div
              className={cn(
                "flex-1 min-w-0 flex items-center gap-2 rounded-xl px-2.5 py-1.5 overflow-hidden",
                "bg-zinc-900/50 border border-zinc-700/55 ring-1 ring-inset ring-white/[0.05]",
                "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
              )}
            >
              <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" strokeWidth={2} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
                placeholder="Search chats…"
                className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
              {searching && (
                <span className="text-xs text-zinc-500 shrink-0 tabular-nums">…</span>
              )}
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300 shrink-0 transition-colors"
                title="Close search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 h-9 rounded-xl text-sm font-medium text-zinc-400",
                "bg-zinc-900/40 border border-zinc-700/50 ring-1 ring-inset ring-white/[0.04]",
                theme === "light"
                  ? "shadow-none"
                  : "shadow-sm shadow-black/20",
                "hover:bg-zinc-800/55 hover:border-zinc-600/55 hover:text-zinc-200",
                "active:translate-y-px transition-[transform,background-color,color,border-color] duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              )}
              title="Search conversations"
            >
              <Search className="w-3.5 h-3.5 opacity-90" strokeWidth={2} />
              Search
            </button>
          )}

          {/* New folder button */}
          {!searchOpen && (
            <button
              type="button"
              onClick={() => setNewFolderOpen((v) => !v)}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-[transform,background-color,border-color,color] duration-150",
                "border ring-1 ring-inset ring-white/[0.04]",
                theme === "light"
                  ? "shadow-none"
                  : "shadow-sm shadow-black/20",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                newFolderOpen
                  ? "text-cyan-300 border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/16"
                  : "text-zinc-500 border-zinc-700/50 bg-zinc-900/40 hover:bg-zinc-800/55 hover:border-zinc-600/55 hover:text-zinc-300",
              )}
              title="New folder"
            >
              <FolderPlus className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Inline folder name input */}
        {newFolderOpen && (
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <input
              ref={newFolderInputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setNewFolderOpen(false);
                  setNewFolderName("");
                }
              }}
              placeholder="Folder name…"
              className={cn(
                "flex-1 min-w-0 rounded-xl border border-zinc-700/55 bg-zinc-900/50 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500",
                "ring-1 ring-inset ring-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
                "focus:outline-none focus:border-cyan-500/40 focus:ring-cyan-500/15",
              )}
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
              className="shrink-0 rounded-lg p-1.5 text-cyan-400 hover:bg-zinc-800/80 hover:text-cyan-300 disabled:cursor-default disabled:opacity-40 transition-colors"
              title="Create folder"
            >
              <Check className="w-3.5 h-3.5" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => {
                setNewFolderOpen(false);
                setNewFolderName("");
              }}
              className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300 transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Search results mode — only shown when search is open AND there's an active query */}
        {searchOpen && searchQuery.trim() ? (
          searching ? (
            <div className="text-sm text-zinc-600 text-center py-8">Searching…</div>
          ) : searchResults === null ? (
            <div className="text-sm text-zinc-600 text-center py-8">Searching…</div>
          ) : searchResults.length === 0 ? (
            <div className="text-sm text-zinc-600 text-center py-8">
              No results for &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            searchResults.map(renderConvRow)
          )
        ) : (
          <>
            {/* Folders first */}
            {folders.map((folder) => {
              const folderConvs = folderMap.get(folder.id) ?? [];
              const isCollapsed = collapsedFolders.has(folder.id);
              return (
                <div key={folder.id}>
                  {/* Folder header */}
                  <div className="group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-zinc-800/30 transition-colors">
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 text-zinc-400 hover:text-zinc-200"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0" />
                      )}
                      {isCollapsed ? (
                        <Folder className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                      )}
                      <span className="text-sm truncate">{folder.name}</span>
                      <span className="text-xs text-zinc-600 ml-1 shrink-0">
                        {folderConvs.length}
                      </span>
                    </button>

                    {/* Folder delete */}
                    {pendingFolderDeleteId === folder.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); setPendingFolderDeleteId(null); }}
                          className="text-red-400 hover:text-red-300 p-0.5"
                          title="Confirm delete folder"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setPendingFolderDeleteId(null); }}
                          className="text-zinc-500 hover:text-zinc-300 p-0.5"
                          title="Cancel"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingFolderDeleteId(folder.id); }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 p-0.5 transition-opacity duration-75 shrink-0"
                        title="Delete folder"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Folder conversations */}
                  {!isCollapsed && (
                    <div className="pl-2 ml-2 border-l border-white/[0.06]">
                      {folderConvs.length === 0 ? (
                        <div className="text-xs text-zinc-600 py-2 px-3">Empty folder</div>
                      ) : (
                        folderConvs.map(renderConvRow)
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unfiled conversations below folders */}
            {unfiledConvs.length === 0 && folders.length === 0 && (
              <div className="text-sm text-zinc-600 text-center py-8">
                No conversations yet
              </div>
            )}
            {unfiledConvs.map(renderConvRow)}
          </>
        )}
      </div>

      <Dialog.Root
        open={deleteDialogConvId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogConvId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-[2px]"
          />
          <Dialog.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-[201] w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 -translate-y-1/2",
              "rounded-2xl border border-zinc-700/80 bg-zinc-900 p-5",
              "ring-1 ring-white/[0.04] focus:outline-none",
              theme === "light"
                ? "shadow-sm shadow-black/15"
                : "shadow-2xl shadow-black/60",
            )}
          >
            <Dialog.Title className="text-base font-semibold text-zinc-100">
              Delete chat?
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-sm leading-relaxed text-zinc-400">
              This will delete{" "}
              <span className="font-medium text-zinc-200">{deleteTargetTitle}</span>
              .
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    "rounded-full border border-zinc-600/70 bg-zinc-800/80 px-4 py-2 text-sm font-medium text-zinc-200",
                    "transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-50",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40",
                  )}
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={cn(
                  "rounded-full border border-red-800/70 bg-red-900/85 px-4 py-2 text-sm font-medium text-red-100",
                  "transition-colors",
                  theme === "light"
                    ? "shadow-none"
                    : "shadow-sm shadow-black/25",
                  "hover:border-red-600/55 hover:bg-red-800/90 hover:text-white",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-red-800/45",
                )}
                onClick={() => {
                  if (deleteDialogConvId) {
                    void deleteConversation(deleteDialogConvId);
                    setDeleteDialogConvId(null);
                  }
                }}
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Rename dialog */}
      <Dialog.Root
        open={renameDialogConvId !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogConvId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-[2px]"
          />
          <Dialog.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-[201] w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 -translate-y-1/2",
              "rounded-2xl border border-zinc-700/80 bg-zinc-900 p-5",
              "ring-1 ring-white/[0.04] focus:outline-none",
              theme === "light"
                ? "shadow-sm shadow-black/15"
                : "shadow-2xl shadow-black/60",
            )}
          >
            <Dialog.Title className="text-base font-semibold text-zinc-100">
              Rename chat
            </Dialog.Title>
            <input
              ref={renameInputRef}
              type="text"
              value={renameInputValue}
              onChange={(e) => setRenameInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameDialogConvId && renameInputValue.trim()) {
                  void updateConversation(renameDialogConvId, { title: renameInputValue.trim() });
                  setRenameDialogConvId(null);
                }
                if (e.key === "Escape") {
                  setRenameDialogConvId(null);
                }
              }}
              placeholder="Chat name…"
              className={cn(
                "mt-3 w-full rounded-xl border border-zinc-700/55 bg-zinc-900/50 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500",
                "ring-1 ring-inset ring-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
                "focus:outline-none focus:border-cyan-500/40 focus:ring-cyan-500/15",
              )}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    "rounded-full border border-zinc-600/70 bg-zinc-800/80 px-4 py-2 text-sm font-medium text-zinc-200",
                    "transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-50",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40",
                  )}
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                disabled={!renameInputValue.trim()}
                className={cn(
                  "rounded-full border border-cyan-800/70 bg-cyan-900/85 px-4 py-2 text-sm font-medium text-cyan-100",
                  "transition-colors",
                  theme === "light"
                    ? "shadow-none"
                    : "shadow-sm shadow-black/25",
                  "hover:border-cyan-600/55 hover:bg-cyan-800/90 hover:text-white",
                  "disabled:cursor-default disabled:opacity-40",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40",
                )}
                onClick={() => {
                  if (renameDialogConvId && renameInputValue.trim()) {
                    void updateConversation(renameDialogConvId, { title: renameInputValue.trim() });
                    setRenameDialogConvId(null);
                  }
                }}
              >
                Save
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
