import { create } from "zustand";
import type { HfDownloadProgressEvent, HfIncompleteDownloadInfo } from "@shared/types";
import { api } from "../lib/ipc";

export type HfDownloadPhase = "downloading" | "complete" | "error" | "fading" | "interrupted" | "paused";

export type DownloadEntry = {
  downloadId: string;
  repoId: string | null;
  /** Stable file key from the UI (hfFileKey(f)) — set eagerly before IPC fires. */
  fileKey: string | null;
  /** Ordered list of file keys for bundle downloads (weight first, mmproj second). */
  fileKeys: string[];
  fileLabel: string;
  modelsDir: string | null;
  receivedBytes: number;
  totalBytes: number | undefined;
  progressHint: string | null;
  phase: HfDownloadPhase;
  errorMessage: string | null;
  savedPathSummary: string | null;
  /** 0-based index of the file currently being downloaded (multi-file bundles only). */
  currentFileIndex: number | undefined;
  /** True for vLLM safetensor downloads; false/undefined for GGUF downloads. */
  vllmTarget?: boolean;
  /** Only set for "interrupted" phase — holds the persisted meta for resume. */
  interruptedMeta?: HfIncompleteDownloadInfo;
  /** Only set for "error" phase entries restored from disk — used to clean up the meta file on dismiss. */
  failedMeta?: HfIncompleteDownloadInfo;
};

const FADE_OUT_MS = 500;

/** Per-download dismiss/fade timers, keyed by downloadId. */
const timers = new Map<
  string,
  { dismiss: ReturnType<typeof setTimeout>; fade?: ReturnType<typeof setTimeout> }
>();

function clearTimers(id: string): void {
  const t = timers.get(id);
  if (!t) return;
  clearTimeout(t.dismiss);
  if (t.fade != null) clearTimeout(t.fade);
  timers.delete(id);
}

function scheduleDismiss(id: string, ms: number): void {
  clearTimers(id);
  const dismiss = setTimeout(() => {
    useHfDownloadStore.setState((s) => {
      const entry = s.downloads[id];
      if (!entry) { timers.delete(id); return s; }
      return { downloads: { ...s.downloads, [id]: { ...entry, phase: "fading" as const } } };
    });
    const fade = setTimeout(() => {
      timers.delete(id);
      useHfDownloadStore.setState((s) => {
        const next = { ...s.downloads };
        delete next[id];
        return { downloads: next };
      });
    }, FADE_OUT_MS);
    timers.set(id, { dismiss: 0 as unknown as ReturnType<typeof setTimeout>, fade });
  }, ms);
  timers.set(id, { dismiss });
}

type HfDownloadStore = {
  downloads: Record<string, DownloadEntry>;
  /**
   * Called immediately when the user confirms a download (after dir picker if shown).
   * Creates a "downloading" entry so the button updates instantly — before the IPC
   * "started" event arrives.
   */
  registerPendingDownload: (downloadId: string, fileKey: string, repoId: string, initialBytes?: number, initialTotal?: number, vllmTarget?: boolean, progressHint?: string | null, fileKeys?: string[]) => void;
  applyProgressEvent: (payload: HfDownloadProgressEvent) => void;
  /** Reports an error that occurred before any progress events (e.g. validation failure). */
  reportDownloadError: (message: string) => void;
  /** Adds a previously-interrupted (persisted) download to the sidebar on app startup. */
  addInterrupted: (info: HfIncompleteDownloadInfo) => void;
  /** Adds a previously-failed (persisted) download to the sidebar on app startup. */
  addFailed: (info: HfIncompleteDownloadInfo) => void;
  dismiss: (downloadId: string) => void;
  cancelDownload: (downloadId: string) => void;
  pauseDownload: (downloadId: string) => void;
};

let errorSeq = 0;

export const useHfDownloadStore = create<HfDownloadStore>((set, get) => ({
  downloads: {},

   registerPendingDownload: (downloadId, fileKey, repoId, initialBytes, initialTotal, vllmTarget, progressHint, fileKeys) => {
    set((s) => ({
      downloads: {
        ...s.downloads,
        [downloadId]: {
          downloadId,
          repoId,
          fileKey,
          fileKeys: fileKeys ?? [fileKey],
          fileLabel: "",
          modelsDir: null,
          receivedBytes: initialBytes ?? 0,
          totalBytes: initialTotal,
          progressHint: progressHint ?? null,
          phase: "downloading" as const,
          currentFileIndex: undefined,
          errorMessage: null,
          savedPathSummary: null,
          vllmTarget: vllmTarget || undefined,
        },
      },
    }));
  },

  addInterrupted: (info) => {
    const id = `__interrupted__${info.modelDir}`;
    set((s) => {
      // Don't overwrite an active download for the same model dir
      const existing = s.downloads[id];
      if (existing && existing.phase === "downloading") return s;
      return {
        downloads: {
          ...s.downloads,
          [id]: {
            downloadId: id,
            repoId: info.meta.repoId,
            fileKey: null,
            fileKeys: [],
            fileLabel: info.meta.destFolder,
            modelsDir: info.meta.modelsDir,
            receivedBytes: 0,
            totalBytes: undefined,
            progressHint: null,
            phase: "interrupted" as const,
            currentFileIndex: undefined,
            errorMessage: null,
            savedPathSummary: null,
            vllmTarget: info.meta.vllmTarget ?? undefined,
            interruptedMeta: info,
          },
        },
      };
    });
  },

  addFailed: (info) => {
    const id = `__failed__${info.modelDir}`;
    set((s) => {
      const existing = s.downloads[id];
      if (existing && existing.phase !== "error") return s;
      return {
        downloads: {
          ...s.downloads,
          [id]: {
            downloadId: id,
            repoId: info.meta.repoId,
            fileKey: null,
            fileKeys: [],
            fileLabel: info.meta.destFolder,
            modelsDir: info.meta.modelsDir,
            receivedBytes: 0,
            totalBytes: undefined,
            progressHint: null,
            phase: "error" as const,
            currentFileIndex: undefined,
            errorMessage: info.errorMessage ?? "Download failed",
            savedPathSummary: null,
            vllmTarget: info.meta.vllmTarget ?? undefined,
            failedMeta: info,
          },
        },
      };
    });
  },

  dismiss: (downloadId) => {
    clearTimers(downloadId);
    set((s) => {
      const next = { ...s.downloads };
      delete next[downloadId];
      return { downloads: next };
    });
  },

  reportDownloadError: (message) => {
    const id = `__error_${++errorSeq}`;
    set((s) => ({
      downloads: {
        ...s.downloads,
        [id]: {
          downloadId: id,
          repoId: null,
          fileKey: null,
          fileKeys: [],
          fileLabel: "",
          modelsDir: null,
          receivedBytes: 0,
          totalBytes: undefined,
          progressHint: null,
          phase: "error" as const,
          currentFileIndex: undefined,
          errorMessage: message,
          savedPathSummary: null,
        },
      },
    }));
  },

  cancelDownload: (downloadId) => {
    const entry = get().downloads[downloadId];
    if (entry?.phase === "downloading") {
      void api.hf.cancelDownload(downloadId);
    } else if (
      (entry?.phase === "paused" || entry?.phase === "interrupted") &&
      entry.interruptedMeta
    ) {
      void api.hf.abandonDownload(entry.interruptedMeta.modelDir);
      useHfDownloadStore.getState().dismiss(downloadId);
    }
  },

  pauseDownload: (downloadId) => {
    const entry = get().downloads[downloadId];
    if (entry?.phase === "downloading") {
      void api.hf.pauseDownload(downloadId);
    }
  },

  applyProgressEvent: (payload) => {
    if (payload.phase === "started") {
      clearTimers(payload.downloadId);
      set((s) => {
        const existing = s.downloads[payload.downloadId];
        return {
          downloads: {
            ...s.downloads,
            [payload.downloadId]: {
              ...(existing ?? {}),
              downloadId: payload.downloadId,
              repoId: payload.repoId,
              fileLabel: payload.filename,
              modelsDir: payload.modelsDir,
              // Preserve bytes and progressHint pre-populated by registerPendingDownload (resume from paused).
              // A fresh download registers with 0/null, so this is safe for both cases.
              receivedBytes: existing?.receivedBytes ?? 0,
              totalBytes: existing?.totalBytes,
              progressHint: existing?.progressHint ?? null,
              phase: "downloading" as const,
              currentFileIndex: 0,
              errorMessage: null,
              savedPathSummary: null,
            },
          },
        };
      });
      return;
    }

    const entry = get().downloads[payload.downloadId];
    if (!entry) return;

    if (payload.phase === "progress") {
      let received = payload.receivedBytes;
      let total = payload.totalBytes;
      if (payload.bundleReceivedBytes != null && payload.bundleTotalBytes != null) {
        received = payload.bundleReceivedBytes;
        total = payload.bundleTotalBytes;
      }
      let hint: string | null = null;
      if (
        payload.filesTotal != null &&
        payload.fileIndex != null &&
        payload.filesTotal > 1
      ) {
        const tail = payload.currentFilename ? ` · ${payload.currentFilename}` : "";
        hint = `Part ${payload.fileIndex} of ${payload.filesTotal}${tail}`;
      }
      // Track which file in the bundle is currently downloading (payload.fileIndex is 1-based).
      const currentFi = payload.fileIndex != null ? payload.fileIndex - 1 : undefined;
      set((s) => ({
        downloads: {
          ...s.downloads,
          [payload.downloadId]: {
            ...s.downloads[payload.downloadId]!,
            receivedBytes: received,
            totalBytes: total,
            progressHint: hint,
            currentFileIndex: currentFi ?? s.downloads[payload.downloadId]?.currentFileIndex,
          },
        },
      }));
      return;
    }

    if (payload.phase === "complete") {
      const summary =
        payload.savedPaths && payload.savedPaths.length > 1
          ? `${payload.savedPaths.length} files saved`
          : (payload.savedPath ?? null);
      set((s) => ({
        downloads: {
          ...s.downloads,
          [payload.downloadId]: {
            ...s.downloads[payload.downloadId]!,
            phase: "complete" as const,
            savedPathSummary: summary,
            progressHint: null,
          },
        },
      }));
      scheduleDismiss(payload.downloadId, 5000);
      return;
    }

    if (payload.phase === "error") {
      set((s) => ({
        downloads: {
          ...s.downloads,
          [payload.downloadId]: {
            ...s.downloads[payload.downloadId]!,
            phase: "error" as const,
            errorMessage: payload.aborted ? "Cancelled" : (payload.error ?? null),
            progressHint: null,
          },
        },
      }));
    }

    if (payload.phase === "interrupted") {
      const info = payload.info;
      const id = payload.downloadId;
      clearTimers(id);
      set((s) => ({
        downloads: {
          ...s.downloads,
          [id]: {
            downloadId: id,
            repoId: info.meta.repoId,
            fileKey: s.downloads[id]?.fileKey ?? null,
            fileKeys: s.downloads[id]?.fileKeys ?? [],
            fileLabel: info.meta.destFolder,
            modelsDir: info.meta.modelsDir,
            receivedBytes: 0,
            totalBytes: undefined,
            progressHint: null,
            phase: "interrupted" as const,
            currentFileIndex: undefined,
            errorMessage: null,
            savedPathSummary: null,
            vllmTarget: s.downloads[id]?.vllmTarget ?? info.meta.vllmTarget ?? undefined,
            interruptedMeta: info,
          },
        },
      }));
    }

    if (payload.phase === "paused") {
      const info = payload.info;
      const id = payload.downloadId;
      clearTimers(id);
      set((s) => {
        const existing = s.downloads[id];
        return {
          downloads: {
            ...s.downloads,
            [id]: {
              // Preserve receivedBytes/totalBytes, progressHint, and fileLabel from the downloading
              // state so the card height stays stable and the "Part X of Y" hint remains visible.
              ...(existing ?? {}),
              downloadId: id,
              repoId: info.meta.repoId,
              fileLabel: existing?.fileLabel || info.meta.destFolder,
              modelsDir: info.meta.modelsDir,
              phase: "paused" as const,
              errorMessage: null,
              savedPathSummary: null,
              interruptedMeta: info,
            },
          },
        };
      });
    }
  },
}));
