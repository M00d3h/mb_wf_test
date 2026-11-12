/**
 * Requires better-sqlite3 compiled for standard Node.js.
 * Run `npm run test:db` — see models.repo.test.ts for details.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isSqliteAvailable, createTestDb } from '../helpers/makeDb'

const sqlite = isSqliteAvailable()

let ctx: ReturnType<typeof createTestDb> | null = null
vi.mock('@main/db/database', () => ({
  getDb: () => {
    if (!ctx) throw new Error('test db not initialised')
    return ctx.db
  },
}))

const {
  getSetting,
  setSetting,
  getSettings,
  updateSettings,
  resolveModelsDirForHfDownload,
  resolveVllmDirForHfDownload,
  getPrimaryModelsDir,
} = await import('@main/db/repos/settings.repo')

describe.skipIf(!sqlite)('settings.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('getSetting / setSetting', () => {
    it('returns null for unknown key', () => {
      expect(getSetting('no_such_key')).toBeNull()
    })

    it('stores and retrieves a string value', () => {
      setSetting('test_key', 'hello')
      expect(getSetting('test_key')).toBe('hello')
    })

    it('overwrites existing value (INSERT OR REPLACE)', () => {
      setSetting('test_key', 'v1')
      setSetting('test_key', 'v2')
      expect(getSetting('test_key')).toBe('v2')
    })
  })

  describe('getSettings defaults', () => {
    it('returns firstRun=true when no settings in DB', () => {
      const s = getSettings()
      expect(s.firstRun).toBe(true)
    })

    it('returns a valid modelsDirs array', () => {
      const s = getSettings()
      expect(Array.isArray(s.modelsDirs)).toBe(true)
      expect(s.modelsDirs.length).toBeGreaterThan(0)
    })

    it('returns numeric defaults for ports', () => {
      const s = getSettings()
      expect(typeof s.llamaBasePort).toBe('number')
      expect(typeof s.vllmBasePort).toBe('number')
    })

    it('returns default font size 14', () => {
      const s = getSettings()
      expect(s.fontSize).toBe(14)
    })

    it('returns wslMode=false by default', () => {
      const s = getSettings()
      expect(s.wslMode).toBe(false)
    })
  })

  describe('updateSettings', () => {
    it('updates llamaServerPath', () => {
      const s = updateSettings({ llamaServerPath: '/usr/local/bin/llama-server' })
      expect(s.llamaServerPath).toBe('/usr/local/bin/llama-server')
    })

    it('updates firstRun to false', () => {
      const s = updateSettings({ firstRun: false })
      expect(s.firstRun).toBe(false)
    })

    it('updates firstRun back to true', () => {
      updateSettings({ firstRun: false })
      const s = updateSettings({ firstRun: true })
      expect(s.firstRun).toBe(true)
    })

    it('updates modelsDirs array', () => {
      const dirs = ['/models/fast', '/models/slow']
      const s = updateSettings({ modelsDirs: dirs })
      expect(s.modelsDirs).toEqual(dirs)
    })

    it('updates llamaDefaultHost', () => {
      const s = updateSettings({ llamaDefaultHost: '127.0.0.1' })
      expect(s.llamaDefaultHost).toBe('127.0.0.1')
    })

    it('updates llamaBasePort', () => {
      const s = updateSettings({ llamaBasePort: 9000 })
      expect(s.llamaBasePort).toBe(9000)
    })

    it('updates fontSize', () => {
      const s = updateSettings({ fontSize: 16 })
      expect(s.fontSize).toBe(16)
    })

    it('updates wslMode', () => {
      const s = updateSettings({ wslMode: true })
      expect(s.wslMode).toBe(true)
    })

    it('partial update preserves other fields', () => {
      updateSettings({ llamaServerPath: '/bin/server', fontSize: 18 })
      const s = updateSettings({ fontSize: 20 })
      expect(s.llamaServerPath).toBe('/bin/server')
      expect(s.fontSize).toBe(20)
    })

    it('updates vllmModelDirs', () => {
      const dirs = ['/hf/hub', '/hf/models']
      const s = updateSettings({ vllmModelDirs: dirs })
      expect(s.vllmModelDirs).toEqual(dirs)
    })

    it('updates vllmRuntime', () => {
      const s = updateSettings({
        vllmRuntime: {
          envKind: 'docker',
          dockerImage: 'vllm/vllm-openai:v0.8.0',
          dockerExtraArgs: '--gpus all',
          condaEnvName: '',
          condaShPath: '',
          venvPath: '',
          wslDistro: '',
        },
      })
      expect(s.vllmRuntime.envKind).toBe('docker')
      expect(s.vllmRuntime.dockerImage).toBe('vllm/vllm-openai:v0.8.0')
    })
  })

  describe('resolveModelsDirForHfDownload', () => {
    it('returns primary dir when requested is undefined', () => {
      const s = updateSettings({ modelsDirs: ['/models/primary', '/models/secondary'] })
      const result = resolveModelsDirForHfDownload(s, undefined)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.modelsDir).toBe('/models/primary')
    })

    it('returns primary dir when requested is empty string', () => {
      const s = updateSettings({ modelsDirs: ['/models/primary'] })
      const result = resolveModelsDirForHfDownload(s, '')
      expect(result.ok).toBe(true)
    })

    it('accepts a known configured dir', () => {
      const s = updateSettings({ modelsDirs: ['/models/fast', '/models/slow'] })
      const result = resolveModelsDirForHfDownload(s, '/models/slow')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.modelsDir).toBe('/models/slow')
    })

    it('rejects an unknown dir', () => {
      const s = updateSettings({ modelsDirs: ['/models/fast'] })
      const result = resolveModelsDirForHfDownload(s, '/models/other')
      expect(result.ok).toBe(false)
    })
  })

  describe('resolveVllmDirForHfDownload', () => {
    it('returns error when no vllmModelDirs configured', () => {
      const s = updateSettings({ vllmModelDirs: [] })
      const result = resolveVllmDirForHfDownload(s, undefined)
      expect(result.ok).toBe(false)
    })

    it('returns first vllmDir when requested is undefined', () => {
      const s = updateSettings({ vllmModelDirs: ['/hf/hub', '/hf/other'] })
      const result = resolveVllmDirForHfDownload(s, undefined)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.vllmDir).toBe('/hf/hub')
    })

    it('accepts a known configured vllm dir', () => {
      const s = updateSettings({ vllmModelDirs: ['/hf/hub', '/hf/other'] })
      const result = resolveVllmDirForHfDownload(s, '/hf/other')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.vllmDir).toBe('/hf/other')
    })

    it('rejects an unknown vllm dir', () => {
      const s = updateSettings({ vllmModelDirs: ['/hf/hub'] })
      const result = resolveVllmDirForHfDownload(s, '/hf/unknown')
      expect(result.ok).toBe(false)
    })
  })

  describe('getPrimaryModelsDir', () => {
    it('returns first models dir', () => {
      const s = updateSettings({ modelsDirs: ['/models/a', '/models/b'] })
      expect(getPrimaryModelsDir(s)).toBe('/models/a')
    })
  })
})
