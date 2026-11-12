import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  Loader2,
  Pause,
  RotateCcw,
  XCircle,
  X,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "../../lib/utils";
import { api } from "../../lib/ipc";
import { useHfDownloadStore, type DownloadEntry } from "../../store/hfDownloadStore";
import { useThemeStore } from "../../store/themeStore";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const flyoutPanel =
  "rounded-2xl border border-zinc-700/80 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40 ring-1 ring-zinc-800/90";

function EntryProgressBar({ entry }: { entry: DownloadEntry }): JSX.Element {
  const pct = useMemo(() => {
    if (entry.totalBytes != null && entry.totalBytes > 0) {
      return Math.min(100, (entry.receivedBytes / entry.totalBytes) * 100);
    }
    return entry.receivedBytes > 0 ? 40 : 0;
  }, [entry.receivedBytes, entry.totalBytes]);

  return (
    <>
      {/* bg-zinc-800/90 auto-inverts to light gray in light mode via CSS var swap */}
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/90">
        <div
          className="h-full rounded-full bg-cyan-500/80 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] tabular-nums text-zinc-500">
        {formatBytes(entry.receivedBytes)}
        {entry.totalBytes != null && entry.totalBytes > 0
          ? ` / ${formatBytes(entry.totalBytes)}`
          : " …"}
      </p>
    </>
  );
}

function DownloadEntryRow({
  entry,
  theme,
  onDismiss,
  onCancel,
  onPause,
}: {
  entry: DownloadEntry;
  theme: string;
  onDismiss: () => void;
  onCancel: () => void;
  onPause: () => void;
}): JSX.Element {
  const isBusy = entry.phase === "downloading";
  const isPaused = entry.phase === "paused";
  const isOk = entry.phase === "complete" || entry.phase === "fading";
  const isErr = entry.phase === "error";
  const isInterrupted = entry.phase === "interrupted";
  const [resuming, setResuming] = useState(false);
  const dismiss = useHfDownloadStore((s) => s.dismiss);
  const registerPendingDownload = useHfDownloadStore((s) => s.registerPendingDownload);
  const reportDownloadError = useHfDownloadStore((s) => s.reportDownloadError);

  const handleResume = async (): Promise<void> => {
    if (!entry.interruptedMeta || resuming) return;
    const { meta } = entry.interruptedMeta;
    const newId = uuidv4();
    setResuming(true);
    // For paused entries, pass current bytes so progress shows immediately on resume
    const initialBytes = entry.phase === "paused" && entry.receivedBytes > 0 ? entry.receivedBytes : undefined;
    const initialTotal = entry.phase === "paused" ? entry.totalBytes : undefined;
    const hintToCarry = entry.phase === "paused" ? entry.progressHint : null;
    dismiss(entry.downloadId);
    registerPendingDownload(newId, "", meta.repoId, initialBytes, initialTotal, meta.vllmTarget, hintToCarry);
    try {
      const result = await api.hf.download({
        downloadId: newId,
        repoId: meta.repoId,
        filenames: meta.filenames,
        fileSizes: meta.fileSizes,
        modelsDir: meta.modelsDir,
        destFolder: meta.destFolder,
        vllmTarget: meta.vllmTarget,
      });
      if (!result.ok && !result.aborted) {
        reportDownloadError(result.error ?? "Resume failed");
      }
    } catch (e: unknown) {
      reportDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setResuming(false);
    }
  };

  const handlePausedCancel = async (): Promise<void> => {
    if (entry.interruptedMeta) {
      await api.hf.abandonDownload(entry.interruptedMeta.modelDir).catch(() => {});
    }
    dismiss(entry.downloadId);
  };

  // For interrupted/failed entries, X must also remove the meta file from disk or it repopulates on restart.
  const handleDismiss = async (): Promise<void> => {
    if (isInterrupted && entry.interruptedMeta) {
      await api.hf.abandonDownload(entry.interruptedMeta.modelDir).catch(() => {});
    } else if (isErr && entry.failedMeta) {
      await api.hf.abandonDownload(entry.failedMeta.modelDir).catch(() => {});
    }
    onDismiss();
  };

  const statusLabel = isBusy
    ? "Downloading"
    : isPaused
      ? "Paused"
      : isOk
        ? "Saved"
        : isInterrupted
          ? "Interrupted"
          : "Failed";

  const isLight = theme === "light";

  // Amber/rose don't auto-invert — explicit split needed. Zinc does auto-invert.
  const statusColor = isBusy || isPaused
    ? "text-zinc-500"
    : isOk
      ? "text-emerald-500/90"
      : isInterrupted
        ? isLight ? "text-amber-700/80" : "text-amber-400/80"
        : "text-rose-400/80";

  return (
    // zinc-900/zinc-800 auto-invert to near-white/light in light mode
    <div className={cn(
      "flex flex-col gap-2 rounded-xl border p-3",
      isInterrupted
        ? "border-amber-500/25 bg-zinc-900/60"
        : isErr
          ? "border-rose-500/25 bg-zinc-900/60"
          : "border-zinc-800/80 bg-zinc-900/60",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-[10px] font-medium uppercase tracking-wide", statusColor)}>
            {statusLabel}
          </p>
          {/* text-zinc-100 auto-inverts to near-black in light mode */}
          {entry.repoId && (
            <p className="mt-0.5 break-all font-mono text-xs leading-snug text-zinc-100">
              {entry.repoId}
            </p>
          )}
          {entry.fileLabel && (
            <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400">
              {entry.fileLabel}
            </p>
          )}
          {entry.modelsDir && (
            <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">
              → {entry.modelsDir}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleDismiss()}
          className={cn(
            "shrink-0 rounded-full p-1 text-zinc-500 transition-colors",
            // hover bg must flip: white tint invisible on light bg, black tint invisible on dark bg
            isLight
              ? "hover:bg-black/[0.06] hover:text-zinc-200"
              : "hover:bg-white/[0.06] hover:text-zinc-200",
          )}
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {(isBusy || isPaused) && (
        <>
          {/* Fixed-height hint row — always reserved so paused and downloading cards are the same height */}
          <div className="flex min-h-[1.375rem] items-center">
            {isBusy && entry.progressHint && (
              <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                <span className="min-w-0 truncate">{entry.progressHint}</span>
              </p>
            )}
          </div>
          <EntryProgressBar entry={entry} />
          <div className="mt-1 flex gap-1.5">
            {isBusy ? (
              <button
                type="button"
                onClick={onPause}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  isLight
                    ? "border-amber-400/60 bg-transparent text-amber-700 hover:border-amber-500 hover:bg-amber-100 hover:text-amber-900"
                    : "border-zinc-700/60 bg-transparent text-zinc-300 hover:border-amber-400/30 hover:bg-amber-500/[0.08] hover:text-amber-200",
                )}
              >
                <Pause className="h-3 w-3 shrink-0" />
                Pause
              </button>
            ) : (
              <button
                type="button"
                disabled={resuming}
                onClick={() => void handleResume()}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                  isLight
                    ? "border-cyan-500/50 bg-transparent text-cyan-700 hover:border-cyan-500 hover:bg-cyan-50 hover:text-cyan-900"
                    : "border-cyan-500/25 bg-transparent text-cyan-400 hover:border-cyan-400/50 hover:bg-cyan-500/[0.09] hover:text-cyan-200",
                )}
              >
                <RotateCcw className="h-3 w-3 shrink-0" />
                {resuming ? "Resuming…" : "Resume"}
              </button>
            )}
            <button
              type="button"
              onClick={isBusy ? onCancel : () => void handlePausedCancel()}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                isLight
                  ? "border-rose-400/50 bg-transparent text-rose-700 hover:border-rose-500 hover:bg-rose-50 hover:text-rose-900"
                  : "border-rose-500/25 bg-transparent text-rose-400 hover:border-rose-400/50 hover:bg-rose-500/[0.08] hover:text-rose-200",
              )}
            >
              <X className="h-3 w-3 shrink-0" />
              Cancel
            </button>
          </div>
        </>
      )}

      {isOk && entry.savedPathSummary && (
        <p className="break-all font-mono text-[11px] leading-relaxed text-emerald-400/90">
          {entry.savedPathSummary}
        </p>
      )}

      {isErr && entry.errorMessage && (
        <p className="text-[11px] leading-relaxed text-rose-400/95">
          {entry.errorMessage}
        </p>
      )}

      {isInterrupted && entry.interruptedMeta && (() => {
        const { meta, missingFileSizes, missingFilenames: _mf } = entry.interruptedMeta;
        const missingFilenames: string[] = _mf ?? [];
        const totalBytes = meta.fileSizes?.reduce((a, b) => a + b, 0);
        const missingBytes = missingFileSizes?.reduce((a, b) => a + b, 0);
        const downloadedBytes = totalBytes != null && missingBytes != null ? totalBytes - missingBytes : null;
        const pct = totalBytes != null && totalBytes > 0 && downloadedBytes != null
          ? Math.min(100, (downloadedBytes / totalBytes) * 100)
          : null;
        return (
          <>
            {pct != null && (
              <div className="flex flex-col gap-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/90">
                  <div
                    className={cn("h-full rounded-full", isLight ? "bg-amber-500/70" : "bg-amber-400/60")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className={cn("text-[11px] tabular-nums", isLight ? "text-amber-700/80" : "text-amber-400/70")}>
                  {formatBytes(downloadedBytes!)} / {formatBytes(totalBytes!)}
                  {" · "}
                  {missingFilenames.length === 1 ? "1 file missing" : `${missingFilenames.length} files missing`}
                </p>
              </div>
            )}
            {pct == null && (
              <p className={cn("text-[11px] leading-snug", isLight ? "text-amber-700/80" : "text-amber-400/70")}>
                {missingFilenames.length === 1 ? "1 file missing" : `${missingFilenames.length} files missing`}
              </p>
            )}
            <button
              type="button"
              disabled={resuming}
              onClick={() => void handleResume()}
              className={cn(
                "mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-center text-[11px] font-medium transition-colors disabled:opacity-50",
                isLight
                  ? "border-amber-400/50 bg-amber-100 text-amber-700 hover:bg-amber-200"
                  : "border-amber-500/20 bg-amber-500/[0.08] text-amber-300 hover:border-amber-400/30 hover:bg-amber-500/[0.14] hover:text-amber-100",
              )}
            >
              <RotateCcw className="h-3 w-3 shrink-0" />
              {resuming ? "Resuming…" : "Resume download"}
            </button>
          </>
        );
      })()}
    </div>
  );
}

const BUBBLE_SIZE = 56;
const RING_STROKE = 3;
const RING_R = (BUBBLE_SIZE - RING_STROKE * 2) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

export function HfDownloadFloatingPanel({ isHfPage }: { isHfPage: boolean }): JSX.Element | null {
  const downloads = useHfDownloadStore((s) => s.downloads);
  const dismiss = useHfDownloadStore((s) => s.dismiss);
  const cancelDownload = useHfDownloadStore((s) => s.cancelDownload);
  const pauseDownload = useHfDownloadStore((s) => s.pauseDownload);
  const { theme } = useThemeStore();
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(true);
  };
  const onLeave = (): void => {
    hoverTimer.current = setTimeout(() => setHovered(false), 80);
  };

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  const entries = useMemo(() => Object.values(downloads), [downloads]);
  const busyEntries = useMemo(() => entries.filter((e) => e.phase === "downloading"), [entries]);
  const pausedEntries = useMemo(() => entries.filter((e) => e.phase === "paused"), [entries]);
  const anyActive = entries.some(
    (e) => e.phase === "downloading" || e.phase === "paused" || e.phase === "interrupted" || e.phase === "error",
  );

  const pct = useMemo(() => {
    const progressEntries = [...busyEntries, ...pausedEntries];
    if (progressEntries.length === 0) return 0;
    let rx = 0, total = 0, hasTotal = true;
    for (const e of progressEntries) {
      rx += e.receivedBytes;
      if (e.totalBytes != null && e.totalBytes > 0) total += e.totalBytes;
      else hasTotal = false;
    }
    if (hasTotal && total > 0) return Math.min(100, (rx / total) * 100);
    return rx > 0 ? 40 : 0;
  }, [busyEntries, pausedEntries]);

  const isExpanded = isHfPage || hovered;
  const dashoffset = RING_CIRC - (pct / 100) * RING_CIRC;

  const isPausedState = busyEntries.length === 0 && pausedEntries.length > 0;
  const isInterruptedState = busyEntries.length === 0 && pausedEntries.length === 0 && entries.some((e) => e.phase === "interrupted");
  const isErrorState = busyEntries.length === 0 && pausedEntries.length === 0 && !isInterruptedState && entries.some((e) => e.phase === "error");

  if (!anyActive) return null;

  const accentColor = isInterruptedState
    ? "rgba(251,191,36,0.85)"
    : isErrorState
      ? "rgba(244,63,94,0.85)"
      : "rgba(34,211,238,0.15)";
  const accentColorDark = isInterruptedState
    ? "rgba(251,191,36,0.12)"
    : isErrorState
      ? "rgba(244,63,94,0.12)"
      : "rgba(34,211,238,0.14)";
  const ringColor = isInterruptedState
    ? "rgb(251,191,36)"
    : isErrorState
      ? "rgb(244,63,94)"
      : "rgb(34,211,238)";
  const ringGlow = isInterruptedState
    ? "rgba(251,191,36,0.55)"
    : isErrorState
      ? "rgba(244,63,94,0.55)"
      : "rgba(34,211,238,0.55)";

  return (
    <div
      className="fixed bottom-4 right-2 z-[200]"
      style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
    >
      {/* Expanded panel — grows upward from bottom-right */}
      <div
        className="absolute bottom-0 right-0"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          transformOrigin: "bottom right",
          opacity: isExpanded ? 1 : 0,
          transform: isExpanded ? "scale(1) translateY(0px)" : "scale(0.82) translateY(8px)",
          transition: isExpanded
            ? "opacity 180ms ease-out, transform 420ms cubic-bezier(0.34,1.56,0.64,1)"
            : "opacity 130ms ease-in, transform 200ms cubic-bezier(0.4,0,0.2,1)",
          pointerEvents: isExpanded ? "auto" : "none",
        }}
      >
        <div className={cn("relative z-50 w-[min(20rem,calc(100vw-2rem))] p-2 backdrop-blur-sm", flyoutPanel)}>
          <div className="flex max-h-[min(70vh,32rem)] flex-col gap-2 overflow-y-auto">
            {entries.map((entry) => (
              <DownloadEntryRow
                key={entry.downloadId}
                entry={entry}
                theme={theme}
                onDismiss={() => dismiss(entry.downloadId)}
                onCancel={() => cancelDownload(entry.downloadId)}
                onPause={() => pauseDownload(entry.downloadId)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Collapsed bubble */}
      <div
        className="absolute bottom-0 right-0 cursor-pointer"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          opacity: isExpanded ? 0 : 1,
          transform: isExpanded ? "scale(0.55)" : "scale(1)",
          transition: isExpanded
            ? "opacity 120ms ease-in, transform 170ms ease-in"
            : "opacity 230ms 90ms ease-out, transform 400ms cubic-bezier(0.34,1.56,0.64,1)",
          pointerEvents: isExpanded ? "none" : "auto",
        }}
      >
        <div
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            background: theme === "light" ? "rgba(255,255,255,0.97)" : "rgba(20,20,23,0.97)",
            boxShadow: theme === "light"
              ? `0 0 0 1px rgba(0,0,0,0.1), 0 8px 28px rgba(0,0,0,0.14), 0 0 20px ${accentColor}`
              : `0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.55), 0 0 24px ${accentColorDark}`,
          }}
        >
          {/* Progress ring */}
          <svg
            width={BUBBLE_SIZE}
            height={BUBBLE_SIZE}
            className="absolute inset-0"
            style={{ transform: "rotate(-90deg)" }}
            aria-hidden
          >
            <circle
              cx={BUBBLE_SIZE / 2}
              cy={BUBBLE_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={BUBBLE_SIZE / 2}
              cy={BUBBLE_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashoffset}
              style={{
                transition: "stroke-dashoffset 400ms ease-out",
                filter: `drop-shadow(0 0 5px ${ringGlow})`,
              }}
            />
          </svg>

          {/* Icon */}
          {(() => {
            const iconClass = cn(
              "relative z-10 h-5 w-5",
              isInterruptedState
                ? theme === "light" ? "text-amber-600" : "text-amber-400"
                : isErrorState
                  ? theme === "light" ? "text-rose-600" : "text-rose-400"
                  : theme === "light" ? "text-cyan-600" : "text-cyan-400",
            );
            return isPausedState
              ? <Pause className={iconClass} aria-hidden />
              : isErrorState
                ? <XCircle className={iconClass} aria-hidden />
                : <Download className={iconClass} aria-hidden />;
          })()}

          {/* Multi-download count badge */}
          {busyEntries.length > 1 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[9px] font-bold leading-none text-white ring-2 ring-zinc-950">
              {busyEntries.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function HfSidebarDownload(): JSX.Element | null {
  const downloads = useHfDownloadStore((s) => s.downloads);
  const dismiss = useHfDownloadStore((s) => s.dismiss);
  const cancelDownload = useHfDownloadStore((s) => s.cancelDownload);
  const pauseDownload = useHfDownloadStore((s) => s.pauseDownload);
  const { theme } = useThemeStore();
  const isLight = theme === "light";

  const entries = useMemo(() => Object.values(downloads), [downloads]);

  const busyEntries = useMemo(
    () => entries.filter((e) => e.phase === "downloading"),
    [entries],
  );
  const anyBusy = busyEntries.length > 0;
  const anyOk = entries.some(
    (e) => e.phase === "complete" || e.phase === "fading",
  );
  const anyErr = entries.some((e) => e.phase === "error");
  const anyInterrupted = entries.some((e) => e.phase === "interrupted");
  const anyPaused = entries.some((e) => e.phase === "paused");
  const interruptedEntries = useMemo(
    () => entries.filter((e) => e.phase === "interrupted"),
    [entries],
  );
  const errorEntries = useMemo(
    () => entries.filter((e) => e.phase === "error"),
    [entries],
  );
  const pausedEntries = useMemo(
    () => entries.filter((e) => e.phase === "paused"),
    [entries],
  );
  const allGone = entries.length === 0;

  // Progress percentage for the first interrupted entry (shown on icon bar)
  const interruptedPct = useMemo(() => {
    const e = interruptedEntries[0];
    if (!e?.interruptedMeta) return 50;
    const { meta, missingFileSizes } = e.interruptedMeta;
    const total = meta.fileSizes?.reduce((a, b) => a + b, 0);
    const missing = missingFileSizes?.reduce((a, b) => a + b, 0);
    if (total == null || total === 0 || missing == null) return 50;
    return Math.min(100, ((total - missing) / total) * 100);
  }, [interruptedEntries]);

  // Frozen progress percentage for the first paused entry (shown on icon bar)
  const pausedPct = useMemo(() => {
    const e = pausedEntries[0];
    if (!e) return 0;
    if (e.totalBytes != null && e.totalBytes > 0) {
      return Math.min(100, (e.receivedBytes / e.totalBytes) * 100);
    }
    return e.receivedBytes > 0 ? 40 : 0;
  }, [pausedEntries]);

  // Aggregate progress across all active downloads for the icon bar
  const pct = useMemo(() => {
    if (busyEntries.length === 0) return 0;
    let rx = 0;
    let total = 0;
    let hasTotal = true;
    for (const e of busyEntries) {
      rx += e.receivedBytes;
      if (e.totalBytes != null && e.totalBytes > 0) {
        total += e.totalBytes;
      } else {
        hasTotal = false;
      }
    }
    if (hasTotal && total > 0) return Math.min(100, (rx / total) * 100);
    return rx > 0 ? 40 : 0;
  }, [busyEntries]);

  // Fade-out: only apply when all downloads are done/fading (interrupted and error entries exempt)
  const [fadeOut, setFadeOut] = useState(false);
  const allFinishing = !anyBusy && !anyInterrupted && !anyPaused && !anyErr && entries.every(
    (e) => e.phase === "fading" || e.phase === "complete",
  );

  const allFinishingRef = useRef(allFinishing);
  allFinishingRef.current = allFinishing;

  useEffect(() => {
    if (!allFinishing) {
      setFadeOut(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (allFinishingRef.current) setFadeOut(true);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [allFinishing]);

  if (allGone) return null;

  return (
    <div
      className={cn(
        "group/hf-dl relative w-full transition-opacity duration-500 ease-out",
        allFinishing && fadeOut ? "opacity-0" : "opacity-100",
      )}
    >
      <div className="relative w-full">
        {/* Icon + progress bar — full sidebar width, matches NavButton hit area */}
        <div
          className={cn(
            "relative flex h-10 w-full flex-col rounded-lg transition-[box-shadow,background-color,border-color]",
            isLight
              ? "border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
              : "border border-transparent bg-transparent",
            anyBusy || anyPaused
              ? "group-hover/hf-dl:border-cyan-400/20 group-hover/hf-dl:bg-cyan-500/[0.06] group-hover/hf-dl:ring-1 group-hover/hf-dl:ring-cyan-500/15"
              : anyInterrupted
                ? "group-hover/hf-dl:border-amber-400/20 group-hover/hf-dl:bg-amber-500/[0.06] group-hover/hf-dl:ring-1 group-hover/hf-dl:ring-amber-500/15"
                : anyErr
                  ? "group-hover/hf-dl:border-rose-400/20 group-hover/hf-dl:bg-rose-500/[0.06] group-hover/hf-dl:ring-1 group-hover/hf-dl:ring-rose-500/15"
                  : "group-hover/hf-dl:bg-white/[0.04]",
          )}
        >
          <div className="relative flex flex-1 items-center justify-center">
            {/* text-zinc-200 auto-inverts to near-dark in light mode */}
            {anyBusy && <Download className="h-4 w-4 text-zinc-200" aria-hidden />}
            {!anyBusy && anyPaused && <Pause className="h-4 w-4 text-zinc-400" aria-hidden />}
            {!anyBusy && !anyPaused && anyOk && <Check className="h-4 w-4 text-emerald-500/95" aria-hidden />}
            {!anyBusy && !anyPaused && !anyOk && anyErr && <XCircle className="h-4 w-4 text-rose-500/95" aria-hidden />}
            {!anyBusy && !anyPaused && !anyOk && !anyErr && anyInterrupted && (
              <Download className={cn("h-4 w-4", isLight ? "text-amber-600" : "text-amber-400/90")} aria-hidden />
            )}
          </div>
          {/* Progress bar — rounded-b-lg clips it to the parent's corner radius */}
          {anyBusy ? (
            <div className="h-1 w-full shrink-0 overflow-hidden rounded-b-lg bg-zinc-800/90">
              <div
                className="h-full bg-cyan-500/80 transition-all duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : anyPaused ? (
            <div className="h-1 w-full shrink-0 overflow-hidden rounded-b-lg bg-zinc-800/90">
              <div
                className="h-full bg-zinc-500/70 transition-none"
                style={{ width: `${pausedPct}%` }}
              />
            </div>
          ) : (
            <div className="h-1 w-full shrink-0 overflow-hidden rounded-b-lg bg-zinc-800/80">
              <div
                className={cn(
                  "h-full transition-all duration-300",
                  anyOk
                    ? "bg-emerald-500/60 w-full"
                    : anyInterrupted
                      ? "bg-amber-500/60"
                      : "bg-rose-500/50 w-full",
                )}
                style={anyInterrupted ? { width: `${interruptedPct}%` } : undefined}
              />
            </div>
          )}
        </div>

        {/* Count badge */}
        {busyEntries.length > 1 && (
          <span className="pointer-events-none absolute right-0.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-500 text-[8px] font-bold leading-none text-white">
            {busyEntries.length}
          </span>
        )}
        {!anyBusy && anyPaused && pausedEntries.length > 1 && (
          <span className="pointer-events-none absolute right-0.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-500 text-[8px] font-bold leading-none text-white">
            {pausedEntries.length}
          </span>
        )}
        {!anyBusy && !anyPaused && interruptedEntries.length > 0 && (
          <span className="pointer-events-none absolute right-0.5 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black leading-none text-amber-950 ring-1 ring-amber-300">
            {interruptedEntries.length}
          </span>
        )}
        {!anyBusy && !anyPaused && interruptedEntries.length === 0 && errorEntries.length > 0 && (
          <span className="pointer-events-none absolute right-0.5 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black leading-none text-white ring-1 ring-rose-400">
            {errorEntries.length}
          </span>
        )}

        {/* Hover flyout — flyoutPanel uses bg-zinc-950 which auto-inverts to near-white in light mode */}
        <div
          className="absolute left-full top-1/2 z-[100] -translate-y-1/2 pl-2 transition-opacity duration-150 invisible opacity-0 group-hover/hf-dl:visible group-hover/hf-dl:opacity-100"
        >
          <div
            className={cn(
              "relative z-50 w-[min(20rem,calc(100vw-4rem))] p-2",
              flyoutPanel,
            )}
          >
            <div className="flex max-h-[min(70vh,32rem)] flex-col gap-2 overflow-y-auto">
              {entries.map((entry) => (
                <DownloadEntryRow
                  key={entry.downloadId}
                  entry={entry}
                  theme={theme}
                  onDismiss={() => dismiss(entry.downloadId)}
                  onCancel={() => cancelDownload(entry.downloadId)}
                  onPause={() => pauseDownload(entry.downloadId)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
