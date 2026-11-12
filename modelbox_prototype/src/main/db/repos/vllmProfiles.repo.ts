import { getDb } from "../database";
import type { VllmModelConfig, VllmProfile } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { getVllmModel } from "./vllmModels.repo";

interface Row {
  id: string;
  vllm_model_id: string;
  name: string;
  active: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

function parseConfig(raw: string): VllmModelConfig {
  if (!raw || raw.trim() === "") return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return o as VllmModelConfig;
    }
  } catch {
    /* */
  }
  return {};
}

function rowToProfile(r: Row): VllmProfile {
  return {
    id: r.id,
    vllmModelId: r.vllm_model_id,
    name: r.name,
    active: r.active === 1,
    config: parseConfig(r.config_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listVllmProfiles(vllmModelId: string): VllmProfile[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM vllm_profiles WHERE vllm_model_id = ? ORDER BY created_at",
    )
    .all(vllmModelId) as Row[];
  return rows.map(rowToProfile);
}

export function getVllmProfile(id: string): VllmProfile | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM vllm_profiles WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? rowToProfile(row) : null;
}

export function createVllmProfile(
  id: string,
  vllmModelId: string,
  name: string,
  config: VllmModelConfig,
  active = false,
): VllmProfile {
  const db = getDb();
  db.prepare(
    `INSERT INTO vllm_profiles (id, vllm_model_id, name, active, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, vllmModelId, name, active ? 1 : 0, JSON.stringify(config));
  return getVllmProfile(id)!;
}

export function updateVllmProfile(
  id: string,
  patch: { name?: string; config?: VllmModelConfig },
): VllmProfile {
  const db = getDb();
  const current = getVllmProfile(id);
  if (!current) throw new Error(`vLLM profile ${id} not found`);
  const newName = patch.name ?? current.name;
  const newConfig = patch.config ?? current.config;
  const sameName = newName === current.name;
  const sameConfig =
    JSON.stringify(newConfig) === JSON.stringify(current.config);
  if (sameName && sameConfig) {
    return current;
  }
  db.prepare(
    `UPDATE vllm_profiles SET name = ?, config_json = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(newName, JSON.stringify(newConfig), id);
  return getVllmProfile(id)!;
}

export function setActiveVllmProfile(id: string): void {
  const db = getDb();
  const profile = getVllmProfile(id);
  if (!profile) throw new Error(`vLLM profile ${id} not found`);
  db.prepare(
    `UPDATE vllm_profiles SET active = 0 WHERE vllm_model_id = ? AND active = 1`,
  ).run(profile.vllmModelId);
  db.prepare(`UPDATE vllm_profiles SET active = 1 WHERE id = ?`).run(id);
}

export function deleteVllmProfile(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM vllm_profiles WHERE id = ?").run(id);
}

export function duplicateVllmProfile(
  id: string,
  newId: string,
  newName: string,
): VllmProfile {
  const source = getVllmProfile(id);
  if (!source) throw new Error(`vLLM profile ${id} not found`);
  return createVllmProfile(newId, source.vllmModelId, newName, source.config, false);
}

/** Ensures at least one profile exists (e.g. after scan upsert). */
export function ensureDefaultVllmProfile(vllmModelId: string): VllmProfile | null {
  const existing = listVllmProfiles(vllmModelId);
  if (existing.length > 0) return existing[0]!;
  const vm = getVllmModel(vllmModelId);
  if (!vm) return null;
  const id = uuidv4();
  return createVllmProfile(id, vllmModelId, "default", { port: 8000 }, true);
}
