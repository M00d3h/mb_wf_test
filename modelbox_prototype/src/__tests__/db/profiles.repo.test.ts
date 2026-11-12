/**
 * Requires better-sqlite3 compiled for standard Node.js.
 * Run `npm run test:db` — see models.repo.test.ts for details.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isSqliteAvailable, createTestDb } from '../helpers/makeDb'

const sqlite = isSqliteAvailable()

vi.mock('@main/services/ggufFileSizes', () => ({ sumGgufFileSizes: () => 0 }))

let ctx: ReturnType<typeof createTestDb> | null = null
vi.mock('@main/db/database', () => ({
  getDb: () => {
    if (!ctx) throw new Error('test db not initialised')
    return ctx.db
  },
}))

const { upsertModel } = await import('@main/db/repos/models.repo')
const {
  createProfile,
  getProfile,
  getActiveProfile,
  listProfiles,
  updateProfile,
  setActiveProfile,
  deleteProfile,
  duplicateProfile,
} = await import('@main/db/repos/profiles.repo')

const BASE_MODEL = {
  id: 'm1',
  name: 'Llama-3-8B',
  ggufPath: '/models/llama-3-8b.gguf',
  modelDir: '/models',
  isEmbedding: false,
  isMultimodal: false,
  detectedFiles: ['/models/llama-3-8b.gguf'],
}

describe.skipIf(!sqlite)('profiles.repo', () => {
  beforeEach(() => {
    ctx = createTestDb()
    upsertModel(BASE_MODEL)
  })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('createProfile / getProfile', () => {
    it('creates and retrieves a profile', () => {
      createProfile('p1', 'm1', 'default', {})
      const p = getProfile('p1')
      expect(p).not.toBeNull()
      expect(p!.name).toBe('default')
      expect(p!.modelId).toBe('m1')
      expect(p!.active).toBe(false)
    })

    it('returns null for unknown id', () => {
      expect(getProfile('unknown')).toBeNull()
    })

    it('stores config as JSON and round-trips it', () => {
      createProfile('p1', 'm1', 'default', { gpuLayers: 35, contextSize: 4096 })
      const p = getProfile('p1')!
      expect(p.config.gpuLayers).toBe(35)
      expect(p.config.contextSize).toBe(4096)
    })

    it('creates active profile', () => {
      createProfile('p1', 'm1', 'active', {}, true)
      expect(getProfile('p1')!.active).toBe(true)
    })
  })

  describe('listProfiles', () => {
    it('returns empty array when no profiles', () => {
      expect(listProfiles('m1')).toEqual([])
    })

    it('returns all profiles for the model', () => {
      createProfile('p1', 'm1', 'Profile 1', {})
      createProfile('p2', 'm1', 'Profile 2', {})
      expect(listProfiles('m1')).toHaveLength(2)
    })

    it('only returns profiles for the specified model', () => {
      upsertModel({ ...BASE_MODEL, id: 'm2', name: 'Other', ggufPath: '/models/other.gguf' })
      createProfile('p1', 'm1', 'For m1', {})
      createProfile('p2', 'm2', 'For m2', {})
      expect(listProfiles('m1')).toHaveLength(1)
      expect(listProfiles('m1')[0].name).toBe('For m1')
    })
  })

  describe('getActiveProfile', () => {
    it('returns null when no active profile', () => {
      createProfile('p1', 'm1', 'inactive', {}, false)
      expect(getActiveProfile('m1')).toBeNull()
    })

    it('returns the active profile', () => {
      createProfile('p1', 'm1', 'active', {}, true)
      const active = getActiveProfile('m1')
      expect(active).not.toBeNull()
      expect(active!.id).toBe('p1')
    })
  })

  describe('DB trigger: single_active_profile', () => {
    it('deactivates previous profile when new active profile is inserted', () => {
      createProfile('p1', 'm1', 'first', {}, true)
      createProfile('p2', 'm1', 'second', {}, true)
      // Only p2 should be active now
      expect(getProfile('p1')!.active).toBe(false)
      expect(getProfile('p2')!.active).toBe(true)
    })
  })

  describe('setActiveProfile', () => {
    it('makes the specified profile active', () => {
      createProfile('p1', 'm1', 'Profile 1', {})
      createProfile('p2', 'm1', 'Profile 2', {})
      setActiveProfile('p2')
      expect(getProfile('p2')!.active).toBe(true)
    })

    it('deactivates the previously active profile', () => {
      createProfile('p1', 'm1', 'P1', {}, true)
      createProfile('p2', 'm1', 'P2', {})
      setActiveProfile('p2')
      expect(getProfile('p1')!.active).toBe(false)
      expect(getProfile('p2')!.active).toBe(true)
    })

    it('throws when profile not found', () => {
      expect(() => setActiveProfile('no-such-id')).toThrow()
    })
  })

  describe('updateProfile', () => {
    it('updates the profile name', () => {
      createProfile('p1', 'm1', 'old-name', {})
      updateProfile('p1', { name: 'new-name' })
      expect(getProfile('p1')!.name).toBe('new-name')
    })

    it('updates the config', () => {
      createProfile('p1', 'm1', 'default', { gpuLayers: 10 })
      updateProfile('p1', { config: { gpuLayers: 99 } })
      expect(getProfile('p1')!.config.gpuLayers).toBe(99)
    })

    it('partial update preserves unchanged fields', () => {
      createProfile('p1', 'm1', 'original-name', { gpuLayers: 10 })
      updateProfile('p1', { config: { gpuLayers: 50 } })
      expect(getProfile('p1')!.name).toBe('original-name')
    })

    it('throws when profile not found', () => {
      expect(() => updateProfile('no-such-id', { name: 'x' })).toThrow()
    })
  })

  describe('deleteProfile', () => {
    it('removes the profile', () => {
      createProfile('p1', 'm1', 'default', {})
      deleteProfile('p1')
      expect(getProfile('p1')).toBeNull()
    })

    it('is idempotent', () => {
      expect(() => deleteProfile('no-such-id')).not.toThrow()
    })
  })

  describe('duplicateProfile', () => {
    it('creates a copy of the profile with a new id and name', () => {
      createProfile('p1', 'm1', 'original', { gpuLayers: 35 }, true)
      const copy = duplicateProfile('p1', 'p2', 'copy')
      expect(copy.id).toBe('p2')
      expect(copy.name).toBe('copy')
      expect(copy.modelId).toBe('m1')
      expect(copy.config.gpuLayers).toBe(35)
      expect(copy.active).toBe(false)
    })

    it('throws when source profile not found', () => {
      expect(() => duplicateProfile('no-such-id', 'p2', 'copy')).toThrow()
    })
  })
})
