import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowUp,
  CircleStop,
  Plus,
  X,
  FileText,
  Files,
  Image as ImageIcon,
  Brain,
  ToggleLeft,
  ToggleRight,
  Search,
  Settings,
} from "lucide-react";
import { Icon } from "@iconify/react";
import { useChatStore } from "../../store/chatStore";
import { useModelsStore } from "../../store/modelsStore";
import { useServerStore } from "../../store/serverStore";
import { useVllmStore } from "../../store/vllmStore";
import { useMCPStore } from "../../store/mcpStore";
import { ImageLightbox } from "../shared/ImageLightbox";
import { DocumentPreviewModal } from "../shared/DocumentPreviewModal";
import { PdfPagesPreviewModal } from "../shared/PdfPagesPreviewModal";
import { FileChipHoverTooltip } from "../shared/FileChipHoverTooltip";
import {
  isThinkingCapableModel,
  isThinkingCapableVllmModel,
  isVisionCapableVllmModel,
  modelHasVisionCapability,
  resolveProfileMmprojForModel,
} from "../../lib/modelCapabilities";
import { cn } from "../../lib/utils";
import { extractPdfText, renderPdfPages, PDF_MAX_VISION_PAGES } from "../../lib/pdfUtils";
import { useThemeStore } from "../../store/themeStore";
import { conversationMatchesInstance } from "../../lib/serverInstanceMatch";
import { getFileTypeInfo } from "../../lib/fileTypeIcons";
import mcpSvgUrl from "../../assets/mcp.svg";
import type { MCPTool } from "@shared/types";

/** Same cap as `max-h-72` (18rem @ 16px) — scroll area cannot exceed this. */
const MCP_LIST_MAX_HEIGHT_PX = 288;

/**
 * Approximate unfiltered MCP list height so search filtering does not shrink the panel.
 */
function estimateMcpListBodyMinHeightPx(tools: MCPTool[]): number {
  if (tools.length === 0) return 0;
  const serverNames = [...new Set(tools.map((t) => t.serverName))];
  const HEADER_PX = 36;
  const TOOL_ROW_PX = 40;
  const GROUP_GAP_PX = 4;
  const PAD_PX = 8;
  let h = PAD_PX;
  for (let i = 0; i < serverNames.length; i++) {
    if (i > 0) h += GROUP_GAP_PX;
    const sn = serverNames[i]!;
    const n = tools.filter((t) => t.serverName === sn).length;
    h += HEADER_PX + n * TOOL_ROW_PX;
  }
  return Math.min(MCP_LIST_MAX_HEIGHT_PX, h);
}

// ── Context ring ──────────────────────────────────────────────────────────────

function ContextRing({
  tokens,
  total,
}: {
  tokens: number;
  total: number;
}): JSX.Element {
  const { theme } = useThemeStore();
  const pct = Math.min(tokens / total, 1);
  const pctInt = Math.round(pct * 100);
  const size = 20;
  const sw = 2;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  /* Cyan (theme) → amber → red as context fills — no purple */
  const stroke =
    pct > 0.9 ? "#f87171" : pct > 0.7 ? "#fbbf24" : "#22d3ee";

  return (
    <div className="relative group" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        style={{
          display: "block",
          filter:
            theme === "light"
              ? "drop-shadow(0 1px 1px rgba(0,0,0,0.08))"
              : "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
        }}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#3f3f46"
          strokeWidth={sw}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {/* Tooltip — fade/slide in on hover (no display:none so motion can run) */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-max",
          "opacity-0 translate-y-1.5 scale-[0.97]",
          "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100",
        )}
        role="tooltip"
      >
        <div
          className={cn(
            "rounded-xl border border-zinc-700/50 bg-zinc-900/90 px-3 py-2 backdrop-blur-md",
            "ring-1 ring-inset ring-white/[0.06]",
            theme === "light"
              ? "shadow-sm shadow-black/10"
              : "shadow-2xl shadow-black/50",
          )}
        >
          <p className="font-mono text-xs tabular-nums leading-none text-zinc-100">
            {tokens.toLocaleString()} / {total.toLocaleString()}
          </p>
          <p className="mt-1.5 flex items-baseline gap-1.5 text-xs leading-tight text-zinc-500">
            <span className="font-medium tabular-nums text-zinc-300">
              {pctInt}%
            </span>
            <span>context used</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AttachFile {
  id: string;
  type: "image" | "document" | "pdf-pages";
  name: string;
  data: string; // data URL for image/pdf-pages first page, plain text for document
  pages?: string[]; // rendered page data URLs, only for pdf-pages
}

interface Props {
  conversationId: string;
}

/** ~2 lines at text-base + leading-snug — minimum visible typing area */
const MIN_TEXTAREA_HEIGHT_PX = 52;

/**
 * Floating t/s + ctx line above the composer while streaming. Disabled by default
 * because `LiveStatsRow` in MessageThread already shows the same live metrics.
 */
const SHOW_LIVE_STATS_ABOVE_INPUT = false;

export function ChatInput({ conversationId }: Props): JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AttachFile[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMCPPanel, setShowMCPPanel] = useState(false);
  const [mcpToolSearch, setMcpToolSearch] = useState("");
  const [mcpSearchExpanded, setMcpSearchExpanded] = useState(false);
  const mcpSearchInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const mcpPanelRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const activePreview =
    previewIndex !== null && attachments[previewIndex]
      ? attachments[previewIndex]
      : null;

  useEffect(() => {
    if (previewIndex === null) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setPreviewIndex(null);
      if (e.key === "ArrowRight" && previewIndex < attachments.length - 1)
        setPreviewIndex((i) => (i ?? 0) + 1);
      if (e.key === "ArrowLeft" && previewIndex > 0)
        setPreviewIndex((i) => (i ?? 0) - 1);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [previewIndex, attachments.length]);

  const {
    sendMessage,
    streaming,
    stopGeneration,
    liveTokensPerSecond,
    liveContextTokens,
    contextSize,
    livePhase,
    liveProcessingElapsedMs,
    conversations,
    messages,
    inputDraft,
    setInputDraft,
    draftConv,
    draftMessages,
    updateConversation,
  } = useChatStore();

  const convMessages =
    draftConv?.id === conversationId && draftConv.isTemp
      ? draftMessages
      : (messages[conversationId] ?? []);

  // History navigation state (like terminal up/down arrow)
  const historyIndexRef = useRef(-1);
  const savedTextRef = useRef("");

  // Load inputDraft set by editUserMessage action
  useEffect(() => {
    if (inputDraft !== null) {
      setText(inputDraft);
      setInputDraft(null);
      // Reset history position when new draft arrives
      historyIndexRef.current = -1;
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [inputDraft, setInputDraft]);

  // Derive ring data: live values during streaming, last assistant message otherwise

  const lastCtxMsg = [...convMessages]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        m.contextTokens != null &&
        m.contextSize != null,
    );
  const ringTokens =
    streaming && liveContextTokens !== null
      ? liveContextTokens
      : (lastCtxMsg?.contextTokens ?? null);
  const ringSize =
    streaming && contextSize !== null
      ? contextSize
      : (lastCtxMsg?.contextSize ?? null);
  const { models, profiles, fetchProfiles } = useModelsStore();
  const { models: vllmModels } = useVllmStore();
  const { instances } = useServerStore();
  const { theme } = useThemeStore();
  const {
    tools: mcpTools,
    mcpGloballyEnabled,
    setMcpGloballyEnabled,
    isToolEnabled,
    setToolEnabled,
    setServerToolsEnabled,
    getEnabledTools,
    status: mcpStatus,
    loadTools: loadMCPTools,
    refreshStatus: refreshMCPStatus,
  } = useMCPStore();

  const mcpToolsFiltered = useMemo(() => {
    const q = mcpToolSearch.trim().toLowerCase();
    if (!q) return mcpTools;
    return mcpTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.serverName.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [mcpTools, mcpToolSearch]);

  const mcpListBodyMinHeightPx = useMemo(
    () => estimateMcpListBodyMinHeightPx(mcpTools),
    [mcpTools],
  );

  /** Measured height when the full list is visible — used so "no search results" matches exactly. */
  const [mcpListBaselineHeightPx, setMcpListBaselineHeightPx] = useState<number | null>(null);
  const mcpListBodyRef = useRef<HTMLDivElement>(null);

  const mcpListAppliedMinHeightPx = useMemo(() => {
    const est = mcpListBodyMinHeightPx;
    const base = mcpListBaselineHeightPx;
    if (base != null && base > 0) return Math.max(base, est);
    return est;
  }, [mcpListBodyMinHeightPx, mcpListBaselineHeightPx]);

  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const syncTextareaHeight = useCallback((): void => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxPx = parseFloat(getComputedStyle(ta).maxHeight);
    const maxH = Number.isFinite(maxPx) ? maxPx : 272;
    const scrollH = ta.scrollHeight;
    const next = Math.min(
      Math.max(scrollH, MIN_TEXTAREA_HEIGHT_PX),
      maxH,
    );
    ta.style.height = `${next}px`;
    ta.style.overflowY = scrollH > maxH ? "auto" : "hidden";
  }, []);

  // Grow the field upward (layout pushes the thread) until max height, then scroll.
  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [text, syncTextareaHeight]);

  useEffect(() => {
    window.addEventListener("resize", syncTextareaHeight);
    return () => window.removeEventListener("resize", syncTextareaHeight);
  }, [syncTextareaHeight]);

  // Determine whether the current conversation's model supports vision.
  // Prefer the running instance's model when host/port match — it stays
  // authoritative after switching instances via the model dropdown.
  const conv =
    conversations.find((c) => c.id === conversationId) ??
    (draftConv?.id === conversationId ? draftConv : undefined);
  // Resolve bound instance: prefer instanceId (UUID) for precision, then
  // host:port matching as fallback for legacy conversations.
  const boundInstance =
    (conv?.instanceId
      ? instances.find((i) => i.id === conv.instanceId)
      : null) ??
    instances.find((i) =>
      conversationMatchesInstance(conv?.instanceHost, conv?.instancePort, i),
    );
  // Prefer the running instance's modelId for capability checks — it reflects
  // the actual loaded model after a stop/start switch. Fall back to conv.modelId
  // (which the dropdown sets optimistically) only when no instance is bound.
  const modelId = boundInstance?.modelId ?? conv?.modelId;
  const model = models.find((m) => m.id === modelId);

  const profileMmprojForVision = useMemo(() => {
    if (!modelId) return undefined;
    const list = profiles[modelId];
    if (!list?.length) return undefined;
    if (boundInstance) {
      const bp = list.find((p) => p.id === boundInstance.profileId);
      const v = bp?.config.mmproj?.trim();
      if (v) return v;
    }
    return resolveProfileMmprojForModel(modelId, profiles);
  }, [modelId, boundInstance?.profileId, profiles]);

  useEffect(() => {
    if (!modelId) return;
    void fetchProfiles(modelId);
  }, [modelId, fetchProfiles]);

  const isVllmInstance = boundInstance?.instanceKind === "vllm";
  const vllmModel = isVllmInstance
    ? vllmModels.find((m) => m.id === boundInstance!.vllmModelId)
    : undefined;
  const isVisionModel =
    modelHasVisionCapability(model, profileMmprojForVision) ||
    (isVllmInstance && isVisionCapableVllmModel(vllmModel));
  const supportsThinking = isVllmInstance
    ? isThinkingCapableVllmModel(vllmModel)
    : isThinkingCapableModel(model);
  const thinkingSuppressed = conv?.chatParams?.noThinking === true;
  const thinkingActive = supportsThinking && !thinkingSuppressed;

  const toggleThinkingMode = (): void => {
    if (!conv || !supportsThinking) return;
    void updateConversation(conversationId, {
      chatParams: {
        ...conv.chatParams,
        noThinking: thinkingSuppressed ? false : true,
      },
    });
  };

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent): void => {
      if (!attachMenuRef.current?.contains(e.target as Node))
        setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAttachMenu]);

  // Close MCP panel on outside click
  useEffect(() => {
    if (!showMCPPanel) return;
    const handler = (e: MouseEvent): void => {
      if (!mcpPanelRef.current?.contains(e.target as Node))
        setShowMCPPanel(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMCPPanel]);

  useEffect(() => {
    if (!showMCPPanel) {
      setMcpToolSearch("");
      setMcpSearchExpanded(false);
      setMcpListBaselineHeightPx(null);
    }
  }, [showMCPPanel]);

  /** Capture real list body height while the unfiltered list is shown (search empty, has rows). */
  useLayoutEffect(() => {
    if (!showMCPPanel || mcpTools.length === 0) return;
    if (mcpToolSearch.trim() !== "") return;
    if (mcpToolsFiltered.length === 0) return;

    let cancelled = false;
    let raf2 = 0;
    const measure = (): void => {
      if (cancelled) return;
      const el = mcpListBodyRef.current;
      if (!el) return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) setMcpListBaselineHeightPx(h);
    };

    measure();
    const raf1 = requestAnimationFrame(() => {
      measure();
      raf2 = requestAnimationFrame(measure);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [
    showMCPPanel,
    mcpTools,
    mcpToolSearch,
    mcpToolsFiltered.length,
  ]);

  useEffect(() => {
    if (mcpSearchExpanded) {
      mcpSearchInputRef.current?.focus();
    }
  }, [mcpSearchExpanded]);

  // Load MCP tools + connection status on mount; retry after init — main may still be connecting.
  useEffect(() => {
    void loadMCPTools();
    const t = window.setTimeout(() => {
      void refreshMCPStatus();
    }, 1600);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const readAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const readAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });

  const handleImageFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await readAsDataURL(file);
    setAttachments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: "image", name: file.name, data },
    ]);
    e.target.value = "";
    setShowAttachMenu(false);
  };

  const handleDocFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      await processPdfFile(file);
    } else {
      const data = await readAsText(file);
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), type: "document", name: file.name, data },
      ]);
    }
    e.target.value = "";
    setShowAttachMenu(false);
  };

  const removeAttachment = (id: string): void =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const processPdfFile = async (file: File): Promise<void> => {
    if (isVisionModel) {
      try {
        const pages = await renderPdfPages(file);
        if (pages.length === 0) {
          setError("Could not render PDF pages.");
          setTimeout(() => setError(null), 4000);
          return;
        }
        if (pages[0]!.totalPages > PDF_MAX_VISION_PAGES) {
          setError(
            `PDF has ${pages[0]!.totalPages} pages — only the first ${PDF_MAX_VISION_PAGES} are attached.`,
          );
          setTimeout(() => setError(null), 5000);
        }
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "pdf-pages" as const,
            name: file.name,
            data: pages[0]!.dataUrl,
            pages: pages.map((p) => p.dataUrl),
          },
        ]);
      } catch (err) {
        console.error("[PDF] renderPdfPages failed:", err);
        setError("Failed to render PDF. The file may be encrypted or corrupted.");
        setTimeout(() => setError(null), 4000);
      }
    } else {
      try {
        const text = await extractPdfText(file);
        if (!text.trim()) {
          setError(
            "No text found in this PDF. If it contains scanned images, attach it with a vision-capable model.",
          );
          setTimeout(() => setError(null), 5000);
          return;
        }
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), type: "document" as const, name: file.name, data: text },
        ]);
      } catch (err) {
        console.error("[PDF] extractPdfText failed:", err);
        setError("Failed to read PDF. The file may be encrypted or corrupted.");
        setTimeout(() => setError(null), 4000);
      }
    }
  };

  const processFile = async (file: File): Promise<void> => {
    if (file.type.startsWith("image/")) {
      if (!isVisionModel) {
        setError("This model does not support image attachments");
        setTimeout(() => setError(null), 3000);
        return;
      }
      const data = await readAsDataURL(file);
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), type: "image", name: file.name || "image", data },
      ]);
    } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      await processPdfFile(file);
    } else {
      const data = await readAsText(file);
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), type: "document", name: file.name || "file", data },
      ]);
    }
  };

  const handlePaste = async (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ): Promise<void> => {
    const items = e.clipboardData.items;
    let hasAttachments = false;

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (!file) continue;
        hasAttachments = true;
        await processFile(file);
      }
    }

    if (hasAttachments) {
      e.preventDefault();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await processFile(file);
    }
  };

  const handleSend = async (): Promise<void> => {
    if ((!text.trim() && attachments.length === 0) || streaming || isModelNotReady) return;

    const docs = attachments.filter((a) => a.type === "document");
    const images = attachments.flatMap((a) => {
      if (a.type === "image") return [a];
      if (a.type === "pdf-pages") {
        return (a.pages ?? [a.data]).map((url, i) => ({
          ...a,
          type: "image" as const,
          data: url,
          name: `${a.name} — page ${i + 1}`,
        }));
      }
      return [];
    });

    let content = text.trim();

    // Prepend document text wrapped in tags so the model sees clear context
    if (docs.length > 0) {
      const preamble = docs
        .map((d) => `<document name="${d.name}">\n${d.data}\n</document>`)
        .join("\n\n");
      content = preamble + (content ? "\n\n" + content : "");
    }

    setText("");
    setAttachments([]);
    setError(null);
    historyIndexRef.current = -1;

    try {
      await sendMessage(
        conversationId,
        content,
        images.map((a) => ({ dataUrl: a.data, name: a.name })),
      );
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  const stripAttachmentMarkers = useCallback(
    (content: string): string =>
      content
        .replace(/<image name="[^"]*">\n[\s\S]*?\n<\/image>\n*/g, "")
        .replace(/<document name="[^"]*">\n[\s\S]*?\n<\/document>\n*/g, "")
        .trimStart(),
    [],
  );

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      historyIndexRef.current = -1;
      handleSend();
      return;
    }

    if (e.key === "ArrowUp") {
      // Only intercept when the cursor is on the first line
      const ta = textareaRef.current;
      if (!ta) return;
      const onFirstLine = !ta.value.slice(0, ta.selectionStart).includes("\n");
      if (!onFirstLine) return;

      const userMsgs = convMessages.filter((m) => m.role === "user");
      if (userMsgs.length === 0) return;
      e.preventDefault();

      if (historyIndexRef.current === -1) savedTextRef.current = text;
      const newIdx = Math.min(historyIndexRef.current + 1, userMsgs.length - 1);
      if (newIdx === historyIndexRef.current && newIdx !== 0) return;
      historyIndexRef.current = newIdx;
      setText(
        stripAttachmentMarkers(userMsgs[userMsgs.length - 1 - newIdx].content),
      );
      return;
    }

    if (e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      e.preventDefault();
      const newIdx = historyIndexRef.current - 1;
      historyIndexRef.current = newIdx;
      if (newIdx === -1) {
        setText(savedTextRef.current);
      } else {
        const userMsgs = convMessages.filter((m) => m.role === "user");
        setText(
          stripAttachmentMarkers(
            userMsgs[userMsgs.length - 1 - newIdx].content,
          ),
        );
      }
    }
  };

  const isModelNotReady =
    !boundInstance || boundInstance.state !== "running";

  const canSend =
    (text.trim().length > 0 || attachments.length > 0) && !streaming && !isModelNotReady;

  return (
    <div
      className="relative px-4 pb-3 pt-2"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {activePreview && activePreview.type === "image" && (
        <ImageLightbox
          src={activePreview.data}
          name={activePreview.name}
          onClose={() => setPreviewIndex(null)}
        />
      )}
      {activePreview && activePreview.type === "document" && (
        <DocumentPreviewModal
          name={activePreview.name}
          content={activePreview.data}
          onClose={() => setPreviewIndex(null)}
        />
      )}
      {activePreview && activePreview.type === "pdf-pages" && (
        <PdfPagesPreviewModal
          name={activePreview.name}
          pages={activePreview.pages ?? [activePreview.data]}
          onClose={() => setPreviewIndex(null)}
        />
      )}
      {activePreview && attachments.length > 1 && createPortal(
        <div
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-[70]",
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
            "bg-zinc-800/90 border border-zinc-700/50 text-zinc-300 backdrop-blur-sm",
          )}
        >
          {previewIndex! + 1} / {attachments.length}
        </div>,
        document.body
      )}
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".txt,.md,.csv,.json,.yaml,.yml,.xml,.py,.js,.ts,.jsx,.tsx,.html,.css,.sh,.log,.pdf"
        className="hidden"
        onChange={handleDocFile}
      />

      {/* Live stats — floats above the card */}
      {SHOW_LIVE_STATS_ABOVE_INPUT && streaming && (
        <div className="absolute -top-6 inset-x-0 flex justify-center gap-4 text-sm text-cyan-400 font-mono tabular-nums pointer-events-none">
          {livePhase === "processing" ? (
            liveProcessingElapsedMs !== null && (
              <span>
                processing · {(liveProcessingElapsedMs / 1000).toFixed(1)}s
              </span>
            )
          ) : (
            <>
              {liveTokensPerSecond !== null && (
                <span>{liveTokensPerSecond.toFixed(1)} t/s</span>
              )}
              {liveContextTokens !== null && contextSize !== null && (
                <span>
                  {liveContextTokens.toLocaleString()}/
                  {contextSize.toLocaleString()} (
                  {Math.round(
                    Math.min(liveContextTokens / contextSize, 1) * 100,
                  )}
                  %) ctx
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Error banner — above the card */}
      {error && (
        <div className="mb-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Attachment previews — float above the card without expanding it */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end px-1 pb-2">
          {attachments.map((att, idx) => {
            if (att.type === "image") {
              return (
                <div key={att.id} className="relative group shrink-0">
                  <button
                    onClick={() => setPreviewIndex(idx)}
                    className="block rounded-lg overflow-hidden border border-zinc-600/60 hover:border-cyan-500/60 transition-colors"
                    title={att.name}
                  >
                    <img
                      src={att.data}
                      alt={att.name}
                      className="w-16 h-16 object-cover"
                    />
                  </button>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1.5 -right-1.5 bg-zinc-900 border border-zinc-600 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5 text-zinc-300" />
                  </button>
                </div>
              );
            } else if (att.type === "pdf-pages") {
              const pageCount = att.pages?.length ?? 1;
              return (
                <div key={att.id} className="relative group shrink-0">
                  <button
                    onClick={() => setPreviewIndex(idx)}
                    className="block rounded-lg overflow-hidden border border-zinc-600/60 hover:border-cyan-500/60 transition-colors relative"
                    title={`${att.name} (${pageCount} pages)`}
                  >
                    <img
                      src={att.data}
                      alt={att.name}
                      className="w-16 h-16 object-cover"
                    />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] font-semibold text-white text-center py-0.5 leading-none">
                      {pageCount}p
                    </span>
                  </button>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1.5 -right-1.5 bg-zinc-900 border border-zinc-600 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5 text-zinc-300" />
                  </button>
                </div>
              );
            } else {
              const fileTypeInfo = getFileTypeInfo(att.name);
              return (
                <FileChipHoverTooltip
                  key={att.id}
                  fileName={att.name}
                  chipClassName={fileTypeInfo.chip}
                  className="w-32"
                  tooltipAlign="start"
                >
                  <div
                    className={cn(
                      "flex h-10 w-full shrink-0 items-stretch gap-0.5 overflow-hidden rounded-lg border text-sm text-zinc-300",
                      fileTypeInfo.chip,
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left transition-colors",
                        "hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35",
                      )}
                      onClick={() => setPreviewIndex(idx)}
                      aria-label={`Preview ${att.name}`}
                    >
                      {fileTypeInfo.icon ? (
                        <Icon
                          icon={fileTypeInfo.icon}
                          width={20}
                          height={20}
                          color={fileTypeInfo.color}
                          className="shrink-0 pointer-events-none"
                          aria-hidden
                        />
                      ) : (
                        <FileText
                          className="pointer-events-none h-3 w-3 shrink-0 text-zinc-400"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{att.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="shrink-0 px-1.5 text-zinc-500 hover:bg-black/15 hover:text-zinc-300"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </FileChipHoverTooltip>
              );
            }
          })}
        </div>
      )}

      {/* Floating card — textarea and toolbar are separate rows so text cannot reach the buttons */}
      <div
        className={cn(
          "relative flex flex-col rounded-2xl border bg-zinc-800 transition-colors duration-500",
          isModelNotReady
            ? theme === "light"
              ? "border-amber-500/50 shadow-none ring-1 ring-inset ring-amber-500/25"
              : "border-amber-500/30 shadow-lg shadow-black/30 ring-1 ring-inset ring-amber-500/10"
            : theme === "light"
              ? "border-zinc-700/50 shadow-none ring-1 ring-inset ring-zinc-700/25"
              : "border-zinc-700/50 shadow-lg shadow-black/30",
        )}
      >
        <div className="min-h-0 w-full px-3 pt-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKey}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className={cn(
              "w-full min-h-[52px] max-h-[min(52vh,17rem)] bg-transparent",
              "pb-1 text-base leading-snug text-zinc-100 placeholder-zinc-500",
              "focus:outline-none resize-none",
            )}
          />
        </div>

        {/* Toolbar — fixed strip below the text; text never overlaps this region */}
        <div className="relative flex shrink-0 items-center justify-between gap-2 px-2 pb-2 pt-1">
          {/* Attach + thinking */}
          <div
            ref={attachMenuRef}
            className="relative flex min-w-0 items-center gap-0.5"
          >
          <button
            type="button"
            onClick={() => setShowAttachMenu((v) => !v)}
            className={cn(
              "rounded-lg p-1.5 transition-all duration-200",
              showAttachMenu
                ? cn(
                    "bg-zinc-700/90 text-cyan-300 ring-1 ring-cyan-500/25",
                    theme === "light"
                      ? "shadow-none"
                      : "shadow-sm shadow-black/20",
                  )
                : "text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300",
            )}
            title="Attach"
            aria-expanded={showAttachMenu}
          >
            <Plus
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                showAttachMenu && "rotate-45",
              )}
            />
          </button>

          {/* MCP button */}
          <div ref={mcpPanelRef} className="relative">
            {(() => {
              const enabledCount = getEnabledTools().length;
              const savedEnabledCount = mcpTools.filter((t) =>
                isToolEnabled(t.serverName, t.name),
              ).length;
              const hasTools = mcpTools.length > 0;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMCPPanel((v) => !v);
                      setShowAttachMenu(false);
                    }}
                    className={cn(
                      "relative rounded-lg p-1.5 transition-all duration-200",
                      showMCPPanel
                        ? theme === "light"
                          ? "bg-cyan-500/15 text-cyan-800"
                          : "bg-zinc-700/90 text-cyan-300 ring-1 ring-cyan-500/25"
                        : mcpGloballyEnabled && enabledCount > 0
                          ? theme === "light"
                            ? "text-cyan-800 hover:bg-cyan-500/12"
                            : "text-cyan-400 hover:bg-zinc-700/50"
                          : theme === "light"
                            ? "text-neutral-600 hover:bg-neutral-300/90 hover:text-neutral-900"
                            : "text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300",
                    )}
                    title="MCP Tools"
                  >
                    <img
                      src={mcpSvgUrl}
                      alt="MCP"
                      className="h-4 w-4"
                      style={{
                        filter:
                          theme === "light"
                            ? mcpGloballyEnabled && enabledCount > 0
                              ? "brightness(0) saturate(100%) invert(32%) sepia(98%) saturate(1200%) hue-rotate(165deg) brightness(0.95)"
                              : "brightness(0) saturate(100%) invert(45%)"
                            : mcpGloballyEnabled && enabledCount > 0
                              ? "brightness(0) saturate(100%) invert(79%) sepia(80%) saturate(500%) hue-rotate(150deg)"
                              : "brightness(0) saturate(100%) invert(50%)",
                      }}
                    />
                    {mcpGloballyEnabled && enabledCount > 0 && hasTools && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-500 text-[9px] font-bold text-white">
                        {enabledCount > 9 ? '9+' : enabledCount}
                      </span>
                    )}
                  </button>

                  {showMCPPanel && (
                    <div
                      className={cn(
                        "absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl backdrop-blur-md",
                        theme === "light"
                          ? "border border-neutral-200/90 bg-white/95 shadow-lg shadow-black/10 ring-1 ring-black/[0.04]"
                          : "border border-zinc-700/50 bg-zinc-900/95 ring-1 ring-inset ring-white/[0.05] shadow-2xl shadow-black/50",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 shrink-0 items-center gap-2 border-b px-3",
                          theme === "light" ? "border-neutral-200" : "border-zinc-700/50",
                        )}
                      >
                        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "text-xs font-semibold leading-none",
                              theme === "light" ? "text-neutral-900" : "text-zinc-300",
                            )}
                          >
                            MCP Tools
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={mcpGloballyEnabled}
                            aria-label={
                              mcpGloballyEnabled
                                ? "Disable all MCP tools for new messages"
                                : "Enable MCP tools for new messages"
                            }
                            title={
                              mcpGloballyEnabled
                                ? "Turn off MCP for chat (saves each tool’s on/off)"
                                : "Turn MCP back on (restores saved tool choices)"
                            }
                            onClick={() => setMcpGloballyEnabled(!mcpGloballyEnabled)}
                            className={cn(
                              "flex h-3.5 w-6 shrink-0 items-center rounded-full p-[1px] transition-colors",
                              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50",
                              mcpGloballyEnabled
                                ? "justify-end bg-cyan-600"
                                : theme === "light"
                                  ? "justify-start bg-neutral-300"
                                  : "justify-start bg-zinc-600",
                            )}
                          >
                            <span className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" />
                          </button>
                        </div>
                        {mcpSearchExpanded ? (
                          <div className="flex min-h-0 min-w-0 flex-1 items-center gap-1">
                            <Search
                              className={cn(
                                "h-3.5 w-3.5 shrink-0 opacity-70",
                                theme === "light" ? "text-neutral-500" : "text-zinc-500",
                              )}
                              aria-hidden
                            />
                            <input
                              ref={mcpSearchInputRef}
                              type="text"
                              inputMode="search"
                              autoComplete="off"
                              value={mcpToolSearch}
                              onChange={(e) => setMcpToolSearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setMcpToolSearch("");
                                  setMcpSearchExpanded(false);
                                }
                              }}
                              placeholder="Search tools…"
                              className={cn(
                                "box-border h-7 min-h-0 min-w-0 flex-1 rounded border px-2 py-0 text-[11px] leading-normal outline-none transition-colors",
                                theme === "light"
                                  ? "border-neutral-200/90 bg-white/90 text-neutral-900 placeholder:text-neutral-400 focus:border-cyan-500/50 focus:ring-0"
                                  : "border-zinc-600/50 bg-zinc-950/50 text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/40 focus:ring-0",
                              )}
                              aria-label="Search MCP tools"
                            />
                            <button
                              type="button"
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors",
                                theme === "light"
                                  ? "text-neutral-500 hover:bg-neutral-200/80 hover:text-neutral-800"
                                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
                              )}
                              aria-label="Close search"
                              onClick={() => {
                                setMcpToolSearch("");
                                setMcpSearchExpanded(false);
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors",
                                theme === "light"
                                  ? "text-neutral-500 hover:bg-neutral-200/80 hover:text-neutral-800"
                                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
                              )}
                              title="Search tools"
                              aria-label="Search tools"
                              onClick={() => setMcpSearchExpanded(true)}
                            >
                              <Search className="h-3.5 w-3.5" />
                            </button>
                            <span
                              className={cn(
                                "text-[11px] tabular-nums leading-none",
                                theme === "light" ? "text-neutral-500" : "text-zinc-500",
                              )}
                            >
                              {!mcpGloballyEnabled
                                ? `${savedEnabledCount} saved · off`
                                : `${enabledCount} enabled`}
                            </span>
                          </div>
                        )}
                      </div>

                      {mcpTools.length === 0 ? (
                        <div className="px-4 py-5 text-center">
                          <p
                            className={cn(
                              "text-sm",
                              theme === "light" ? "text-neutral-700" : "text-zinc-500",
                            )}
                          >
                            No MCP servers connected.
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-xs",
                              theme === "light" ? "text-neutral-500" : "text-zinc-600",
                            )}
                          >
                            Add servers in Settings → MCP Servers.
                          </p>
                        </div>
                      ) : (
                        <div
                          ref={mcpListBodyRef}
                          className="flex max-h-72 flex-col overflow-hidden p-1"
                          style={
                            mcpListAppliedMinHeightPx > 0
                              ? mcpToolsFiltered.length === 0 &&
                                  mcpToolSearch.trim() !== ""
                                ? {
                                    minHeight: `${mcpListAppliedMinHeightPx}px`,
                                    height: `${mcpListAppliedMinHeightPx}px`,
                                  }
                                : { minHeight: `${mcpListAppliedMinHeightPx}px` }
                              : undefined
                          }
                        >
                          {mcpToolsFiltered.length === 0 ? (
                            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-5 text-center">
                              <p
                                className={cn(
                                  "text-sm",
                                  theme === "light" ? "text-neutral-700" : "text-zinc-500",
                                )}
                              >
                                No tools match your search.
                              </p>
                              <button
                                type="button"
                                className={cn(
                                  "mt-2 text-xs underline-offset-2 hover:underline",
                                  theme === "light"
                                    ? "text-cyan-700"
                                    : "text-cyan-400",
                                )}
                                onClick={() => setMcpToolSearch("")}
                              >
                                Clear search
                              </button>
                            </div>
                          ) : (
                            <div className="min-h-0 flex-1 overflow-y-auto">
                          {/* Group by server */}
                          {Array.from(new Set(mcpToolsFiltered.map((t) => t.serverName))).map((serverName) => {
                            const serverTools = mcpToolsFiltered.filter((t) => t.serverName === serverName);
                            const serverStatus = mcpStatus.find((s) => s.serverName === serverName);
                            const allToolsEnabled = serverTools.every((t) =>
                              isToolEnabled(serverName, t.name),
                            );
                            /** Icon only: “on” while any tool is enabled; avoids looking “off” when one tool is disabled. */
                            const anyToolEnabled = serverTools.some((t) =>
                              isToolEnabled(serverName, t.name),
                            );
                            return (
                              <div key={serverName} className="mb-1">
                                {/* Server header — click still uses allToolsEnabled so mixed → click enables all. */}
                                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 shrink-0 rounded-full",
                                      // Status was never loaded ([]) → avoid false red; tools imply connected.
                                      serverStatus?.connected === true ||
                                      (serverStatus == null && serverTools.length > 0)
                                        ? "bg-emerald-400"
                                        : serverStatus?.connected === false
                                          ? "bg-red-400"
                                          : serverStatus == null
                                            ? "bg-zinc-500"
                                            : "bg-emerald-400",
                                    )}
                                    title={
                                      serverStatus?.connected === false
                                        ? serverStatus.error ?? "Disconnected"
                                        : serverStatus?.connected === true
                                          ? "Connected"
                                          : serverTools.length > 0
                                            ? "Connected"
                                            : "Connection status pending…"
                                    }
                                  />
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide",
                                      theme === "light" ? "text-neutral-500" : "text-zinc-500",
                                    )}
                                  >
                                    {serverName}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setServerToolsEnabled(serverName, !allToolsEnabled)
                                    }
                                    className={cn(
                                      "shrink-0 transition-colors",
                                      theme === "light"
                                        ? "text-neutral-500 hover:text-neutral-800"
                                        : "text-zinc-500 hover:text-zinc-300",
                                    )}
                                    title={
                                      allToolsEnabled
                                        ? "Disable all tools from this server"
                                        : "Enable all tools from this server"
                                    }
                                  >
                                    {anyToolEnabled
                                      ? (
                                          <ToggleRight
                                            className={cn(
                                              "h-4 w-4",
                                              theme === "light" ? "text-cyan-600" : "text-cyan-400",
                                            )}
                                          />
                                        )
                                      : <ToggleLeft className="h-4 w-4" />
                                    }
                                  </button>
                                </div>
                                {/* Tools */}
                                {serverTools.map((tool) => {
                                  const enabled = isToolEnabled(serverName, tool.name);
                                  return (
                                    <button
                                      key={tool.name}
                                      type="button"
                                      onClick={() => setToolEnabled(serverName, tool.name, !enabled)}
                                      className={cn(
                                        "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                                        enabled
                                          ? theme === "light"
                                            ? "text-neutral-900 hover:bg-neutral-200/80"
                                            : "text-zinc-200 hover:bg-zinc-800/70"
                                          : theme === "light"
                                            ? "text-neutral-500 hover:bg-neutral-100/90"
                                            : "text-zinc-500 hover:bg-zinc-800/50",
                                      )}
                                      title={tool.description}
                                    >
                                      <span className="mt-0.5 shrink-0">
                                        {enabled
                                          ? (
                                              <ToggleRight
                                                className={cn(
                                                  "h-3.5 w-3.5",
                                                  theme === "light" ? "text-cyan-600" : "text-cyan-400",
                                                )}
                                              />
                                            )
                                          : (
                                              <ToggleLeft
                                                className={cn(
                                                  "h-3.5 w-3.5",
                                                  theme === "light" ? "text-neutral-400" : "text-zinc-600",
                                                )}
                                              />
                                            )
                                        }
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block font-medium">{tool.name}</span>
                                        {tool.description && (
                                          <span
                                            className={cn(
                                              "mt-0.5 block truncate text-[10px]",
                                              theme === "light" ? "text-neutral-500" : "text-zinc-600",
                                            )}
                                          >
                                            {tool.description}
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Footer link to settings */}
                      <div
                        className={cn(
                          "border-t px-3 py-1.5",
                          theme === "light" ? "border-neutral-200" : "border-zinc-700/40",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setShowMCPPanel(false);
                            navigate("/settings#mcp-servers");
                          }}
                          className={cn(
                            "flex w-full items-center gap-1.5 text-[11px] transition-colors",
                            theme === "light"
                              ? "text-neutral-500 hover:text-neutral-800"
                              : "text-zinc-500 hover:text-zinc-300",
                          )}
                        >
                          <Settings className="h-3 w-3" />
                          Manage servers in Settings → MCP Servers
                        </button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <button
            type="button"
            onClick={toggleThinkingMode}
            disabled={!supportsThinking}
            className={`p-1.5 rounded-lg transition-colors ${
              !supportsThinking
                ? "cursor-default text-zinc-600 opacity-60"
                : thinkingActive
                  ? "text-cyan-400 bg-cyan-500/15 hover:bg-cyan-500/25"
                  : "text-zinc-500 hover:text-zinc-400 hover:bg-zinc-700/50"
            }`}
            title={
              !supportsThinking
                ? "This model does not support thinking mode"
                : thinkingActive
                  ? "Thinking enabled — click to turn off (no thinking)"
                  : "No thinking mode — click to enable reasoning"
            }
          >
            <Brain className="w-4 h-4" strokeWidth={thinkingActive ? 2.25 : 2} />
          </button>

          {showAttachMenu && (
            <div
              className={cn(
                "absolute bottom-full left-0 z-30 mb-2 min-w-[13rem] overflow-hidden rounded-xl",
                "border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-md",
                "ring-1 ring-inset ring-white/[0.05]",
                theme === "light"
                  ? "shadow-sm shadow-black/10"
                  : "shadow-2xl shadow-black/50",
              )}
              role="menu"
            >
              <div className="p-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => isVisionModel && imageInputRef.current?.click()}
                  disabled={!isVisionModel}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    isVisionModel
                      ? "cursor-pointer text-zinc-200 hover:bg-zinc-800/90"
                      : "cursor-not-allowed text-zinc-500 opacity-75",
                  )}
                  title={
                    !isVisionModel
                      ? "This model does not support vision"
                      : "Attach an image"
                  }
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      "bg-emerald-500/12 ring-1 ring-emerald-500/20",
                      !isVisionModel && "opacity-50 grayscale",
                    )}
                  >
                    <ImageIcon
                      className="h-4 w-4 text-emerald-400"
                      strokeWidth={2}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight">
                      Image
                    </span>
                    {!isVisionModel ? (
                      <span className="mt-0.5 block text-[11px] leading-tight text-zinc-500">
                        Vision-capable model required
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[11px] leading-tight text-zinc-500">
                        PNG, JPEG, WebP…
                      </span>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => docInputRef.current?.click()}
                  className="mt-0.5 flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800/90"
                  title="Attach a text file"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 ring-1 ring-violet-500/20">
                    <Files className="h-4 w-4 text-violet-400" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight">Files</span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-zinc-500">
                      Code, markdown, PDF…
                    </span>
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Send / Stop — bottom-right */}
        <div className="flex shrink-0 items-center gap-2">
          {ringTokens !== null && ringSize !== null && (
            <ContextRing tokens={ringTokens} total={ringSize} />
          )}
          {streaming ? (
            <button
              type="button"
              onClick={stopGeneration}
              className={cn(
                "group flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                "border-0 bg-zinc-700/45 text-zinc-300",
                "hover:bg-zinc-600/55 hover:text-zinc-50",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/25",
              )}
              title="Stop generating"
            >
              <CircleStop
                className={cn(
                  "h-4 w-4",
                  /* Outer ring zinc; inner stop cyan — matches app accent, no red */
                  "[&>circle]:stroke-zinc-500 [&>rect]:stroke-cyan-400",
                  "group-hover:[&>circle]:stroke-zinc-400 group-hover:[&>rect]:stroke-cyan-300",
                )}
                strokeWidth={2}
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                /* ~28px — same visual weight as previous p-1.5 + icon (not h-9) */
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150 text-white",
                theme === "light"
                  ? "bg-cyan-500 hover:bg-cyan-400 active:scale-[0.97]"
                  : "bg-gradient-to-b from-cyan-500 to-cyan-600 ring-1 ring-inset ring-white/15 shadow-md shadow-black/35 hover:shadow-lg hover:shadow-cyan-950/30 hover:from-cyan-400 hover:to-cyan-500 active:scale-[0.97]",
                "disabled:cursor-default disabled:opacity-35 disabled:shadow-none disabled:ring-0",
                theme === "light"
                  ? "disabled:hover:bg-cyan-500"
                  : "disabled:hover:from-cyan-500 disabled:hover:to-cyan-600",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45",
              )}
              title="Send (Enter)"
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
