import { readdirSync, statSync } from "fs";
import { basename, dirname, join, normalize, resolve } from "path";
import { homedir } from "os";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/database";
import {
  upsertModel,
  listModels,
  getModel,
  getModelByPath,
  listModelsByModelDir,
  updateModelById,
  reassignModelIdAndDelete,
} from "../db/repos/models.repo";
import { createProfile, listProfiles } from "../db/repos/profiles.repo";
import { getSettings } from "../db/repos/settings.repo";
import type { Model } from "@shared/types";
import { readGgufModelLimits } from "./ggufMetadata";

function ensureDefaultProfile(modelId: string): void {
  if (listProfiles(modelId).length > 0) return;
  const settings = getSettings();
  createProfile(
    uuidv4(),
    modelId,
    "Default",
    {
      host: settings.llamaDefaultHost ?? "0.0.0.0",
      port: settings.llamaBasePort ?? 8502,
      fit: "on",
    },
    true,
  );
}

/** Stable key for dedupe / orphan checks (Windows paths are case-insensitive). */
function ggufPathKey(p: string): string {
  const n = normalize(p);
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/** Resolve, trim, and dedupe configured roots so every directory is scanned once. */
export function expandScanRoots(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = r.trim();
    if (!t) continue;
    let abs: string;
    try {
      abs = resolve(t);
    } catch {
      continue;
    }
    const k = process.platform === "win32" ? abs.toLowerCase() : abs;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(abs);
  }
  return out.length > 0 ? out : [join(homedir(), ".modelbox", "models")];
}

function walkGguf(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...walkGguf(fullPath));
      } else if (entry.toLowerCase().endsWith(".gguf")) {
        results.push(fullPath);
      }
    } catch {
      // skip unreadable
    }
  }
  return results;
}

function groupByDir(paths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of paths) {
    const dir = dirname(p);
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(p);
  }
  return map;
}

/** Same pattern as `huggingfaceHub.parseGgufShard` — llama-server `-m` must be shard `1-of-N`. */
function parseGgufShardFilename(p: string): {
  groupKey: string;
  idx: number;
  total: number;
} | null {
  const base = basename(p);
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
  const dir = dirname(p);
  const groupKey = `${ggufPathKey(dir)}::${prefix}::${total}`;
  return { groupKey, idx, total };
}

function pickFirstShardPath(groupPaths: string[]): string | null {
  const parsed = groupPaths
    .map((p) => ({ p, s: parseGgufShardFilename(p) }))
    .filter((x): x is { p: string; s: NonNullable<ReturnType<typeof parseGgufShardFilename>> } => x.s !== null);
  if (parsed.length === 0) {
    return null;
  }
  const first = parsed.find((x) => x.s.idx === 1);
  if (first) {
    return first.p;
  }
  parsed.sort((a, b) => a.s.idx - b.s.idx);
  return parsed[0]!.p;
}

type MainCandidate = { path: string; size: number };

function buildMainCandidates(candidates: string[]): MainCandidate[] {
  const shardGroups = new Map<string, string[]>();
  const singles: string[] = [];

  for (const c of candidates) {
    const shard = parseGgufShardFilename(c);
    if (shard) {
      if (!shardGroups.has(shard.groupKey)) {
        shardGroups.set(shard.groupKey, []);
      }
      shardGroups.get(shard.groupKey)!.push(c);
    } else {
      singles.push(c);
    }
  }

  const reps: MainCandidate[] = [];

  for (const [, groupPaths] of shardGroups) {
    const first = pickFirstShardPath(groupPaths);
    if (!first) {
      continue;
    }
    let sum = 0;
    for (const p of groupPaths) {
      try {
        sum += statSync(p).size;
      } catch {
        /* skip */
      }
    }
    reps.push({ path: first, size: sum });
  }

  for (const p of singles) {
    try {
      reps.push({ path: p, size: statSync(p).size });
    } catch {
      reps.push({ path: p, size: 0 });
    }
  }

  return reps;
}

/** mmproj saved under a sibling folder (e.g. HF layout bug: `stem-mmproj-…` vs `stem`).
 * Also checks the immediate parent directory for mmproj (nested layout: mmproj lives
 * in `namespace/repoName/` while weights are in `namespace/repoName/stem/`). */
function findMmprojInSiblingFolders(modelDir: string): string | null {
  const weightStem = basename(modelDir);
  const parent = dirname(modelDir);

  // Nested layout: mmproj lives directly in the parent folder
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return null;
  }
  const directMmproj = entries.find((f) => /mmproj/i.test(f));
  if (directMmproj) {
    return normalize(join(parent, directMmproj));
  }

  // Sibling folder search
  const stemLower = weightStem.toLowerCase();
  for (const entry of entries) {
    if (entry === basename(modelDir)) continue;
    const sibPath = join(parent, entry);
    try {
      if (!statSync(sibPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const el = entry.toLowerCase();
    const relates =
      el.startsWith(`${stemLower}-mmproj`) ||
      el.startsWith(`${stemLower}_mmproj`) ||
      el === `${stemLower}-mmproj`;
    if (!relates) continue;
    for (const p of walkGguf(sibPath)) {
      if (/mmproj/i.test(basename(p))) return normalize(p);
    }
  }
  return null;
}

/** Find a shared mmproj downloaded from the same repo, searching across all scan roots.
 * Check 1: Look for the exact repo folder in every root (handles different model dirs).
 * Check 2: Prefix-match siblings in the namespace dir (handles quant-specific folders). */
function findSharedMmprojInNamespace(modelDir: string, scanRoots: string[]): string | null {
  const modelDirNorm = normalize(modelDir);
  for (const root of scanRoots) {
    const rootNorm = normalize(root);
    const rel = modelDirNorm.slice(rootNorm.length).replace(/^[/\\]/, "");
    if (!rel || rel.startsWith("..")) continue;
    const relParts = rel.split(/[/\\]/).filter(Boolean);
    if (relParts.length < 2) continue;
    const namespace = relParts[0]!;
    const repoName = relParts[1]!;

    // Check 1: Look for the repo folder directly in every root.
    for (const otherRoot of scanRoots) {
      const repoFolder = join(normalize(otherRoot), namespace, repoName);
      let entries: string[];
      try {
        entries = readdirSync(repoFolder);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (/mmproj/i.test(f)) return normalize(join(repoFolder, f));
      }
    }

    // Check 2: Prefix-match siblings in any root's namespace dir.
    const modelStem = basename(modelDirNorm).toLowerCase();
    for (const otherRoot of scanRoots) {
      const nsDir = join(normalize(otherRoot), namespace);
      let entries: string[];
      try {
        entries = readdirSync(nsDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry === basename(modelDirNorm)) continue;
        const sibPath = join(nsDir, entry);
        try {
          if (!statSync(sibPath).isDirectory()) continue;
        } catch {
          continue;
        }
        if (!modelStem.startsWith(entry.toLowerCase())) continue;
        for (const p of walkGguf(sibPath)) {
          if (/mmproj/i.test(basename(p))) return normalize(p);
        }
      }
    }
  }
  return null;
}

function pickMainGguf(files: string[]): {
  main: string;
  mmproj: string | null;
} {
  const mmprojs = files.filter((f) => /mmproj/i.test(basename(f)));
  const candidates = files.filter((f) => !/mmproj/i.test(basename(f)));

  let main: string | null = null;

  const reps = buildMainCandidates(candidates);

  // Prefer MOE or Instruct in name
  const preferred = reps.find((r) => {
    const b = basename(r.path).toUpperCase();
    return b.includes("MOE") || b.includes("INSTRUCT");
  });
  if (preferred) {
    main = preferred.path;
  } else if (reps.length > 0) {
    let largest = reps[0]!;
    for (const r of reps) {
      if (r.size > largest.size) {
        largest = r;
      }
    }
    main = largest.path;
  }

  if (!main && mmprojs.length > 0) {
    main = mmprojs[0];
  }

  return {
    main: main ?? files[0],
    mmproj: mmprojs.length > 0 ? mmprojs[0] : null,
  };
}

/** True when `dir` is exactly one of the configured model roots (GGUFs live in a subfolder otherwise). */
function isModelsRootDir(dir: string, scanRoots: string[]): boolean {
  const key = ggufPathKey(dir);
  return scanRoots.some((r) => ggufPathKey(r) === key);
}

function deriveModelName(
  mainPath: string,
  dir: string,
  scanRoots: string[],
): string {
  const fileName = basename(mainPath, ".gguf");
  // GGUF dropped straight under a scan root: folder name is the root (e.g. "models"), not the model
  if (isModelsRootDir(dir, scanRoots)) return fileName;
  const dirName = basename(dir);
  // Use directory name if it's more descriptive than just a version string
  if (dirName.length > 3 && !/^v?\d/.test(dirName)) return dirName;
  return fileName;
}

function detectTags(mainPath: string): { isEmbedding: boolean } {
  const name = basename(mainPath).toLowerCase();
  const isEmbedding =
    name.includes("embed") ||
    name.includes("bge-") ||
    name.includes("e5-") ||
    name.includes("nomic-embed");
  return { isEmbedding };
}

export async function scanModels(modelsDirs: string[]): Promise<Model[]> {
  const dirs = expandScanRoots(modelsDirs);
  const allGgufs: string[] = [];
  const seenFileKeys = new Set<string>();
  for (const d of dirs) {
    for (const p of walkGguf(d)) {
      const k = ggufPathKey(p);
      if (seenFileKeys.has(k)) continue;
      seenFileKeys.add(k);
      allGgufs.push(normalize(p));
    }
  }
  const currentPathKeys = new Set(allGgufs.map((p) => ggufPathKey(p)));
  const grouped = groupByDir(allGgufs);
  const upserted: Model[] = [];
  const db = getDb();

  for (const [dir, files] of grouped.entries()) {
    const dirNorm = normalize(dir);
    const hasWeightGguf = files.some((f) => !/mmproj/i.test(basename(f)));
    if (!hasWeightGguf && files.some((f) => /mmproj/i.test(basename(f)))) {
      // Projector-only folder; weights live in a sibling directory — skip duplicate "model".
      for (const fp of files) {
        const ghost = getModelByPath(normalize(fp));
        if (ghost) {
          db.prepare("DELETE FROM profiles WHERE model_id = ?").run(ghost.id);
          db.prepare("DELETE FROM models WHERE id = ?").run(ghost.id);
        }
      }
      continue;
    }
    let filesForPick = [...files];
    if (!filesForPick.some((f) => /mmproj/i.test(basename(f)))) {
      let sib = findMmprojInSiblingFolders(dirNorm);
      if (!sib) sib = findSharedMmprojInNamespace(dirNorm, dirs);
      if (sib) filesForPick.push(sib);
    }
    const { main, mmproj } = pickMainGguf(filesForPick);
    const mainNorm = normalize(main);
    const name = deriveModelName(mainNorm, dir, dirs);
    const { isEmbedding } = detectTags(mainNorm);
    const isMultimodal = mmproj !== null;
    const limits = readGgufModelLimits(mainNorm);

    const sameDir = listModelsByModelDir(dirNorm);
    const byPath = getModelByPath(mainNorm);
    let survivorId: string;
    if (byPath) {
      survivorId = byPath.id;
    } else if (sameDir.length > 0) {
      survivorId = sameDir[0]!.id;
    } else {
      survivorId = uuidv4();
    }

    for (const m of sameDir) {
      if (m.id !== survivorId) {
        reassignModelIdAndDelete(m.id, survivorId);
      }
    }

    const payload: Omit<Model, "createdAt" | "updatedAt"> = {
      id: survivorId,
      name,
      ggufPath: mainNorm,
      modelDir: dirNorm,
      isEmbedding,
      isMultimodal,
      detectedFiles: filesForPick,
      maxContextTokens: limits.maxContextTokens,
      blockCount: limits.blockCount,
      quantLabel: limits.quantLabel,
    };

    if (getModel(survivorId)) {
      const { id: _id, ...rest } = payload;
      upserted.push(updateModelById(survivorId, rest));
    } else {
      upserted.push(upsertModel(payload));
      ensureDefaultProfile(survivorId);
    }
  }

  // Cleanup orphaned models (files no longer on disk)
  const allModels = db.prepare("SELECT id, gguf_path FROM models").all() as {
    id: string;
    gguf_path: string;
  }[];
  for (const model of allModels) {
    if (!currentPathKeys.has(ggufPathKey(model.gguf_path))) {
      // conversations.model_id has no ON DELETE CASCADE — NULL it out to satisfy the FK.
      db.prepare("UPDATE conversations SET model_id = NULL WHERE model_id = ?").run(model.id);
      db.prepare("DELETE FROM profiles WHERE model_id = ?").run(model.id);
      db.prepare("DELETE FROM models WHERE id = ?").run(model.id);
    }
  }

  return upserted;
}

export { listModels };
