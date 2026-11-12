import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { createWriteStream } from "fs";
import { unlink } from "fs/promises";
import { mkdirSafe, mkdirSafeSync } from "../utils/wslPath";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import type {
  HfDownloadMeta,
  HfIncompleteDownloadInfo,
  HfModelListSort,
  HfModelSearchPage,
  HfModelSummary,
  HfRepoFileInfo,
  HfRepoGgufFile,
  HfRepoSafetensorFile,
  HfRepoVllmModel,
} from "@shared/types";

const HF_API = "https://huggingface.co/api";

const HUB_FETCH_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "ModelBox/1.0 (Electron; https://huggingface.co)",
};

const HUB_RAW_HEADERS: Record<string, string> = {
  Accept: "text/plain, text/markdown; q=0.9, */*; q=0.8",
  "User-Agent": "ModelBox/1.0 (Electron; https://huggingface.co)",
};

let _hubToken: string | null = null;
export function setHubToken(token: string | null): void {
  _hubToken = token;
}
function authHeaders(): Record<string, string> {
  return _hubToken ? { Authorization: `Bearer ${_hubToken}` } : {};
}

const README_MAX_CHARS = 500_000;

const REPO_ID_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
/** Hub namespace (user or org slug) — same rules as each segment of a repo id. */
const PUBLISHER_RE = /^[a-zA-Z0-9_.-]+$/;

const publisherAvatarCache = new Map<string, string | null>();

/** Hub expects `/api/models/{namespace}/{repo}`, not a single segment with `%2F`. */
function apiModelsPath(repoId: string): string {
  return repoId.split("/").map(encodeURIComponent).join("/");
}

export function assertValidRepoId(repoId: string): void {
  if (!repoId || !REPO_ID_RE.test(repoId)) {
    throw new Error("Invalid model id");
  }
}

/**
 * Resolve profile image URL for a Hub namespace (repo id prefix before `/`).
 * Tries user account first, then organization.
 */
export async function resolvePublisherAvatarUrl(
  publisher: string,
): Promise<string | null> {
  const p = publisher.trim();
  if (!p || !PUBLISHER_RE.test(p)) {
    return null;
  }
  const cached = publisherAvatarCache.get(p);
  if (cached !== undefined) {
    return cached;
  }

  const enc = encodeURIComponent(p);
  const candidates = [
    `${HF_API}/users/${enc}/avatar`,
    `${HF_API}/organizations/${enc}/avatar`,
  ];

  let resolved: string | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: HUB_FETCH_HEADERS });
      if (!res.ok) {
        continue;
      }
      const data = (await res.json()) as { avatarUrl?: unknown };
      const u = data.avatarUrl;
      if (typeof u === "string" && u.startsWith("https://")) {
        resolved = u;
        break;
      }
    } catch {
      /* ignore */
    }
  }

  publisherAvatarCache.set(p, resolved);
  return resolved;
}

/** Resolve multiple publisher avatars concurrently, returning a slug→url map. */
export async function resolvePublisherAvatarUrlBatch(
  publishers: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const toFetch: string[] = [];
  for (const raw of publishers) {
    const p = raw.trim();
    if (!p || !PUBLISHER_RE.test(p)) continue;
    if (publisherAvatarCache.has(p)) {
      out[p] = publisherAvatarCache.get(p)!;
    } else {
      toFetch.push(p);
    }
  }
  await Promise.all(
    toFetch.map(async (p) => {
      out[p] = await resolvePublisherAvatarUrl(p);
    }),
  );
  return out;
}

/**
 * Fetch README.md from the default branch (main, then master).
 */
export async function fetchRepoReadme(repoId: string): Promise<{
  markdown: string | null;
  error: string | null;
}> {
  assertValidRepoId(repoId);
  const parts = repoId.split("/").filter((s) => s.length > 0);
  if (parts.length !== 2) {
    return { markdown: null, error: "Invalid model id" };
  }
  const [ns, name] = parts;
  const branches = ["main", "master"];
  for (const branch of branches) {
    const url = `https://huggingface.co/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/raw/${encodeURIComponent(branch)}/README.md`;
    try {
      const res = await fetch(url, { headers: { ...HUB_RAW_HEADERS, ...authHeaders() } });
      if (!res.ok) {
        continue;
      }
      const text = await res.text();
      if (typeof text !== "string" || text.length === 0) {
        continue;
      }
      const clipped =
        text.length > README_MAX_CHARS
          ? `${text.slice(0, README_MAX_CHARS)}\n\n_(truncated)_`
          : text;
      return { markdown: clipped, error: null };
    } catch {
      /* try next branch */
    }
  }
  return { markdown: null, error: "README not found" };
}

function sanitizeHubFolderSegment(seg: string): string {
  let name = seg.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  name = name.replace(/\.+$/g, "").trim();
  if (!name || name === "." || name === "..") {
    throw new Error("Invalid repository folder segment");
  }
  return name;
}

/**
 * Nested folders under the models root: `namespace/repo` → `[namespace, repo]`
 * (mirrors Hugging Face repo id, Windows-safe per segment).
 */
export function modelsRepoPathSegments(repoId: string): string[] {
  assertValidRepoId(repoId);
  const parts = repoId.split("/").filter((s) => s.length > 0);
  if (parts.length !== 2) {
    throw new Error("Invalid model id");
  }
  return parts.map((seg) => sanitizeHubFolderSegment(seg));
}

/**
 * Derive the per-quant subfolder name from the list of hub filenames being downloaded together.
 *
 * - Single file `Qwen3-0.8B-Q4_K_M.gguf` → `Qwen3-0.8B-Q4_K_M`
 * - Shard bundle `model-00001-of-00003.gguf` … → `model` (common prefix)
 */
/**
 * Per-quant download folder stem. Multimodal projector filenames often add a
 * `-mmproj-…` segment after the weight stem; without this, mmproj lands in a
 * sibling folder and the library never marks the model multimodal.
 */
export function weightBundleFolderStemFromHubFilename(stem: string): string {
  const t = stem.trim();
  if (!t || t === "." || t === "..") return "model";
  if (!/mmproj/i.test(t)) return t;
  const idx = t.search(/[-_]mmproj/i);
  if (idx > 0) {
    const base = t.slice(0, idx).replace(/[-_]+$/g, "");
    if (base.length >= 3) return base;
  }
  const prefix = t.match(/^mmproj[-_]?(.+)$/i);
  if (prefix?.[1]) {
    const rest = prefix[1].replace(/^[-_]+|[-_]+$/g, "");
    if (rest.length >= 3) return rest;
  }
  return t;
}

export function deriveFolderName(
  hubFilenames: string[],
  repoId?: string,
): string {
  const first = basename(hubFilenames[0] ?? "unknown");
  const isMmprojFile = /mmproj/i.test(first);
  const repoName =
    repoId != null ? repoId.split("/").filter((s) => s.length > 0)[1] : null;

  if (hubFilenames.length > 1) {
    const m = first.match(/^(.+)-\d+-of-\d+\.gguf$/i);
    if (m?.[1]) {
      const stem = m[1].trim();
      if (stem && stem !== "." && stem !== "..") {
        const bundleStem = weightBundleFolderStemFromHubFilename(stem);
        if (isMmprojFile && repoName) return repoName;
        if (repoName) return `${repoName}/${bundleStem}`;
        return bundleStem;
      }
    }
  }

  const stem = first.replace(/\.gguf$/i, "").trim();
  if (isMmprojFile && repoName) return repoName;
  const weightStem = weightBundleFolderStemFromHubFilename(stem);
  if (!isMmprojFile && repoName) return `${repoName}/${weightStem}`;
  return weightStem || "model";
}

/** Check whether a single file's basename exists in a given directory. */
function filePresentInDir(filename: string, dir: string): boolean {
  return existsSync(join(dir, basename(filename)));
}

/** Broad fallback: find a GGUF file by basename anywhere under `namespace/`.
 * Handles layouts we can't predict (e.g. files downloaded by older code). */
function findGgufByBasename(namespaceDir: string, targetName: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(namespaceDir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const entryPath = join(namespaceDir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(entryPath).isDirectory();
    } catch { continue; }
    if (!isDir) continue;
    // Check directly in this folder
    if (existsSync(join(entryPath, targetName))) return true;
    // Check one level deeper (subfolders like quant stems)
    let subEntries: string[];
    try {
      subEntries = readdirSync(entryPath);
    } catch { continue; }
    for (const sub of subEntries) {
      const subPath = join(entryPath, sub);
      try {
        if (statSync(subPath).isDirectory()) {
          if (existsSync(join(subPath, targetName))) return true;
        }
      } catch { continue; }
    }
  }
  return false;
}

/**
 * True if every Hub file in the bundle already exists on disk.
 * Separates mmproj and weight files since they live in different folders.
 * Checks multiple layouts for backward compatibility:
 * 1. Nested: weights in `namespace/repo/stem/`, mmproj in `namespace/repo/`
 * 2. Old flat: all in `namespace/stem/`
 * 3. Old repo: all in `namespace/repo/...path`
 * 4. Fallback: search by basename under namespace/ (catches unknown layouts)
 */
export function ggufBundleFullyPresent(
  modelsDir: string,
  repoId: string,
  hubFilenames: string[],
): boolean {
  if (hubFilenames.length === 0) return false;
  let repoSegs: string[];
  try {
    repoSegs = modelsRepoPathSegments(repoId);
  } catch {
    return false;
  }
  const root = modelsDir.trim();
  if (!root) return false;
  const [namespace] = repoSegs;
  if (!namespace) return false;

  // Validate all filenames up-front (path traversal only).
  const segsList: string[][] = [];
  for (const fn of hubFilenames) {
    const segs = safePathSegments(fn);
    if (!segs) return false;
    segsList.push(segs);
  }

  // Separate mmproj and weight files — they live in different folders.
  const weightFiles = hubFilenames.filter((n) => !/mmproj/i.test(basename(n)));
  const mmprojFiles = hubFilenames.filter((n) => /mmproj/i.test(basename(n)));

  // Derive per-type folder names for the nested layout.
  const weightFolder = weightFiles.length > 0
    ? deriveFolderName(weightFiles, repoId)
    : null;
  const mmprojFolder = mmprojFiles.length > 0
    ? deriveFolderName(mmprojFiles, repoId)
    : null;

  // Layout 1: Nested — each type checked in its own folder.
  const nestedOk = (
    weightFolder
      ? weightFiles.every((f) => filePresentInDir(f, join(root, namespace, weightFolder)))
      : true
  ) && (
    mmprojFolder
      ? mmprojFiles.every((f) => filePresentInDir(f, join(root, namespace, mmprojFolder)))
      : true
  );
  if (nestedOk) return true;

  // Layout 2 + 3: Old layouts (all files in one folder).
  // Only applicable when there are weight files (mmproj-only bundles use nested).
  if (weightFiles.length > 0) {
    const oldStem = weightBundleFolderStemFromHubFilename(
      basename(weightFiles[0]!, "").replace(/\.gguf$/i, ""),
    );
    const allFlatPresent = segsList.every((segs) => {
      return existsSync(join(root, namespace, oldStem, segs[segs.length - 1]!));
    });
    if (allFlatPresent) return true;

    // Layout 3: Old repo layout — namespace/repoName/...path
    return segsList.every((segs) => existsSync(join(root, ...repoSegs, ...segs)));
  }

  // Layout 4: Broad fallback for weight files only — search by basename under namespace/.
  // Catches weight files downloaded by older code in unexpected layouts.
  // Skip this for mmproj files (generic names like mmproj-BF16.gguf would match
  // unrelated repos under the same namespace).
  if (weightFiles.length > 0 && mmprojFiles.length === 0) {
    const nsDir = join(root, namespace);
    return weightFiles.every((f) => findGgufByBasename(nsDir, basename(f)));
  }

  return false;
}

/** Check if an mmproj exists in a sibling folder matching this weight file's base name.
 * e.g. weight in "gemma-4-E2B-it-UD-IQ2_M" finds mmproj in "gemma-4-E2B-it" (prefix match).
 * Does NOT match unrelated models like Qwen3.6-27B or gemma-4-E4B-it. */
export function relatedMmprojExists(
  weightFolder: string,
  _modelsDirs: string[],
): boolean {
  // Find which namespace parent this weight folder belongs to
  const weightStem = basename(weightFolder).toLowerCase();
  const nsParent = dirname(dirname(weightFolder));

  let entries: string[];
  try {
    entries = readdirSync(nsParent);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry === basename(weightFolder)) continue;
    // Only consider siblings whose name the weight folder starts with
    if (!weightStem.startsWith(entry.toLowerCase())) continue;
    const sibPath = join(nsParent, entry);
    let isDir: boolean;
    try {
      isDir = statSync(sibPath).isDirectory();
    } catch { continue; }
    if (!isDir) continue;
    try {
      const files = readdirSync(sibPath);
      if (files.some((f) => /mmproj/i.test(f))) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Repo-level: check if any mmproj exists for any model folder sharing this repo's base name.
 * Handles both layouts:
 * - Nested: mmproj in `namespace/repoName/`, weights in `namespace/repoName/stem/`
 * - Flat: mmproj in `namespace/stem/` (prefix-matched sibling) */
export function relatedMmprojExistsForRepo(
  repoId: string,
  modelsDirs: string[],
): boolean {
  let repoSegs: string[];
  try {
    repoSegs = modelsRepoPathSegments(repoId);
  } catch {
    return false;
  }
  const namespace = repoSegs[0];
  if (!namespace) return false;
  const repoName = repoSegs[1];
  if (!repoName) return false;

  for (const root of modelsDirs) {
    const nsDir = join(root, namespace);
    let entries: string[];
    try {
      entries = readdirSync(nsDir);
    } catch {
      continue;
    }
    const folders: { name: string; path: string; hasMmproj: boolean }[] = [];
    for (const entry of entries) {
      const entryPath = join(nsDir, entry);
      let isDir: boolean;
      try {
        isDir = statSync(entryPath).isDirectory();
      } catch { continue; }
      if (!isDir) continue;
      let hasMmproj = false;
      try {
        const files = readdirSync(entryPath);
        hasMmproj = files.some((f) => /mmproj/i.test(f));
      } catch { /* skip */ }
      folders.push({ name: entry, path: entryPath, hasMmproj });
    }

    // Check 1: mmproj lives directly in the repo folder — vision is installed.
    const repoFolder = folders.find((f) => f.name === repoName);
    if (repoFolder?.hasMmproj) {
      return true;
    }

    // Check 2: Flat layout — any sibling folder whose name starts with this repo's
    // base name (suffix -GGUF/-vLLM stripped) contains an mmproj.
    // e.g. repo `gemma-4-E4B-it-GGUF` → base `gemma-4-e4b-it` → matches sibling
    // `gemma-4-E4B-it-Q4_K_M/` or stem folder `gemma-4-E4B-it/`, both of which
    // may hold the shared mmproj for any quant of that model.
    // Scoped to the repo base so unrelated siblings (gemma-4-E4B-it-GGUF vs
    // Qwen3-VL-*) never produce false positives.
    const repoBase = repoName.replace(/[-_]?(gguf|vllm)$/i, "").toLowerCase();
    for (const folder of folders) {
      if (!folder.hasMmproj) continue;
      if (folder.name.toLowerCase().startsWith(repoBase)) {
        return true;
      }
    }
  }
  return false;
}

/** Path traversal check only — no extension constraint. Used for read-only presence checks. */
function safePathSegments(rfilename: string): string[] | null {
  if (!rfilename || rfilename.includes("\\")) return null;
  const segs = rfilename.split("/").filter((s) => s.length > 0);
  if (segs.length === 0) return null;
  for (const s of segs) {
    if (s === "." || s === ".." || s.includes("\0")) return null;
  }
  return segs;
}

/**
 * Valid repo-relative path segments; mirrors Hub `rfilename` / tree `path`.
 * @param allowedExts - extensions to accept (default: [".gguf"]). Pass e.g.
 *   [".safetensors", ".json", ".model"] for vLLM downloads.
 */
export function assertSafeRepoRelPath(
  rfilename: string,
  allowedExts?: string[],
): string[] {
  if (!rfilename || rfilename.includes("\\")) {
    throw new Error("Invalid repository file path");
  }
  const segments = rfilename.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("Invalid path");
  }
  for (const seg of segments) {
    if (seg === "." || seg === ".." || seg.includes("\0")) {
      throw new Error("Invalid path segment");
    }
  }
  const last = segments[segments.length - 1]!.toLowerCase();
  const exts = allowedExts ?? [".gguf"];
  if (!exts.some((e) => last.endsWith(e))) {
    throw new Error("Not a GGUF file");
  }
  return segments;
}

const MLX_ID_RE = /\bmlx\b/i;

/**
 * Returns true for models that are not vLLM-compatible:
 * - GGUF-format repos (`library_name: "gguf"` or "gguf" tag)
 * - MLX repos: detected via `library_name`, tags starting with "mlx",
 *   OR "mlx" as a word in the model ID (namespace or repo name) — catches repos
 *   like `mlx-community/...` or `unsloth/gemma-MLX-4bit` that omit the library tag.
 */
function isVllmIncompatibleModel(id: string, r: Record<string, unknown>): boolean {
  if (MLX_ID_RE.test(id)) return true;
  const lib = typeof r.library_name === "string" ? r.library_name.toLowerCase() : "";
  if (lib === "gguf" || lib.startsWith("mlx")) return true;
  const tags = Array.isArray(r.tags) ? r.tags : [];
  return tags.some((t) => {
    const tl = typeof t === "string" ? t.toLowerCase() : "";
    return tl === "gguf" || tl.startsWith("mlx");
  });
}

function parseModelsSearchJson(
  data: unknown,
  excludeModel?: (id: string, r: Record<string, unknown>) => boolean,
): HfModelSummary[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: HfModelSummary[] = [];
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const id =
      typeof r.id === "string"
        ? r.id
        : typeof r.modelId === "string"
          ? r.modelId
          : "";
    if (!id.includes("/")) {
      continue;
    }
    if (excludeModel?.(id, r)) continue;
    out.push({
      id,
      downloads: typeof r.downloads === "number" ? r.downloads : undefined,
      likes: typeof r.likes === "number" ? r.likes : undefined,
      lastModified: typeof r.lastModified === "string" ? r.lastModified : undefined,
    });
  }
  return out;
}

/** Only allow chaining Hub pagination URLs (SSRF-safe). */
function assertSafeHfModelsListUrl(cursorUrl: string): string {
  let u: URL;
  try {
    u = new URL(cursorUrl);
  } catch {
    throw new Error("Invalid pagination URL");
  }
  if (u.protocol !== "https:" || u.hostname !== "huggingface.co") {
    throw new Error("Invalid pagination URL");
  }
  if (u.pathname !== "/api/models") {
    throw new Error("Invalid pagination URL");
  }
  return u.href;
}

function hubModelsSortField(listSort: HfModelListSort): string {
  /** `likes7d` matches Hub “trending” style (recent engagement); `downloads` is all-time pulls. */
  return listSort === "downloads" ? "downloads" : "likes7d";
}

/**
 * Search GGUF-tagged models; pass `cursorUrl` from a previous page’s `nextCursorUrl`
 * to fetch the next slice (Hub `Link` header).
 */
export async function searchGgufModelsPage(
  query: string,
  limit: number,
  cursorUrl: string | null,
  listSort: HfModelListSort = "trending",
): Promise<HfModelSearchPage> {
  const lim = Math.min(Math.max(limit, 1), 50);
  const url =
    cursorUrl != null && cursorUrl.length > 0
      ? assertSafeHfModelsListUrl(cursorUrl)
      : (() => {
          const q = query.trim() || "gguf";
          const params = new URLSearchParams({
            search: q,
            filter: "gguf",
            limit: String(lim),
            sort: hubModelsSortField(listSort),
            direction: "-1",
            full: "true",
          });
          return `${HF_API}/models?${params}`;
        })();

  const res = await fetch(url, {
    headers: HUB_FETCH_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`Hugging Face search failed (${res.status})`);
  }
  const data = (await res.json()) as unknown;
  const models = parseModelsSearchJson(data);
  const rawNext = nextUrlFromLinkHeader(res.headers.get("link"));
  let nextCursorUrl: string | null = null;
  if (rawNext) {
    try {
      nextCursorUrl = assertSafeHfModelsListUrl(rawNext);
    } catch {
      nextCursorUrl = null;
    }
  }
  if (models.length === 0) {
    nextCursorUrl = null;
  }
  return { models, nextCursorUrl };
}

/**
 * Search safetensor-tagged models (vLLM / PyTorch weight dirs).
 * Filters out GGUF-only repos (`library_name: "gguf"`) and MLX repos
 * (`library_name: "mlx"`) which are incompatible with vLLM.
 */
export async function searchSafetensorModelsPage(
  query: string,
  limit: number,
  cursorUrl: string | null,
  listSort: HfModelListSort = "trending",
): Promise<HfModelSearchPage> {
  const lim = Math.min(Math.max(limit, 1), 50);
  const url =
    cursorUrl != null && cursorUrl.length > 0
      ? assertSafeHfModelsListUrl(cursorUrl)
      : (() => {
          const q = query.trim();
          const params = new URLSearchParams({
            filter: "safetensors",
            limit: String(lim),
            sort: hubModelsSortField(listSort),
            direction: "-1",
            full: "true",
          });
          if (q) params.set("search", q);
          return `${HF_API}/models?${params}`;
        })();

  const res = await fetch(url, {
    headers: HUB_FETCH_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`Hugging Face search failed (${res.status})`);
  }
  const data = (await res.json()) as unknown;
  const models = parseModelsSearchJson(data, isVllmIncompatibleModel);
  const rawNext = nextUrlFromLinkHeader(res.headers.get("link"));
  let nextCursorUrl: string | null = null;
  if (rawNext) {
    try {
      nextCursorUrl = assertSafeHfModelsListUrl(rawNext);
    } catch {
      nextCursorUrl = null;
    }
  }
  if (models.length === 0) {
    nextCursorUrl = null;
  }
  return { models, nextCursorUrl };
}

function readPositiveSize(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}

function treeEntrySize(e: Record<string, unknown>): number {
  const lfs = e.lfs;
  if (lfs && typeof lfs === "object") {
    const ls = readPositiveSize((lfs as Record<string, unknown>).size);
    if (ls != null) {
      return ls;
    }
  }
  const s = readPositiveSize(e.size);
  if (s != null) {
    return s;
  }
  return 0;
}

/** Hub usually sends `type: "file"` but some entries omit it; only skip explicit directories. */
function isTreeFileEntry(e: Record<string, unknown>): boolean {
  if (typeof e.path !== "string" || e.path.length === 0) {
    return false;
  }
  const t = e.type;
  if (typeof t === "string" && t.toLowerCase() === "directory") {
    return false;
  }
  return true;
}

function normalizeHubPath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

/** e.g. `…/foo-00001-of-00002.gguf` → group key + shard index / total */
function parseGgufShard(path: string): {
  groupKey: string;
  idx: number;
  total: number;
} | null {
  const norm = normalizeHubPath(path);
  const d = dirname(norm);
  const base = basename(norm);
  const m = base.match(/^(.+)-(\d+)-of-(\d+)\.gguf$/i);
  if (!m) {
    return null;
  }
  const idx = parseInt(m[2], 10);
  const total = parseInt(m[3], 10);
  if (
    !Number.isFinite(idx) ||
    !Number.isFinite(total) ||
    total < 2 ||
    idx < 1 ||
    idx > total
  ) {
    return null;
  }
  const prefix = m[1];
  const dirKey = d === "." ? "" : d;
  const groupKey = `${dirKey}::${prefix}::${total}`;
  return { groupKey, idx, total };
}

/** Merge `*-00001-of-00002.gguf` … `*-00002-of-00002.gguf` into one row (combined size, ordered paths). */
function coalesceGgufShards(files: HfRepoGgufFile[]): HfRepoGgufFile[] {
  type Part = HfRepoGgufFile & { idx: number; total: number; groupKey: string };
  const parts: Part[] = [];
  const singles: HfRepoGgufFile[] = [];

  for (const f of files) {
    const s = parseGgufShard(f.path);
    if (!s) {
      singles.push(f);
      continue;
    }
    parts.push({
      ...f,
      idx: s.idx,
      total: s.total,
      groupKey: s.groupKey,
    });
  }

  const byGroup = new Map<string, Part[]>();
  for (const p of parts) {
    if (!byGroup.has(p.groupKey)) {
      byGroup.set(p.groupKey, []);
    }
    byGroup.get(p.groupKey)!.push(p);
  }

  const coalesced: HfRepoGgufFile[] = [];
  for (const [, group] of byGroup) {
    const expected = group[0].total;
    const byIdx = new Map<number, Part>();
    for (const p of group) {
      if (p.total === expected) {
        byIdx.set(p.idx, p);
      }
    }
    let complete = byIdx.size === expected;
    if (complete) {
      for (let i = 1; i <= expected; i++) {
        if (!byIdx.has(i)) {
          complete = false;
          break;
        }
      }
    }
    if (!complete) {
      for (const p of group) {
        singles.push({ path: p.path, size: p.size, isMmproj: p.isMmproj });
      }
      continue;
    }
    const ordered: Part[] = [];
    for (let i = 1; i <= expected; i++) {
      ordered.push(byIdx.get(i)!);
    }
    const sum = ordered.reduce((a, p) => a + p.size, 0);
    const first = ordered[0]!;
    const dir = dirname(first.path);
    const bm = basename(first.path).match(/^(.+)-\d+-of-\d+\.gguf$/i);
    const stem = bm ? bm[1] : basename(first.path);
    const displayPath = dir === "." || dir === "" ? stem : `${dir}/${stem}`;
    coalesced.push({
      path: displayPath,
      size: sum,
      isMmproj: ordered.some((p) => p.isMmproj),
      shardParts: ordered.map((p) => p.path),
      shardSizes: ordered.map((p) => p.size),
    });
  }

  const merged = [...singles, ...coalesced];
  merged.sort((a, b) => {
    if (a.isMmproj !== b.isMmproj) {
      return a.isMmproj ? -1 : 1;
    }
    if (a.size !== b.size) {
      return a.size - b.size;
    }
    return a.path.localeCompare(b.path);
  });
  return merged;
}

function normalizeTreeChunk(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is Record<string, unknown> => x != null && typeof x === "object",
    );
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const nested = o.items ?? o.entries ?? o.files ?? o.data;
    if (Array.isArray(nested)) {
      return nested.filter(
        (x): x is Record<string, unknown> => x != null && typeof x === "object",
      );
    }
  }
  return [];
}

/**
 * Parse `Link: <url>; rel="next"` without splitting on commas (cursor URLs may contain commas).
 * Resolve relative URLs against huggingface.co (Node fetch requires an absolute URL).
 */
function nextUrlFromLinkHeader(link: string | null): string | null {
  if (!link) {
    return null;
  }
  const re = /<([^>]+)>\s*;\s*rel\s*=\s*["']?next["']?/gi;
  const m = re.exec(link);
  if (!m?.[1]) {
    return null;
  }
  const href = m[1].trim();
  try {
    return new URL(href, "https://huggingface.co").href;
  } catch {
    return null;
  }
}

async function fetchPagedTree(
  base: string,
  rev: string,
): Promise<Record<string, unknown>[]> {
  let url: string | null =
    `${HF_API}/models/${base}/tree/${encodeURIComponent(rev)}?recursive=true`;
  const out: Record<string, unknown>[] = [];
  let pages = 0;
  while (url != null && pages < 48) {
    pages += 1;
    const res = await fetch(url, { headers: { ...HUB_FETCH_HEADERS, ...authHeaders() } });
    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? "Access denied — accept this model's license on huggingface.co first, then retry"
          : res.status === 401
            ? "Unauthorized — add a HuggingFace access token in Settings to access this gated model"
            : `Could not list files (${res.status})`,
      );
    }
    const raw = (await res.json()) as unknown;
    out.push(...normalizeTreeChunk(raw));
    url = nextUrlFromLinkHeader(res.headers.get("link"));
  }
  return out;
}

export async function listGgufFiles(repoId: string): Promise<HfRepoGgufFile[]> {
  assertValidRepoId(repoId);
  const base = apiModelsPath(repoId);
  const infoRes = await fetch(`${HF_API}/models/${base}`, {
    headers: { ...HUB_FETCH_HEADERS, ...authHeaders() },
  });
  if (!infoRes.ok) {
    throw new Error(
      infoRes.status === 401 || infoRes.status === 403
        ? infoRes.status === 403
          ? "Access denied — accept this model's license on huggingface.co first, then retry"
          : "Unauthorized — add a HuggingFace access token in Settings to access this gated model"
        : `Model not found or inaccessible (${infoRes.status})`,
    );
  }
  const info = (await infoRes.json()) as { sha?: unknown };
  const shaStr =
    typeof info.sha === "string" && /^[0-9a-f]{7,40}$/i.test(info.sha.trim())
      ? info.sha.trim()
      : null;

  const revAttempts = ["main", ...(shaStr ? [shaStr] : []), "master"];

  let rows: Record<string, unknown>[] = [];
  let lastErr: Error | null = null;
  for (const rev of revAttempts) {
    try {
      rows = await fetchPagedTree(base, rev);
      lastErr = null;
      if (rows.length > 0) {
        break;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      rows = [];
    }
  }
  if (lastErr != null && rows.length === 0) {
    throw lastErr;
  }

  const flat: HfRepoGgufFile[] = [];
  const seenPaths = new Set<string>();
  for (const e of rows) {
    if (!isTreeFileEntry(e)) {
      continue;
    }
    const rawPath = e.path;
    if (typeof rawPath !== "string") {
      continue;
    }
    const path = normalizeHubPath(rawPath);
    if (!path || path.includes("\\")) {
      continue;
    }
    if (!path.toLowerCase().endsWith(".gguf")) {
      continue;
    }
    if (seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    flat.push({
      path,
      size: treeEntrySize(e),
      isMmproj: /mmproj/i.test(basename(path)),
    });
  }
  return coalesceGgufShards(flat);
}

export async function listSafetensorFiles(
  repoId: string,
): Promise<HfRepoSafetensorFile[]> {
  assertValidRepoId(repoId);
  const base = apiModelsPath(repoId);
  const infoRes = await fetch(`${HF_API}/models/${base}`, {
    headers: { ...HUB_FETCH_HEADERS, ...authHeaders() },
  });
  if (!infoRes.ok) {
    throw new Error(
      infoRes.status === 401 || infoRes.status === 403
        ? infoRes.status === 403
          ? "Access denied — accept this model's license on huggingface.co first, then retry"
          : "Unauthorized — add a HuggingFace access token in Settings to access this gated model"
        : `Model not found or inaccessible (${infoRes.status})`,
    );
  }
  const info = (await infoRes.json()) as { sha?: unknown };
  const shaStr =
    typeof info.sha === "string" && /^[0-9a-f]{7,40}$/i.test(info.sha.trim())
      ? info.sha.trim()
      : null;

  const revAttempts = ["main", ...(shaStr ? [shaStr] : []), "master"];

  let rows: Record<string, unknown>[] = [];
  let lastErr: Error | null = null;
  for (const rev of revAttempts) {
    try {
      rows = await fetchPagedTree(base, rev);
      lastErr = null;
      if (rows.length > 0) {
        break;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      rows = [];
    }
  }
  if (lastErr != null && rows.length === 0) {
    throw lastErr;
  }

  const out: HfRepoSafetensorFile[] = [];
  const seen = new Set<string>();
  for (const e of rows) {
    if (!isTreeFileEntry(e)) {
      continue;
    }
    const rawPath = e.path;
    if (typeof rawPath !== "string") {
      continue;
    }
    const path = normalizeHubPath(rawPath);
    if (!path || path.includes("\\") || seen.has(path)) {
      continue;
    }
    const baseName = basename(path);
    const lower = path.toLowerCase();
    let kind: HfRepoSafetensorFile["kind"] = "other";
    if (lower.endsWith(".safetensors")) {
      kind = "weight";
    } else if (baseName === "config.json") {
      kind = "config";
    } else if (
      /tokenizer/i.test(baseName) &&
      (lower.endsWith(".json") || lower.endsWith(".model"))
    ) {
      kind = "tokenizer";
    } else {
      continue;
    }
    seen.add(path);
    out.push({
      path,
      size: treeEntrySize(e),
      kind,
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Parse a safetensor shard path like `model-00001-of-00008.safetensors`. Returns null for single-file models. */
function parseSafetensorShard(path: string): {
  groupKey: string;
  idx: number;
  total: number;
} | null {
  const norm = normalizeHubPath(path);
  const d = dirname(norm);
  const base = basename(norm);
  const m = base.match(/^(.+)\.safetensors$/);
  if (!m) return null;
  const stem = m[1];
  const shardMatch = stem.match(/^(.+)-(\d+)-of-(\d+)$/i);
  if (!shardMatch) return null;
  const idx = parseInt(shardMatch[2], 10);
  const total = parseInt(shardMatch[3], 10);
  if (
    !Number.isFinite(idx) ||
    !Number.isFinite(total) ||
    total < 2 ||
    idx < 1 ||
    idx > total
  ) {
    return null;
  }
  const prefix = shardMatch[1];
  const dirKey = d === "." ? "" : d;
  const groupKey = `${dirKey}::${prefix}::${total}`;
  return { groupKey, idx, total };
}

/** Parse prefix-numbered shards like `layers-0.safetensors`, `layers-1.safetensors`. */
function parsePrefixNumberedShard(path: string): {
  groupKey: string;
  idx: number;
  prefix: string;
  dir: string;
} | null {
  const norm = normalizeHubPath(path);
  const d = dirname(norm);
  const base = basename(norm);
  const m = base.match(/^(.+)-(\d+)\.safetensors$/i);
  if (!m) return null;
  const idx = parseInt(m[2], 10);
  if (!Number.isFinite(idx)) return null;
  const prefix = m[1];
  const dirKey = d === "." ? "" : d;
  const groupKey = `${dirKey}::${prefix}`;
  return { groupKey, idx, prefix, dir: d };
}

/** Coalesce safetensor shards into model bundles, each with config/tokenizer aux files. */
function coalesceSafetensorModels(
  files: HfRepoSafetensorFile[],
): HfRepoVllmModel[] {
  const weights = files.filter((f) => f.kind === "weight");
  const auxFiles = files.filter((f) => f.kind !== "weight");

  type Part = {
    path: string;
    size: number;
    idx: number;
    total: number;
    groupKey: string;
    dir: string;
  };
  const parts: Part[] = [];
  const singles: HfRepoVllmModel[] = [];

  // First pass: group standard -NNNNN-of-NNNNN shards
  for (const f of weights) {
    const s = parseSafetensorShard(f.path);
    if (!s) {
      singles.push({
        displayName: basename(f.path),
        safetensorPaths: [f.path],
        safetensorSizes: [f.size],
        totalSize: f.size,
        auxPaths: [],
      });
      continue;
    }
    parts.push({
      path: f.path,
      size: f.size,
      idx: s.idx,
      total: s.total,
      groupKey: s.groupKey,
      dir: dirname(f.path),
    });
  }

  const byGroup = new Map<string, Part[]>();
  for (const p of parts) {
    if (!byGroup.has(p.groupKey)) {
      byGroup.set(p.groupKey, []);
    }
    byGroup.get(p.groupKey)!.push(p);
  }

  const coalesced: HfRepoVllmModel[] = [];
  for (const [, group] of byGroup) {
    const expected = group[0].total;
    const byIdx = new Map<number, Part>();
    for (const p of group) {
      if (p.total === expected) {
        byIdx.set(p.idx, p);
      }
    }
    let complete = byIdx.size === expected;
    if (complete) {
      for (let i = 1; i <= expected; i++) {
        if (!byIdx.has(i)) {
          complete = false;
          break;
        }
      }
    }
    if (!complete) {
      for (const p of group) {
        singles.push({
          displayName: basename(p.path),
          safetensorPaths: [p.path],
          safetensorSizes: [p.size],
          totalSize: p.size,
          auxPaths: [],
        });
      }
      continue;
    }
    const ordered: Part[] = [];
    for (let i = 1; i <= expected; i++) {
      ordered.push(byIdx.get(i)!);
    }
    const sum = ordered.reduce((a, p) => a + p.size, 0);
    const first = ordered[0]!;
    const baseName = basename(first.path);
    const stemMatch = baseName.match(/^(.+)-\d+-of-\d+\.safetensors$/i);
    const stem = stemMatch ? `${stemMatch[1]}.safetensors` : baseName;
    const dir = first.dir;
    const displayName = dir === "." || dir === "" ? stem : `${dir}/${stem}`;
    coalesced.push({
      displayName,
      safetensorPaths: ordered.map((p) => p.path),
      safetensorSizes: ordered.map((p) => p.size),
      totalSize: sum,
      auxPaths: [],
    });
  }

  // Second pass: group prefix-numbered singles like layers-0.safetensors, layers-1.safetensors
  const prefixGroups = new Map<string, HfRepoVllmModel[]>();
  const remaining: HfRepoVllmModel[] = [];
  for (const s of singles) {
    const parsed = parsePrefixNumberedShard(s.safetensorPaths[0]!);
    if (parsed) {
      if (!prefixGroups.has(parsed.groupKey)) {
        prefixGroups.set(parsed.groupKey, []);
      }
      prefixGroups.get(parsed.groupKey)!.push(s);
    } else {
      remaining.push(s);
    }
  }

  // Merge prefix-numbered groups into single bundles (only if 2+ files share the prefix)
  for (const [, group] of prefixGroups) {
    if (group.length < 2) {
      remaining.push(...group);
      continue;
    }
    const ordered = [...group].sort((a, b) => {
      const aIdx = parsePrefixNumberedShard(a.safetensorPaths[0]!)?.idx ?? 0;
      const bIdx = parsePrefixNumberedShard(b.safetensorPaths[0]!)?.idx ?? 0;
      return aIdx - bIdx;
    });
    const sum = ordered.reduce((a, m) => a + m.totalSize, 0);
    const first = ordered[0]!;
    const parsed = parsePrefixNumberedShard(first.safetensorPaths[0]!)!;
    const firstDir = dirname(first.safetensorPaths[0]!);
    const displayName =
      firstDir === "." || firstDir === ""
        ? `${parsed.prefix}.safetensors`
        : `${firstDir}/${parsed.prefix}.safetensors`;
    coalesced.push({
      displayName,
      safetensorPaths: ordered.flatMap((m) => m.safetensorPaths),
      safetensorSizes: ordered.flatMap((m) => m.safetensorSizes),
      totalSize: sum,
      auxPaths: [],
    });
  }

  const allModels = [...remaining, ...coalesced];

  // Attach aux files to models - match by directory
  for (const model of allModels) {
    const modelDir =
      model.safetensorPaths.length > 0
        ? dirname(model.safetensorPaths[0]!)
        : "";
    for (const aux of auxFiles) {
      const auxDir = dirname(aux.path);
      if (modelDir === "" || modelDir === auxDir || auxDir === ".") {
        if (!model.auxPaths.includes(aux.path)) {
          model.auxPaths.push(aux.path);
        }
      }
    }
  }

  // If there are aux files but no weight models (unusual), create a synthetic entry
  if (allModels.length === 0 && auxFiles.length > 0) {
    allModels.push({
      displayName: "model",
      safetensorPaths: [],
      safetensorSizes: [],
      totalSize: 0,
      auxPaths: auxFiles.map((f) => f.path),
    });
  }

  allModels.sort((a, b) => b.totalSize - a.totalSize);
  return allModels;
}

export async function listVllmModels(
  repoId: string,
): Promise<{ models: HfRepoVllmModel[]; allFiles: HfRepoFileInfo[] }> {
  assertValidRepoId(repoId);
  const base = apiModelsPath(repoId);
  const infoRes = await fetch(`${HF_API}/models/${base}`, {
    headers: { ...HUB_FETCH_HEADERS, ...authHeaders() },
  });
  if (!infoRes.ok) {
    throw new Error(
      infoRes.status === 401 || infoRes.status === 403
        ? infoRes.status === 403
          ? "Access denied — accept this model's license on huggingface.co first, then retry"
          : "Unauthorized — add a HuggingFace access token in Settings to access this gated model"
        : `Model not found or inaccessible (${infoRes.status})`,
    );
  }
  const info = (await infoRes.json()) as { sha?: unknown };
  const shaStr =
    typeof info.sha === "string" && /^[0-9a-f]{7,40}$/i.test(info.sha.trim())
      ? info.sha.trim()
      : null;

  const revAttempts = ["main", ...(shaStr ? [shaStr] : []), "master"];

  let rows: Record<string, unknown>[] = [];
  let lastErr: Error | null = null;
  for (const rev of revAttempts) {
    try {
      rows = await fetchPagedTree(base, rev);
      lastErr = null;
      if (rows.length > 0) {
        break;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      rows = [];
    }
  }
  if (lastErr != null && rows.length === 0) {
    throw lastErr;
  }

  const flat: HfRepoSafetensorFile[] = [];
  const allFiles: HfRepoFileInfo[] = [];
  const seen = new Set<string>();
  for (const e of rows) {
    if (!isTreeFileEntry(e)) {
      continue;
    }
    const rawPath = e.path;
    if (typeof rawPath !== "string") {
      continue;
    }
    const path = normalizeHubPath(rawPath);
    if (!path || path.includes("\\")) {
      continue;
    }
    if (!seen.has(path)) {
      seen.add(path);
      allFiles.push({ path, size: treeEntrySize(e) });
      const baseName = basename(path);
      const lower = path.toLowerCase();
      let kind: HfRepoSafetensorFile["kind"] = "other";
      if (lower.endsWith(".safetensors")) {
        kind = "weight";
      } else if (baseName === "config.json") {
        kind = "config";
      } else if (
        /tokenizer/i.test(baseName) &&
        (lower.endsWith(".json") || lower.endsWith(".model"))
      ) {
        kind = "tokenizer";
      }
      if (kind !== "other") {
        flat.push({ path, size: treeEntrySize(e), kind });
      }
    }
  }

  allFiles.sort((a, b) => a.path.localeCompare(b.path));
  return { models: coalesceSafetensorModels(flat), allFiles };
}

const HF_META_FILE = ".hf-meta.json";

export function hfMetaPath(modelDir: string): string {
  return join(modelDir, HF_META_FILE);
}

export function writeHfMetaSync(modelDir: string, meta: HfDownloadMeta): void {
  try {
    mkdirSafeSync(modelDir);
    writeFileSync(hfMetaPath(modelDir), JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // non-fatal — meta is best-effort
  }
}

export function markHfMetaCompleteSync(modelDir: string): void {
  const p = hfMetaPath(modelDir);
  if (!existsSync(p)) return;
  try {
    const meta = JSON.parse(readFileSync(p, "utf-8")) as HfDownloadMeta;
    meta.complete = true;
    writeFileSync(p, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // non-fatal
  }
}

/** Resolve the mmproj destination folder for a given modelDir (weight folder).
 * In the nested layout: modelDir = modelsDir/namespace/repo/stem, mmproj = modelsDir/namespace/repo.
 * Falls back to modelDir itself if repoId is missing or segments are invalid. */
function resolveMmprojDir(modelDir: string, meta: HfDownloadMeta): string {
  const repoId = meta.repoId;
  if (!repoId) return modelDir;
  const modelsDir = meta.modelsDir;
  if (!modelsDir) return modelDir;
  let repoSegs: string[];
  try {
    repoSegs = modelsRepoPathSegments(repoId);
  } catch {
    return modelDir;
  }
  const [namespace, repoName] = repoSegs;
  if (!namespace || !repoName) return modelDir;
  return join(modelsDir, namespace, repoName);
}

export function getIncompleteMetaForDir(
  modelDir: string,
): HfIncompleteDownloadInfo | null {
  const p = hfMetaPath(modelDir);
  if (!existsSync(p)) return null;
  let meta: HfDownloadMeta;
  try {
    meta = JSON.parse(readFileSync(p, "utf-8")) as HfDownloadMeta;
  } catch {
    return null;
  }
  if (meta.complete) return null;

  // mmproj files live in the repo folder; weights live in the quant folder.
  const mmprojDir = resolveMmprojDir(modelDir, meta);

  const missingFilenames: string[] = [];
  const missingFileSizes: number[] = [];
  for (let i = 0; i < meta.filenames.length; i++) {
    const fn = meta.filenames[i]!;
    const isMmproj = /mmproj/i.test(basename(fn));
    const checkDir = isMmproj ? mmprojDir : modelDir;
    const dest = join(checkDir, basename(fn));
    if (!existsSync(dest)) {
      missingFilenames.push(fn);
      if (meta.fileSizes?.[i] != null)
        missingFileSizes.push(meta.fileSizes[i]!);
    }
  }

  // All files landed — auto-heal the meta and report complete
  if (missingFilenames.length === 0) {
    markHfMetaCompleteSync(modelDir);
    return null;
  }

  return {
    modelDir,
    meta,
    missingFilenames,
    missingFileSizes:
      missingFileSizes.length === missingFilenames.length
        ? missingFileSizes
        : undefined,
    errorMessage: typeof meta.failed === "string" ? meta.failed : undefined,
  };
}

/** Recursively find all directories containing an incomplete HF download meta file. */
function walkMetaDirs(dir: string, results: HfIncompleteDownloadInfo[], seen: Set<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(entryPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (seen.has(entryPath)) continue;
    seen.add(entryPath);
    const info = getIncompleteMetaForDir(entryPath);
    if (info) results.push(info);
    // Recurse into subdirectories (handles nested layout: namespace/repo/stem/)
    walkMetaDirs(entryPath, results, seen);
  }
}

export function scanAllIncompleteMetas(
  modelsDirs: string[],
): HfIncompleteDownloadInfo[] {
  const results: HfIncompleteDownloadInfo[] = [];
  const seen = new Set<string>();
  for (const root of modelsDirs) {
    const trimmed = root.trim();
    if (!trimmed) continue;
    walkMetaDirs(trimmed, results, seen);
  }
  return results;
}

function buildResolveUrl(
  repoId: string,
  revision: string,
  rfilename: string,
): string {
  const base = apiModelsPath(repoId);
  const encRev = encodeURIComponent(revision);
  const encPath = rfilename
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `https://huggingface.co/${base}/resolve/${encRev}/${encPath}`;
}

export async function abandonIncompleteDownload(modelDir: string): Promise<void> {
  // Only delete the meta file and any .partial files — never remove the directory
  // or completed files (could delete weight files in subfolders).
  await unlink(hfMetaPath(modelDir)).catch(() => {});
  // Clean up any .partial files left behind by the interrupted download.
  let entries: string[];
  try {
    entries = readdirSync(modelDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith(".partial")) {
      await unlink(join(modelDir, entry)).catch(() => {});
    }
  }
}

/** Delete only the meta file (leave any .partial data on disk for future resume). */
export async function deleteHfMeta(modelDir: string): Promise<void> {
  await unlink(hfMetaPath(modelDir)).catch(() => {});
}

export async function downloadGgufToModelsDir(
  repoId: string,
  filename: string,
  modelsDir: string,
  revision: string,
  signal: AbortSignal,
  onProgress: (received: number, total?: number) => void,
  destFolder: string,
  isKeepPartial: () => boolean = () => false,
  allowedExts?: string[],
): Promise<string> {
  assertValidRepoId(repoId);
  const segments = assertSafeRepoRelPath(filename, allowedExts);
  const [namespace] = modelsRepoPathSegments(repoId);
  const fileBasename = segments[segments.length - 1]!;
  const destPath = join(modelsDir, namespace!, destFolder, fileBasename);
  await mkdirSafe(dirname(destPath));
  const tmpPath = `${destPath}.partial`;

  // Check for an existing partial file from a previous interrupted download.
  let resumeOffset = 0;
  try {
    const { size } = statSync(tmpPath);
    if (size > 0) resumeOffset = size;
  } catch {
    // no partial file — start fresh
  }

  const reqHeaders: Record<string, string> = { ...HUB_FETCH_HEADERS, ...authHeaders() };
  if (resumeOffset > 0) reqHeaders["Range"] = `bytes=${resumeOffset}-`;

  const url = buildResolveUrl(repoId, revision, filename);
  const res = await fetch(url, {
    signal,
    redirect: "follow",
    headers: reqHeaders,
  });

  // 416 Range Not Satisfiable — partial file is already the full file, just rename.
  if (res.status === 416) {
    const { rename } = await import("fs/promises");
    await unlink(destPath).catch(() => {});
    await rename(tmpPath, destPath);
    return destPath;
  }

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied — accept this model's license on huggingface.co first, then retry");
    }
    if (res.status === 401) {
      throw new Error("Unauthorized — add a HuggingFace access token in Settings to download gated models");
    }
    throw new Error(`Download failed (${res.status}): ${res.statusText}`);
  }

  // Server ignored our Range header and returned 200 — restart from scratch.
  if (res.status === 200 && resumeOffset > 0) {
    await unlink(tmpPath).catch(() => {});
    resumeOffset = 0;
  }

  const body = res.body;
  if (!body) throw new Error("Empty response body");

  // Derive total file size: Content-Range gives full size; Content-Length is remaining bytes.
  const contentRange = res.headers.get("content-range");
  const contentLength = res.headers.get("content-length");
  let total: number | undefined;
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)$/);
    if (m) total = parseInt(m[1], 10);
  } else if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > 0) total = n + resumeOffset;
  }

  let received = resumeOffset;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      onProgress(received, total);
      cb(null, chunk);
    },
  });

  const nodeIn = Readable.fromWeb(body as import("stream/web").ReadableStream);
  // Append to partial file when resuming, otherwise overwrite.
  const writeStream =
    resumeOffset > 0
      ? createWriteStream(tmpPath, { flags: "a" })
      : createWriteStream(tmpPath);

  try {
    await pipeline(nodeIn, counter, writeStream);
    const { rename } = await import("fs/promises");
    await unlink(destPath).catch(() => {});
    await rename(tmpPath, destPath);
  } catch (e) {
    // Only delete the partial on an explicit user cancel — keep it for network errors
    // or app close so the next resume can pick up from the same offset.
    const isAbort =
      e instanceof Error &&
      (e.name === "AbortError" || e.message.includes("aborted"));
    if (isAbort && !isKeepPartial()) await unlink(tmpPath).catch(() => {});
    throw e;
  }

  return destPath;
}

export async function listRepoAllFiles(
  repoId: string,
): Promise<HfRepoFileInfo[]> {
  assertValidRepoId(repoId);
  const base = apiModelsPath(repoId);
  const infoRes = await fetch(`${HF_API}/models/${base}`, {
    headers: { ...HUB_FETCH_HEADERS, ...authHeaders() },
  });
  if (!infoRes.ok) {
    throw new Error(
      infoRes.status === 401 || infoRes.status === 403
        ? infoRes.status === 403
          ? "Access denied — accept this model's license on huggingface.co first, then retry"
          : "Unauthorized — add a HuggingFace access token in Settings to access this gated model"
        : `Model not found or inaccessible (${infoRes.status})`,
    );
  }
  const info = (await infoRes.json()) as { sha?: unknown };
  const shaStr =
    typeof info.sha === "string" && /^[0-9a-f]{7,40}$/i.test(info.sha.trim())
      ? info.sha.trim()
      : null;

  const revAttempts = ["main", ...(shaStr ? [shaStr] : []), "master"];

  let rows: Record<string, unknown>[] = [];
  let lastErr: Error | null = null;
  for (const rev of revAttempts) {
    try {
      rows = await fetchPagedTree(base, rev);
      lastErr = null;
      if (rows.length > 0) {
        break;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      rows = [];
    }
  }
  if (lastErr != null && rows.length === 0) {
    throw lastErr;
  }

  const out: HfRepoFileInfo[] = [];
  const seen = new Set<string>();
  for (const e of rows) {
    if (!isTreeFileEntry(e)) {
      continue;
    }
    const rawPath = e.path;
    if (typeof rawPath !== "string") {
      continue;
    }
    const path = normalizeHubPath(rawPath);
    if (!path || path.includes("\\") || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push({
      path,
      size: treeEntrySize(e),
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
