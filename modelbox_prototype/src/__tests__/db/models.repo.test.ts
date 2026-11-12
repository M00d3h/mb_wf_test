/**
 * DB repo tests require better-sqlite3 compiled for standard Node.js ABI.
 * Run `npm run test:db` which rebuilds the native module, runs these tests,
 * then restores the Electron build.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isSqliteAvailable, createTestDb } from '../helpers/makeDb'

const sqlite = isSqliteAvailable()

// Stub out ggufFileSizes (reads disk — not needed for repo tests)
vi.mock('@main/services/ggufFileSizes', () => ({
  sumGgufFileSizes: () => 0,
}))

// Provide an in-memory DB in place of the Electron-managed file DB
let ctx: ReturnType<typeof createTestDb> | null = null
vi.mock('@main/db/database', () => ({
  getDb: () => {
    if (!ctx) throw new Error('test db not initialised')
    return ctx.db
  },
}))

// Lazy import — only resolved after the mocks above are registered
const { upsertModel, getModel, listModels, getModelByPath, deleteModel } =
  await import('@main/db/repos/models.repo')

const BASE: Parameters<typeof upsertModel>[0] = {
  id: 'm1',
  name: 'Llama-3-8B',
  ggufPath: '/models/llama-3-8b-q4.gguf',
  modelDir: '/models',
  isEmbedding: false,
  isMultimodal: false,
  detectedFiles: ['/models/llama-3-8b-q4.gguf'],
}

describe.skipIf(!sqlite)('models.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('upsertModel / getModel', () => {
    it('inserts a new model and retrieves it by id', () => {
      upsertModel(BASE)
      const m = getModel('m1')
      expect(m).not.toBeNull()
      expect(m!.name).toBe('Llama-3-8B')
      expect(m!.ggufPath).toContain('llama-3-8b-q4.gguf')
    })

    it('updates an existing model on conflict (same gguf_path)', () => {
      upsertModel(BASE)
      upsertModel({ ...BASE, name: 'Updated-Name' })
      expect(getModel('m1')!.name).toBe('Updated-Name')
    })

    it('returns null for unknown id', () => {
      expect(getModel('unknown')).toBeNull()
    })

    it('round-trips boolean fields correctly', () => {
      upsertModel({ ...BASE, isEmbedding: true, isMultimodal: true })
      const m = getModel('m1')!
      expect(m.isEmbedding).toBe(true)
      expect(m.isMultimodal).toBe(true)
    })

    it('round-trips optional numeric fields (maxContextTokens, blockCount)', () => {
      upsertModel({ ...BASE, maxContextTokens: 4096, blockCount: 32 })
      const m = getModel('m1')!
      expect(m.maxContextTokens).toBe(4096)
      expect(m.blockCount).toBe(32)
    })

    it('stores undefined optional fields as undefined (not null)', () => {
      upsertModel(BASE)
      const m = getModel('m1')!
      expect(m.maxContextTokens).toBeUndefined()
      expect(m.quantLabel).toBeUndefined()
    })

    it('round-trips detectedFiles JSON array', () => {
      const files = ['/models/llama.gguf', '/models/mmproj.gguf']
      upsertModel({ ...BASE, detectedFiles: files })
      expect(getModel('m1')!.detectedFiles).toEqual(files)
    })
  })

  describe('listModels', () => {
    it('returns empty array when no models', () => {
      expect(listModels()).toEqual([])
    })

    it('returns all inserted models', () => {
      upsertModel(BASE)
      upsertModel({ ...BASE, id: 'm2', name: 'Mistral-7B', ggufPath: '/models/mistral.gguf' })
      expect(listModels()).toHaveLength(2)
    })

    it('returns models sorted by name', () => {
      upsertModel({ ...BASE, id: 'm2', name: 'Zzz-model', ggufPath: '/models/zzz.gguf' })
      upsertModel({ ...BASE, id: 'm1', name: 'Aaa-model', ggufPath: '/models/aaa.gguf' })
      const names = listModels().map((m) => m.name)
      expect(names[0]).toBe('Aaa-model')
      expect(names[1]).toBe('Zzz-model')
    })
  })

  describe('getModelByPath', () => {
    it('finds a model by exact path', () => {
      upsertModel(BASE)
      const m = getModelByPath('/models/llama-3-8b-q4.gguf')
      expect(m).not.toBeNull()
      expect(m!.id).toBe('m1')
    })

    it('returns null for unknown path', () => {
      expect(getModelByPath('/models/nonexistent.gguf')).toBeNull()
    })

    it('is case-insensitive on Windows', () => {
      if (process.platform !== 'win32') return
      upsertModel(BASE)
      const m = getModelByPath('/MODELS/LLAMA-3-8B-Q4.GGUF')
      expect(m).not.toBeNull()
    })
  })

  describe('deleteModel', () => {
    it('removes the model from the database', () => {
      upsertModel(BASE)
      expect(getModel('m1')).not.toBeNull()
      deleteModel('m1')
      expect(getModel('m1')).toBeNull()
    })

    it('is idempotent — deleting non-existent id does not throw', () => {
      expect(() => deleteModel('no-such-id')).not.toThrow()
    })
  })
})
