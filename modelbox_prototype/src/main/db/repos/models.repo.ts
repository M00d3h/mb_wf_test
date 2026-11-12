import { normalize } from 'path'
import { getDb } from '../database'
import type { Model } from '@shared/types'
import { sumGgufFileSizes } from '../../services/ggufFileSizes'

interface ModelRow {
  id: string
  name: string
  gguf_path: string
  model_dir: string
  is_embedding: number
  is_multimodal: number
  detected_files: string
  max_context_tokens: number | null
  block_count: number | null
  quant_label: string | null
  created_at: string
  updated_at: string
}

function rowToModel(r: ModelRow): Model {
  const detectedFiles = JSON.parse(r.detected_files) as string[]
  return {
    id: r.id,
    name: r.name,
    ggufPath: r.gguf_path,
    modelDir: r.model_dir,
    isEmbedding: r.is_embedding === 1,
    isMultimodal: r.is_multimodal === 1,
    detectedFiles,
    maxContextTokens: r.max_context_tokens ?? undefined,
    blockCount: r.block_count ?? undefined,
    quantLabel: r.quant_label ?? undefined,
    ggufTotalBytes: sumGgufFileSizes(detectedFiles),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listModels(): Model[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM models ORDER BY name')
    .all() as ModelRow[]
  return rows.map(rowToModel)
}

export function getModel(id: string): Model | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as
    | ModelRow
    | undefined
  return row ? rowToModel(row) : null
}

export function getModelByPath(ggufPath: string): Model | null {
  const db = getDb()
  const n = normalize(ggufPath.trim())
  const row =
    process.platform === 'win32'
      ? (db
          .prepare(
            'SELECT * FROM models WHERE lower(gguf_path) = lower(?) LIMIT 1',
          )
          .get(n) as ModelRow | undefined)
      : (db.prepare('SELECT * FROM models WHERE gguf_path = ?').get(n) as
          | ModelRow
          | undefined)
  return row ? rowToModel(row) : null
}

/** All models whose folder matches (e.g. same dir, multiple rows after gguf_path changed). */
export function listModelsByModelDir(modelDir: string): Model[] {
  const db = getDb()
  const n = normalize(modelDir.trim())
  const rows =
    process.platform === 'win32'
      ? (db
          .prepare(
            'SELECT * FROM models WHERE lower(model_dir) = lower(?) ORDER BY updated_at DESC',
          )
          .all(n) as ModelRow[])
      : (db
          .prepare(
            'SELECT * FROM models WHERE model_dir = ? ORDER BY updated_at DESC',
          )
          .all(n) as ModelRow[])
  return rows.map(rowToModel)
}

export function getModelByModelDir(modelDir: string): Model | null {
  const list = listModelsByModelDir(modelDir)
  return list[0] ?? null
}

export function upsertModel(model: Omit<Model, 'createdAt' | 'updatedAt'>): Model {
  const db = getDb()
  db.prepare(`
    INSERT INTO models (id, name, gguf_path, model_dir, is_embedding, is_multimodal, detected_files, max_context_tokens, block_count, quant_label, updated_at)
    VALUES (@id, @name, @ggufPath, @modelDir, @isEmbedding, @isMultimodal, @detectedFiles, @maxContextTokens, @blockCount, @quantLabel, datetime('now'))
    ON CONFLICT(gguf_path) DO UPDATE SET
      name = excluded.name,
      model_dir = excluded.model_dir,
      is_embedding = excluded.is_embedding,
      is_multimodal = excluded.is_multimodal,
      detected_files = excluded.detected_files,
      max_context_tokens = excluded.max_context_tokens,
      block_count = excluded.block_count,
      quant_label = excluded.quant_label,
      updated_at = datetime('now')
  `).run({
    id: model.id,
    name: model.name,
    ggufPath: normalize(model.ggufPath.trim()),
    modelDir: normalize(model.modelDir.trim()),
    isEmbedding: model.isEmbedding ? 1 : 0,
    isMultimodal: model.isMultimodal ? 1 : 0,
    detectedFiles: JSON.stringify(model.detectedFiles),
    maxContextTokens: model.maxContextTokens ?? null,
    blockCount: model.blockCount ?? null,
    quantLabel: model.quantLabel ?? null,
  })
  return getModel(model.id)!
}

/** Update an existing row by id (e.g. main gguf path changed from shard 2 to shard 1). */
export function updateModelById(
  id: string,
  model: Omit<Model, 'id' | 'createdAt' | 'updatedAt'>,
): Model {
  const db = getDb()
  db.prepare(`
    UPDATE models SET
      name = @name,
      gguf_path = @ggufPath,
      model_dir = @modelDir,
      is_embedding = @isEmbedding,
      is_multimodal = @isMultimodal,
      detected_files = @detectedFiles,
      max_context_tokens = @maxContextTokens,
      block_count = @blockCount,
      quant_label = @quantLabel,
      updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id,
    name: model.name,
    ggufPath: normalize(model.ggufPath.trim()),
    modelDir: normalize(model.modelDir.trim()),
    isEmbedding: model.isEmbedding ? 1 : 0,
    isMultimodal: model.isMultimodal ? 1 : 0,
    detectedFiles: JSON.stringify(model.detectedFiles),
    maxContextTokens: model.maxContextTokens ?? null,
    blockCount: model.blockCount ?? null,
    quantLabel: model.quantLabel ?? null,
  })
  return getModel(id)!
}

/**
 * Merge a duplicate model row into another (same folder, wrong gguf_path row).
 * Reassigns profiles, conversations, server instances; deletes the duplicate model.
 */
export function reassignModelIdAndDelete(fromId: string, toId: string): void {
  if (fromId === toId) return
  const db = getDb()
  db.prepare('UPDATE profiles SET model_id = ? WHERE model_id = ?').run(
    toId,
    fromId,
  )
  db.prepare('UPDATE conversations SET model_id = ? WHERE model_id = ?').run(
    toId,
    fromId,
  )
  db.prepare(
    'UPDATE server_instances SET model_id = ? WHERE model_id = ?',
  ).run(toId, fromId)
  db.prepare('DELETE FROM models WHERE id = ?').run(fromId)
}

export function deleteModel(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM models WHERE id = ?').run(id)
}
