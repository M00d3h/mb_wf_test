import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { Download, Loader2, Pause, RotateCcw, Search, RefreshCw, Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useModelsStore } from "../store/modelsStore";
import { useServerStore } from "../store/serverStore";
import { useThemeStore } from "../store/themeStore";
import { useHfDownloadStore, type DownloadEntry } from "../store/hfDownloadStore";
import { useSettingsStore } from "../store/settingsStore";
import { cn, extractQuant } from "../lib/utils";
import { getProviderFromModelDir } from "../lib/hfModelPublisher";
import { ModelCard } from "../components/models/ModelCard";
import { ModelDetails } from "../components/models/ModelDetails";
import { TagChip } from "../components/shared/TagChip";
import { FolderQuantProviderInline } from "../components/models/FolderQuantProviderInline";
import { api } from "../lib/ipc";
import type {
  HfIncompleteDownloadInfo,
  HfModelLibrary,
  Model,
  Profile,
} from "@shared/types";
import { readLibraryTab, writeLibraryTab } from "../lib/libraryTab";
import {
  modelHasVisionCapability,
  resolveProfileMmprojForModel,
} from "../lib/modelCapabilities";
import { VllmModelDetails } from "../components/models/VllmModelDetails";
import { VllmModelCard } from "../components/models/VllmModelCard";
import { useVllmStore } from "../store/vllmStore";
import { useVllmSetupStore } from "../store/vllmSetupStore";
import llamacppIcon from "../assets/llamacpp-icon.png";
import vllmColorIcon from "../assets/vllm-color.svg";

const isMacOs = window.platform === 'darwin';

function groupModels(
  models: Model[],
  profilesByModel: Record<string, Profile[]>,
): {
  embedding: Model[];
  multimodal: Model[];
  other: Model[];
} {
  const embedding: Model[] = [];
  const multimodal: Model[] = [];
  const other: Model[] = [];
  for (const m of models) {
    if (m.isEmbedding) embedding.push(m);
    else if (
      modelHasVisionCapability(
        m,
        resolveProfileMmprojForModel(m.id, profilesByModel),
      )
    ) {
      multimodal.push(m);
    } else other.push(m);
  }
  return { embedding, multimodal, other };
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ActiveDownloadCard({
  entry,
  theme,
}: {
  entry: DownloadEntry;
  theme: string;
}): JSX.Element {
  const { cancelDownload, pauseDownload, dismiss, registerPendingDownload, reportDownloadError } = useHfDownloadStore();
  const [resuming, setResuming] = useState(false);

  const pct = useMemo(() => {
    if (entry.totalBytes != null && entry.totalBytes > 0) {
      return Math.min(100, (entry.receivedBytes / entry.totalBytes) * 100);
    }
    return entry.receivedBytes > 0 ? 40 : 0;
  }, [entry.receivedBytes, entry.totalBytes]);

  const isPaused = entry.phase === "paused";
  const isInterrupted = entry.phase === "interrupted";
  const [abandoning, setAbandoning] = useState(false);

  const handleAbandon = async (): Promise<void> => {
    if (!entry.interruptedMeta || abandoning) return;
    setAbandoning(true);
    try {
      await api.hf.abandonDownload(entry.interruptedMeta.modelDir);
      dismiss(entry.downloadId);
    } finally {
      setAbandoning(false);
    }
  };

  const handleResume = async (): Promise<void> => {
    if (!entry.interruptedMeta || resuming) return;
    const { meta } = entry.interruptedMeta;
    const newId = uuidv4();
    setResuming(true);
    const initialBytes = entry.receivedBytes > 0 ? entry.receivedBytes : undefined;
    const initialTotal = entry.totalBytes;
    const hintToCarry = isPaused ? entry.progressHint : null;
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

  if (isInterrupted) {
    const missingCount = entry.interruptedMeta?.missingFilenames.length ?? 0;
    return (
      <div
        className={cn(
          "w-full flex items-start gap-2 px-2.5 py-2 rounded-md border",
          theme === "light"
            ? "border-amber-600/40 bg-amber-50/80"
            : "border-amber-500/20 bg-amber-500/[0.05]",
        )}
      >
        <Download
          className={cn(
            "h-4 w-4 shrink-0 mt-0.5",
            theme === "light" ? "text-amber-600/80" : "text-amber-400/70",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 flex flex-col justify-between">
          <div
            className={cn(
              "text-sm font-medium leading-tight truncate",
              theme === "light" ? "text-black" : "text-zinc-200",
            )}
          >
            {entry.repoId ?? entry.fileLabel}
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <div
              className={cn(
                "text-[11px]",
                theme === "light" ? "text-amber-700/80" : "text-amber-400/70",
              )}
            >
              {missingCount === 1 ? "1 file missing" : `${missingCount} files missing`}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={resuming || abandoning}
                onClick={() => void handleResume()}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border disabled:opacity-50 transition-colors",
                  theme === "light"
                    ? "text-amber-700 bg-amber-100 border-amber-400/50 hover:bg-amber-200"
                    : "text-amber-300 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
                )}
              >
                <RotateCcw className="h-3 w-3" />
                {resuming ? "…" : "Resume"}
              </button>
              <button
                type="button"
                disabled={resuming || abandoning}
                onClick={() => void handleAbandon()}
                title="Abandon download and delete partial files"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border disabled:opacity-50 transition-colors",
                  theme === "light"
                    ? "text-rose-700 bg-rose-50 border-rose-400/50 hover:bg-rose-100"
                    : "text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
                )}
              >
                <Trash2 className="h-3 w-3" />
                {abandoning ? "…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full flex flex-col gap-1.5 px-2.5 py-2 rounded-md border",
        theme === "light"
          ? "border-emerald-600/40 bg-emerald-50/80"
          : "border-emerald-500/20 bg-emerald-500/[0.05]",
      )}
    >
      <div className="flex items-start gap-2">
        <Download
          className={cn(
            "h-4 w-4 shrink-0 mt-0.5",
            theme === "light" ? "text-emerald-600/80" : "text-emerald-400/70",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-sm font-medium leading-tight truncate",
              theme === "light" ? "text-black" : "text-zinc-200",
            )}
          >
            {entry.repoId ?? entry.fileLabel}
          </div>
          {entry.repoId && entry.fileLabel && (
            <div className="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
              {entry.fileLabel}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        {entry.progressHint && (
          <p className="flex items-center gap-1 text-[11px] text-zinc-500 mb-0.5">
            {isPaused
              ? <Pause className="h-3 w-3 shrink-0" />
              : <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            }
            <span className="truncate">{entry.progressHint}</span>
          </p>
        )}
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/40">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-150",
              isPaused ? "bg-zinc-500/70" : "bg-emerald-500/80",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className={cn("text-[11px] tabular-nums", theme === "light" ? "text-emerald-700/80" : "text-emerald-400/70")}>
            {isPaused ? "Paused · " : ""}
            {formatBytes(entry.receivedBytes)}
            {entry.totalBytes != null && entry.totalBytes > 0
              ? ` / ${formatBytes(entry.totalBytes)}`
              : " …"}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {isPaused ? (
              <button
                type="button"
                disabled={resuming}
                onClick={() => void handleResume()}
                className={cn(
                  "flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50",
                  theme === "light"
                    ? "text-emerald-700 border-emerald-500/40 hover:bg-emerald-100"
                    : "text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10",
                )}
              >
                <RotateCcw className="h-3 w-3" />
                {resuming ? "…" : "Resume"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => pauseDownload(entry.downloadId)}
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors",
                  theme === "light"
                    ? "text-emerald-700 border-emerald-500/40 hover:bg-emerald-100"
                    : "text-zinc-400 border-zinc-600/40 hover:bg-zinc-700/40",
                )}
              >
                Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => cancelDownload(entry.downloadId)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors",
                theme === "light"
                  ? "text-rose-700 border-rose-400/40 hover:bg-rose-50"
                  : "text-rose-400 border-rose-500/20 hover:bg-rose-500/10",
              )}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrphanDownloadCard({
  info,
  theme,
  onAbandoned,
}: {
  info: HfIncompleteDownloadInfo;
  theme: string;
  onAbandoned: () => void;
}): JSX.Element {
  const [resuming, setResuming] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const { settings } = useSettingsStore();
  const { registerPendingDownload, dismiss, reportDownloadError } = useHfDownloadStore();

  const quant = useMemo(
    () =>
      extractQuant(info.meta.destFolder) ??
      extractQuant(info.missingFilenames[0] ?? ""),
    [info.meta.destFolder, info.missingFilenames],
  );

  const provider = useMemo(
    () => getProviderFromModelDir(info.modelDir, settings?.modelsDirs ?? []),
    [info.modelDir, settings?.modelsDirs],
  );

  const handleResume = async (): Promise<void> => {
    if (resuming) return;
    const newId = uuidv4();
    setResuming(true);
    // Dismiss the corresponding sidebar interrupted entry so it doesn't double-resume.
    dismiss(`__interrupted__${info.modelDir}`);
    registerPendingDownload(newId, "", info.meta.repoId, undefined, undefined, info.meta.vllmTarget);
    try {
      const result = await api.hf.download({
        downloadId: newId,
        repoId: info.meta.repoId,
        filenames: info.meta.filenames,
        fileSizes: info.meta.fileSizes,
        modelsDir: info.meta.modelsDir,
        destFolder: info.meta.destFolder,
        vllmTarget: info.meta.vllmTarget,
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

  const handleAbandon = async (): Promise<void> => {
    if (abandoning) return;
    setAbandoning(true);
    try {
      await api.hf.abandonDownload(info.modelDir);
      dismiss(`__interrupted__${info.modelDir}`);
      onAbandoned();
    } finally {
      setAbandoning(false);
    }
  };

  return (
    <div
      className={cn(
        "w-full flex items-start gap-2 px-2.5 py-2 rounded-md border",
        theme === "light"
          ? "border-amber-600/40 bg-amber-50/80"
          : "border-amber-500/20 bg-amber-500/[0.05]",
      )}
    >
      <Download
        className={cn(
          "h-4 w-4 shrink-0 mt-0.5",
          theme === "light" ? "text-amber-600/80" : "text-amber-400/70",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 flex flex-col justify-between">
        <div
          className={cn(
            "text-sm font-medium leading-tight truncate",
            theme === "light" ? "text-black" : "text-zinc-200",
          )}
        >
          {info.meta.destFolder}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="flex items-center gap-1 flex-wrap">
            {quant && <TagChip label={quant} variant="quant" />}
            {provider && <FolderQuantProviderInline providerSlug={provider} />}
            <div
              className={cn(
                "text-[11px]",
                theme === "light" ? "text-amber-700/80" : "text-amber-400/70",
              )}
            >
              {info.missingFilenames.length === 1
                ? "1 file missing"
                : `${info.missingFilenames.length} files missing`}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={resuming || abandoning}
              onClick={() => void handleResume()}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border disabled:opacity-50 transition-colors",
                theme === "light"
                  ? "text-amber-700 bg-amber-100 border-amber-400/50 hover:bg-amber-200"
                  : "text-amber-300 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
              )}
            >
              <RotateCcw className="h-3 w-3" />
              {resuming ? "…" : "Resume"}
            </button>
            <button
              type="button"
              disabled={resuming || abandoning}
              onClick={() => void handleAbandon()}
              title="Abandon download and delete partial files"
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border disabled:opacity-50 transition-colors",
                theme === "light"
                  ? "text-rose-700 bg-rose-50 border-rose-400/50 hover:bg-rose-100"
                  : "text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
              )}
            >
              <Trash2 className="h-3 w-3" />
              {abandoning ? "…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModelsPage(): JSX.Element {
  const {
    models,
    profiles,
    selectedModelId,
    scanning,
    loading,
    fetchModels,
    fetchProfiles,
    scanModels,
    selectModel,
  } = useModelsStore();
  const { fetchInstances } = useServerStore();
  const { theme } = useThemeStore();
  const [libraryTab, setLibraryTab] = useState<HfModelLibrary>(readLibraryTab());
  const [search, setSearch] = useState("");
  const vllmModels = useVllmStore((s) => s.models);
  const vllmScanWarnings = useVllmStore((s) => s.scanWarnings);
  const vllmLoading = useVllmStore((s) => s.loading);
  const fetchVllmList = useVllmStore((s) => s.fetchList);
  const scanVllm = useVllmStore((s) => s.scan);
  const vllmSetupPhase = useVllmSetupStore((s) => s.phase);
  const [selectedVllmId, setSelectedVllmId] = useState<string | null>(null);
  const [incompleteModelDirs, setIncompleteModelDirs] = useState<Set<string>>(new Set());
  const [orphanMetas, setOrphanMetas] = useState<HfIncompleteDownloadInfo[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Load from DB on each visit (snappy). Boot does one disk scan in App.tsx; use
  // refresh for an extra scan. Visiting this page does not rescan the disk.
  useEffect(() => {
    fetchInstances();
    fetchModels();
  }, [fetchInstances, fetchModels]);

  // Re-fetch when setup phase changes so models surface as soon as vLLM setup
  // completes — without this, an earlier fetch can race with the setup scan
  // and leave the page showing an empty list until the app is restarted.
  useEffect(() => {
    if (libraryTab === "vllm") {
      void fetchVllmList();
    }
  }, [libraryTab, fetchVllmList, vllmSetupPhase]);

  const setTab = useCallback((tab: HfModelLibrary): void => {
    setLibraryTab(tab);
    writeLibraryTab(tab);
  }, []);

  useEffect(() => {
    if (models.length === 0) return;
    void Promise.all(models.map((m) => fetchProfiles(m.id))).catch(() => {});
  }, [models, fetchProfiles]);

  // Load orphan incomplete downloads (dirs with meta but no GGUF in the models list).
  useEffect(() => {
    void api.hf.getAllIncompleteMetas().then((metas) => {
      setOrphanMetas(metas);
    }).catch(() => {});
  }, []);

  // After models load, check which have incomplete HF downloads.
  useEffect(() => {
    if (models.length === 0) {
      setIncompleteModelDirs(new Set());
      return;
    }
    void api.hf
      .checkIncompleteMetas(models.map((m) => m.modelDir))
      .then((dirs) => setIncompleteModelDirs(new Set(dirs)))
      .catch(() => {});
  }, [models]);

  const filtered = models.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredVllm = useMemo(
    () =>
      vllmModels
        .filter(
          (m) =>
            m.displayName.toLowerCase().includes(search.toLowerCase()) ||
            m.path.toLowerCase().includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            b.diskSize - a.diskSize || a.displayName.localeCompare(b.displayName),
        ),
    [vllmModels, search],
  );
  const selectedVllm = vllmModels.find((m) => m.id === selectedVllmId);

  const { embedding, multimodal, other } = useMemo(
    () => groupModels(filtered, profiles),
    [filtered, profiles],
  );

  const orderedIds = useMemo(
    () =>
      [...embedding, ...multimodal, ...other].map((m) => m.id),
    [embedding, multimodal, other],
  );

  const vllmOrderedIds = useMemo(
    () => filteredVllm.map((m) => m.id),
    [filteredVllm],
  );

  const llamaTotalBytes = useMemo(
    () => models.reduce((sum, m) => sum + (m.ggufTotalBytes ?? 0), 0),
    [models],
  );

  const vllmTotalBytes = useMemo(
    () => vllmModels.reduce((sum, m) => sum + m.diskSize, 0),
    [vllmModels],
  );

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (libraryTab === "vllm") {
        const n = vllmOrderedIds.length;
        if (n === 0) return;
        const cur = selectedVllmId
          ? vllmOrderedIds.indexOf(selectedVllmId)
          : -1;
        let next: number;
        if (e.key === "ArrowDown") {
          next = cur < 0 ? 0 : Math.min(cur + 1, n - 1);
        } else {
          next = cur <= 0 ? 0 : cur - 1;
        }
        setSelectedVllmId(vllmOrderedIds[next]!);
        return;
      }
      const n = orderedIds.length;
      if (n === 0) return;
      const cur = selectedModelId
        ? orderedIds.indexOf(selectedModelId)
        : -1;
      let next: number;
      if (e.key === "ArrowDown") {
        next = cur < 0 ? 0 : Math.min(cur + 1, n - 1);
      } else {
        next = cur <= 0 ? 0 : cur - 1;
      }
      selectModel(orderedIds[next]!);
    },
    [
      libraryTab,
      vllmOrderedIds,
      selectedVllmId,
      orderedIds,
      selectedModelId,
      selectModel,
    ],
  );

  const selectedModel = models.find((m) => m.id === selectedModelId);

  const downloads = useHfDownloadStore((s) => s.downloads);

  // Orphan = incomplete meta with no corresponding model scanned AND still in store
  // (disappears when resumed from sidebar or dismissed).
  const modelDirSet = useMemo(
    () => new Set(models.map((m) => m.modelDir)),
    [models],
  );
  const visibleOrphans = useMemo(
    () =>
      orphanMetas.filter(
        (o) =>
          !o.meta.vllmTarget &&
          !modelDirSet.has(o.modelDir) &&
          `__interrupted__${o.modelDir}` in downloads,
      ),
    [orphanMetas, modelDirSet, downloads],
  );

  const activeDownloads = useMemo(
    () =>
      Object.values(downloads).filter(
        (e) => !e.vllmTarget && (e.phase === "downloading" || e.phase === "paused"),
      ),
    [downloads],
  );

  const vllmActiveDownloads = useMemo(
    () =>
      Object.values(downloads).filter(
        (e) =>
          e.vllmTarget === true &&
          (e.phase === "downloading" || e.phase === "paused"),
      ),
    [downloads],
  );

  const vllmInterruptedDownloads = useMemo(
    () =>
      Object.values(downloads).filter(
        (e) => e.vllmTarget === true && e.phase === "interrupted",
      ),
    [downloads],
  );

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <div
        className={cn(
          "w-96 shrink-0 flex flex-col min-h-0 rounded-2xl",
          theme === "light"
            ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
            : "bg-zinc-900/35 ring-1 ring-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        )}
      >
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  libraryTab === "vllm"
                    ? "Search vLLM models…"
                    : "Search models…"
                }
                className="w-full pl-7 pr-2 py-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
              />
            </div>
            <button
              onClick={() =>
                libraryTab === "vllm" ? void scanVllm() : void scanModels()
              }
              disabled={libraryTab === "vllm" ? vllmLoading : scanning}
              title={
                libraryTab === "vllm"
                  ? "Scan vLLM model directories"
                  : "Scan for models"
              }
              className="p-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-lg hover:bg-zinc-700/80 text-zinc-400 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${(libraryTab === "vllm" ? vllmLoading : scanning) ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          <div
            className={cn(
              "flex gap-0.5 rounded-lg border p-0.5 mt-2",
              theme === "light"
                ? "border-zinc-700/35 bg-zinc-900/40"
                : "border border-zinc-700 bg-zinc-900/50",
            )}
            role="group"
            aria-label="Model library"
          >
            <button
              type="button"
              aria-pressed={libraryTab === "llama"}
              onClick={() => setTab("llama")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                libraryTab === "llama"
                  ? theme === "light"
                    ? "bg-zinc-800/50 text-zinc-100"
                    : "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              <img
                src={llamacppIcon}
                alt=""
                className="h-3.5 w-3.5 shrink-0 object-contain opacity-95"
              />
              llama.cpp
            </button>
            {!isMacOs && (
              <button
                type="button"
                aria-pressed={libraryTab === "vllm"}
                onClick={() => setTab("vllm")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                  libraryTab === "vllm"
                    ? theme === "light"
                      ? "bg-zinc-800/50 text-zinc-100"
                      : "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <img
                  src={vllmColorIcon}
                  alt=""
                  className="h-3.5 w-3.5 shrink-0 opacity-95"
                />
                vLLM
              </button>
            )}
          </div>
        </div>

        <div
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-label="Models"
          aria-activedescendant={
            libraryTab === "vllm"
              ? (selectedVllmId ?? undefined)
              : (selectedModelId ?? undefined)
          }
          onKeyDown={handleListKeyDown}
          className="flex-1 overflow-y-auto p-2 pt-1 flex flex-col gap-3 outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/40 focus-visible:ring-inset rounded-xl min-h-0"
        >
          {libraryTab === "vllm" ? (
            <>
              {vllmLoading && !vllmModels.length && (
                <div className="text-sm text-zinc-500 text-center py-8">
                  Loading…
                </div>
              )}
              {vllmScanWarnings.length > 0 && (
                <ul
                  className={cn(
                    "mb-2 text-left text-xs rounded-lg border px-3 py-2 space-y-1.5 shrink-0",
                    theme === "light"
                      ? "border-amber-600/35 bg-amber-50/90 text-amber-950"
                      : "border-amber-500/30 bg-amber-500/[0.07] text-amber-100/95",
                  )}
                >
                  {vllmScanWarnings.map((w, i) => (
                    <li key={i} className="leading-snug">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              {!vllmLoading && !filteredVllm.length && !vllmActiveDownloads.length && !vllmInterruptedDownloads.length && (
                <div className="text-sm text-zinc-600 text-center py-6 px-2 whitespace-pre-line">
                  {vllmModels.length === 0
                    ? "No vLLM models found.\nAdd directories in Settings → vLLM, then scan."
                    : "No results for this search."}
                </div>
              )}

              {vllmActiveDownloads.length > 0 && (
                <section aria-label="Active vLLM downloads">
                  <h3
                    className={cn(
                      "px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider",
                      theme === "light" ? "text-emerald-700/80" : "text-emerald-500/80",
                    )}
                  >
                    Downloading
                  </h3>
                  <div className="flex flex-col gap-1">
                    {vllmActiveDownloads.map((entry) => (
                      <ActiveDownloadCard
                        key={entry.downloadId}
                        entry={entry}
                        theme={theme}
                      />
                    ))}
                  </div>
                </section>
              )}

              {vllmInterruptedDownloads.length > 0 && (
                <section aria-label="Incomplete vLLM downloads">
                  <h3
                    className={cn(
                      "px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider",
                      theme === "light" ? "text-amber-700/80" : "text-amber-500/80",
                    )}
                  >
                    Incomplete Downloads
                  </h3>
                  <div className="flex flex-col gap-1">
                    {vllmInterruptedDownloads.map((entry) => (
                      <ActiveDownloadCard
                        key={entry.downloadId}
                        entry={entry}
                        theme={theme}
                      />
                    ))}
                  </div>
                </section>
              )}

              <div className="flex flex-col gap-1">
                {filteredVllm.map((m) => (
                  <VllmModelCard
                    key={m.id}
                    model={m}
                    selected={selectedVllmId === m.id}
                    onClick={() => setSelectedVllmId(m.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
          {loading && !models.length && (
            <div className="text-sm text-zinc-500 text-center py-8">
              Loading…
            </div>
          )}
          {!loading && !filtered.length && (
            <div className="text-sm text-zinc-600 text-center py-8 whitespace-pre-line">
              {models.length === 0
                ? "No models found.\nClick scan to discover models."
                : "No results for this search."}
            </div>
          )}

          {activeDownloads.length > 0 && (
            <section aria-label="Active downloads">
              <h3
                className={cn(
                  "px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider",
                  theme === "light" ? "text-emerald-700/80" : "text-emerald-500/80",
                )}
              >
                Downloading
              </h3>
              <div className="flex flex-col gap-1">
                {activeDownloads.map((entry) => (
                  <ActiveDownloadCard
                    key={entry.downloadId}
                    entry={entry}
                    theme={theme}
                  />
                ))}
              </div>
            </section>
          )}

          {visibleOrphans.length > 0 && (
            <section aria-label="Incomplete downloads">
              <h3
                className={cn(
                  "px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider",
                  theme === "light" ? "text-amber-700/80" : "text-amber-500/80",
                )}
              >
                Incomplete Downloads
              </h3>
              <div className="flex flex-col gap-1">
                {visibleOrphans.map((info) => (
                  <OrphanDownloadCard
                    key={info.modelDir}
                    info={info}
                    theme={theme}
                    onAbandoned={() =>
                      setOrphanMetas((prev) => prev.filter((o) => o.modelDir !== info.modelDir))
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {embedding.length > 0 && (
            <section aria-label="Embedding models">
              <h3 className="px-1 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                Embedding
              </h3>
              <div className="flex flex-col gap-1">
                {embedding.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    visionCapable={modelHasVisionCapability(
                      m,
                      resolveProfileMmprojForModel(m.id, profiles),
                    )}
                    selected={m.id === selectedModelId}
                    onClick={() => selectModel(m.id)}
                    incomplete={incompleteModelDirs.has(m.modelDir)}
                  />
                ))}
              </div>
            </section>
          )}

          {multimodal.length > 0 && (
            <section aria-label="Multimodal models">
              <h3 className="px-1 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                Multimodal
              </h3>
              <div className="flex flex-col gap-1">
                {multimodal.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    visionCapable={modelHasVisionCapability(
                      m,
                      resolveProfileMmprojForModel(m.id, profiles),
                    )}
                    selected={m.id === selectedModelId}
                    onClick={() => selectModel(m.id)}
                    incomplete={incompleteModelDirs.has(m.modelDir)}
                  />
                ))}
              </div>
            </section>
          )}

          {other.length > 0 && (
            <section aria-label="Language models">
              <h3 className="px-1 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                {embedding.length > 0 || multimodal.length > 0
                  ? "Other"
                  : "Models"}
              </h3>
              <div className="flex flex-col gap-1">
                {other.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    visionCapable={modelHasVisionCapability(
                      m,
                      resolveProfileMmprojForModel(m.id, profiles),
                    )}
                    selected={m.id === selectedModelId}
                    onClick={() => selectModel(m.id)}
                    incomplete={incompleteModelDirs.has(m.modelDir)}
                  />
                ))}
              </div>
            </section>
          )}
            </>
          )}
        </div>

        <div className="px-3 pt-2 pb-2.5 shrink-0 text-[11px] text-zinc-500 tabular-nums">
          {libraryTab === "vllm" ? (
            <>
              {vllmModels.length} vLLM model{vllmModels.length !== 1 ? "s" : ""}
              {vllmTotalBytes > 0 && (
                <span className="text-zinc-600">
                  {" · "}{(vllmTotalBytes / 1e9).toFixed(1)} GB
                </span>
              )}
            </>
          ) : (
            <>
              {models.length} model{models.length !== 1 ? "s" : ""}
              {llamaTotalBytes > 0 && (
                <span className="text-zinc-600">
                  {" · "}{(llamaTotalBytes / 1e9).toFixed(1)} GB
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-hidden min-w-0 rounded-2xl min-h-0",
          theme === "light"
            ? "border border-zinc-700/30 bg-zinc-950/40 shadow-none ring-1 ring-zinc-700/20"
            : "bg-zinc-900/20 ring-1 ring-white/[0.04]",
        )}
      >
        {libraryTab === "vllm" ? (
          selectedVllm ? (
            <VllmModelDetails model={selectedVllm} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-600 text-base">
              Select a vLLM model
            </div>
          )
        ) : selectedModel ? (
          <ModelDetails
            model={selectedModel}
            onDownloadComplete={() =>
              setIncompleteModelDirs((prev) => {
                const next = new Set(prev);
                next.delete(selectedModel.modelDir);
                return next;
              })
            }
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-base">
            Select a model to view details
          </div>
        )}
      </div>
    </div>
  );
}
