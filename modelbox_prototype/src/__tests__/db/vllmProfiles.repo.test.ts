/**
 * Requires better-sqlite3 compiled for standard Node.js.
 * Run `npm run test:db`.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isSqliteAvailable, createTestDb } from '../helpers/makeDb'

const sqlite = isSqliteAvailable()

vi.mock('@main/services/ggufFileSizes', () => ({
  sumGgufFileSizes: () => 0,
  sumVllmModelDirBytes: () => 0,
}))

let ctx: ReturnType<typeof createTestDb> | null = null
vi.mock('@main/db/database', () => ({
  getDb: () => {
    if (!ctx) throw new Error('test db not initialised')
    return ctx.db
  },
}))

const {
  upsertVllmModelByPath,
  getVllmModel,
} = await import('@main/db/repos/vllmModels.repo')

const {
  listVllmProfiles,
  getVllmProfile,
  createVllmProfile,
  updateVllmProfile,
  setActiveVllmProfile,
  deleteVllmProfile,
  duplicateVllmProfile,
  ensureDefaultVllmProfile,
} = await import('@main/db/repos/vllmProfiles.repo')

describe.skipIf(!sqlite)('vllmProfiles.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('ensureDefaultVllmProfile', () => {
    it('creates a default profile when none exist', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const p = ensureDefaultVllmProfile(m.id)
      expect(p).not.toBeNull()
      expect(p!.name).toBe('default')
      expect(p!.active).toBe(true)
    })

    it('returns existing profile when one already exists', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const p1 = ensureDefaultVllmProfile(m.id)
      const p2 = ensureDefaultVllmProfile(m.id)
      expect(p2!.id).toBe(p1!.id)
    })

    it('returns null for unknown model', () => {
      expect(ensureDefaultVllmProfile('nonexistent')).toBeNull()
    })
  })

  describe('createVllmProfile / getVllmProfile', () => {
    it('creates and retrieves a profile', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const p = createVllmProfile('p1', m.id, 'test-profile', { port: 8001 }, false)
      expect(p.id).toBe('p1')
      expect(p.name).toBe('test-profile')
      expect(p.active).toBe(false)

      const found = getVllmProfile('p1')
      expect(found).not.toBeNull()
      expect(found!.name).toBe('test-profile')
      expect(found!.config).toEqual({ port: 8001 })
    })

    it('returns null for unknown profile id', () => {
      expect(getVllmProfile('unknown-id')).toBeNull()
    })
  })

  describe('listVllmProfiles', () => {
    it('returns empty array when no profiles', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      expect(listVllmProfiles(m.id)).toEqual([])
    })

    it('returns all profiles for a model', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      createVllmProfile('p1', m.id, 'profile-1', {}, false)
      createVllmProfile('p2', m.id, 'profile-2', { port: 8001 }, false)
      const list = listVllmProfiles(m.id)
      expect(list).toHaveLength(2)
    })
  })

  describe('setActiveVllmProfile', () => {
    it('sets a profile as active and deactivates others', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const p1 = createVllmProfile('p1', m.id, 'profile-1', {}, true)
      createVllmProfile('p2', m.id, 'profile-2', { port: 8001 }, false)

      setActiveVllmProfile('p2')

      expect(getVllmProfile('p1')!.active).toBe(false)
      expect(getVllmProfile('p2')!.active).toBe(true)
    })

    it('does NOT overwrite the model displayName when setting active profile', () => {
      const m = upsertVllmModelByPath('/models/Qwen3.6-35B-A3B-NVFP4', 'Qwen3.6-35B-A3B-NVFP4')
      expect(getVllmModel(m.id)!.displayName).toBe('Qwen3.6-35B-A3B-NVFP4')

      createVllmProfile('p1', m.id, 'default', {}, true)
      const p2 = createVllmProfile('p2', m.id, 'config2', { port: 8001 }, false)

      // Setting profile-1 as active should not change model displayName
      setActiveVllmProfile('p1')
      expect(getVllmModel(m.id)!.displayName).toBe('Qwen3.6-35B-A3B-NVFP4')

      // Switching to "config2" as active should not change model displayName
      setActiveVllmProfile(p2.id)
      expect(getVllmModel(m.id)!.displayName).toBe('Qwen3.6-35B-A3B-NVFP4')
    })

    it('preserves model displayName after updating an active profile name', () => {
      const m = upsertVllmModelByPath('/models/Mistral-7B', 'Mistral-7B')
      const p = createVllmProfile('p1', m.id, 'original-name', {}, true)

      // Rename the active profile
      updateVllmProfile(p.id, { name: 'renamed-profile' })

      // Model displayName must stay as the original model name, not the profile name
      expect(getVllmModel(m.id)!.displayName).toBe('Mistral-7B')
    })
  })

  describe('updateVllmProfile', () => {
    it('updates profile name and config', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      createVllmProfile('p1', m.id, 'old-name', { port: 8000 }, false)
      updateVllmProfile('p1', { name: 'new-name', config: { port: 8001 } })
      const p = getVllmProfile('p1')!
      expect(p.name).toBe('new-name')
      expect(p.config.port).toBe(8001)
    })

    it('does not change anything when name and config are identical', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const original = createVllmProfile('p1', m.id, 'profile', { port: 8000 }, false)
      const updated = updateVllmProfile('p1', { name: 'profile', config: { port: 8000 } })
      expect(updated.id).toBe(original.id)
      expect(updated.updatedAt).toBe(original.updatedAt)
    })
  })

  describe('deleteVllmProfile', () => {
    it('removes a profile', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      createVllmProfile('p1', m.id, 'profile', {}, false)
      deleteVllmProfile('p1')
      expect(getVllmProfile('p1')).toBeNull()
    })

    it('is idempotent', () => {
      expect(() => deleteVllmProfile('nonexistent')).not.toThrow()
    })
  })

  describe('duplicateVllmProfile', () => {
    it('creates a copy with a new id and name', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const src = createVllmProfile('p1', m.id, 'source', { port: 8001 }, false)
      const dup = duplicateVllmProfile('p1', 'p2', 'copy-of-source')
      expect(dup.id).toBe('p2')
      expect(dup.name).toBe('copy-of-source')
      expect(dup.config).toEqual(src.config)
      expect(dup.active).toBe(false)
    })

    it('throws for unknown source id', () => {
      expect(() => duplicateVllmProfile('unknown', 'p2', 'copy')).toThrow()
    })
  })
})
