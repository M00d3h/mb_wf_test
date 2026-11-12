import { getDb } from '../database'
import type { Profile, ProfileConfig } from '@shared/types'

interface ProfileRow {
  id: string
  model_id: string
  name: string
  active: number
  config: string
  created_at: string
  updated_at: string
}

function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    modelId: r.model_id,
    name: r.name,
    active: r.active === 1,
    config: JSON.parse(r.config) as ProfileConfig,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listProfiles(modelId: string): Profile[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM profiles WHERE model_id = ? ORDER BY created_at')
    .all(modelId) as ProfileRow[]
  return rows.map(rowToProfile)
}

export function getProfile(id: string): Profile | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as
    | ProfileRow
    | undefined
  return row ? rowToProfile(row) : null
}

export function getActiveProfile(modelId: string): Profile | null {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE model_id = ? AND active = 1')
    .get(modelId) as ProfileRow | undefined
  return row ? rowToProfile(row) : null
}

export function createProfile(
  id: string,
  modelId: string,
  name: string,
  config: ProfileConfig,
  active = false
): Profile {
  const db = getDb()
  db.prepare(`
    INSERT INTO profiles (id, model_id, name, active, config)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, modelId, name, active ? 1 : 0, JSON.stringify(config))
  return getProfile(id)!
}

export function updateProfile(id: string, patch: { name?: string; config?: ProfileConfig }): Profile {
  const db = getDb()
  const current = getProfile(id)
  if (!current) throw new Error(`Profile ${id} not found`)
  const newName = patch.name ?? current.name
  const newConfig = patch.config ?? current.config
  db.prepare(`
    UPDATE profiles SET name = ?, config = ?, updated_at = datetime('now') WHERE id = ?
  `).run(newName, JSON.stringify(newConfig), id)
  return getProfile(id)!
}

export function setActiveProfile(id: string): void {
  const db = getDb()
  const profile = getProfile(id)
  if (!profile) throw new Error(`Profile ${id} not found`)
  db.prepare(`
    UPDATE profiles SET active = 0 WHERE model_id = ? AND active = 1
  `).run(profile.modelId)
  db.prepare(`
    UPDATE profiles SET active = 1 WHERE id = ?
  `).run(id)
}

export function deleteProfile(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
}

export function duplicateProfile(id: string, newId: string, newName: string): Profile {
  const source = getProfile(id)
  if (!source) throw new Error(`Profile ${id} not found`)
  return createProfile(newId, source.modelId, newName, source.config, false)
}
