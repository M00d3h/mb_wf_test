import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Download,
  Heart,
  ExternalLink,
  Loader2,
  Flame,
  FolderOpen,
  FileText,
  Image,
  Clock,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type {
  HfLocalGgufDirStatus,
  HfLocalGgufStatusBatchResult,
  HfModelLibrary,
  HfModelListSort,
  HfModelSummary,
  HfRepoFileInfo,
  HfRepoGgufFile,
  HfRepoVllmModel,
  HfVllmModelsResult,
  SystemStats,
} from "@shared/types";
import { api } from "../lib/ipc";
import { readLibraryTab, writeLibraryTab } from "../lib/libraryTab";
import llamacppIcon from "../assets/llamacpp-icon.png";
import vllmColorIcon from "../assets/vllm-color.svg";

const isMacOs = window.platform === 'darwin';

import { useSettingsStore } from "../store/settingsStore";
import { useThemeStore } from "../store/themeStore";
import { useHfDownloadStore } from "../store/hfDownloadStore";
import { useModelsStore } from "../store/modelsStore";
import { cn } from "../lib/utils";
import { publisherNeedsWhiteAvatarBackground } from "../lib/hfModelPublisher";
import { usePublisherAvatarUrl, prefetchPublisherAvatars } from "../lib/usePublisherAvatarUrl";
import { HfReadmeMarkdown } from "../components/hf/HfReadmeMarkdown";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatVramMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / (1000 * 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1mo ago";
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1yr ago" : `${years}yr ago`;
}

type OffloadTier = "gpu_ok" | "cpu_mild" | "cpu_severe" | "unknown";

/** Plain size text (no border); colors come from tier. */
const hfFileRowSizeText =
  "inline-flex min-w-[4.5rem] max-w-[7.5rem] shrink-0 items-center text-xs font-semibold tabular-nums";

/** Hugging Face modal download — dark: glass pill; light: neutral border (same weight as cyan hover, no hue). */
const hfDownloadButtonLayout =
  "group inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-40";

const hfDownloadButtonIdleDark =
  "border-white/[0.08] bg-white/[0.03] text-zinc-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/25";

const hfDownloadButtonIdleLight =
  "border-zinc-400/55 bg-transparent text-black shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30";

const hfDownloadButtonHoverDark =
  "hover:border-cyan-400/20 hover:bg-cyan-500/[0.09] hover:text-cyan-50 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]";

const hfDownloadButtonHoverLight =
  "hover:border-cyan-400 hover:bg-cyan-100 hover:text-cyan-900 hover:shadow-none";

/** GGUF file rows: fixed width so “Download” / “Downloaded” match; emerald when already on disk. */
const hfFileRowDownloadBtnBase =
  "group inline-flex h-8 w-[7rem] min-w-[7rem] max-w-[7rem] shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 text-xs font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-[background-color,border-color,color,box-shadow] focus:outline-none focus-visible:ring-2 disabled:pointer-events-none justify-self-end";

const hfFileRowDownloadFreshBase =
  "border-white/[0.08] bg-white/[0.03] text-xs text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/25";

/** Light: visible neutral border (same idea as modal download idle). */
const hfFileRowDownloadFreshIdleLight =
  "border-zinc-400/55 bg-transparent text-black shadow-none";

const hfFileRowDownloadFreshHoverDark =
  "hover:border-cyan-400/20 hover:bg-cyan-500/[0.09] hover:text-cyan-50";

const hfFileRowDownloadFreshHoverLight =
  "hover:border-cyan-400 hover:bg-cyan-100 hover:text-cyan-900";

const hfFileRowDownloadedLookBase =
  "border-emerald-400/40 bg-emerald-500/[0.09] text-xs text-emerald-100 focus-visible:ring-emerald-500/30";

/** Light mode: readable on pale surfaces. */
const hfFileRowDownloadedLookBaseLight =
  "border-emerald-500 bg-emerald-100 text-xs text-emerald-900 shadow-none focus-visible:ring-emerald-600/30";

const hfFileRowDownloadedLookHoverDark =
  "hover:border-emerald-500/30 hover:bg-white/[0.03] hover:text-emerald-400";

const hfFileRowDownloadedLookHoverLight =
  "hover:border-emerald-600/40 hover:bg-transparent hover:text-emerald-700";

/** Violet "Install Vision" button shown beside "Downloaded" when mmproj is missing. */
const hfFileRowInstallVisionBase =
  "border-violet-500/30 bg-violet-500/[0.08] text-violet-200";
const hfFileRowInstallVisionHoverDark =
  "hover:border-violet-400/50 hover:bg-violet-500/[0.15] hover:text-violet-100";
const hfFileRowInstallVisionIdleLight =
  "border-violet-600/50 bg-violet-100 text-violet-800";
const hfFileRowInstallVisionHoverLight =
  "hover:border-violet-600/70 hover:bg-violet-200 hover:text-violet-900";

const HF_SIDEBAR_PAGE_SIZE = 25;

/** How many **weight** rows the VRAM band targets (mmproj excluded). */
const HF_GGUF_VISIBLE_FILE_ROWS = 4;

/**
 * Padding (p-2) + four rows + three gaps (gap-2). Row height matches typical grid row (~3.75rem).
 * Light/dark surfaces applied in `HuggingFacePage` via `ggufFileListScrollClass`.
 */
const hfGgufFileListScrollBase =
  "max-h-[min(42vh,calc(0.5rem*2+4*3.75rem+0.5rem*3))] min-h-0 overflow-y-auto overscroll-y-contain rounded-xl p-2 pr-1 [scrollbar-gutter:stable]";

type GgufInitialScroll = "scroll_anchor" | "bottom_weights" | "top";

/**
 * mmproj rows first (smallest→largest), then weight GGUFs (smallest→largest).
 * Initial scroll (VRAM): align so ~four **weight** rows show the two largest fits + next two
 * too-big; mmproj is not part of that band (scroll up to see mmproj).
 */
function buildGgufDisplayList(
  files: HfRepoGgufFile[],
  gpu: SystemStats["gpu"] | null | undefined,
  platform?: string,
  ram?: SystemStats["ram"],
): {
  rows: HfRepoGgufFile[];
  mmprojCount: number;
  /** Row index in `rows` to bottom-align for initial scroll (VRAM path). */
  scrollAnchorRowIndex: number | null;
  /** First **weight** row of the VRAM band (full-list index includes mmproj rows above). */
  vramBandFirstRowIndex: number | null;
  initialScroll: GgufInitialScroll;
  mode: "vram" | "no_gpu" | "no_fit" | "only_mmproj";
} {
  const mmproj = [...files.filter((f) => f.isMmproj)].sort(
    (a, b) => a.size - b.size,
  );
  const weights = [...files.filter((f) => !f.isMmproj)].sort(
    (a, b) => a.size - b.size,
  );
  const rows = [...mmproj, ...weights];
  const mmprojCount = mmproj.length;

  if (weights.length === 0) {
    return {
      rows,
      mmprojCount,
      scrollAnchorRowIndex: null,
      vramBandFirstRowIndex: null,
      initialScroll: "top",
      mode: files.length > 0 ? "only_mmproj" : "no_fit",
    };
  }

  const isMac = platform === "darwin";
  const totalGpuMem = gpu?.reduce((acc, g) => acc + g.memTotalMb, 0) ?? 0;
  const budgetMb = isMac ? (ram?.totalMb ?? 0) : totalGpuMem;
  const hasGpu = isMac ? budgetMb > 0 : totalGpuMem > 0;
  if (!hasGpu) {
    return {
      rows,
      mmprojCount,
      scrollAnchorRowIndex: null,
      vramBandFirstRowIndex: null,
      initialScroll: "bottom_weights",
      mode: "no_gpu",
    };
  }

  const totalBytes = budgetMb * 1024 * 1024;
  let lastFitWeightIdx = -1;
  const tooBigWeightIndices: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w.size <= 0) {
      continue;
    }
    if (w.size <= totalBytes) {
      lastFitWeightIdx = i;
    } else {
      tooBigWeightIndices.push(i);
    }
  }

  let anchorWeightIdx: number | null = null;
  if (tooBigWeightIndices.length >= 2) {
    anchorWeightIdx = tooBigWeightIndices[1]!;
  } else if (tooBigWeightIndices.length === 1) {
    anchorWeightIdx = tooBigWeightIndices[0]!;
  } else if (lastFitWeightIdx >= 0) {
    anchorWeightIdx = lastFitWeightIdx;
  }

  const scrollAnchorRowIndex =
    anchorWeightIdx != null ? mmprojCount + anchorWeightIdx : null;

  const maxStartWeight = Math.max(
    0,
    weights.length - HF_GGUF_VISIBLE_FILE_ROWS,
  );
  let bandFirstWeightIdx = 0;
  if (lastFitWeightIdx < 0) {
    bandFirstWeightIdx = 0;
  } else if (lastFitWeightIdx >= 1) {
    bandFirstWeightIdx = Math.min(lastFitWeightIdx - 1, maxStartWeight);
  } else {
    bandFirstWeightIdx = Math.min(0, maxStartWeight);
  }
  const vramBandFirstRowIndex = mmprojCount + bandFirstWeightIdx;

  const mode: "vram" | "no_fit" = lastFitWeightIdx >= 0 ? "vram" : "no_fit";

  return {
    rows,
    mmprojCount,
    scrollAnchorRowIndex,
    vramBandFirstRowIndex,
    initialScroll: scrollAnchorRowIndex != null ? "scroll_anchor" : "top",
    mode,
  };
}

/** Distinct configured roots for UI (trim, trailing slashes, case-insensitive dedupe). */
function uniqueModelDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const t = d.trim();
    if (!t) continue;
    const key = t.replace(/[/\\]+$/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function hfFileKey(f: HfRepoGgufFile): string {
  return f.shardParts && f.shardParts.length > 0
    ? f.shardParts.join("|")
    : f.path;
}

function hubFilenamesForFile(f: HfRepoGgufFile): string[] {
  return f.shardParts && f.shardParts.length > 0 ? f.shardParts : [f.path];
}

/** Match Settings paths to main-process `path` strings (slashes + case on Windows). */
function pathsEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/[/\\]+$/, "")
      .replace(/\\/g, "/")
      .toLowerCase();
  return norm(a) === norm(b);
}

function presentForDir(
  rows: HfLocalGgufDirStatus[] | undefined,
  dir: string,
): boolean {
  if (!rows?.length) return false;
  return rows.some((r) => pathsEqual(r.path, dir) && r.present);
}

function anyRootHasBundle(rows: HfLocalGgufDirStatus[] | undefined): boolean {
  if (!rows?.length) return false;
  return rows.some((r) => r.present);
}

function publisherFromRepoId(repoId: string): string {
  const slash = repoId.indexOf("/");
  return slash > 0 ? repoId.slice(0, slash) : repoId;
}

/** Hub user/org avatar from main-process–cached Hugging Face API lookup. */
function HfPublisherAvatar({
  publisher,
  size = "sm",
}: {
  publisher: string;
  size?: "sm" | "md";
}): JSX.Element {
  const url = usePublisherAvatarUrl(publisher);
  const [imageReady, setImageReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  /**
   * Cached images often fire `load` before a `useEffect` runs; that effect used to reset
   * `imageReady` and never fire again — list avatars stayed invisible (opacity-0).
   * useLayoutEffect + `complete` handles cache; `onLoad` handles async decode.
   */
  useLayoutEffect(() => {
    setImgFailed(false);
    if (!url) {
      setImageReady(false);
      return;
    }
    const el = imgRef.current;
    if (el?.complete && el.naturalHeight > 0) {
      setImageReady(true);
    } else {
      setImageReady(false);
    }
  }, [publisher, url]);

  const sizeClass = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const letter = (publisher.charAt(0) || "?").toUpperCase();
  const whiteDisc = publisherNeedsWhiteAvatarBackground(publisher);

  return (
    <div
      className={cn(
        sizeClass,
        "relative shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-600/60",
        whiteDisc ? "bg-white" : "bg-zinc-700",
      )}
      aria-hidden
    >
      {url && !imgFailed ? (
        <img
          key={url}
          ref={imgRef}
          src={url}
          alt=""
          loading={size === "sm" ? "eager" : "lazy"}
          decoding="async"
          className={cn(
            "absolute inset-0 h-full w-full",
            whiteDisc ? "object-contain" : "object-cover",
            !imageReady && "opacity-0",
          )}
          onLoad={() => setImageReady(true)}
          onError={() => {
            setImgFailed(true);
            setImageReady(false);
          }}
        />
      ) : null}
      <div
        className={cn(
          "flex h-full w-full items-center justify-center text-zinc-300 font-semibold",
          size === "md" ? "text-sm" : "text-xs",
          url && !imgFailed && imageReady && "hidden",
        )}
      >
        {letter}
      </div>
    </div>
  );
}

function offloadTier(
  sizeBytes: number,
  gpu: SystemStats["gpu"],
  platform?: string,
  ram?: SystemStats["ram"],
): OffloadTier {
  const isMac = platform === "darwin";
  if (!isMac && !gpu) return "unknown";
  if (isMac && !ram) return "unknown";
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "unknown";
  // On Mac use total unified memory; elsewhere compare to total VRAM capacity.
  const totalGpuMem = gpu?.reduce((acc, g) => acc + g.memTotalMb, 0) ?? 0;
  const budgetMb = isMac ? (ram?.totalMb ?? 0) : totalGpuMem;
  const totalBytes = budgetMb * 1024 * 1024;
  if (sizeBytes <= totalBytes) return "gpu_ok";
  const overTotal = sizeBytes - totalBytes;
  const overRatio = totalBytes > 0 ? overTotal / totalBytes : Infinity;
  return overRatio <= 0.25 ? "cpu_mild" : "cpu_severe";
}

/** File size pill + offload hint on one row (sits beside the GGUF path). */
function ModelSizeOffloadHint({
  sizeBytes,
  gpu,
  platform,
  ram,
}: {
  sizeBytes: number;
  gpu: SystemStats["gpu"];
  platform?: string;
  ram?: SystemStats["ram"];
}): JSX.Element {
  const { theme } = useThemeStore();
  const isMac = platform === "darwin";
  const tier = offloadTier(sizeBytes, gpu, platform, ram);
  const totalGpuMem = gpu?.reduce((acc, g) => acc + g.memTotalMb, 0) ?? 0;
  const totalGpuUsed = gpu?.reduce((acc, g) => acc + g.memUsedMb, 0) ?? 0;
  const budgetMb = isMac ? (ram?.totalMb ?? 0) : totalGpuMem;
  const usedMb = isMac ? (ram?.usedMb ?? 0) : totalGpuUsed;
  const freeMb = Math.max(0, budgetMb - usedMb);
  const memLabel = isMac ? "Unified Memory" : "VRAM";
  const titleBase =
    budgetMb > 0
      ? `~${formatVramMb(budgetMb)} total ${memLabel} — file size vs capacity (not current free memory; ~${formatVramMb(freeMb)} free now). Ignores KV cache & overhead.`
      : "";

  const sizeLine = sizeBytes > 0 ? formatBytes(sizeBytes) : "—";

  if (tier === "unknown") {
    const hint = isMac ? "Size unknown" : "VRAM unknown";
    return (
      <div className="flex w-full min-w-0 items-center gap-2">
        <span
          className={cn(hfFileRowSizeText, "text-zinc-300")}
          title={
            isMac
              ? "Model size unknown — cannot compare to Unified Memory"
              : "GPU stats unavailable (e.g. nvidia-smi not detected)"
          }
        >
          <span className="truncate" title={sizeLine}>
            {sizeLine}
          </span>
        </span>
        <p className="min-w-0 flex-1 text-sm leading-tight text-zinc-500">
          {hint}
        </p>
      </div>
    );
  }

  const sub =
    tier === "gpu_ok"
      ? isMac
        ? "Fits in unified memory"
        : "Full GPU offload possible"
      : isMac
        ? "Exceeds unified memory"
        : "CPU offload required";

  // On Mac, any exceedance is red — unified memory is a hard limit with no VRAM fallback.
  // On Windows/Linux, cpu_mild is amber (partial offload is workable with a dedicated GPU).
  const subClass =
    tier === "gpu_ok"
      ? theme === "light"
        ? "text-emerald-600"
        : "text-emerald-400/95"
      : tier === "cpu_mild" && !isMac
        ? theme === "light"
          ? "text-amber-600"
          : "text-amber-400/95"
        : theme === "light"
          ? "text-rose-600"
          : "text-rose-400/95";

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <span className={cn(hfFileRowSizeText, subClass)} title={titleBase}>
        <span className="truncate" title={sizeLine}>
          {sizeLine}
        </span>
      </span>
      <p className={cn("min-w-0 flex-1 text-sm leading-tight", subClass)}>
        {sub}
      </p>
    </div>
  );
}

export function HuggingFacePage(): JSX.Element {
  const { settings, fetch: fetchSettings } = useSettingsStore();
  const { theme } = useThemeStore();
  const downloads = useHfDownloadStore((s) => s.downloads);
  const reportDownloadError = useHfDownloadStore((s) => s.reportDownloadError);
  const registerPendingDownload = useHfDownloadStore(
    (s) => s.registerPendingDownload,
  );
  const dismissDownload = useHfDownloadStore((s) => s.dismiss);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState(() =>
    readLibraryTab() === "vllm" ? "" : "gguf",
  );
  const [models, setModels] = useState<HfModelSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listNextCursorUrl, setListNextCursorUrl] = useState<string | null>(
    null,
  );
  const [listError, setListError] = useState<string | null>(null);
  const [listSort, setListSort] = useState<HfModelListSort>("trending");
  const [hfLibrary, setHfLibrary] = useState<HfModelLibrary>(readLibraryTab());

  const sidebarListRef = useRef<HTMLDivElement>(null);
  const activeSearchQueryRef = useRef(debounced);
  const activeListSortRef = useRef<HfModelListSort>(listSort);
  const activeHfLibraryRef = useRef(hfLibrary);
  const loadMoreInFlightRef = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<HfRepoGgufFile[]>([]);
  const [vllmModels, setVllmModels] = useState<HfRepoVllmModel[]>([]);
  const [repoAllFiles, setRepoAllFiles] = useState<HfRepoFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [readmeMd, setReadmeMd] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);

  const [sysStats, setSysStats] = useState<SystemStats | null>(null);

  const [downloadDirPick, setDownloadDirPick] = useState<{
    repoId: string;
    file: HfRepoGgufFile;
    dirs: string[];
    selected: string;
  } | null>(null);

  const [vllmDownloadDirPick, setVllmDownloadDirPick] = useState<{
    repoId: string;
    dirs: string[];
    selected: string;
  } | null>(null);

   const [overwritePrompt, setOverwritePrompt] = useState<{
    repoId: string;
    file: HfRepoGgufFile;
    modelsDir: string;
  } | null>(null);

  const [mmprojPrompt, setMmprojPrompt] = useState<{
    repoId: string;
    mainFile?: HfRepoGgufFile;
    mmprojFiles: HfRepoGgufFile[];
    modelsDir: string | undefined;
    selectedMmprojKey: string | null;
    /** True when triggered from "Install Vision" on an already-downloaded weight file. */
    installMmprojOnly?: boolean;
  } | null>(null);

  const [localGgufStatus, setLocalGgufStatus] =
    useState<HfLocalGgufStatusBatchResult>({});
  const [localVllmStatus, setLocalVllmStatus] =
    useState<HfLocalGgufStatusBatchResult>({});
  const [localStatusRefresh, setLocalStatusRefresh] = useState(0);
  const seenCompleteRef = useRef<Set<string>>(new Set());

  const modelRoots = useMemo(
    () => uniqueModelDirs(settings?.modelsDirs ?? []),
    [settings?.modelsDirs],
  );

  const vllmRoots = useMemo(
    () => uniqueModelDirs(settings?.vllmModelDirs ?? []),
    [settings?.vllmModelDirs],
  );

  const ggufFileListScrollClass = useMemo(
    () =>
      cn(
        hfGgufFileListScrollBase,
        theme === "light"
          ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
          : "border border-zinc-800/80 bg-zinc-900/40 ring-1 ring-white/[0.04]",
      ),
    [theme],
  );

  const gpuMemTotalMb = useMemo(() => {
    if (!sysStats?.gpu) return 0;
    return sysStats.gpu.reduce((acc, g) => acc + g.memTotalMb, 0);
  }, [sysStats?.gpu]);

  const ramTotalMb = sysStats?.ram?.totalMb;
  const filesForGguf = hfLibrary === "llama" ? files : [];
  const ggufDisplay = useMemo(
    () =>
      buildGgufDisplayList(
        filesForGguf,
        sysStats?.gpu ?? null,
        sysStats?.platform,
        sysStats?.ram,
      ),
    [filesForGguf, gpuMemTotalMb, ramTotalMb, sysStats?.platform],
  );

  const vllmIsDownloading = useMemo(() => {
    return Object.values(downloads).some(
      (d) => d.phase === "downloading" && d.repoId === selectedId && d.vllmTarget === true,
    );
  }, [downloads, selectedId]);

  const vllmIsDownloaded = useMemo(() => {
    if (hfLibrary !== "vllm" || vllmModels.length === 0 || vllmRoots.length === 0) {
      return false;
    }
    const firstModel = vllmModels[0]!;
    const mKey = (firstModel.safetensorPaths ?? []).join("|");
    const status = localVllmStatus[mKey];
    return anyRootHasBundle(status);
  }, [hfLibrary, vllmModels, vllmRoots, localVllmStatus]);

  const downloadingFileKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of Object.values(downloads)) {
      if (d.phase === "downloading" && d.repoId === selectedId) {
        // Multi-file bundle: the file at currentFileIndex is actively downloading.
        if (d.fileKeys.length > 1 && d.currentFileIndex != null && d.currentFileIndex < d.fileKeys.length) {
          keys.add(d.fileKeys[d.currentFileIndex]!);
        } else if (d.fileKey) {
          // Single-file download or fallback.
          keys.add(d.fileKey);
        }
      }
    }
    return keys;
  }, [downloads, selectedId]);

  /** File keys waiting in a bundle download (e.g. mmproj queued while weight downloads). */
  const queuedFileKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of Object.values(downloads)) {
      if (d.phase === "downloading" && d.repoId === selectedId && d.fileKeys.length > 1) {
        const ci = d.currentFileIndex ?? 0;
        for (let i = ci + 1; i < d.fileKeys.length; i++) {
          keys.add(d.fileKeys[i]!);
        }
      }
    }
    return keys;
  }, [downloads, selectedId]);

  const completedFileKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of Object.values(downloads)) {
      if (d.phase === "complete" && d.repoId === selectedId && d.fileKey) {
        keys.add(d.fileKey);
      }
    }
    return keys;
  }, [downloads, selectedId]);

  /** True if an mmproj exists in a related sibling folder for this repo.
 * Uses base-name prefix matching — e.g. gemma-4-E2B-it-Q4_K_M and gemma-4-E2B-it-UD-IQ2_M
 * both find the mmproj in gemma-4-E2B-it/, but NOT in Qwen3.6-27B/. */
  const [hasRelatedMmproj, setHasRelatedMmproj] = useState(false);

  useEffect(() => {
    if (
      hfLibrary !== "llama" ||
      !selectedId ||
      ggufDisplay.mmprojCount === 0 ||
      modelRoots.length === 0
    ) {
      setHasRelatedMmproj(false);
      return;
    }
    // Reset immediately so a stale `true` from the previous repo never suppresses the
    // prompt for the new one while the async filesystem check is in flight.
    setHasRelatedMmproj(false);
    let cancelled = false;
    void api.hf
      .relatedMmprojExists({ repoId: selectedId, modelRoots })
      .then((res) => {
        if (!cancelled) setHasRelatedMmproj(res);
      })
      .catch(() => {
        if (!cancelled) setHasRelatedMmproj(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hfLibrary, selectedId, ggufDisplay.mmprojCount, modelRoots, localStatusRefresh]);

  const ggufListScrollRef = useRef<HTMLDivElement>(null);

  /** Start scrolled so the weight VRAM band (~4 rows) is in view; mmproj stays above — scroll up for it. */
  useLayoutEffect(() => {
    if (filesLoading || !selectedId || hfLibrary !== "llama") return;
    const box = ggufListScrollRef.current;
    if (!box || ggufDisplay.rows.length === 0) return;

    if (
      ggufDisplay.initialScroll === "scroll_anchor" &&
      ggufDisplay.vramBandFirstRowIndex != null
    ) {
      const target = box.querySelector(
        `[data-hf-gguf-row="${String(ggufDisplay.vramBandFirstRowIndex)}"]`,
      );
      if (target instanceof HTMLElement) {
        const boxRect = box.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        box.scrollTop += tRect.top - boxRect.top;
      }
      return;
    }
    if (ggufDisplay.initialScroll === "bottom_weights") {
      box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
      return;
    }
    box.scrollTop = 0;
  }, [
    selectedId,
    filesLoading,
    hfLibrary,
    ggufDisplay.initialScroll,
    ggufDisplay.vramBandFirstRowIndex,
    ggufDisplay.rows.length,
  ]);

  /** Keeps the chosen models dir in sync for the folder picker (avoids stale closure on Confirm). */
  const hfDownloadModelsDirRef = useRef<string | null>(null);
  const hfVllmDownloadModelsDirRef = useRef<string | null>(null);
  const mmprojSelectedRef = useRef<HfRepoGgufFile | null>(null);

  useEffect(() => {
    if (downloadDirPick) {
      hfDownloadModelsDirRef.current = downloadDirPick.selected;
    }
  }, [downloadDirPick]);

  useEffect(() => {
    if (vllmDownloadDirPick) {
      hfVllmDownloadModelsDirRef.current = vllmDownloadDirPick.selected;
    }
  }, [vllmDownloadDirPick]);

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const s = await api.system.getStats();
        if (!cancelled) setSysStats(s);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(
      () => setDebounced(query.trim() || (hfLibrary === "vllm" ? "" : "gguf")),
      350,
    );
    return () => window.clearTimeout(t);
  }, [query, hfLibrary]);

  useEffect(() => {
    activeSearchQueryRef.current = debounced;
  }, [debounced]);

  useEffect(() => {
    activeListSortRef.current = listSort;
  }, [listSort]);

  useEffect(() => {
    activeHfLibraryRef.current = hfLibrary;
  }, [hfLibrary]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    setListNextCursorUrl(null);
    setSelectedId(null);
    api.hf
      .searchModels(debounced, HF_SIDEBAR_PAGE_SIZE, null, listSort, hfLibrary)
      .then((page) => {
        if (!cancelled) {
          prefetchPublisherAvatars(page.models.map((m) => publisherFromRepoId(m.id)));
          setModels(page.models);
          setListNextCursorUrl(page.nextCursorUrl);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setListError(e instanceof Error ? e.message : String(e));
          setModels([]);
          setListNextCursorUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, listSort, hfLibrary]);

  const loadMoreModels = useCallback(async () => {
    const cursor = listNextCursorUrl;
    if (!cursor || loadMoreInFlightRef.current || listLoading) {
      return;
    }
    const q = activeSearchQueryRef.current;
    const sort = activeListSortRef.current;
    const libAtStart = activeHfLibraryRef.current;
    loadMoreInFlightRef.current = true;
    setListLoadingMore(true);
    try {
      const page = await api.hf.searchModels(
        q,
        HF_SIDEBAR_PAGE_SIZE,
        cursor,
        sort,
        libAtStart,
      );
      if (
        q !== activeSearchQueryRef.current ||
        sort !== activeListSortRef.current ||
        activeHfLibraryRef.current !== libAtStart
      ) {
        return;
      }
      prefetchPublisherAvatars(page.models.map((m) => publisherFromRepoId(m.id)));
      setModels((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const next = [...prev];
        for (const m of page.models) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            next.push(m);
          }
        }
        return next;
      });
      setListNextCursorUrl(page.nextCursorUrl);
    } catch {
      if (
        q === activeSearchQueryRef.current &&
        sort === activeListSortRef.current &&
        activeHfLibraryRef.current === libAtStart
      ) {
        setListNextCursorUrl(null);
      }
    } finally {
      loadMoreInFlightRef.current = false;
      setListLoadingMore(false);
    }
  }, [listNextCursorUrl, listLoading, listSort]);

  const onSidebarListScroll = useCallback(() => {
    const el = sidebarListRef.current;
    if (!el || !listNextCursorUrl || listLoading || listLoadingMore) {
      return;
    }
    const thresholdPx = 120;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx) {
      void loadMoreModels();
    }
  }, [listNextCursorUrl, listLoading, listLoadingMore, loadMoreModels]);

  /** If the list is still short (viewport not filled) or user remains at bottom, fetch again. */
  useEffect(() => {
    if (
      listLoading ||
      listLoadingMore ||
      !listNextCursorUrl ||
      models.length === 0
    ) {
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = sidebarListRef.current;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      if (nearBottom) {
        void loadMoreModels();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [
    models.length,
    listLoading,
    listLoadingMore,
    listNextCursorUrl,
    listSort,
    loadMoreModels,
  ]);

  useEffect(() => {
    if (!selectedId) {
      setFiles([]);
      setVllmModels([]);
      setRepoAllFiles([]);
      setFilesError(null);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);
    if (hfLibrary === "vllm") {
      setFiles([]);
      void api.hf
        .listVllmModels(selectedId)
        .then((result: HfVllmModelsResult) => {
          if (!cancelled) {
            setVllmModels(result.models);
            setRepoAllFiles(result.allFiles);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setFilesError(e instanceof Error ? e.message : String(e));
            setVllmModels([]);
            setRepoAllFiles([]);
          }
        })
        .finally(() => {
          if (!cancelled) setFilesLoading(false);
        });
    } else {
      setVllmModels([]);
      setFiles([]);
      void api.hf
        .listGgufFiles(selectedId)
        .then((f) => {
          if (!cancelled) setFiles(f);
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setFilesError(e instanceof Error ? e.message : String(e));
            setFiles([]);
          }
        })
        .finally(() => {
          if (!cancelled) setFilesLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedId, hfLibrary]);

  useEffect(() => {
    const newlyComplete = Object.values(downloads).filter(
      (d) =>
        d.phase === "complete" && !seenCompleteRef.current.has(d.downloadId),
    );
    if (newlyComplete.length > 0) {
      newlyComplete.forEach((d) => seenCompleteRef.current.add(d.downloadId));
      // Defer presence refresh so files are flushed to disk before re-checking.
      setTimeout(() => setLocalStatusRefresh((n) => n + 1), 300);
      // Background scan so newly-downloaded models (including mmproj)
      // are reflected in the model library without manual scanning.
      if (hfLibrary === "llama") {
        useModelsStore.getState().scanModels();
      }
    }
  }, [downloads, hfLibrary]);

  useEffect(() => {
    const picks = ggufDisplay.rows;
    if (
      hfLibrary !== "llama" ||
      !selectedId ||
      picks.length === 0 ||
      modelRoots.length === 0
    ) {
      setLocalGgufStatus({});
      return;
    }
    let cancelled = false;
    const items = picks.map((f) => ({
      key: hfFileKey(f),
      filenames: hubFilenamesForFile(f),
    }));
    void api.hf
      .localGgufStatusBatch({
        repoId: selectedId,
        items,
        roots: modelRoots,
      })
      .then((res) => {
        if (!cancelled) setLocalGgufStatus(res);
      })
      .catch(() => {
        if (!cancelled) setLocalGgufStatus({});
      });
    return () => {
      cancelled = true;
    };
  }, [hfLibrary, selectedId, ggufDisplay.rows, modelRoots, localStatusRefresh]);

  // Check local presence of vLLM model bundles
  useEffect(() => {
    if (
      hfLibrary !== "vllm" ||
      !selectedId ||
      vllmModels.length === 0 ||
      vllmRoots.length === 0
    ) {
      setLocalVllmStatus({});
      return;
    }
    let cancelled = false;
    const items = vllmModels.map((m) => ({
      key: (m.safetensorPaths ?? []).join("|"),
      filenames: [...(m.safetensorPaths ?? [])],
    }));
    void api.hf
      .localGgufStatusBatch({
        repoId: selectedId,
        items,
        roots: vllmRoots,
      })
      .then((res) => {
        if (!cancelled) setLocalVllmStatus(res);
      })
      .catch(() => {
        if (!cancelled) setLocalVllmStatus({});
      });
    return () => {
      cancelled = true;
    };
  }, [hfLibrary, selectedId, vllmModels, vllmRoots, localStatusRefresh]);


  useEffect(() => {
    if (!selectedId) {
      setReadmeMd(null);
      setReadmeError(null);
      setReadmeLoading(false);
      return;
    }
    let cancelled = false;
    setReadmeLoading(true);
    setReadmeError(null);
    setReadmeMd(null);
    void api.hf
      .getRepoReadme(selectedId)
      .then((r) => {
        if (cancelled) return;
        setReadmeMd(r.markdown);
        setReadmeError(r.error);
      })
      .finally(() => {
        if (!cancelled) setReadmeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const startDownload = useCallback(
    async (repoId: string, f: HfRepoGgufFile, modelsDir?: string, mmprojFile?: HfRepoGgufFile) => {
      const id = uuidv4();
      const fk = hfFileKey(f);
      const hubPaths = hubFilenamesForFile(f);
      const mmprojPaths = mmprojFile ? hubFilenamesForFile(mmprojFile) : [];
      // Always put weight files first — presence check and folder derivation depend on order.
      const allPaths: string[] = [...hubPaths, ...mmprojPaths];
      const mainSizes =
        f.shardSizes &&
        f.shardSizes.length === hubPaths.length &&
        f.shardSizes.length > 0
          ? f.shardSizes
          : undefined;
      const mmprojSizes =
        mmprojFile?.shardSizes &&
        mmprojFile.shardSizes.length === mmprojPaths.length &&
        mmprojPaths.length > 0
          ? mmprojFile.shardSizes
          : undefined;
      const fileSizes =
        mainSizes && (mmprojPaths.length === 0 || mmprojSizes)
          ? [...mainSizes, ...(mmprojSizes ?? [])]
          : undefined;

      const bundleKeys = mmprojFile ? [fk, hfFileKey(mmprojFile)] : [fk];
      registerPendingDownload(id, fk, repoId, undefined, undefined, undefined, undefined, bundleKeys);

      try {
        const payload: {
          downloadId: string;
          repoId: string;
          filenames: string[];
          fileSizes?: number[];
          modelsDir?: string;
        } = {
          downloadId: id,
          repoId,
          filenames: allPaths,
          fileSizes,
        };
        if (modelsDir != null && modelsDir !== "") {
          payload.modelsDir = modelsDir;
        }
        const result = await api.hf.download(payload);
        if (!result.ok && !result.aborted) {
          const entry = useHfDownloadStore.getState().downloads[id];
          if (entry?.phase !== "error") {
            if (!entry || entry.fileLabel === "") dismissDownload(id);
            reportDownloadError(result.error ?? "Download failed");
          }
        }
      } catch (e: unknown) {
        const entry = useHfDownloadStore.getState().downloads[id];
        if (!entry || entry.fileLabel === "") dismissDownload(id);
        reportDownloadError(e instanceof Error ? e.message : String(e));
      }
    },
    [registerPendingDownload, dismissDownload, reportDownloadError],
  );

  const startDownloadAllVllm = useCallback(
    async (repoId: string, modelsDir?: string) => {
      if (repoAllFiles.length === 0) return;
      if (vllmRoots.length === 0) {
        reportDownloadError(
          "Add at least one vLLM model directory in Settings.",
        );
        return;
      }
      const VLLM_EXTS = [".safetensors", ".json", ".model"];
      const allowed = repoAllFiles.filter((f) =>
        VLLM_EXTS.some((ext) => f.path.toLowerCase().endsWith(ext)),
      );
      if (allowed.length === 0) {
        reportDownloadError("No downloadable files found in this repository.");
        return;
      }
      const targetDir = modelsDir ?? vllmRoots[0];
      const id = uuidv4();
      const allFiles = allowed.map((f) => f.path);
      const allSizes = allowed.map((f) => f.size);
      registerPendingDownload(id, `${repoId}::all`, repoId, undefined, undefined, true);
      try {
        const result = await api.hf.download({
          downloadId: id,
          repoId,
          filenames: allFiles,
          fileSizes: allSizes,
          vllmTarget: true,
          modelsDir: targetDir,
        });
        if (!result.ok && !result.aborted) {
          const entry = useHfDownloadStore.getState().downloads[id];
          if (entry?.phase !== "error") {
            if (!entry || entry.fileLabel === "") dismissDownload(id);
            reportDownloadError(result.error ?? "Download failed");
          }
        }
      } catch (e: unknown) {
        const entry = useHfDownloadStore.getState().downloads[id];
        if (!entry || entry.fileLabel === "") dismissDownload(id);
        reportDownloadError(e instanceof Error ? e.message : String(e));
      }
    },
    [repoAllFiles, vllmRoots, registerPendingDownload, dismissDownload, reportDownloadError],
  );

  const requestDownloadAllVllm = useCallback(
    async (repoId: string) => {
      let s = settings;
      if (!s) {
        await fetchSettings();
        s = useSettingsStore.getState().settings;
      }
      const dirs = uniqueModelDirs(s?.vllmModelDirs ?? []);
      if (dirs.length > 1) {
        const initial = dirs[0]!;
        hfVllmDownloadModelsDirRef.current = initial;
        setVllmDownloadDirPick({ repoId, dirs, selected: initial });
        return;
      }
      void startDownloadAllVllm(repoId, dirs[0]);
    },
    [settings, fetchSettings, startDownloadAllVllm],
  );

  const requestDownload = useCallback(
    async (repoId: string, f: HfRepoGgufFile) => {
      let s = settings;
      if (!s) {
        await fetchSettings();
        s = useSettingsStore.getState().settings;
      }
      const dirs = uniqueModelDirs(s?.modelsDirs ?? []);
      if (dirs.length > 1) {
        const initial = dirs[0]!;
        hfDownloadModelsDirRef.current = initial;
        setDownloadDirPick({
          repoId,
          file: f,
          dirs,
          selected: initial,
        });
        return;
      }
      const only = dirs[0];
      const key = hfFileKey(f);
      if (only && presentForDir(localGgufStatus[key], only)) {
        setOverwritePrompt({ repoId, file: f, modelsDir: only });
        return;
      }
      const mmprojFiles = files.filter((mf) => mf.isMmproj);
      if (!f.isMmproj && mmprojFiles.length > 0 && !hasRelatedMmproj) {
        const firstKey = mmprojFiles[0] ? hfFileKey(mmprojFiles[0]) : null;
        mmprojSelectedRef.current = mmprojFiles[0] ?? null;
        setMmprojPrompt({
          repoId,
          mainFile: f,
          mmprojFiles,
          modelsDir: only,
          selectedMmprojKey: firstKey,
        });
        return;
      }
      void startDownload(repoId, f, only);
    },
    [settings, fetchSettings, startDownload, localGgufStatus, files, hasRelatedMmproj],
  );

  return (
    <div className="flex h-full min-h-0 gap-3 p-3 font-sans">
      {downloadDirPick &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setDownloadDirPick(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="hf-download-dir-title"
              className={cn(
                "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl",
                theme === "light"
                  ? "border border-zinc-700/40 bg-zinc-950/95 ring-1 ring-zinc-700/25"
                  : "bg-zinc-900 ring-1 ring-white/[0.08]",
              )}
            >
              <header
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b px-4 py-3",
                  theme === "light"
                    ? "border-zinc-800/30"
                    : "border-white/[0.06]",
                )}
              >
                <FolderOpen
                  className="h-4 w-4 shrink-0 text-cyan-500/90"
                  aria-hidden
                />
                <h2
                  id="hf-download-dir-title"
                  className="text-[15px] font-semibold tracking-tight text-zinc-100"
                >
                  Download to folder
                </h2>
              </header>
              <p className="px-4 pt-3 text-sm text-zinc-400">
                Choose which models directory to save this file under (from
                Settings → Paths).
              </p>
              <div className="max-h-[min(240px,40vh)] min-h-0 overflow-y-auto px-4 py-3">
                <ul className="flex flex-col gap-1.5">
                  {downloadDirPick.dirs.map((d, i) => {
                    const fieldId = `hf-dl-dir-${i}`;
                    const isOn = downloadDirPick.selected === d;
                    const pickKey = hfFileKey(downloadDirPick.file);
                    const onDisk = presentForDir(localGgufStatus[pickKey], d);
                    return (
                      <li key={d}>
                        <label
                          htmlFor={fieldId}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-500/25",
                            isOn
                              ? "border-cyan-500/40 bg-cyan-500/10"
                              : theme === "light"
                                ? "border border-zinc-700/20 bg-zinc-800/40 hover:border-zinc-600/45"
                                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600",
                          )}
                        >
                          <input
                            id={fieldId}
                            type="radio"
                            name="hf-download-models-dir"
                            className="sr-only"
                            checked={isOn}
                            onChange={() => {
                              hfDownloadModelsDirRef.current = d;
                              setDownloadDirPick((p) =>
                                p ? { ...p, selected: d } : p,
                              );
                            }}
                          />
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-[border-color,background-color,box-shadow]",
                              isOn
                                ? "border-cyan-400/90 bg-cyan-500/15 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]"
                                : "border-zinc-600 bg-zinc-950/80",
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full bg-cyan-400 transition-[transform,opacity]",
                                isOn
                                  ? "scale-100 opacity-100"
                                  : "scale-0 opacity-0",
                              )}
                            />
                          </span>
                          <span className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-200">
                            {d}
                            {onDisk ? (
                              <span
                                className={cn(
                                  "ml-2 inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  theme === "light"
                                    ? "border-emerald-600/40 bg-emerald-100 text-emerald-800"
                                    : "border-emerald-500/35 bg-emerald-500/10 text-emerald-400/95",
                                )}
                              >
                                On disk
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <footer
                className={cn(
                  "flex shrink-0 justify-end gap-2 border-t px-4 py-3",
                  theme === "light"
                    ? "border-zinc-800/30"
                    : "border-white/[0.06]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setDownloadDirPick(null)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-0",
                    theme === "light"
                      ? "text-black hover:bg-zinc-800/35"
                      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = downloadDirPick;
                    const dir =
                      hfDownloadModelsDirRef.current ??
                      p?.selected ??
                      undefined;
                    setDownloadDirPick(null);
                    if (!p || dir == null || dir === "") {
                      return;
                    }
                    const key = hfFileKey(p.file);
                    if (presentForDir(localGgufStatus[key], dir)) {
                      setOverwritePrompt({
                        repoId: p.repoId,
                        file: p.file,
                        modelsDir: dir,
                      });
                      return;
                    }
                    const mmprojFiles = files.filter((mf) => mf.isMmproj);
                    if (!p.file.isMmproj && mmprojFiles.length > 0 && !hasRelatedMmproj) {
                      const firstKey = mmprojFiles[0] ? hfFileKey(mmprojFiles[0]) : null;
                      mmprojSelectedRef.current = mmprojFiles[0] ?? null;
                      setMmprojPrompt({
                        repoId: p.repoId,
                        mainFile: p.file,
                        mmprojFiles,
                        modelsDir: dir,
                        selectedMmprojKey: firstKey,
                      });
                      return;
                    }
                    void startDownload(p.repoId, p.file, dir);
                  }}
                  className={cn(
                    hfDownloadButtonLayout,
                    theme === "light"
                      ? cn(
                          hfDownloadButtonIdleLight,
                          hfDownloadButtonHoverLight,
                        )
                      : cn(hfDownloadButtonIdleDark, hfDownloadButtonHoverDark),
                  )}
                >
                  <Download
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      theme === "light"
                        ? "text-black opacity-100 group-hover:text-cyan-900"
                        : "opacity-80 group-hover:opacity-100",
                    )}
                    aria-hidden
                  />
                  Download
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {overwritePrompt &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setOverwritePrompt(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="hf-overwrite-title"
              className={cn(
                "relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl",
                theme === "light"
                  ? "border border-zinc-700/40 bg-zinc-950/95 ring-1 ring-zinc-700/25"
                  : "bg-zinc-900 ring-1 ring-white/[0.08]",
              )}
            >
              <header className="flex shrink-0 items-center gap-2 px-4 py-3">
                <Download
                  className="h-4 w-4 shrink-0 text-amber-400/90"
                  aria-hidden
                />
                <h2
                  id="hf-overwrite-title"
                  className="text-[15px] font-semibold tracking-tight text-zinc-100"
                >
                  Already downloaded
                </h2>
              </header>
              <p className="px-4 pt-3 text-sm leading-relaxed text-zinc-400">
                This file is already in the folder you selected. Download again
                to overwrite the existing files?
              </p>
              <footer className="flex shrink-0 justify-end gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOverwritePrompt(null)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-0",
                    theme === "light"
                      ? "text-black hover:bg-zinc-800/35"
                      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = overwritePrompt;
                    setOverwritePrompt(null);
                    if (p) {
                      void startDownload(p.repoId, p.file, p.modelsDir);
                    }
                  }}
                  className={cn(
                    hfDownloadButtonLayout,
                    theme === "light"
                      ? cn(
                          hfDownloadButtonIdleLight,
                          hfDownloadButtonHoverLight,
                        )
                      : cn(hfDownloadButtonIdleDark, hfDownloadButtonHoverDark),
                  )}
                >
                  <Download
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      theme === "light"
                        ? "text-black opacity-100 group-hover:text-cyan-900"
                        : "opacity-80 group-hover:opacity-100",
                    )}
                    aria-hidden
                  />
                  Download anyway
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {mmprojPrompt &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setMmprojPrompt(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="hf-mmproj-title"
              className={cn(
                "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/40",
                theme === "light"
                  ? "border border-zinc-700/40 bg-zinc-950/95 ring-1 ring-zinc-700/25"
                  : "bg-zinc-900 ring-1 ring-white/[0.08]",
              )}
            >
              <header
                className={cn(
                  "flex shrink-0 items-center gap-3 border-b px-4 py-3",
                  theme === "light" ? "border-zinc-800/30" : "border-white/[0.06]",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-500/35 bg-violet-500/10 text-violet-300/90">
                  <Image className="h-4 w-4" aria-hidden />
                </span>
                <h2
                  id="hf-mmproj-title"
                  className="text-[15px] font-semibold tracking-tight text-zinc-100"
                >
                  {mmprojPrompt.installMmprojOnly
                    ? "Adding vision support"
                    : "Vision support available"}
                </h2>
              </header>
              <div className="px-4 pt-3 pb-1">
                <p className="text-sm leading-relaxed text-zinc-400">
                  {mmprojPrompt.installMmprojOnly
                    ? "Download a multimodal projector (mmproj) to add image input to this model."
                    : "This model includes a multimodal projector (mmproj) for image input. Select one to download alongside the model, or skip if you don't need vision."}
                </p>
              </div>
              <div className="max-h-[min(240px,40vh)] min-h-0 overflow-y-auto px-4 py-3">
                <ul className="flex flex-col gap-1.5">
                  {mmprojPrompt.mmprojFiles.map((mf, i) => {
                    const mk = hfFileKey(mf);
                    const isOn = mmprojPrompt.selectedMmprojKey === mk;
                    return (
                      <li key={mk}>
                        <label
                          htmlFor={`hf-mmproj-${i}`}
                          onClick={(e) => {
                            if (isOn) {
                              e.preventDefault();
                              mmprojSelectedRef.current = null;
                              setMmprojPrompt((p) =>
                                p ? { ...p, selectedMmprojKey: null } : p,
                              );
                            }
                          }}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-violet-500/25",
                            isOn
                              ? "border-violet-500/40 bg-violet-500/[0.08]"
                              : theme === "light"
                                ? "border border-zinc-700/20 bg-zinc-800/40 hover:border-zinc-600/45"
                                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600",
                          )}
                        >
                          <input
                            id={`hf-mmproj-${i}`}
                            type="radio"
                            name="hf-mmproj-file"
                            className="sr-only"
                            checked={isOn}
                            onChange={() => {
                              mmprojSelectedRef.current = mf;
                              setMmprojPrompt((p) =>
                                p ? { ...p, selectedMmprojKey: mk } : p,
                              );
                            }}
                          />
                          <span
                            aria-hidden
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-[border-color,background-color,box-shadow]",
                              isOn
                                ? "border-violet-400/90 bg-violet-500/15 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.25)]"
                                : "border-zinc-600 bg-zinc-950/80",
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full bg-violet-400 transition-[transform,opacity]",
                                isOn ? "scale-100 opacity-100" : "scale-0 opacity-0",
                              )}
                            />
                          </span>
                          <span className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-200">
                            {mf.path}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                            {formatBytes(mf.size)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <footer
                className={cn(
                  "flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3",
                  theme === "light" ? "border-zinc-800/30" : "border-white/[0.06]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setMmprojPrompt(null)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-0",
                    theme === "light"
                      ? "text-black hover:bg-zinc-800/35"
                      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200",
                  )}
                >
                  Cancel
                </button>
                <div className="flex items-center gap-2">
                  {!mmprojPrompt.installMmprojOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const p = mmprojPrompt;
                        setMmprojPrompt(null);
                        if (!p || !p.mainFile) return;
                        void startDownload(p.repoId, p.mainFile, p.modelsDir);
                      }}
                      className={cn(
                        hfDownloadButtonLayout,
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25",
                        theme === "light"
                          ? "border-zinc-400/55 bg-transparent text-black hover:border-zinc-500/70 hover:bg-black/[0.07]"
                          : "border-zinc-700/60 bg-transparent text-zinc-300 hover:border-zinc-500/60 hover:bg-white/[0.06] hover:text-zinc-100",
                      )}
                    >
                      Skip – text only input
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={mmprojPrompt.selectedMmprojKey === null}
                    onClick={() => {
                      const p = mmprojPrompt;
                      const selected =
                        mmprojSelectedRef.current ??
                        p?.mmprojFiles.find(
                          (mf) => hfFileKey(mf) === p.selectedMmprojKey,
                        );
                      setMmprojPrompt(null);
                      if (!p || !selected) return;
                      if (p.installMmprojOnly) {
                        void startDownload(p.repoId, selected, p.modelsDir);
                      } else if (p.mainFile) {
                        void startDownload(p.repoId, p.mainFile, p.modelsDir, selected);
                      }
                    }}
                    className={cn(
                      hfDownloadButtonLayout,
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/25",
                      theme === "light"
                        ? "border-violet-600/50 bg-violet-100 text-violet-800 hover:border-violet-600/70 hover:bg-violet-200 hover:text-violet-900"
                        : "border-violet-500/30 bg-violet-500/[0.08] text-violet-200 hover:border-violet-400/50 hover:bg-violet-500/[0.15] hover:text-violet-100",
                    )}
                  >
                    <Image
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        theme === "light" ? "opacity-90" : "opacity-80 group-hover:opacity-100",
                      )}
                      aria-hidden
                    />
                    {mmprojPrompt.installMmprojOnly
                      ? "Install vision"
                      : "Download with vision"}
                  </button>
                </div>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {vllmDownloadDirPick &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setVllmDownloadDirPick(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="hf-vllm-download-dir-title"
              className={cn(
                "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl",
                theme === "light"
                  ? "border border-zinc-700/40 bg-zinc-950/95 ring-1 ring-zinc-700/25"
                  : "bg-zinc-900 ring-1 ring-white/[0.08]",
              )}
            >
              <header
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b px-4 py-3",
                  theme === "light" ? "border-zinc-800/30" : "border-white/[0.06]",
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-cyan-500/90" aria-hidden />
                <h2
                  id="hf-vllm-download-dir-title"
                  className="text-[15px] font-semibold tracking-tight text-zinc-100"
                >
                  Download to folder
                </h2>
              </header>
              <p className="px-4 pt-3 text-sm text-zinc-400">
                Choose which vLLM model directory to save this model under (from
                Settings → Paths).
              </p>
              <div className="max-h-[min(240px,40vh)] min-h-0 overflow-y-auto px-4 py-3">
                <ul className="flex flex-col gap-1.5">
                  {vllmDownloadDirPick.dirs.map((d, i) => {
                    const fieldId = `hf-vllm-dl-dir-${i}`;
                    const isOn = vllmDownloadDirPick.selected === d;
                    const mKey = (vllmModels[0]?.safetensorPaths ?? []).join("|");
                    const onDisk = presentForDir(localVllmStatus[mKey], d);
                    return (
                      <li key={d}>
                        <label
                          htmlFor={fieldId}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-500/25",
                            isOn
                              ? "border-cyan-500/40 bg-cyan-500/10"
                              : theme === "light"
                                ? "border border-zinc-700/20 bg-zinc-800/40 hover:border-zinc-600/45"
                                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600",
                          )}
                        >
                          <input
                            id={fieldId}
                            type="radio"
                            name="hf-vllm-download-models-dir"
                            className="sr-only"
                            checked={isOn}
                            onChange={() => {
                              hfVllmDownloadModelsDirRef.current = d;
                              setVllmDownloadDirPick((p) =>
                                p ? { ...p, selected: d } : p,
                              );
                            }}
                          />
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-[border-color,background-color,box-shadow]",
                              isOn
                                ? "border-cyan-400/90 bg-cyan-500/15 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]"
                                : "border-zinc-600 bg-zinc-950/80",
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full bg-cyan-400 transition-[transform,opacity]",
                                isOn ? "scale-100 opacity-100" : "scale-0 opacity-0",
                              )}
                            />
                          </span>
                          <span className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-200">
                            {d}
                            {onDisk ? (
                              <span
                                className={cn(
                                  "ml-2 inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  theme === "light"
                                    ? "border-emerald-600/40 bg-emerald-100 text-emerald-800"
                                    : "border-emerald-500/35 bg-emerald-500/10 text-emerald-400/95",
                                )}
                              >
                                On disk
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <footer
                className={cn(
                  "flex shrink-0 justify-end gap-2 border-t px-4 py-3",
                  theme === "light" ? "border-zinc-800/30" : "border-white/[0.06]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setVllmDownloadDirPick(null)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-0",
                    theme === "light"
                      ? "text-black hover:bg-zinc-800/35"
                      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = vllmDownloadDirPick;
                    const dir =
                      hfVllmDownloadModelsDirRef.current ?? p?.selected ?? undefined;
                    setVllmDownloadDirPick(null);
                    if (!p || dir == null || dir === "") return;
                    void startDownloadAllVllm(p.repoId, dir);
                  }}
                  className={cn(
                    hfDownloadButtonLayout,
                    theme === "light"
                      ? cn(hfDownloadButtonIdleLight, hfDownloadButtonHoverLight)
                      : cn(hfDownloadButtonIdleDark, hfDownloadButtonHoverDark),
                  )}
                >
                  <Download
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      theme === "light"
                        ? "text-black opacity-100 group-hover:text-cyan-900"
                        : "opacity-80 group-hover:opacity-100",
                    )}
                    aria-hidden
                  />
                  Download
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      <div
        className={cn(
          "w-80 shrink-0 flex flex-col min-h-0 rounded-2xl",
          theme === "light"
            ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
            : "bg-zinc-900/35 ring-1 ring-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        )}
      >
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                hfLibrary === "vllm"
                  ? "Search safetensor models…"
                  : "Search GGUF models…"
              }
              className="w-full pl-7 pr-2 py-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
            />
          </div>
          <div
            className={cn(
              "flex gap-0.5 rounded-lg border p-0.5 mt-2",
              theme === "light"
                ? "border-zinc-700/35 bg-zinc-900/40"
                : "border border-zinc-700 bg-zinc-900/50",
            )}
            role="group"
            aria-label="Hub library"
          >
            <button
              type="button"
              aria-pressed={hfLibrary === "llama"}
              onClick={() => {
                setHfLibrary("llama");
                writeLibraryTab("llama");
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                hfLibrary === "llama"
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
                aria-pressed={hfLibrary === "vllm"}
                onClick={() => {
                  setHfLibrary("vllm");
                  writeLibraryTab("vllm");
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                  hfLibrary === "vllm"
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
          <div
            className={cn(
              "mt-2 flex gap-0.5 rounded-lg border p-0.5",
              theme === "light"
                ? "border-zinc-700/35 bg-zinc-900/40"
                : "border border-zinc-700 bg-zinc-900/50",
            )}
            role="group"
            aria-label="Sort models"
          >
            <button
              type="button"
              aria-pressed={listSort === "trending"}
              onClick={() => setListSort("trending")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                listSort === "trending"
                  ? theme === "light"
                    ? "bg-zinc-800/50 text-zinc-100"
                    : "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              <Flame className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
              Trending
            </button>
            <button
              type="button"
              aria-pressed={listSort === "downloads"}
              onClick={() => setListSort("downloads")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                listSort === "downloads"
                  ? theme === "light"
                    ? "bg-zinc-800/50 text-zinc-100"
                    : "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              <Download
                className="h-3.5 w-3.5 shrink-0 opacity-90"
                aria-hidden
              />
              Downloads
            </button>
          </div>
        </div>

        <div
          ref={sidebarListRef}
          onScroll={onSidebarListScroll}
          className="flex-1 overflow-y-auto p-2 flex flex-col gap-1"
        >
          {listLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching…
            </div>
          )}
          {listError && (
            <div className="text-sm text-red-400/90 px-1 py-2">{listError}</div>
          )}
          {!listLoading &&
            !listError &&
            models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={cn(
                  "flex items-start gap-2.5 text-left rounded-lg px-2 py-2 text-sm border transition-colors",
                  selectedId === m.id
                    ? "bg-cyan-500/15 border-cyan-500/40 text-zinc-100"
                    : theme === "light"
                      ? "border border-zinc-700/20 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600/45 hover:bg-zinc-800/65"
                      : "bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:border-zinc-600",
                )}
              >
                <HfPublisherAvatar
                  publisher={publisherFromRepoId(m.id)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate" title={m.id}>
                    {m.id}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 tabular-nums">
                    {m.downloads != null && (
                      <span className="inline-flex items-center gap-1">
                        <Download
                          className="w-3.5 h-3.5 text-zinc-500 shrink-0"
                          aria-hidden
                        />
                        {m.downloads.toLocaleString()}
                      </span>
                    )}
                    {m.likes != null && (
                      <span className="inline-flex items-center gap-1">
                        <Heart
                          className="w-3.5 h-3.5 shrink-0 fill-red-500 text-red-500"
                          aria-hidden
                        />
                        {m.likes.toLocaleString()}
                      </span>
                    )}
                    {m.lastModified && (
                      <span className="inline-flex items-center gap-1">
                        <Clock
                          className="w-3 h-3 text-zinc-500 shrink-0"
                          aria-hidden
                        />
                        {formatRelativeDate(m.lastModified)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          {!listLoading && !listError && listLoadingMore && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-zinc-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              Loading more…
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden rounded-2xl",
          theme === "light"
            ? "border border-zinc-700/30 bg-zinc-950/40 shadow-none ring-1 ring-zinc-700/20"
            : "bg-zinc-900/20 ring-1 ring-white/[0.04]",
        )}
      >
        {!selectedId ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm px-6 text-center">
            {hfLibrary === "vllm"
              ? "Select a model to see safetensor and config files and download into your vLLM folders."
              : "Select a model to see GGUF files and download into your models folder."}
          </div>
        ) : (
          <>
            <div
              className={cn(
                "px-4 py-3.5 flex items-center justify-between gap-3 shrink-0 bg-gradient-to-b to-transparent",
                theme === "light" ? "from-zinc-950/50" : "from-zinc-900/40",
              )}
            >
              <div className="min-w-0 flex items-start gap-3">
                <HfPublisherAvatar
                  publisher={publisherFromRepoId(selectedId)}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-zinc-100 truncate">
                    {selectedId}
                  </h2>
                  <a
                    href={`https://huggingface.co/${selectedId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-cyan-500/90 hover:text-cyan-400 inline-flex items-center gap-1.5 mt-1"
                  >
                    Open on Hugging Face
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {filesLoading && (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading files…
                  </div>
                )}
                {filesError && (
                  <div className="text-sm text-red-400/90">{filesError}</div>
                )}
                {!filesLoading &&
                  !filesError &&
                  hfLibrary === "llama" &&
                  files.length === 0 && (
                    <div className="text-sm text-zinc-600">
                      No GGUF files found in this repo tree.
                    </div>
                  )}
                {!filesLoading &&
                  !filesError &&
                  hfLibrary === "vllm" &&
                  vllmModels.length === 0 && (
                    <div className="text-sm text-zinc-600">
                      No safetensor models found in this repo.
                    </div>
                  )}
                {hfLibrary === "vllm" &&
                  !filesLoading &&
                  !filesError &&
                  vllmModels.length > 0 && (
                    <section className="flex flex-col gap-3">
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-lg border px-3 py-2",
                          theme === "light"
                            ? "border-zinc-700/20 bg-zinc-800/40"
                            : "border-zinc-800 bg-zinc-900/30",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedId && !vllmIsDownloaded && !vllmIsDownloading) {
                              void requestDownloadAllVllm(selectedId);
                            }
                          }}
                          disabled={vllmIsDownloaded || vllmIsDownloading}
                          className={cn(
                            hfFileRowDownloadBtnBase,
                            vllmIsDownloading
                              ? theme === "light"
                                ? "animate-pulse border-cyan-400/40 bg-cyan-500/10 text-cyan-700 shadow-none focus-visible:ring-cyan-500/30"
                                : "animate-pulse border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-300 focus-visible:ring-cyan-500/25"
                              : vllmIsDownloaded
                                ? cn(
                                    theme === "light"
                                      ? hfFileRowDownloadedLookBaseLight
                                      : hfFileRowDownloadedLookBase,
                                    theme === "light"
                                      ? hfFileRowDownloadedLookHoverLight
                                      : hfFileRowDownloadedLookHoverDark,
                                  )
                                : cn(
                                    hfFileRowDownloadFreshBase,
                                    theme === "light"
                                      ? cn(
                                          hfFileRowDownloadFreshIdleLight,
                                          hfFileRowDownloadFreshHoverLight,
                                        )
                                      : hfFileRowDownloadFreshHoverDark,
                                  ),
                          )}
                        >
                          {vllmIsDownloading ? (
                            <>
                              <Loader2
                                className="h-3.5 w-3.5 shrink-0 animate-spin"
                                aria-hidden
                              />
                              Downloading
                            </>
                          ) : vllmIsDownloaded ? (
                            <>Downloaded</>
                          ) : (
                            <>
                              <Download
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0",
                                  theme === "light"
                                    ? "text-black opacity-100 group-hover:text-cyan-900"
                                    : "opacity-80 group-hover:opacity-100",
                                )}
                                aria-hidden
                              />
                              Download
                            </>
                          )}
                        </button>
                        <ModelSizeOffloadHint
                          sizeBytes={vllmModels[0]?.totalSize ?? 0}
                          gpu={sysStats?.gpu ?? null}
                          platform={sysStats?.platform}
                          ram={sysStats?.ram}
                        />
                      </div>
                      <div
                        className={cn(
                          hfGgufFileListScrollBase,
                          theme === "light"
                            ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
                            : "border border-zinc-800/80 bg-zinc-900/40 ring-1 ring-white/[0.04]",
                        )}
                        aria-label="Repository files"
                      >
                        <ul className="flex flex-col gap-1">
                          {repoAllFiles.map((f) => (
                            <li
                              key={f.path}
                              className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-md px-3 py-1.5 hover:bg-white/[0.02]"
                            >
                              <span
                                className="truncate text-xs font-mono text-zinc-400"
                                title={f.path}
                              >
                                {f.path}
                              </span>
                              <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                                {formatBytes(f.size)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </section>
                  )}
                {hfLibrary === "llama" &&
                  !filesLoading &&
                  !filesError &&
                  files.length > 0 && (
                    <section className="flex flex-col gap-3">
                      {ggufDisplay.rows.length > 0 ? (
                        <div
                          ref={ggufListScrollRef}
                          className={ggufFileListScrollClass}
                          aria-label="GGUF and multimodal files"
                        >
                          <ul className="flex flex-col gap-2">
                            {ggufDisplay.rows.map((f, i) => {
                              const fk = hfFileKey(f);
                              const hasLocal = anyRootHasBundle(
                                localGgufStatus[fk],
                              );
                              const isThisFileDownloading = downloadingFileKeys.has(fk);
                              const isThisFileQueued = queuedFileKeys.has(fk);
                              const isThisFileJustCompleted = completedFileKeys.has(fk);
                              return (
                                <li
                                  key={
                                    f.shardParts?.join("|") ??
                                    `${f.path}::${f.size}`
                                  }
                                  data-hf-gguf-row={String(i)}
                                  className={cn(
                                    "grid grid-cols-[minmax(0,1fr)_20rem_auto] items-center gap-x-3 rounded-lg border px-3 py-2",
                                    theme === "light"
                                      ? "border-zinc-700/20 bg-zinc-800/40"
                                      : "border-zinc-800 bg-zinc-900/30",
                                  )}
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    {f.isMmproj ? (
                                      <span
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-violet-500/35 bg-violet-500/10 text-violet-300/95"
                                        title="Multimodal projector (mmproj)"
                                      >
                                        <Image
                                          className="h-4 w-4"
                                          aria-hidden
                                        />
                                        <span className="sr-only">mmproj</span>
                                      </span>
                                    ) : null}
                                    <span
                                      className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-zinc-200"
                                      title={f.path}
                                    >
                                      {f.path}
                                    </span>
                                  </div>
                                  <ModelSizeOffloadHint
                                    sizeBytes={f.size}
                                    gpu={sysStats?.gpu ?? null}
                                    platform={sysStats?.platform}
                                    ram={sysStats?.ram}
                                  />
                                  {isThisFileDownloading
                                    ? (
                                        <button
                                          type="button"
                                          disabled
                                          className={cn(
                                            hfFileRowDownloadBtnBase,
                                            theme === "light"
                                              ? "animate-pulse border-cyan-400/40 bg-cyan-500/10 text-cyan-700 shadow-none focus-visible:ring-cyan-500/30"
                                              : "animate-pulse border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-300 focus-visible:ring-cyan-500/25",
                                          )}
                                        >
                                          <Loader2
                                            className="h-3.5 w-3.5 shrink-0 animate-spin"
                                            aria-hidden
                                          />
                                          Downloading
                                        </button>
                                      )
                                    : isThisFileQueued
                                      ? (
                                          <button
                                            type="button"
                                            disabled
                                            className={cn(
                                              hfFileRowDownloadBtnBase,
                                              theme === "light"
                                                ? "border-amber-400/30 bg-amber-500/10 text-amber-600"
                                                : "border-amber-500/20 bg-amber-500/10 text-amber-400",
                                            )}
                                          >
                                            <Clock
                                              className="h-3.5 w-3.5 shrink-0"
                                              aria-hidden
                                            />
                                            Queued
                                          </button>
                                        )
                                      : hasLocal || isThisFileJustCompleted
                                      ? (
                                          <div className="flex flex-col items-end gap-1.5 min-w-[7rem] shrink-0">
                                            <button
                                              type="button"
                                              className={cn(
                                                hfFileRowDownloadBtnBase,
                                                "w-full",
                                                theme === "light"
                                                  ? cn(hfFileRowDownloadedLookBaseLight, hfFileRowDownloadedLookHoverLight)
                                                  : cn(hfFileRowDownloadedLookBase, hfFileRowDownloadedLookHoverDark),
                                              )}
                                            >
                                              Downloaded
                                              {!f.isMmproj &&
                                                ggufDisplay.mmprojCount > 0 &&
                                                hasRelatedMmproj && (
                                                  <Image
                                                    className="h-3.5 w-3.5 shrink-0 text-purple-500"
                                                    aria-hidden
                                                  />
                                                )}
                                            </button>
                                            {!f.isMmproj &&
                                              ggufDisplay.mmprojCount > 0 &&
                                              !hasRelatedMmproj &&
                                              selectedId && (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const fk = hfFileKey(f);
                                                    const localDir =
                                                      localGgufStatus[fk]
                                                        ?.find((r) => r.present)
                                                        ?.path ?? modelRoots[0];
                                                    const mmf =
                                                      files
                                                        .filter(
                                                          (mf) => mf.isMmproj,
                                                        );
                                                    const firstKey =
                                                      mmf[0]
                                                        ? hfFileKey(mmf[0])
                                                        : null;
                                                    mmprojSelectedRef.current =
                                                      mmf[0] ?? null;
                                                    setMmprojPrompt({
                                                      repoId: selectedId,
                                                      mmprojFiles: mmf,
                                                      modelsDir: localDir,
                                                      selectedMmprojKey:
                                                        firstKey,
                                                      installMmprojOnly: true,
                                                    });
                                                  }}
                                                  className={cn(
                                                    hfFileRowDownloadBtnBase,
                                                    "w-full",
                                                    theme === "light"
                                                      ? cn(hfFileRowInstallVisionIdleLight, hfFileRowInstallVisionHoverLight)
                                                      : cn(hfFileRowInstallVisionBase, hfFileRowInstallVisionHoverDark),
                                                  )}
                                                >
                                                  <Image
                                                    className={cn(
                                                      "h-3.5 w-3.5 shrink-0",
                                                      theme === "light"
                                                        ? "opacity-90"
                                                        : "opacity-80",
                                                    )}
                                                    aria-hidden
                                                  />
                                                  Install Vision
                                                </button>
                                              )}
                                          </div>
                                        )
                                      : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (selectedId) {
                                                void requestDownload(selectedId, f);
                                              }
                                            }}
                                            className={cn(
                                              hfFileRowDownloadBtnBase,
                                              hfFileRowDownloadFreshBase,
                                              theme === "light"
                                                ? cn(
                                                    hfFileRowDownloadFreshIdleLight,
                                                    hfFileRowDownloadFreshHoverLight,
                                                  )
                                                : hfFileRowDownloadFreshHoverDark,
                                            )}
                                          >
                                            <Download
                                              className={cn(
                                                "h-3.5 w-3.5 shrink-0",
                                                theme === "light"
                                                  ? "text-black opacity-100 group-hover:text-cyan-900"
                                                  : "opacity-80 group-hover:opacity-100",
                                              )}
                                              aria-hidden
                                            />
                                            Download
                                          </button>
                                        )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  )}

                <section
                  className={cn(
                    !filesLoading &&
                      !filesError &&
                      ((hfLibrary === "llama" && files.length > 0) ||
                        (hfLibrary === "vllm" && vllmModels.length > 0)) &&
                      cn(
                        "border-t pt-6",
                        theme === "light"
                          ? "border-zinc-800/30"
                          : "border-white/[0.06]",
                      ),
                  )}
                >
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <FileText
                      className="h-4 w-4 shrink-0 text-zinc-500"
                      aria-hidden
                    />
                    README
                  </h3>
                  {readmeLoading && (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading README…
                    </div>
                  )}
                  {!readmeLoading && readmeMd ? (
                    <div
                      className={cn(
                        "rounded-xl p-4",
                        theme === "light"
                          ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
                          : "border border-zinc-800/80 bg-zinc-950/35",
                      )}
                    >
                      <HfReadmeMarkdown content={readmeMd} />
                    </div>
                  ) : null}
                  {!readmeLoading && !readmeMd && readmeError ? (
                    <p className="text-xs text-zinc-500">{readmeError}</p>
                  ) : null}
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
