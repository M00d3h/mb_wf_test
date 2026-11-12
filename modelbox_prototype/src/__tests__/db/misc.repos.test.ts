/**
 * Tests for folders.repo, mcp.repo, and vllmProfiles.repo.
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

const { createFolder, listFolders, deleteFolder, setConversationFolder } =
  await import('@main/db/repos/folders.repo')
const { createConversation, getConversation } =
  await import('@main/db/repos/conversations.repo')
const { listMCPServers, getMCPServer, createMCPServer, updateMCPServer, deleteMCPServer } =
  await import('@main/db/repos/mcp.repo')
const {
  upsertVllmModelByPath,
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

// ─── folders.repo ─────────────────────────────────────────────────────────────

describe.skipIf(!sqlite)('folders.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  it('returns empty array when no folders', () => {
    expect(listFolders()).toEqual([])
  })

  it('creates and lists a folder', () => {
    createFolder('f1', 'My Folder')
    const folders = listFolders()
    expect(folders).toHaveLength(1)
    expect(folders[0].name).toBe('My Folder')
    expect(folders[0].id).toBe('f1')
  })

  it('returns folders sorted by name', () => {
    createFolder('f2', 'Zzz')
    createFolder('f1', 'Aaa')
    const names = listFolders().map((f) => f.name)
    expect(names[0]).toBe('Aaa')
    expect(names[1]).toBe('Zzz')
  })

  it('deletes a folder', () => {
    createFolder('f1', 'Delete me')
    deleteFolder('f1')
    expect(listFolders()).toHaveLength(0)
  })

  it('delete is idempotent', () => {
    expect(() => deleteFolder('no-such-id')).not.toThrow()
  })

  it('sets and clears conversation folder', () => {
    createConversation({ id: 'c1', title: 'Conv' })
    createFolder('f1', 'Folder')
    setConversationFolder('c1', 'f1')
    const c = getConversation('c1') as (ReturnType<typeof getConversation> & { folderId?: string | null })
    // folderId is set on the raw row but may not be in the typed output
    // verify directly via DB
    const row = ctx!.db.prepare('SELECT folder_id FROM conversations WHERE id = ?').get('c1') as { folder_id: string | null }
    expect(row.folder_id).toBe('f1')
  })

  it('clears conversation folder with null', () => {
    createConversation({ id: 'c1', title: 'Conv' })
    createFolder('f1', 'Folder')
    setConversationFolder('c1', 'f1')
    setConversationFolder('c1', null)
    const row = ctx!.db.prepare('SELECT folder_id FROM conversations WHERE id = ?').get('c1') as { folder_id: string | null }
    expect(row.folder_id).toBeNull()
  })
})

// ─── mcp.repo ─────────────────────────────────────────────────────────────────

describe.skipIf(!sqlite)('mcp.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  const BASE_STDIO = {
    name: 'filesystem',
    transport: 'stdio' as const,
    command: '/usr/bin/npx',
    args: '-y @modelcontextprotocol/server-filesystem /tmp',
    enabled: true,
  }

  const BASE_SSE = {
    name: 'remote-server',
    transport: 'sse' as const,
    url: 'http://localhost:3000/sse',
    enabled: true,
  }

  it('returns empty array when no servers', () => {
    expect(listMCPServers()).toEqual([])
  })

  it('creates and retrieves a stdio server', () => {
    const s = createMCPServer(BASE_STDIO)
    expect(s.id).toBeTruthy()
    expect(s.name).toBe('filesystem')
    expect(s.transport).toBe('stdio')
    expect(s.command).toBe('/usr/bin/npx')
    expect(s.args).toBe('-y @modelcontextprotocol/server-filesystem /tmp')
    expect(s.enabled).toBe(true)
  })

  it('creates and retrieves an SSE server', () => {
    const s = createMCPServer(BASE_SSE)
    expect(s.transport).toBe('sse')
    expect(s.url).toBe('http://localhost:3000/sse')
    expect(s.command).toBeUndefined()
  })

  it('returns null for unknown id', () => {
    expect(getMCPServer('no-such-id')).toBeNull()
  })

  it('lists servers in creation order', () => {
    createMCPServer({ ...BASE_STDIO, name: 'first' })
    createMCPServer({ ...BASE_SSE, name: 'second' })
    const servers = listMCPServers()
    expect(servers[0].name).toBe('first')
    expect(servers[1].name).toBe('second')
  })

  it('updates a server', () => {
    const s = createMCPServer(BASE_STDIO)
    const updated = updateMCPServer(s.id, { name: 'renamed', enabled: false })
    expect(updated.name).toBe('renamed')
    expect(updated.enabled).toBe(false)
    expect(updated.command).toBe(BASE_STDIO.command)
  })

  it('throws when updating unknown server', () => {
    expect(() => updateMCPServer('no-such-id', { name: 'x' })).toThrow()
  })

  it('deletes a server', () => {
    const s = createMCPServer(BASE_STDIO)
    deleteMCPServer(s.id)
    expect(getMCPServer(s.id)).toBeNull()
  })

  it('delete is idempotent', () => {
    expect(() => deleteMCPServer('no-such-id')).not.toThrow()
  })

  it('stores token field', () => {
    const s = createMCPServer({ ...BASE_SSE, token: 'my-secret-token' })
    expect(getMCPServer(s.id)!.token).toBe('my-secret-token')
  })
})

// ─── vllmProfiles.repo ────────────────────────────────────────────────────────

describe.skipIf(!sqlite)('vllmProfiles.repo', () => {
  let modelId: string

  beforeEach(() => {
    ctx = createTestDb()
    const m = upsertVllmModelByPath('/models/qwen', 'Qwen2.5-7B')
    modelId = m.id
  })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('createVllmProfile / getVllmProfile', () => {
    it('creates and retrieves a profile', () => {
      createVllmProfile('vp1', modelId, 'default', {})
      const p = getVllmProfile('vp1')
      expect(p).not.toBeNull()
      expect(p!.name).toBe('default')
      expect(p!.vllmModelId).toBe(modelId)
      expect(p!.active).toBe(false)
    })

    it('returns null for unknown id', () => {
      expect(getVllmProfile('unknown')).toBeNull()
    })

    it('stores config JSON and round-trips it', () => {
      createVllmProfile('vp1', modelId, 'default', { port: 8000, maxModelLen: 16384 })
      const p = getVllmProfile('vp1')!
      expect(p.config.port).toBe(8000)
      expect(p.config.maxModelLen).toBe(16384)
    })
  })

  describe('listVllmProfiles', () => {
    it('returns empty array when no profiles', () => {
      expect(listVllmProfiles(modelId)).toEqual([])
    })

    it('returns only profiles for the specified model', () => {
      const m2 = upsertVllmModelByPath('/models/mistral', 'Mistral-7B')
      createVllmProfile('vp1', modelId, 'for-qwen', {})
      createVllmProfile('vp2', m2.id, 'for-mistral', {})
      expect(listVllmProfiles(modelId)).toHaveLength(1)
      expect(listVllmProfiles(modelId)[0].name).toBe('for-qwen')
    })
  })

  describe('DB trigger: single_active_vllm_profile', () => {
    it('deactivates old profile when new active profile is inserted', () => {
      createVllmProfile('vp1', modelId, 'first', {}, true)
      createVllmProfile('vp2', modelId, 'second', {}, true)
      expect(getVllmProfile('vp1')!.active).toBe(false)
      expect(getVllmProfile('vp2')!.active).toBe(true)
    })
  })

  describe('setActiveVllmProfile', () => {
    it('makes the profile active', () => {
      createVllmProfile('vp1', modelId, 'P1', {})
      createVllmProfile('vp2', modelId, 'P2', {})
      setActiveVllmProfile('vp2')
      expect(getVllmProfile('vp2')!.active).toBe(true)
    })

    it('deactivates previous active profile', () => {
      createVllmProfile('vp1', modelId, 'P1', {}, true)
      createVllmProfile('vp2', modelId, 'P2', {})
      setActiveVllmProfile('vp2')
      expect(getVllmProfile('vp1')!.active).toBe(false)
    })

    it('throws when profile not found', () => {
      expect(() => setActiveVllmProfile('no-such-id')).toThrow()
    })
  })

  describe('updateVllmProfile', () => {
    it('updates name', () => {
      createVllmProfile('vp1', modelId, 'old', {})
      updateVllmProfile('vp1', { name: 'new' })
      expect(getVllmProfile('vp1')!.name).toBe('new')
    })

    it('updates config', () => {
      createVllmProfile('vp1', modelId, 'default', { port: 8000 })
      updateVllmProfile('vp1', { config: { port: 9000 } })
      expect(getVllmProfile('vp1')!.config.port).toBe(9000)
    })

    it('throws when profile not found', () => {
      expect(() => updateVllmProfile('no-such-id', { name: 'x' })).toThrow()
    })
  })

  describe('deleteVllmProfile', () => {
    it('removes the profile', () => {
      createVllmProfile('vp1', modelId, 'default', {})
      deleteVllmProfile('vp1')
      expect(getVllmProfile('vp1')).toBeNull()
    })

    it('is idempotent', () => {
      expect(() => deleteVllmProfile('no-such-id')).not.toThrow()
    })
  })

  describe('duplicateVllmProfile', () => {
    it('creates a copy with new id and name', () => {
      createVllmProfile('vp1', modelId, 'original', { port: 8000 }, true)
      const copy = duplicateVllmProfile('vp1', 'vp2', 'copy')
      expect(copy.id).toBe('vp2')
      expect(copy.name).toBe('copy')
      expect(copy.config.port).toBe(8000)
      expect(copy.active).toBe(false)
    })

    it('throws when source not found', () => {
      expect(() => duplicateVllmProfile('no-such-id', 'vp2', 'copy')).toThrow()
    })
  })

  describe('ensureDefaultVllmProfile', () => {
    it('creates a default profile when none exist', () => {
      const p = ensureDefaultVllmProfile(modelId)
      expect(p).not.toBeNull()
      expect(p!.name).toBe('default')
      expect(p!.active).toBe(true)
    })

    it('returns the first existing profile without creating another', () => {
      createVllmProfile('vp1', modelId, 'existing', {}, false)
      const p = ensureDefaultVllmProfile(modelId)
      expect(p!.id).toBe('vp1')
      expect(listVllmProfiles(modelId)).toHaveLength(1)
    })

    it('returns null for unknown model id', () => {
      expect(ensureDefaultVllmProfile('no-such-model')).toBeNull()
    })
  })
})
