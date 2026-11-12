import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { basename, resolve } from "path";
import { BrowserWindow, ipcMain } from "electron";
import { normalizeWslUncDistro } from "../utils/wslPath";
import {
  getSettings,
  resolveModelsDirForHfDownload,
  resolveVllmDirForHfDownload,
} from "../db/repos/settings.repo";
import {
  abandonIncompleteDownload,
  deriveFolderName,
  downloadGgufToModelsDir,
  fetchRepoReadme,
  getIncompleteMetaForDir,
  ggufBundleFullyPresent,
  listGgufFiles,
  relatedMmprojExistsForRepo,
  listRepoAllFiles,
  listSafetensorFiles,
  listVllmModels,
  modelsRepoPathSegments,
  resolvePublisherAvatarUrl,
  resolvePublisherAvatarUrlBatch,
  scanAllIncompleteMetas,
  searchGgufModelsPage,
  searchSafetensorModelsPage,
  setHubToken,
  writeHfMetaSync,
} from "../services/huggingfaceHub";
import { getHfToken, setHfToken, deleteHfToken } from "../services/keychain";
import type {
  HfDownloadProgressEvent,
  HfDownloadResult,
  HfIncompleteDownloadInfo,
  HfLocalGgufStatusBatchResult,
  HfModelListSort,
  HfRepoFileInfo,
  HfRepoReadmeResult,
  HfSearchModelsPayload,
} from "@shared/types";

const downloadControllers = new Map<
  string,
  { controller: AbortController; modelDir: string }
>();
const pausedDownloadIds = new Set<string>();

function sendHfProgress(payload: HfDownloadProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("hf:download-progress", payload);
    }
  }
}

export function registerHuggingfaceIpc(): void {
  // Load stored HF token into the hub service on startup.
  void getHfToken().then((t) => setHubToken(t));

  ipcMain.handle("hf:search-models", async (_e, raw: unknown) => {
    const p = raw as Partial<HfSearchModelsPayload>;
    const query = typeof p.query === "string" ? p.query : "";
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? p.limit : 25;
    const cursorUrl =
      typeof p.cursorUrl === "string" && p.cursorUrl.length > 0
        ? p.cursorUrl
        : null;
    const sort: HfModelListSort =
      p.listSort === "downloads" ? "downloads" : "trending";
    const lib = p.library === "vllm" ? "vllm" : "llama";
    if (lib === "vllm") {
      return searchSafetensorModelsPage(query, limit, cursorUrl, sort);
    }
    return searchGgufModelsPage(query, limit, cursorUrl, sort);
  });

  ipcMain.handle("hf:list-gguf-files", async (_e, repoId: string) => {
    return listGgufFiles(repoId);
  });

  ipcMain.handle("hf:list-safetensor-files", async (_e, repoId: string) => {
    return listSafetensorFiles(typeof repoId === "string" ? repoId : "");
  });

  ipcMain.handle("hf:list-vllm-models", async (_e, repoId: string) => {
    return listVllmModels(typeof repoId === "string" ? repoId : "");
  });

  ipcMain.handle(
    "hf:get-publisher-avatar",
    async (_e, publisher: string): Promise<string | null> => {
      return resolvePublisherAvatarUrl(
        typeof publisher === "string" ? publisher : "",
      );
    },
  );

  ipcMain.handle(
    "hf:get-publisher-avatars-batch",
    async (_e, publishers: unknown): Promise<Record<string, string | null>> => {
      const slugs = Array.isArray(publishers)
        ? publishers.filter((s): s is string => typeof s === "string")
        : [];
      return resolvePublisherAvatarUrlBatch(slugs);
    },
  );

  ipcMain.handle(
    "hf:repo-readme",
    async (_e, repoId: string): Promise<HfRepoReadmeResult> => {
      const id = typeof repoId === "string" ? repoId : "";
      if (!id) {
        return { markdown: null, error: "Missing repo id" };
      }
      return fetchRepoReadme(id);
    },
  );

  ipcMain.handle(
    "hf:local-gguf-status-batch",
    async (
      _e,
      payload: {
        repoId: string;
        items: { key: string; filenames: string[] }[];
        roots: string[];
      },
    ): Promise<HfLocalGgufStatusBatchResult> => {
      const repoId = typeof payload.repoId === "string" ? payload.repoId : "";
      const items = Array.isArray(payload.items) ? payload.items : [];
      const rawRoots = Array.isArray(payload.roots) ? payload.roots : [];
      const out: HfLocalGgufStatusBatchResult = {};
      if (!repoId || items.length === 0 || rawRoots.length === 0) {
        return out;
      }
      const rootsResolved = rawRoots
        .map((r) => (typeof r === "string" ? r.trim() : ""))
        .filter((r) => r.length > 0)
        .map((displayPath) => {
          try {
            return { displayPath, resolved: resolve(displayPath) };
          } catch {
            return null;
          }
        })
        .filter(
          (x): x is { displayPath: string; resolved: string } => x != null,
        );
      for (const item of items) {
        const key = typeof item.key === "string" ? item.key : "";
        const names = Array.isArray(item.filenames)
          ? item.filenames.filter((x): x is string => typeof x === "string")
          : [];
        if (!key || names.length === 0) continue;
        out[key] = rootsResolved.map(({ displayPath, resolved }) => ({
          path: displayPath,
          present: ggufBundleFullyPresent(resolved, repoId, names),
        }));
      }
      return out;
    },
  );

  ipcMain.handle(
    "hf:related-mmproj-exists",
    async (
      _e,
      payload: { repoId: string; modelRoots: string[] },
    ): Promise<boolean> => {
      const repoId = typeof payload.repoId === "string" ? payload.repoId : "";
      const roots = Array.isArray(payload.modelRoots)
        ? payload.modelRoots.filter((r): r is string => typeof r === "string")
        : [];
      if (!repoId || roots.length === 0) return false;
      return relatedMmprojExistsForRepo(repoId, roots);
    },
  );

  ipcMain.handle(
    "hf:download",
    async (
      _e,
      payload: {
        downloadId: string;
        repoId: string;
        filename?: string;
        filenames?: string[];
        fileSizes?: number[];
        /** Must match a path in Settings → Models directories when set. */
        modelsDir?: string;
        /** Pre-computed dest folder (used when resuming to preserve original folder name). */
        destFolder?: string;
        /** When true, resolve `modelsDir` against Settings → vLLM model directories. */
        vllmTarget?: boolean;
      },
    ): Promise<HfDownloadResult> => {
      const { downloadId, repoId } = payload;
      const names =
        payload.filenames && payload.filenames.length > 0
          ? payload.filenames
          : payload.filename
            ? [payload.filename]
            : [];
      if (!downloadId) {
        return { ok: false, downloadId: "", error: "Missing download id" };
      }
      if (names.length === 0) {
        return { ok: false, downloadId, error: "No files to download" };
      }

      const settings = getSettings();
      const requestedRaw =
        payload &&
        typeof payload === "object" &&
        "modelsDir" in payload &&
        typeof (payload as { modelsDir?: unknown }).modelsDir === "string"
          ? (payload as { modelsDir: string }).modelsDir.trim()
          : "";
      const requested = requestedRaw.length > 0 ? requestedRaw : undefined;
      const vllmTarget =
        payload &&
        typeof payload === "object" &&
        "vllmTarget" in payload &&
        (payload as { vllmTarget?: boolean }).vllmTarget === true;
      const resolved = vllmTarget
        ? resolveVllmDirForHfDownload(settings, requested)
        : resolveModelsDirForHfDownload(settings, requested);
      if (!resolved.ok) {
        return { ok: false, downloadId, error: resolved.error };
      }
      // Normalize WSL distro name: user may have \\wsl.localhost\Ubuntu configured
      // but the actual installed distro is Ubuntu-24.04. mkdirSafe falls back already;
      // this ensures destPath also uses the real distro so file writes land in the same
      // directory that mkdirSafe created.
      const modelsDir = await normalizeWslUncDistro(
        vllmTarget
          ? (resolved as { vllmDir: string }).vllmDir
          : (resolved as { modelsDir: string }).modelsDir,
      );

      const sizes = payload.fileSizes;
      const bundleTotalBytes =
        sizes &&
        sizes.length === names.length &&
        sizes.every((n) => typeof n === "number" && n > 0)
          ? sizes.reduce((a, b) => a + b, 0)
          : undefined;

      // Compute repo segments first — needed for dest folder resolution.
      const repoSegs = modelsRepoPathSegments(repoId);
      const namespace = repoSegs[0]!;

      // Separate mmproj and weight files — they land in different folders.
      const weightNames = names.filter((n) => !/mmproj/i.test(basename(n)));
      const mmprojNames = names.filter((n) => /mmproj/i.test(basename(n)));

      // Preserve explicit destFolder for weights (resume from old metas).
      // Always derive mmproj folder from repoId (mmproj always goes to repo folder).
      const explicitDest =
        typeof payload.destFolder === "string" && payload.destFolder.length > 0
          ? payload.destFolder
          : null;
      // vLLM: everything in repo folder (e.g. "Qwen3-30B-A3B").
      // GGUF weights: per-quant stem under repo folder (e.g. "repo/stem").
      // GGUF mmproj: repo folder only (e.g. "repo").
      const weightDestFolder = vllmTarget
        ? repoSegs[1]!
        : explicitDest
          ? explicitDest
          : deriveFolderName(weightNames.length > 0 ? weightNames : names, repoId);
      const mmprojDestFolder = vllmTarget
        ? repoSegs[1]!
        : deriveFolderName(mmprojNames.length > 0 ? mmprojNames : ["dummy.gguf"], repoId);

      // Canonical model dir: weight folder when weights exist, mmproj folder otherwise.
      const primaryDest = weightNames.length > 0 ? weightDestFolder : mmprojDestFolder;
      const modelDir = resolve(modelsDir, namespace, primaryDest);

      const ac = new AbortController();
      downloadControllers.set(downloadId, { controller: ac, modelDir });

      sendHfProgress({
        downloadId,
        phase: "started",
        repoId,
        filename:
          names.length === 1 ? names[0]! : `${names.length} shard files`,
        filenames: names.length > 1 ? names : undefined,
        modelsDir,
      });

      const savedPaths: string[] = [];
      let bundleBase = 0;
      // Throttle progress IPC events — firing on every stream chunk floods the renderer
      // (thousands/sec on fast connections), delaying events for concurrent downloads.
      const PROGRESS_INTERVAL_MS = 150;
      let lastProgressMs = 0;

      // Build the meta object once so we can reuse it for the completion write.
      const downloadMeta = {
        repoId,
        filenames: names,
        fileSizes: sizes && sizes.length === names.length ? sizes : undefined,
        modelsDir,
        destFolder: primaryDest,
        complete: false,
        vllmTarget: vllmTarget || undefined,
      };

      // Write meta before starting so an interrupted download can be resumed.
      writeHfMetaSync(modelDir, downloadMeta);

      try {
        for (let i = 0; i < names.length; i++) {
          const fn = names[i]!;
          const sliceBytes = sizes?.[i];
          const isMmproj = /mmproj/i.test(basename(fn));
          const fileDestFolder = isMmproj ? mmprojDestFolder : weightDestFolder;

          // Skip files already fully present on disk (resume / retry support).
          const existingPath = resolve(
            modelsDir,
            namespace,
            fileDestFolder,
            basename(fn),
          );
          if (existsSync(existingPath)) {
            savedPaths.push(existingPath);
            if (typeof sliceBytes === "number" && sliceBytes > 0)
              bundleBase += sliceBytes;
            continue;
          }

          const dest = await downloadGgufToModelsDir(
            repoId,
            fn,
            modelsDir,
            "main",
            ac.signal,
            (receivedBytes, totalBytes) => {
              const now = Date.now();
              if (now - lastProgressMs < PROGRESS_INTERVAL_MS) return;
              lastProgressMs = now;
              const bundleReceivedBytes =
                bundleTotalBytes != null
                  ? bundleBase + receivedBytes
                  : undefined;
              sendHfProgress({
                downloadId,
                phase: "progress",
                receivedBytes,
                totalBytes,
                fileIndex: names.length > 1 ? i + 1 : undefined,
                filesTotal: names.length > 1 ? names.length : undefined,
                currentFilename: names.length > 1 ? fn : undefined,
                bundleReceivedBytes,
                bundleTotalBytes,
              });
            },
            fileDestFolder,
            () => pausedDownloadIds.has(downloadId),
            vllmTarget
              ? [".safetensors", ".json", ".model"]
              : undefined,
          );
          savedPaths.push(dest);
          if (typeof sliceBytes === "number" && sliceBytes > 0) {
            bundleBase += sliceBytes;
          }
        }
        // Write complete: true directly from in-memory meta — avoids a read-modify-write
        // over slow/unreliable paths (WSL UNC via 9P) that markHfMetaCompleteSync would need.
        writeHfMetaSync(modelDir, { ...downloadMeta, complete: true });
        sendHfProgress({
          downloadId,
          phase: "complete",
          savedPath: savedPaths[0]!,
          savedPaths: names.length > 1 ? savedPaths : undefined,
        });
        return {
          ok: true,
          downloadId,
          savedPath: savedPaths[0],
          savedPaths: names.length > 1 ? savedPaths : undefined,
        };
      } catch (err: unknown) {
        const aborted =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("aborted"));
        const wasPaused = pausedDownloadIds.has(downloadId);
        if (aborted && wasPaused) {
          const info = getIncompleteMetaForDir(modelDir);
          if (info) {
            sendHfProgress({ downloadId, phase: "paused", info });
            return { ok: false, downloadId, error: "Paused", aborted: true };
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        // Non-abort failure (auth error, HTTP error, etc.) — clean up already-downloaded
        // files and mark the meta as failed so it shows as a hard failure on next launch.
        if (!aborted) {
          writeHfMetaSync(modelDir, { ...downloadMeta, complete: false, failed: message });
          for (const p of savedPaths) {
            await unlink(p).catch(() => {});
          }
          await abandonIncompleteDownload(modelDir);
        }
        sendHfProgress({
          downloadId,
          phase: "error",
          error: message,
          aborted,
        });
        return { ok: false, downloadId, error: message, aborted };
      } finally {
        downloadControllers.delete(downloadId);
        pausedDownloadIds.delete(downloadId);
      }
    },
  );

  ipcMain.handle("hf:cancel-download", async (_e, downloadId: string) => {
    const entry = downloadControllers.get(downloadId);
    if (entry) {
      entry.controller.abort();
      await abandonIncompleteDownload(entry.modelDir).catch(() => {});
    }
  });

  ipcMain.handle("hf:pause-download", async (_e, downloadId: string) => {
    pausedDownloadIds.add(downloadId);
    downloadControllers.get(downloadId)?.controller.abort();
  });

  ipcMain.handle("hf:abandon-download", async (_e, modelDir: string) => {
    if (typeof modelDir !== "string" || modelDir.trim().length === 0) return;
    await abandonIncompleteDownload(modelDir.trim());
  });

  ipcMain.handle(
    "hf:get-incomplete-meta",
    (_e, modelDir: string): HfIncompleteDownloadInfo | null => {
      if (typeof modelDir !== "string" || modelDir.trim().length === 0)
        return null;
      return getIncompleteMetaForDir(modelDir.trim());
    },
  );

  ipcMain.handle(
    "hf:check-incomplete-metas",
    (_e, modelDirs: string[]): string[] => {
      if (!Array.isArray(modelDirs)) return [];
      return modelDirs.filter((d) => {
        if (typeof d !== "string" || d.trim().length === 0) return false;
        return getIncompleteMetaForDir(d.trim()) !== null;
      });
    },
  );

  ipcMain.handle(
    "hf:get-all-incomplete-metas",
    (): HfIncompleteDownloadInfo[] => {
      const settings = getSettings();
      // Skip WSL UNC paths — readdirSync on \\wsl$\... stalls the main thread when the VM is cold.
      // Incomplete download metas are always written to Windows-side paths by the HF downloader.
      const isWslPath = (p: string): boolean => /^\\\\wsl(\$|\.localhost)\\/i.test(p.trim());
      return scanAllIncompleteMetas([
        ...(settings.modelsDirs ?? []),
        ...(settings.vllmModelDirs ?? []).filter((d) => !isWslPath(d)),
      ]);
    },
  );

  ipcMain.handle(
    "hf:repo-all-files",
    async (_e, repoId: string): Promise<HfRepoFileInfo[]> => {
      if (typeof repoId !== "string" || repoId.trim().length === 0) return [];
      return listRepoAllFiles(repoId.trim());
    },
  );

  ipcMain.handle("hf:get-token", async (): Promise<string | null> => {
    return getHfToken();
  });

  ipcMain.handle("hf:set-token", async (_e, token: unknown): Promise<void> => {
    const t = typeof token === "string" ? token.trim() : "";
    if (t.length === 0) {
      await deleteHfToken();
      setHubToken(null);
    } else {
      await setHfToken(t);
      setHubToken(t);
    }
  });
}
