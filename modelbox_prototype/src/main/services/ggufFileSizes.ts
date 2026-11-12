import { statSync, existsSync, readdirSync } from "fs";
import { join } from "path";

/** Sum byte sizes of `.gguf` files in `paths` (skips missing/unreadable paths). */
export function sumGgufFileSizes(paths: string[]): number {
  let sum = 0;
  for (const p of paths) {
    if (!p.toLowerCase().endsWith(".gguf")) continue;
    try {
      sum += statSync(p).size;
    } catch {
      /* skip */
    }
  }
  return sum;
}

function sumFilesInDir(dir: string, ext: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith(ext)) continue;
      try {
        total += statSync(join(dir, entry)).size;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return total;
}

/**
 * Estimate total weight bytes for a vLLM model directory.
 * Handles HF hub cache layout (blobs/ deduplication) and flat safetensors dirs.
 */
export function sumVllmModelDirBytes(dirPath: string): number {
  try {
    // HF hub cache: sum blobs/ to avoid double-counting snapshot symlinks.
    // Blobs are named by sha256 (no extension); skip tiny files (config, tokenizer).
    const blobsDir = join(dirPath, "blobs");
    if (existsSync(blobsDir)) {
      let total = 0;
      try {
        for (const entry of readdirSync(blobsDir)) {
          if (entry.endsWith(".incomplete") || entry.endsWith(".lock")) continue;
          try {
            const s = statSync(join(blobsDir, entry));
            if (s.isFile() && s.size >= 10 * 1024 * 1024) total += s.size;
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return total;
    }

    // Flat dir: safetensors directly in the model folder.
    const direct = sumFilesInDir(dirPath, ".safetensors");
    if (direct > 0) return direct;

    // HF cache without blobs/ (edge case): pick the largest snapshot.
    const snapshotsDir = join(dirPath, "snapshots");
    if (existsSync(snapshotsDir)) {
      let maxSize = 0;
      try {
        for (const hash of readdirSync(snapshotsDir)) {
          const hashDir = join(snapshotsDir, hash);
          try {
            if (!statSync(hashDir).isDirectory()) continue;
            const size = sumFilesInDir(hashDir, ".safetensors");
            if (size > maxSize) maxSize = size;
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return maxSize;
    }
  } catch { /* skip */ }
  return 0;
}
