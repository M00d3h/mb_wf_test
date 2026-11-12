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

const { upsertModel } = await import('@main/db/repos/models.repo')
const { createProfile } = await import('@main/db/repos/profiles.repo')
const { upsertVllmModelByPath } = await import('@main/db/repos/vllmModels.repo')
const { createVllmProfile } = await import('@main/db/repos/vllmProfiles.repo')
const {
  listInstances,
  getInstance,
  createInstance,
  deleteInstance,
  clearAllInstances,
  updateInstanceState,
} = await import('@main/db/repos/serverInstances.repo')

const BASE_MODEL = {
  id: 'm1',
  name: 'Llama-3-8B',
  ggufPath: '/models/llama-3-8b.gguf',
  modelDir: '/models',
  isEmbedding: false,
  isMultimodal: false,
  detectedFiles: ['/models/llama-3-8b.gguf'],
}

describe.skipIf(!sqlite)('serverInstances.repo', () => {
  let profileId: string

  beforeEach(() => {
    ctx = createTestDb()
    upsertModel(BASE_MODEL)
    const p = createProfile('p1', 'm1', 'default', {})
    profileId = p.id
  })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('createInstance / getInstance', () => {
    it('creates a llama instance and retrieves it', () => {
      const inst = createInstance({
        id: 'i1',
        instanceKind: 'llama',
        modelId: 'm1',
        profileId,
        host: '127.0.0.1',
        port: 8080,
      })
      expect(inst.id).toBe('i1')
      expect(inst.instanceKind).toBe('llama')
      expect(inst.modelId).toBe('m1')
      expect(inst.profileId).toBe(profileId)
      expect(inst.host).toBe('127.0.0.1')
      expect(inst.port).toBe(8080)
      expect(inst.state).toBe('stopped')
    })

    it('creates a vllm instance', () => {
      const vm = upsertVllmModelByPath('/models/qwen', 'Qwen')
      const vp = createVllmProfile('vp1', vm.id, 'default', {})
      const inst = createInstance({
        id: 'i1',
        instanceKind: 'vllm',
        vllmModelId: vm.id,
        vllmProfileId: vp.id,
        host: '127.0.0.1',
        port: 8000,
      })
      expect(inst.instanceKind).toBe('vllm')
      expect(inst.vllmModelId).toBe(vm.id)
      expect(inst.modelId).toBeNull()
    })

    it('returns null for unknown id', () => {
      expect(getInstance('no-such-id')).toBeNull()
    })

    it('initial state is stopped', () => {
      const inst = createInstance({
        id: 'i1',
        instanceKind: 'llama',
        modelId: 'm1',
        profileId,
        host: '127.0.0.1',
        port: 8080,
      })
      expect(inst.state).toBe('stopped')
      expect(inst.pid).toBeNull()
      expect(inst.startedAt).toBeNull()
    })
  })

  describe('listInstances', () => {
    it('returns empty array when no instances', () => {
      expect(listInstances()).toEqual([])
    })

    it('returns instances in descending created_at order', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      createInstance({ id: 'i2', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8081 })
      // datetime('now') has 1-second precision — force i2 ahead of i1 explicitly
      ctx!.db.prepare(
        "UPDATE server_instances SET created_at = datetime('now', '+1 second') WHERE id = 'i2'"
      ).run()
      const instances = listInstances()
      expect(instances[0].id).toBe('i2')
      expect(instances[1].id).toBe('i1')
    })
  })

  describe('updateInstanceState', () => {
    it('updates state to running with pid and startedAt', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      updateInstanceState('i1', 'running', 12345, '2024-01-01T00:00:00Z')
      const inst = getInstance('i1')!
      expect(inst.state).toBe('running')
      expect(inst.pid).toBe(12345)
      expect(inst.startedAt).toBe('2024-01-01T00:00:00Z')
    })

    it('updates state to stopped with stoppedAt', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      updateInstanceState('i1', 'running', 12345, '2024-01-01T00:00:00Z')
      updateInstanceState('i1', 'stopped', null, null, '2024-01-01T01:00:00Z')
      const inst = getInstance('i1')!
      expect(inst.state).toBe('stopped')
      expect(inst.stoppedAt).toBe('2024-01-01T01:00:00Z')
    })

    it('preserves pid when null pid is passed (COALESCE)', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      updateInstanceState('i1', 'starting', 99999, '2024-01-01T00:00:00Z')
      updateInstanceState('i1', 'running', null) // null pid → keep existing
      const inst = getInstance('i1')!
      expect(inst.pid).toBe(99999)
    })

    it('handles all ServerState values', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      for (const state of ['starting', 'loading', 'running', 'stopping', 'stopped', 'error'] as const) {
        updateInstanceState('i1', state)
        expect(getInstance('i1')!.state).toBe(state)
      }
    })
  })

  describe('deleteInstance', () => {
    it('removes an instance', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      deleteInstance('i1')
      expect(getInstance('i1')).toBeNull()
    })

    it('is idempotent', () => {
      expect(() => deleteInstance('no-such-id')).not.toThrow()
    })
  })

  describe('clearAllInstances', () => {
    it('removes all instances', () => {
      createInstance({ id: 'i1', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8080 })
      createInstance({ id: 'i2', instanceKind: 'llama', modelId: 'm1', profileId, host: '127.0.0.1', port: 8081 })
      clearAllInstances()
      expect(listInstances()).toHaveLength(0)
    })

    it('does not throw when table is empty', () => {
      expect(() => clearAllInstances()).not.toThrow()
    })
  })
})
