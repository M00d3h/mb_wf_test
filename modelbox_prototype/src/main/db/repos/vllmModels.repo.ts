import { getDb } from "../database";
import type { VllmModel, VllmModelConfig } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { sumVllmModelDirBytes } from "../../services/ggufFileSizes";

/**
 * Normalize both \\wsl$\ and \\wsl.localhost\ to \\wsl$\ so the two UNC forms
 * always map to the same DB key. Without this, a native-scan fallback (when WSL
 * init is slow) stores \\wsl.localhost\… while a later successful WSL scan stores
 * \\wsl$\… — producing duplicate rows for the same physical model.
 */
function canonicalizePath(p: string): string {
  return p.replace(/^\\\\wsl\.localhost\\/i, "\\\\wsl$\\");
}

function parseConfigJson(raw: string): VllmModelConfig {
  if (!raw || raw.trim() === "") return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return o as VllmModelConfig;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function rowToModel(r: {
  id: string;
  path: string;
  display_name: string;
  config_json: string;
  dtype?: string | null;
  is_multimodal?: number | null;
  created_at: string;
  updated_at: string;
}): VllmModel {
  return {
    id: r.id,
    path: r.path,
    displayName: r.display_name,
    dtype: r.dtype ?? null,
    isMultimodal: (r.is_multimodal ?? 0) === 1,
    config: parseConfigJson(r.config_json),
    diskSize: sumVllmModelDirBytes(r.path),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type VllmModelRow = {
  id: string;
  path: string;
  display_name: string;
  config_json: string;
  dtype?: string | null;
  is_multimodal?: number | null;
  created_at: string;
  updated_at: string;
};

export function listVllmModels(): VllmModel[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM vllm_models ORDER BY display_name ASC")
    .all() as VllmModelRow[];
  return rows.map(rowToModel);
}

export function getVllmModel(id: string): VllmModel | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM vllm_models WHERE id = ?")
    .get(id) as VllmModelRow | undefined;
  return row ? rowToModel(row) : null;
}

export function getVllmModelByPath(path: string): VllmModel | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM vllm_models WHERE path = ?")
    .get(canonicalizePath(path)) as VllmModelRow | undefined;
  return row ? rowToModel(row) : null;
}

export function upsertVllmModelByPath(
  path: string,
  displayName: string,
  dtype?: string | null,
  isMultimodal?: boolean,
): VllmModel {
  const db = getDb();
  const canonical = canonicalizePath(path);
  const existing = getVllmModelByPath(canonical);
  const now = new Date().toISOString();
  const mm = isMultimodal ? 1 : 0;
  if (existing) {
    db.prepare(
      `UPDATE vllm_models SET display_name = ?, dtype = ?, is_multimodal = ?, updated_at = ? WHERE id = ?`,
    ).run(displayName, dtype ?? null, mm, now, existing.id);
    return getVllmModel(existing.id)!;
  }
  const id = uuidv4();
  db.prepare(
    `INSERT INTO vllm_models (id, path, display_name, config_json, dtype, is_multimodal, created_at, updated_at)
     VALUES (?, ?, ?, '{}', ?, ?, ?, ?)`,
  ).run(id, canonical, displayName, dtype ?? null, mm, now, now);
  return getVllmModel(id)!;
}

export function updateVllmModel(
  id: string,
  patch: {
    displayName?: string;
    config?: VllmModelConfig;
  },
): VllmModel | null {
  const m = getVllmModel(id);
  if (!m) return null;
  const db = getDb();
  const now = new Date().toISOString();
  const name = patch.displayName ?? m.displayName;
  const config = patch.config ? { ...m.config, ...patch.config } : m.config;
  db.prepare(
    `UPDATE vllm_models SET display_name = ?, config_json = ?, updated_at = ? WHERE id = ?`,
  ).run(name, JSON.stringify(config), now, id);
  return getVllmModel(id);
}

export function deleteVllmModel(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM vllm_models WHERE id = ?").run(id);
}
