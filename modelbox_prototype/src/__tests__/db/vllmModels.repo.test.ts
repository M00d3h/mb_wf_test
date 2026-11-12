/**
 * Requires better-sqlite3 compiled for standard Node.js.
 * Run `npm run test:db` — see models.repo.test.ts for details.
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
  listVllmModels,
  getVllmModel,
  getVllmModelByPath,
  upsertVllmModelByPath,
  updateVllmModel,
  deleteVllmModel,
} = await import('@main/db/repos/vllmModels.repo')

describe.skipIf(!sqlite)('vllmModels.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('upsertVllmModelByPath / getVllmModel', () => {
    it('inserts and retrieves a model', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      expect(m.id).toBeTruthy()
      expect(m.path).toBe('/models/Qwen2.5-7B')
      expect(m.displayName).toBe('Qwen2.5-7B')
      expect(m.config).toEqual({})
    })

    it('returns null for unknown id', () => {
      expect(getVllmModel('unknown-id')).toBeNull()
    })

    it('updates displayName on second upsert for same path', () => {
      const m1 = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Original Name')
      upsertVllmModelByPath('/models/Qwen2.5-7B', 'Updated Name')
      const m2 = getVllmModel(m1.id)!
      expect(m2.displayName).toBe('Updated Name')
      // Same id — no duplicate row
      expect(listVllmModels()).toHaveLength(1)
    })

    it('stores dtype when provided', () => {
      const m = upsertVllmModelByPath('/models/model', 'Model', 'bfloat16')
      expect(getVllmModel(m.id)!.dtype).toBe('bfloat16')
    })

    it('dtype is null when not provided', () => {
      const m = upsertVllmModelByPath('/models/model', 'Model')
      expect(getVllmModel(m.id)!.dtype).toBeNull()
    })
  })

  describe('getVllmModelByPath', () => {
    it('finds model by exact path', () => {
      const m = upsertVllmModelByPath('/models/Qwen2.5-7B', 'Qwen2.5-7B')
      const found = getVllmModelByPath('/models/Qwen2.5-7B')
      expect(found).not.toBeNull()
      expect(found!.id).toBe(m.id)
    })

    it('returns null for unknown path', () => {
      expect(getVllmModelByPath('/models/nonexistent')).toBeNull()
    })

    it('normalizes \\\\wsl.localhost\\ to \\\\wsl$\\', () => {
      upsertVllmModelByPath('\\\\wsl$\\Ubuntu\\models\\qwen', 'Qwen')
      const found = getVllmModelByPath('\\\\wsl.localhost\\Ubuntu\\models\\qwen')
      expect(found).not.toBeNull()
    })
  })

  describe('listVllmModels', () => {
    it('returns empty array when no models', () => {
      expect(listVllmModels()).toEqual([])
    })

    it('returns models sorted by display_name', () => {
      upsertVllmModelByPath('/models/z', 'Zzz-Model')
      upsertVllmModelByPath('/models/a', 'Aaa-Model')
      const names = listVllmModels().map((m) => m.displayName)
      expect(names[0]).toBe('Aaa-Model')
      expect(names[1]).toBe('Zzz-Model')
    })
  })

  describe('updateVllmModel', () => {
    it('updates displayName', () => {
      const m = upsertVllmModelByPath('/models/m', 'Old')
      updateVllmModel(m.id, { displayName: 'New' })
      expect(getVllmModel(m.id)!.displayName).toBe('New')
    })

    it('merges config patch into existing config', () => {
      const m = upsertVllmModelByPath('/models/m', 'Model')
      updateVllmModel(m.id, { config: { port: 8000 } })
      updateVllmModel(m.id, { config: { maxModelLen: 4096 } })
      const updated = getVllmModel(m.id)!
      expect(updated.config.port).toBe(8000)
      expect(updated.config.maxModelLen).toBe(4096)
    })

    it('returns null for unknown id', () => {
      expect(updateVllmModel('no-such-id', { displayName: 'x' })).toBeNull()
    })
  })

  describe('deleteVllmModel', () => {
    it('removes the model', () => {
      const m = upsertVllmModelByPath('/models/m', 'Model')
      deleteVllmModel(m.id)
      expect(getVllmModel(m.id)).toBeNull()
    })

    it('is idempotent', () => {
      expect(() => deleteVllmModel('no-such-id')).not.toThrow()
    })
  })
})
