import { readdirSync, statSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";
import {
  listVllmModels,
  upsertVllmModelByPath,
} from "../db/repos/vllmModels.repo";
import { ensureDefaultVllmProfile } from "../db/repos/vllmProfiles.repo";
import type { VllmScanResult } from "@shared/types";
import { parseWslUncPath } from "../utils/wslPath";
import {
  findModelDirsLinuxTreeViaWsl,
  readConfigJsonMetaForModelDir,
  storedPathFromWslFindResult,
} from "./vllmModelScannerWsl";

const { join } = path;

/** Normalize user-entered roots (WSL UNC, mixed slashes). */
function normalizeRoot(p: string): string {
  const t = p.trim();
  if (!t) return t;
  if (process.platform === "win32") {
    return path.win32.normalize(t);
  }
  return path.normalize(t);
}

/**
 * Resolve a configured root to an existing directory.
 * On Windows, also tries `\\wsl$\` ↔ `\\wsl.localhost\` fallback in case the
 * 9P mount uses the other form. (WSL paths are handled earlier by parseWslUncPath
 * and go through WSL find — this function is only reached for non-WSL paths.)
 */
function resolveExistingVllmRoot(raw: string): string | null {
  const t = normalizeRoot(raw);
  if (!t) return null;

  // Never call existsSync/statSync on UNC paths (\\server\... or \\wsl$\...) — those
  // go through network/9P stacks and can stall the main thread for several seconds.
  // WSL paths are handled via async WSL commands in the caller; other UNC paths are
  // unsupported as vLLM model roots.
  if (t.startsWith("\\\\")) return null;

  // Reject drive/filesystem roots and very shallow paths (e.g. "\", "C:\", "C:\Users").
  // Scanning those would recursively walk an entire drive and block the main thread
  // indefinitely — this is the crash path when the user types a partial "\" prefix.
  // Require at least 2 meaningful segments beyond the drive letter.
  const parts = t.replace(/[/\\]+/g, "/").split("/").filter((s) => s.length > 0 && !s.endsWith(":"));
  if (parts.length < 2) return null;

  try {
    if (existsSync(t) && statSync(t).isDirectory()) {
      return t;
    }
  } catch {
    /* ignore */
  }
  return null;
}

type DirClass = "vllm" | "skip" | "descend";

/**
 * Classify a directory in one pass:
 * - "vllm"    — has safetensors (or config.json as root marker) and is not GGUF-only or MLX
 * - "skip"    — GGUF-only (gguf present, no safetensors) or MLX (mlx_config.json present)
 * - "descend" — no model files found at this level; recurse deeper
 *
 * Uses lstatSync so HF hub-cache symlinks (→ blobs/) are counted as real files.
 */
function classifyModelDir(dir: string): DirClass {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return "descend";
  }

  let hasSafetensors = false;
  let hasGguf = false;
  let hasConfig = false;
  let hasMlxConfig = false;

  for (const name of names) {
    const n = name.toLowerCase();
    const relevant =
      n === "config.json" ||
      n === "mlx_config.json" ||
      n.endsWith(".safetensors") ||
      n.endsWith(".gguf");
    if (!relevant) continue;
    const full = join(dir, name);
    try {
      const st = lstatSync(full);
      if (!st.isFile() && !st.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    if (n.endsWith(".safetensors")) hasSafetensors = true;
    else if (n.endsWith(".gguf")) hasGguf = true;
    else if (n === "config.json") hasConfig = true;
    else if (n === "mlx_config.json") hasMlxConfig = true;
  }

  if (hasMlxConfig) return "skip";
  if (hasGguf && !hasSafetensors) return "skip";
  if (hasSafetensors || hasConfig) return "vllm";
  return "descend";
}

const MAX_TREE_DEPTH = 16;

function shouldSkipChildDir(name: string): boolean {
  const l = name.toLowerCase();
  if (l === "blobs" || l === "tmp") return true;
  if (l.startsWith(".")) return true;
  if (name.startsWith("datasets--")) return true;
  return false;
}

/**
 * Depth-first search for any directory that contains vLLM-usable weights.
 * Skips `blobs` (huge) and `datasets--` cache trees.
 * GGUF-only dirs and MLX dirs are skipped without recursing into them.
 */
function findModelDirsInTree(dir: string, depth: number): string[] {
  if (depth > MAX_TREE_DEPTH) return [];
  const kind = classifyModelDir(dir);
  if (kind === "vllm") return [dir];
  if (kind === "skip") return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (shouldSkipChildDir(name)) continue;
    const sub = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(sub).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    out.push(...findModelDirsInTree(sub, depth + 1));
  }
  return out;
}

function extractRepoFolderName(modelPath: string): string {
  const norm = modelPath.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.startsWith("models--"));
  if (idx >= 0) return parts[idx]!;
  return path.basename(modelPath);
}

/**
 * Parse the HF hub org + repo name from any path containing a `models--org--repo`
 * segment (works for both Linux and UNC paths).
 */
function extractHfRepoParts(
  modelPath: string,
): { namespace: string; modelName: string } | null {
  const norm = modelPath.replace(/\\/g, "/");
  for (const seg of norm.split("/")) {
    if (!seg.startsWith("models--")) continue;
    const rest = seg.slice("models--".length);
    const idx = rest.indexOf("--");
    if (idx === -1) continue;
    const ns = rest.slice(0, idx);
    const name = rest.slice(idx + 2);
    if (ns && name) return { namespace: ns, modelName: name };
  }
  return null;
}

/**
 * Strip `/snapshots/<hash>` suffix from HF hub cache paths so all snapshots of the
 * same model collapse to one stable repo-dir path (deduplicates on upsert key).
 * Works on both Linux paths and Windows UNC paths.
 */
function normalizeToRepoDir(modelPath: string): string {
  const norm = modelPath.replace(/\\/g, "/").replace(/\/$/, "");
  const snapshotsIdx = norm.lastIndexOf("/snapshots/");
  if (snapshotsIdx === -1) return modelPath;
  const beforeSnapshots = norm.slice(0, snapshotsIdx);
  // Only strip for HF hub cache paths (models-- must appear before /snapshots/).
  // Strip everything from /snapshots/ onward regardless of nesting depth so models
  // with weight files in snapshot subdirectories also collapse to one repo-dir key.
  if (!beforeSnapshots.includes("/models--")) return modelPath;
  return modelPath.includes("\\")
    ? beforeSnapshots.replace(/\//g, "\\")
    : beforeSnapshots;
}

/**
 * For non-HF-cache paths, extract "namespace/modelname" from the last two path segments.
 * Our download always writes <vllmDir>/<namespace>/<modelname>, so this is the reliable source.
 * config.json _name_or_path often points to the base model's internal name, not the HF repo ID.
 */
function extractNamespacedTitleFromPath(modelPath: string): string | null {
  const norm = modelPath.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const modelName = parts[parts.length - 1]!;
  const namespace = parts[parts.length - 2]!;
  // Skip Windows drive letters and suspiciously short / purely-numeric segments
  if (namespace.includes(":") || namespace.length < 2 || /^\d+$/.test(namespace)) return null;
  return `${namespace}/${modelName}`;
}

async function buildModelMeta(
  modelPath: string,
  repoStyle: string,
): Promise<{ title: string; dtype: string | null; isMultimodal: boolean }> {
  const hf = extractHfRepoParts(modelPath);
  // Always try to read config.json (now looks inside snapshots/ too).
  // For HF hub paths the title is always derived from the path; dtype may come from config.json.
  const meta = await readConfigJsonMetaForModelDir(modelPath);
  if (hf) return { title: `${hf.namespace}/${hf.modelName}`, dtype: meta.dtype, isMultimodal: meta.isMultimodal };
  // For non-HF-cache paths prefer the folder structure (last two segments = namespace/modelname)
  // over config.json _name_or_path, which for fine-tuned models points to the base model name.
  const pathTitle = extractNamespacedTitleFromPath(modelPath);
  return { title: pathTitle ?? repoStyle, dtype: meta.dtype, isMultimodal: meta.isMultimodal };
}

/**
 * Walk each configured root. For `\\wsl$\\…` / `\\wsl.localhost\\…` on Windows,
 * **always** use WSL `find(1)` — the Windows 9P view is fundamentally unreliable
 * for symlink-heavy HF hub caches (existsSync/statSync/readdirSync can all lie).
 */
export async function scanVllmModelDirs(roots: string[]): Promise<VllmScanResult> {
  const warnings: string[] = [];
  if (!roots.some((x) => x.trim() !== "")) {
    warnings.push("Add at least one vLLM model directory in Settings → vLLM.");
  }
  for (const root of roots) {
    const raw = root.trim();
    if (!raw) continue;

    // For WSL UNC paths, skip resolveExistingVllmRoot entirely — never trust the
    // 9P layer. Go straight to WSL find, which works even when WSL is stopped
    // (wsl.exe auto-starts the distro).
    if (process.platform === "win32") {
      const parsedWsl = parseWslUncPath(raw);
      if (parsedWsl) {
        const wslRes = await findModelDirsLinuxTreeViaWsl(
          parsedWsl.distro,
          parsedWsl.linuxPath,
        );
        if (wslRes.ok && wslRes.paths.length > 0) {
          for (const linux of wslRes.paths) {
            const normalizedLinux = normalizeToRepoDir(linux);
            const modelPath = storedPathFromWslFindResult(wslRes.uncDistro, normalizedLinux);
            const repoStyle = extractRepoFolderName(modelPath);
            const { title, dtype, isMultimodal } = await buildModelMeta(modelPath, repoStyle);
            const m = upsertVllmModelByPath(modelPath, title, dtype, isMultimodal);
            ensureDefaultVllmProfile(m.id);
          }
          continue;
        }
        // WSL find ran but found nothing — or failed.
        if (!wslRes.ok) {
          // Silently skip when the directory simply doesn't exist yet (new user UX;
          // the first download will create it automatically).
          if (!wslRes.dirNotFound) warnings.push(`${wslRes.error}`);
        } else {
          warnings.push(
            `No safetensors / config.json found under ${raw}. HF hub caches only list models with weight files (GGUF-only repos are skipped).`,
          );
        }
        continue;
      }
    }

    // Non-WSL path: use the native file API with existence fallback.
    const r = resolveExistingVllmRoot(raw);
    if (!r) {
      // Silently skip paths that simply don't exist yet (new user UX; dir created on first download).
      // Only call existsSync for non-UNC paths to avoid 9P stalls.
      const t = normalizeRoot(raw);
      if (!t.startsWith("\\\\")) {
        try {
          if (!existsSync(t)) continue;
        } catch { /* fall through to warning */ }
      }
      warnings.push(
        `Cannot read vLLM directory. Try \\\\wsl$\\… or \\\\wsl.localhost\\… (your distro name must match): ${raw}`,
      );
      continue;
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(r);
    } catch (e) {
      warnings.push(
        `Cannot stat vLLM directory: ${r} — ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    if (!st.isDirectory()) {
      warnings.push(`Not a directory: ${r}`);
      continue;
    }

    let paths: string[];
    try {
      paths = findModelDirsInTree(r, 0);
    } catch (e) {
      warnings.push(
        `Scan failed under ${r}: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    if (paths.length === 0) {
      warnings.push(
        `No safetensors / config.json found under ${r}. HF hub caches only list models with weight files (GGUF-only repos are skipped).`,
      );
      continue;
    }
    for (const rawPath of paths) {
      const modelPath = normalizeToRepoDir(rawPath);
      const repoStyle = extractRepoFolderName(modelPath);
      const { title, dtype, isMultimodal } = await buildModelMeta(modelPath, repoStyle);
      const m = upsertVllmModelByPath(modelPath, title, dtype, isMultimodal);
      ensureDefaultVllmProfile(m.id);
    }
  }
  return { models: listVllmModels(), warnings };
}
