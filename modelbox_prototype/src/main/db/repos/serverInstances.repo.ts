import { getDb } from "../database";
import type { ServerInstance, ServerState, ServerInstanceKind } from "@shared/types";

interface InstanceRow {
  id: string;
  model_id: string | null;
  profile_id: string | null;
  vllm_model_id: string | null;
  vllm_profile_id: string | null;
  instance_kind: string;
  host: string;
  port: number;
  last_state: string;
  pid: number | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
}

function rowToInstance(r: InstanceRow): ServerInstance {
  const k = (r.instance_kind ?? "llama") as ServerInstanceKind;
  return {
    id: r.id,
    instanceKind: k,
    modelId: r.model_id,
    profileId: r.profile_id,
    vllmModelId: r.vllm_model_id,
    vllmProfileId: r.vllm_profile_id ?? null,
    host: r.host,
    port: r.port,
    state: r.last_state as ServerState,
    pid: r.pid,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    createdAt: r.created_at,
  };
}

export function listInstances(): ServerInstance[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM server_instances ORDER BY created_at DESC")
    .all() as InstanceRow[];
  return rows.map(rowToInstance);
}

export function getInstance(id: string): ServerInstance | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM server_instances WHERE id = ?")
    .get(id) as InstanceRow | undefined;
  return row ? rowToInstance(row) : null;
}

export function createInstance(inst: {
  id: string;
  instanceKind: "llama";
  modelId: string;
  profileId: string;
  host: string;
  port: number;
}): ServerInstance;
export function createInstance(inst: {
  id: string;
  instanceKind: "vllm";
  vllmModelId: string;
  vllmProfileId: string;
  host: string;
  port: number;
}): ServerInstance;
export function createInstance(inst: {
  id: string;
  instanceKind: ServerInstanceKind;
  modelId?: string | null;
  profileId?: string | null;
  vllmModelId?: string | null;
  vllmProfileId?: string | null;
  host: string;
  port: number;
}): ServerInstance {
  const db = getDb();
  const kind = inst.instanceKind;
  const modelId = kind === "llama" ? (inst.modelId ?? null) : null;
  const profileId = kind === "llama" ? (inst.profileId ?? null) : null;
  const vllmId = kind === "vllm" ? (inst.vllmModelId ?? null) : null;
  const vllmProfileId = kind === "vllm" ? (inst.vllmProfileId ?? null) : null;
  db.prepare(
    `INSERT INTO server_instances (
      id, model_id, profile_id, vllm_model_id, vllm_profile_id, instance_kind, host, port, last_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stopped')`,
  ).run(
    inst.id,
    modelId,
    profileId,
    vllmId,
    vllmProfileId,
    kind,
    inst.host,
    inst.port,
  );
  return getInstance(inst.id)!;
}

export function deleteInstance(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM server_instances WHERE id = ?").run(id);
}

export function clearAllInstances(): void {
  const db = getDb();
  db.prepare("DELETE FROM server_instances").run();
}

export function updateInstanceState(
  id: string,
  state: ServerState,
  pid?: number | null,
  startedAt?: string | null,
  stoppedAt?: string | null,
): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE server_instances SET
      last_state = ?,
      pid = COALESCE(?, pid),
      started_at = COALESCE(?, started_at),
      stopped_at = ?
    WHERE id = ?
  `,
  ).run(state, pid ?? null, startedAt ?? null, stoppedAt ?? null, id);
}
