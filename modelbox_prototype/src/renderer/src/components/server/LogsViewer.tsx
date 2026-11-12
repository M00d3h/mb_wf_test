import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import {
  Search,
  Pause,
  Play,
  Download,
  Trash2,
  ArrowDownToLine,
  Maximize2,
} from "lucide-react";
import { useServerStore } from "../../store/serverStore";
import { useModelsStore } from "../../store/modelsStore";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";
import {
  DocumentPreviewModal,
  type DocumentPreviewHeaderLead,
} from "../shared/DocumentPreviewModal";

interface Props {
  instanceId: string;
}

/** Log line colors: `html.light` remaps Tailwind `zinc-*` and the theme palette omits some `teal-*` stops, so use fixed RGBA for stderr/stdout. */
const logLineStderrBody = cn(
  "bg-[rgba(4,47,46,0.28)] pl-3.5 text-[rgba(204,251,241,0.92)]",
);
/** Light UI dulls the same rgba bar; use a solid 3px stripe so it matches dark’s prominence. */
const logLineStderrBorder = {
  dark: "border-l-2 border-l-[rgba(20,184,166,0.45)]",
  light: "border-l-[3px] border-l-[rgb(20,184,166)]",
} as const;
const logLineStdout = cn(
  "border-l-2 border-l-transparent text-[rgba(228,228,231,0.93)]",
);
const logLineSelection = cn(
  "selection:bg-[rgba(6,182,212,0.2)] selection:text-[rgba(250,250,250,0.98)]",
);

const iconBtn = cn(
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
  "text-zinc-400 transition-all duration-150",
  "hover:bg-white/[0.07] hover:text-zinc-100",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950/80",
  "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35",
);

export function LogsViewer({ instanceId }: Props): JSX.Element {
  const { theme } = useThemeStore();
  const { logs, fetchLogs, instances } = useServerStore();
  const { models, profiles, fetchProfiles } = useModelsStore();
  const instance = instances.find((i) => i.id === instanceId);
  const instanceState = instance?.state;
  const lines = logs[instanceId] ?? [];
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const pausedLinesRef = useRef(lines);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    fetchLogs(instanceId);
  }, [instanceId, fetchLogs]);

  useEffect(() => {
    if (!instance?.modelId || instance.instanceKind === "vllm") return;
    if (!profiles[instance.modelId]) {
      void fetchProfiles(instance.modelId);
    }
  }, [instance?.modelId, instance?.instanceKind, profiles, fetchProfiles]);

  /** After crash/error, main process archives logs — refetch so the panel matches persisted session logs. */
  useEffect(() => {
    if (instanceState === "error") {
      void fetchLogs(instanceId);
    }
  }, [instanceId, instanceState, fetchLogs]);

  const displayLines = paused
    ? pausedLinesRef.current.filter((l) =>
        filter ? l.text.toLowerCase().includes(filter.toLowerCase()) : true,
      )
    : lines.filter((l) =>
        filter ? l.text.toLowerCase().includes(filter.toLowerCase()) : true,
      );

  const handlePauseToggle = (): void => {
    if (!paused) {
      pausedLinesRef.current = lines;
    }
    setPaused(!paused);
  };

  const lastLine =
    displayLines.length > 0
      ? displayLines[displayLines.length - 1]
      : undefined;

  /** Auto-scroll only when the user is at the bottom; scroll up to read without being yanked back. */
  const followOutput =
    autoScroll && ! paused
      ? (isAtBottom: boolean) => isAtBottom ? ("auto" as const) : false
      : false;

  const scrollBumpRaf = useRef<number | null>(null);
  const scrollToTrueBottom = useCallback((): void => {
    if (!autoScroll || paused || !isAtBottomRef.current) return;
    if (scrollBumpRaf.current != null) return;
    scrollBumpRaf.current = requestAnimationFrame(() => {
      scrollBumpRaf.current = null;
      requestAnimationFrame(() => {
        const v = virtuosoRef.current;
        if (!v) return;
        v.scrollToIndex({
          index: "LAST",
          align: "end",
          behavior: "auto",
        });
        v.autoscrollToBottom();
      });
    });
  }, [autoScroll, paused]);

  /** New lines, in-place last-line updates, and remeasured row heights. */
  useEffect(() => {
    if (!autoScroll || paused || displayLines.length === 0) return;
    scrollToTrueBottom();
  }, [autoScroll, paused, lastLine, displayLines.length, scrollToTrueBottom]);

  const exportLogs = useCallback((): void => {
    const text = lines.map((l) => `[${l.stream}] ${l.text}`).join("");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelbox-${instanceId.slice(0, 8)}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lines, instanceId]);

  const fullscreenText = useMemo(
    () => lines.map((l) => `[${l.stream}] ${l.text}`).join(""),
    [lines],
  );

  const logFileName = `instance-${instanceId.slice(0, 8)}-logs.txt`;

  const headerLead: DocumentPreviewHeaderLead | undefined = useMemo(() => {
    if (!instance) return undefined;
    if (instance.instanceKind === "vllm") {
      const primary = (instance.modelName ?? "vLLM").trim();
      const secondary = instance.profileName?.trim();
      return {
        primary,
        ...(secondary ? { secondary } : {}),
      };
    }
    const mid = instance.modelId!;
    const model = models.find((m) => m.id === mid);
    const backend = model?.name ?? mid.slice(0, 8);
    const profileList = profiles[mid] ?? [];
    const profile = profileList.find((p) => p.id === instance.profileId);
    const primary = (profile?.config.alias?.trim() || backend).trim();
    const secondary = profile?.name?.trim();
    if (!primary && !secondary) return undefined;
    return {
      primary: primary || backend,
      ...(secondary ? { secondary } : {}),
    };
  }, [instance, models, profiles]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-gradient-to-b from-zinc-900/40 via-zinc-950/80 to-zinc-950 ring-1 ring-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      {fullscreenOpen && (
        <DocumentPreviewModal
          name={logFileName}
          content={fullscreenText}
          size="lg"
          subtitle="Server console"
          headerLead={headerLead}
          liveScroll
          onClose={() => setFullscreenOpen(false)}
        />
      )}

      {/* Toolbar */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-900/35 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[10rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter output…"
              className="w-full rounded-xl border border-zinc-700/45 bg-zinc-950/55 py-2 pl-10 pr-3 text-sm text-zinc-100 placeholder-zinc-500 shadow-sm transition-colors focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/12"
            />
          </div>

          <div
            className="flex items-center gap-0.5 rounded-xl bg-zinc-950/55 p-1 ring-1 ring-white/[0.06]"
            role="toolbar"
            aria-label="Log actions"
          >
            <button
              type="button"
              onClick={handlePauseToggle}
              title={paused ? "Resume streaming" : "Pause streaming"}
              className={cn(
                iconBtn,
                paused && "bg-amber-500/12 text-amber-200/95 hover:bg-amber-500/18",
              )}
            >
              {paused ? (
                <Play className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Pause className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              title={
                autoScroll
                  ? "Auto-scroll on (stick to bottom)"
                  : "Auto-scroll off"
              }
              className={cn(
                iconBtn,
                autoScroll &&
                  "bg-cyan-500/12 text-cyan-300/95 hover:bg-cyan-500/18 hover:text-cyan-100",
              )}
            >
              <ArrowDownToLine className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setFullscreenOpen(true)}
              title="Open large preview"
              className={iconBtn}
            >
              <Maximize2 className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={exportLogs}
              title="Download logs"
              className={iconBtn}
            >
              <Download className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() =>
                useServerStore.setState((s) => ({
                  logs: { ...s.logs, [instanceId]: [] },
                }))
              }
              title="Clear view"
              className={cn(iconBtn, "hover:text-red-300/95")}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <span className="ml-auto text-[11px] tabular-nums text-zinc-500">
            {displayLines.length} line{displayLines.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Log content */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#09090b]">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-6 bg-gradient-to-b from-[#09090b] to-transparent"
          aria-hidden
        />
        {displayLines.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-zinc-500">
            No output yet — start a server or select an instance.
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="h-full"
            data={displayLines}
            followOutput={followOutput}
            increaseViewportBy={{ top: 80, bottom: 400 }}
            totalListHeightChanged={scrollToTrueBottom}
            onScroll={(e) => {
              const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
              isAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 1;
            }}
            itemContent={(_, line) => (
              <div
                className={cn(
                  "py-1.5 pl-4 pr-4 font-mono text-[13px] leading-relaxed tracking-wide",
                  logLineSelection,
                  line.stream === "stderr"
                    ? cn(
                        logLineStderrBody,
                        logLineStderrBorder[theme === "light" ? "light" : "dark"],
                      )
                    : logLineStdout,
                )}
              >
                <span className="whitespace-pre-wrap break-all">{line.text}</span>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
