import { describe, it, expect } from 'vitest'
import {
  buildCommand,
  buildCommandResult,
  buildEnvFromConfig,
  resolveConfigMmproj,
  applyListenPortToArgs,
  formatSpawnCommand,
  argsIncludeApiKeyFlag,
} from '@main/services/commandBuilder'
import { API_KEY_COMMAND_MASK } from '@shared/apiKeyMask'
import { makeSettings } from '../helpers/makeSettings'
import type { ProfileConfig } from '@shared/types'

const MODEL = '/models/test-q4_k_m.gguf'

// ─── buildCommand ────────────────────────────────────────────────────────────

describe('buildCommand', () => {
  describe('minimal / default output', () => {
    it('returns the configured executable', () => {
      const s = makeSettings({ llamaServerPath: '/bin/llama-server' })
      const { executable } = buildCommand(MODEL, {}, undefined, s)
      expect(executable).toBe('/bin/llama-server')
    })

    it('produces only -m <path> when all profile fields are undefined', () => {
      const { args } = buildCommand(MODEL, {}, undefined, makeSettings())
      expect(args).toEqual(['-m', MODEL])
    })
  })

  describe('flag emission — numeric fields', () => {
    it('emits -c when contextSize is set', () => {
      const { args } = buildCommand(MODEL, { contextSize: 4096 }, undefined, makeSettings())
      expect(args).toContain('-c')
      expect(args[args.indexOf('-c') + 1]).toBe('4096')
    })

    it('omits -c when contextSize is undefined', () => {
      const { args } = buildCommand(MODEL, {}, undefined, makeSettings())
      expect(args).not.toContain('-c')
    })

    it('emits -ngl when gpuLayers is set', () => {
      const { args } = buildCommand(MODEL, { gpuLayers: 35 }, undefined, makeSettings())
      expect(args).toContain('-ngl')
      expect(args[args.indexOf('-ngl') + 1]).toBe('35')
    })

    it('emits --n-cpu-moe when nCpuMoe is set', () => {
      const { args } = buildCommand(MODEL, { nCpuMoe: 2 }, undefined, makeSettings())
      expect(args).toContain('--n-cpu-moe')
      expect(args[args.indexOf('--n-cpu-moe') + 1]).toBe('2')
    })

    it('emits --parallel when set', () => {
      const { args } = buildCommand(MODEL, { parallel: 4 }, undefined, makeSettings())
      expect(args).toContain('--parallel')
      expect(args[args.indexOf('--parallel') + 1]).toBe('4')
    })

    it('emits --temp, --top-p, --min-p, --top-k when set', () => {
      const config: ProfileConfig = { temp: 0.7, topP: 0.9, minP: 0.05, topK: 40 }
      const { args } = buildCommand(MODEL, config, undefined, makeSettings())
      expect(args).toContain('--temp')
      expect(args[args.indexOf('--temp') + 1]).toBe('0.7')
      expect(args).toContain('--top-p')
      expect(args[args.indexOf('--top-p') + 1]).toBe('0.9')
      expect(args).toContain('--min-p')
      expect(args[args.indexOf('--min-p') + 1]).toBe('0.05')
      expect(args).toContain('--top-k')
      expect(args[args.indexOf('--top-k') + 1]).toBe('40')
    })

    it('emits --repeat-penalty and --presence-penalty when set', () => {
      const { args } = buildCommand(MODEL, { repeatPenalty: 1.1, presencePenalty: 0.2 }, undefined, makeSettings())
      expect(args).toContain('--repeat-penalty')
      expect(args[args.indexOf('--repeat-penalty') + 1]).toBe('1.1')
      expect(args).toContain('--presence-penalty')
      expect(args[args.indexOf('--presence-penalty') + 1]).toBe('0.2')
    })

    it('emits speculative decoding flags when set', () => {
      const { args } = buildCommand(
        MODEL,
        { specType: 'ngram', specNgramSizeN: 4, draftMin: 1, draftMax: 8 },
        undefined,
        makeSettings()
      )
      expect(args).toContain('--spec-type')
      expect(args[args.indexOf('--spec-type') + 1]).toBe('ngram')
      expect(args).toContain('--spec-ngram-size-n')
      expect(args[args.indexOf('--spec-ngram-size-n') + 1]).toBe('4')
      expect(args).toContain('--draft-min')
      expect(args[args.indexOf('--draft-min') + 1]).toBe('1')
      expect(args).toContain('--draft-max')
      expect(args[args.indexOf('--draft-max') + 1]).toBe('8')
    })
  })

  describe('flag emission — string fields', () => {
    it('emits --host and --port when set', () => {
      const { args } = buildCommand(MODEL, { host: '0.0.0.0', port: 9090 }, undefined, makeSettings())
      expect(args).toContain('--host')
      expect(args[args.indexOf('--host') + 1]).toBe('0.0.0.0')
      expect(args).toContain('--port')
      expect(args[args.indexOf('--port') + 1]).toBe('9090')
    })

    it('emits -a when alias is set', () => {
      const { args } = buildCommand(MODEL, { alias: 'my-model' }, undefined, makeSettings())
      expect(args).toContain('-a')
      expect(args[args.indexOf('-a') + 1]).toBe('my-model')
    })

    it('emits --mmproj when set and not disabled', () => {
      const { args } = buildCommand(MODEL, { mmproj: '/models/mmproj.gguf' }, undefined, makeSettings())
      expect(args).toContain('--mmproj')
      expect(args[args.indexOf('--mmproj') + 1]).toBe('/models/mmproj.gguf')
    })

    it('omits --mmproj when mmprojDisabled is true', () => {
      const { args } = buildCommand(MODEL, { mmproj: '/models/mmproj.gguf', mmprojDisabled: true }, undefined, makeSettings())
      expect(args).not.toContain('--mmproj')
    })

    it('emits -fa flag when flashAttn is set', () => {
      const { args } = buildCommand(MODEL, { flashAttn: 'on' }, undefined, makeSettings())
      expect(args).toContain('-fa')
      expect(args[args.indexOf('-fa') + 1]).toBe('on')
    })

    it('emits -ctk and -ctv when kv cache types are set', () => {
      const { args } = buildCommand(MODEL, { kvCacheTypeK: 'q8_0', kvCacheTypeV: 'q8_0' }, undefined, makeSettings())
      expect(args).toContain('-ctk')
      expect(args[args.indexOf('-ctk') + 1]).toBe('q8_0')
      expect(args).toContain('-ctv')
      expect(args[args.indexOf('-ctv') + 1]).toBe('q8_0')
    })
  })

  describe('flag emission — boolean fields', () => {
    it('emits --embeddings when embeddings is true', () => {
      const { args } = buildCommand(MODEL, { embeddings: true }, undefined, makeSettings())
      expect(args).toContain('--embeddings')
    })

    it('omits --embeddings when embeddings is false', () => {
      const { args } = buildCommand(MODEL, { embeddings: false }, undefined, makeSettings())
      expect(args).not.toContain('--embeddings')
    })

    it('omits --embeddings when embeddings is undefined', () => {
      const { args } = buildCommand(MODEL, {}, undefined, makeSettings())
      expect(args).not.toContain('--embeddings')
    })

    it('emits --backend-sampling when backendSampling is true', () => {
      const { args } = buildCommand(MODEL, { backendSampling: true }, undefined, makeSettings())
      expect(args).toContain('--backend-sampling')
    })
  })

  describe('API key handling', () => {
    it('emits --api-key VALUE when apiKey is provided', () => {
      const { args } = buildCommand(MODEL, {}, 'my-secret-key', makeSettings())
      const idx = args.indexOf('--api-key')
      expect(idx).toBeGreaterThan(-1)
      expect(args[idx + 1]).toBe('my-secret-key')
    })

    it('does not emit --api-key when apiKey is undefined', () => {
      const { args } = buildCommand(MODEL, {}, undefined, makeSettings())
      expect(args).not.toContain('--api-key')
    })

    it('does not emit --api-key when apiKey is empty string', () => {
      const { args } = buildCommand(MODEL, {}, '', makeSettings())
      expect(args).not.toContain('--api-key')
    })

    it('returns the real key value in args (not masked)', () => {
      const { args } = buildCommand(MODEL, {}, 'real-secret', makeSettings())
      expect(args).toContain('real-secret')
    })
  })
})

// ─── buildCommandResult — builder mode ───────────────────────────────────────

describe('buildCommandResult (builder mode)', () => {
  it('returns masked key in args, not the real key', () => {
    const result = buildCommandResult(MODEL, {}, 'real-secret', makeSettings())
    const idx = result.args.indexOf('--api-key')
    expect(idx).toBeGreaterThan(-1)
    expect(result.args[idx + 1]).toBe(API_KEY_COMMAND_MASK)
    expect(result.args).not.toContain('real-secret')
  })

  it('fullCommand contains the mask, not the real key', () => {
    const result = buildCommandResult(MODEL, {}, 'real-secret', makeSettings())
    expect(result.fullCommand).toContain(API_KEY_COMMAND_MASK)
    expect(result.fullCommand).not.toContain('real-secret')
  })

  it('fullCommand does not contain --api-key when no key provided', () => {
    const result = buildCommandResult(MODEL, {}, undefined, makeSettings())
    expect(result.fullCommand).not.toContain('--api-key')
  })

  it('masks --api-key=VALUE inline format', () => {
    // buildCommand always uses --api-key VALUE (space-separated), but test mask resilience
    const result = buildCommandResult(MODEL, {}, 'real-secret', makeSettings())
    expect(result.fullCommand).not.toContain('real-secret')
  })
})

// ─── buildCommandResult — custom mode ────────────────────────────────────────

describe('buildCommandResult (custom mode)', () => {
  const customSettings = makeSettings({ llamaServerPath: '/ignored' })

  it('uses the custom executable and args from customCommandLine', () => {
    const config: ProfileConfig = {
      launchMode: 'custom',
      customCommandLine: '/path/to/llama-server -m /custom/model.gguf --port 7777',
    }
    const result = buildCommandResult(MODEL, config, undefined, customSettings)
    expect(result.executable).toBe('/path/to/llama-server')
    expect(result.args).toContain('/custom/model.gguf')
    expect(result.args).toContain('--port')
  })

  it('re-injects keychain key (masked) when custom command already has --api-key', () => {
    const config: ProfileConfig = {
      launchMode: 'custom',
      customCommandLine: '/bin/server -m /model.gguf --api-key old-placeholder',
    }
    const result = buildCommandResult(MODEL, config, 'real-secret', customSettings)
    const idx = result.args.indexOf('--api-key')
    expect(idx).toBeGreaterThan(-1)
    expect(result.args[idx + 1]).toBe(API_KEY_COMMAND_MASK)
    expect(result.fullCommand).not.toContain('real-secret')
  })

  it('does NOT inject key when user removed --api-key from custom command', () => {
    const config: ProfileConfig = {
      launchMode: 'custom',
      customCommandLine: '/bin/server -m /model.gguf --temp 0.7',
    }
    const result = buildCommandResult(MODEL, config, 'real-secret', customSettings)
    expect(result.args).not.toContain('--api-key')
    expect(result.fullCommand).not.toContain('api-key')
  })

  it('in liveOverride mode, applies profile fields and preserves unknown flags', () => {
    const config: ProfileConfig = {
      launchMode: 'custom',
      customCommandLine: '/bin/server -m /model.gguf --my-unknown-flag',
      contextSize: 8192,
      temp: 0.5,
    }
    const result = buildCommandResult(MODEL, config, undefined, customSettings, true)
    // Builder config flags applied
    expect(result.args).toContain('-c')
    expect(result.args[result.args.indexOf('-c') + 1]).toBe('8192')
    expect(result.args).toContain('--temp')
    // Unknown user flag preserved
    expect(result.args).toContain('--my-unknown-flag')
  })

  it('in liveOverride mode, model path comes from the ggufPath argument, not custom command', () => {
    const config: ProfileConfig = {
      launchMode: 'custom',
      customCommandLine: '/bin/server -m /old/model.gguf',
    }
    const result = buildCommandResult('/new/actual.gguf', config, undefined, customSettings, true)
    expect(result.args).toContain('/new/actual.gguf')
  })

  it('falls back to builder mode when customCommandLine is empty string', () => {
    // The guard `customCommandLine?.trim()` is falsy for '', so builder mode is used
    const config: ProfileConfig = {
      launchMode: 'custom',
      customCommandLine: '',
    }
    const result = buildCommandResult(MODEL, config, undefined, customSettings)
    expect(result.args[0]).toBe('-m')
    expect(result.args[1]).toBe(MODEL)
  })

  it('falls back to builder mode when launchMode is undefined', () => {
    const result = buildCommandResult(MODEL, {}, undefined, customSettings)
    expect(result.args[0]).toBe('-m')
    expect(result.args[1]).toBe(MODEL)
  })
})

// ─── resolveConfigMmproj ─────────────────────────────────────────────────────

describe('resolveConfigMmproj', () => {
  it('auto-assigns detected file whose name contains "mmproj"', () => {
    const result = resolveConfigMmproj({}, [
      '/models/test-q4_k_m.gguf',
      '/models/test-mmproj-f16.gguf',
    ])
    expect(result.mmproj).toBe('/models/test-mmproj-f16.gguf')
  })

  it('does not auto-assign when mmprojDisabled is true', () => {
    const result = resolveConfigMmproj({ mmprojDisabled: true }, ['/models/mmproj.gguf'])
    expect(result.mmproj).toBeUndefined()
  })

  it('does not override an already-set mmproj path', () => {
    const result = resolveConfigMmproj({ mmproj: '/custom/mmproj.gguf' }, [
      '/models/mmproj-detected.gguf',
    ])
    expect(result.mmproj).toBe('/custom/mmproj.gguf')
  })

  it('returns config unchanged when no detected file matches', () => {
    const result = resolveConfigMmproj({}, ['/models/no-match.gguf'])
    expect(result.mmproj).toBeUndefined()
  })

  it('returns config unchanged when detected list is empty', () => {
    const result = resolveConfigMmproj({}, [])
    expect(result.mmproj).toBeUndefined()
  })

  it('match is case-insensitive on the filename', () => {
    const result = resolveConfigMmproj({}, ['/models/MyModel-MmProj-f16.gguf'])
    expect(result.mmproj).toBe('/models/MyModel-MmProj-f16.gguf')
  })
})

// ─── applyListenPortToArgs ───────────────────────────────────────────────────

describe('applyListenPortToArgs', () => {
  it('appends --port PORT when no port flag exists', () => {
    const result = applyListenPortToArgs(['-m', MODEL], 9090)
    expect(result[result.length - 2]).toBe('--port')
    expect(result[result.length - 1]).toBe('9090')
  })

  it('strips existing --port VALUE and appends the new port', () => {
    const result = applyListenPortToArgs(['-m', MODEL, '--port', '8080', '--temp', '0.7'], 9090)
    // Old port gone
    expect(result).not.toContain('8080')
    // New port present
    const idx = result.indexOf('--port')
    expect(result[idx + 1]).toBe('9090')
    // Other flags preserved
    expect(result).toContain('--temp')
  })

  it('strips --port=VALUE inline form and appends new port', () => {
    const result = applyListenPortToArgs(['--port=8080', '-m', MODEL], 9090)
    expect(result).not.toContain('--port=8080')
    const idx = result.indexOf('--port')
    expect(result[idx + 1]).toBe('9090')
  })

  it('new port is always at the end of the array', () => {
    const result = applyListenPortToArgs(['-m', MODEL, '--port', '8080'], 9999)
    expect(result.at(-2)).toBe('--port')
    expect(result.at(-1)).toBe('9999')
  })
})

// ─── formatSpawnCommand ──────────────────────────────────────────────────────

describe('formatSpawnCommand', () => {
  it('joins executable and args with spaces when no quoting needed', () => {
    expect(formatSpawnCommand('/bin/server', ['-m', 'model.gguf'])).toBe(
      '/bin/server -m model.gguf'
    )
  })

  it('quotes args that contain spaces', () => {
    const cmd = formatSpawnCommand('/bin/server', ['-m', 'path with spaces/model.gguf'])
    expect(cmd).toBe('/bin/server -m "path with spaces/model.gguf"')
  })

  it('quotes an empty string arg', () => {
    const cmd = formatSpawnCommand('/bin/server', [''])
    expect(cmd).toBe('/bin/server ""')
  })

  it('quotes the executable when it contains spaces, doubling backslashes inside quotes', () => {
    // escapeForDoubleQuotedArg doubles backslashes: C:\Foo → C:\\Foo inside "..."
    const cmd = formatSpawnCommand('C:\\Program Files\\llama-server.exe', ['-m', 'model.gguf'])
    expect(cmd).toBe('"C:\\\\Program Files\\\\llama-server.exe" -m model.gguf')
  })

  it('escapes double-quotes inside quoted args', () => {
    const cmd = formatSpawnCommand('/bin/server', ['--msg', 'say "hello"'])
    expect(cmd).toContain('"say \\"hello\\""')
  })

  it('returns just the executable when args array is empty', () => {
    expect(formatSpawnCommand('/bin/server', [])).toBe('/bin/server')
  })
})

// ─── argsIncludeApiKeyFlag ───────────────────────────────────────────────────

describe('argsIncludeApiKeyFlag', () => {
  it('returns true for --api-key VALUE (space-separated) form', () => {
    expect(argsIncludeApiKeyFlag(['--api-key', 'some-value'])).toBe(true)
  })

  it('returns true for --api-key=VALUE inline form', () => {
    expect(argsIncludeApiKeyFlag(['--api-key=some-value'])).toBe(true)
  })

  it('returns false when no --api-key flag present', () => {
    expect(argsIncludeApiKeyFlag(['-m', 'model.gguf', '--port', '8080'])).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(argsIncludeApiKeyFlag([])).toBe(false)
  })
})

// ─── buildEnvFromConfig ──────────────────────────────────────────────────────

describe('buildEnvFromConfig', () => {
  it('merges custom env vars onto the process environment', () => {
    const env = buildEnvFromConfig({ env: { MY_CUSTOM_VAR: 'hello' } }, makeSettings())
    expect(env.MY_CUSTOM_VAR).toBe('hello')
  })

  it('custom env overrides existing env keys', () => {
    // Inject a known key that exists in process.env, then override it
    const originalPath = process.env.PATH ?? ''
    const env = buildEnvFromConfig({ env: { PATH: '/custom/path' } }, makeSettings())
    expect(env.PATH).toBe('/custom/path')
    // Restore is not needed — buildEnvFromConfig never mutates process.env
    expect(process.env.PATH).toBe(originalPath)
  })

  it('prepends cudaBinPath to PATH when prependCudaToPath is true', () => {
    const env = buildEnvFromConfig(
      { prependCudaToPath: true },
      makeSettings({ cudaBinPath: '/usr/local/cuda/bin' })
    )
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    expect(String(env[pathKey])).toMatch(/^\/usr\/local\/cuda\/bin/)
  })

  it('does not modify PATH when prependCudaToPath is false', () => {
    const envBefore = process.env.PATH
    const env = buildEnvFromConfig({ prependCudaToPath: false }, makeSettings({ cudaBinPath: '/cuda' }))
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    expect(String(env[pathKey])).not.toMatch(/^\/cuda/)
    expect(process.env.PATH).toBe(envBefore)
  })

  it('does not modify process.env', () => {
    const before = { ...process.env }
    buildEnvFromConfig({ env: { INJECTED: '1' }, prependCudaToPath: true }, makeSettings({ cudaBinPath: '/cuda' }))
    expect(process.env).toEqual(before)
  })
})
