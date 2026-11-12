import { describe, it, expect } from 'vitest'
import {
  mergeArgvIntoProfileConfig,
  parseScaledInt,
} from '@main/services/argvToProfileConfig'
import type { ProfileConfig } from '@shared/types'

const EMPTY: ProfileConfig = {}

// ─── parseScaledInt ───────────────────────────────────────────────────────────

describe('parseScaledInt', () => {
  it('parses plain integer', () => {
    expect(parseScaledInt('8192')).toBe(8192)
  })

  it('parses k suffix (thousands)', () => {
    expect(parseScaledInt('8k')).toBe(8000)
  })

  it('parses K suffix (case insensitive)', () => {
    expect(parseScaledInt('4K')).toBe(4000)
  })

  it('parses decimal with k', () => {
    expect(parseScaledInt('1.5k')).toBe(1500)
  })

  it('parses m suffix (millions)', () => {
    expect(parseScaledInt('1m')).toBe(1_000_000)
  })

  it('parses g suffix (billions)', () => {
    expect(parseScaledInt('1g')).toBe(1_000_000_000)
  })

  it('ignores underscores', () => {
    expect(parseScaledInt('8_192')).toBe(8192)
  })

  it('returns undefined for non-numeric input', () => {
    expect(parseScaledInt('abc')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseScaledInt('')).toBeUndefined()
  })
})

// ─── mergeArgvIntoProfileConfig ───────────────────────────────────────────────

describe('mergeArgvIntoProfileConfig', () => {
  describe('basic arg parsing', () => {
    it('returns empty config and no apiKey for empty args', () => {
      const { config, apiKey } = mergeArgvIntoProfileConfig([], EMPTY)
      expect(config).toEqual({})
      expect(apiKey).toBeUndefined()
    })

    it('ignores -m / --model flags (not a tracked field)', () => {
      const { config } = mergeArgvIntoProfileConfig(['-m', '/models/llama.gguf'], EMPTY)
      expect((config as Record<string, unknown>)['model']).toBeUndefined()
    })

    it('extracts --alias', () => {
      const { config } = mergeArgvIntoProfileConfig(['-a', 'my-alias'], EMPTY)
      expect(config.alias).toBe('my-alias')
    })

    it('extracts --alias long form', () => {
      const { config } = mergeArgvIntoProfileConfig(['--alias', 'long-alias'], EMPTY)
      expect(config.alias).toBe('long-alias')
    })

    it('extracts --mmproj path', () => {
      const { config } = mergeArgvIntoProfileConfig(
        ['--mmproj', '/models/llava-mmproj.gguf'],
        EMPTY
      )
      expect(config.mmproj).toBe('/models/llava-mmproj.gguf')
    })

    it('extracts --embeddings flag', () => {
      const { config } = mergeArgvIntoProfileConfig(['--embeddings'], EMPTY)
      expect(config.embeddings).toBe(true)
    })
  })

  describe('context / performance flags', () => {
    it('extracts -c ctx-size', () => {
      const { config } = mergeArgvIntoProfileConfig(['-c', '4096'], EMPTY)
      expect(config.contextSize).toBe(4096)
    })

    it('extracts --ctx-size with k suffix', () => {
      const { config } = mergeArgvIntoProfileConfig(['--ctx-size', '8k'], EMPTY)
      expect(config.contextSize).toBe(8000)
    })

    it('extracts -ngl gpu layers', () => {
      const { config } = mergeArgvIntoProfileConfig(['-ngl', '35'], EMPTY)
      expect(config.gpuLayers).toBe(35)
    })

    it('extracts --n-cpu-moe', () => {
      const { config } = mergeArgvIntoProfileConfig(['--n-cpu-moe', '2'], EMPTY)
      expect(config.nCpuMoe).toBe(2)
    })

    it('extracts -fa on', () => {
      const { config } = mergeArgvIntoProfileConfig(['-fa', 'on'], EMPTY)
      expect(config.flashAttn).toBe('on')
    })

    it('extracts -fa off', () => {
      const { config } = mergeArgvIntoProfileConfig(['-fa', 'off'], EMPTY)
      expect(config.flashAttn).toBe('off')
    })

    it('ignores invalid -fa value', () => {
      const { config } = mergeArgvIntoProfileConfig(['-fa', 'yes'], EMPTY)
      expect(config.flashAttn).toBeUndefined()
    })

    it('extracts --backend-sampling flag', () => {
      const { config } = mergeArgvIntoProfileConfig(['--backend-sampling'], EMPTY)
      expect(config.backendSampling).toBe(true)
    })

    it('extracts --parallel', () => {
      const { config } = mergeArgvIntoProfileConfig(['--parallel', '4'], EMPTY)
      expect(config.parallel).toBe(4)
    })

    it('extracts -ctk kv cache type K', () => {
      const { config } = mergeArgvIntoProfileConfig(['-ctk', 'q8_0'], EMPTY)
      expect(config.kvCacheTypeK).toBe('q8_0')
    })

    it('extracts -ctv kv cache type V', () => {
      const { config } = mergeArgvIntoProfileConfig(['-ctv', 'q4_0'], EMPTY)
      expect(config.kvCacheTypeV).toBe('q4_0')
    })
  })

  describe('networking flags', () => {
    it('extracts --host', () => {
      const { config } = mergeArgvIntoProfileConfig(['--host', '0.0.0.0'], EMPTY)
      expect(config.host).toBe('0.0.0.0')
    })

    it('extracts --port', () => {
      const { config } = mergeArgvIntoProfileConfig(['--port', '8080'], EMPTY)
      expect(config.port).toBe(8080)
    })

    it('captures --api-key and returns it separately (not in config)', () => {
      const { config, apiKey } = mergeArgvIntoProfileConfig(
        ['--api-key', 'secret-key-123'],
        EMPTY
      )
      expect(apiKey).toBe('secret-key-123')
      expect((config as Record<string, unknown>)['apiKey']).toBeUndefined()
    })

    it('captures --api-key with inline = syntax', () => {
      const { apiKey } = mergeArgvIntoProfileConfig(['--api-key=inlinekey'], EMPTY)
      expect(apiKey).toBe('inlinekey')
    })
  })

  describe('sampling flags', () => {
    it('extracts --temp', () => {
      const { config } = mergeArgvIntoProfileConfig(['--temp', '0.8'], EMPTY)
      expect(config.temp).toBeCloseTo(0.8)
    })

    it('extracts --top-p', () => {
      const { config } = mergeArgvIntoProfileConfig(['--top-p', '0.95'], EMPTY)
      expect(config.topP).toBeCloseTo(0.95)
    })

    it('extracts --min-p', () => {
      const { config } = mergeArgvIntoProfileConfig(['--min-p', '0.05'], EMPTY)
      expect(config.minP).toBeCloseTo(0.05)
    })

    it('extracts --top-k', () => {
      const { config } = mergeArgvIntoProfileConfig(['--top-k', '40'], EMPTY)
      expect(config.topK).toBe(40)
    })

    it('extracts --top_k (underscore form)', () => {
      const { config } = mergeArgvIntoProfileConfig(['--top_k', '50'], EMPTY)
      expect(config.topK).toBe(50)
    })

    it('extracts --repeat-penalty', () => {
      const { config } = mergeArgvIntoProfileConfig(['--repeat-penalty', '1.1'], EMPTY)
      expect(config.repeatPenalty).toBeCloseTo(1.1)
    })

    it('extracts --presence-penalty', () => {
      const { config } = mergeArgvIntoProfileConfig(['--presence-penalty', '0.2'], EMPTY)
      expect(config.presencePenalty).toBeCloseTo(0.2)
    })
  })

  describe('speculative decoding flags', () => {
    it('extracts --spec-type', () => {
      const { config } = mergeArgvIntoProfileConfig(['--spec-type', 'ngram'], EMPTY)
      expect(config.specType).toBe('ngram')
    })

    it('extracts --spec-ngram-size-n', () => {
      const { config } = mergeArgvIntoProfileConfig(['--spec-ngram-size-n', '4'], EMPTY)
      expect(config.specNgramSizeN).toBe(4)
    })

    it('extracts --draft-min and --draft-max', () => {
      const { config } = mergeArgvIntoProfileConfig(
        ['--draft-min', '2', '--draft-max', '8'],
        EMPTY
      )
      expect(config.draftMin).toBe(2)
      expect(config.draftMax).toBe(8)
    })
  })

  describe('= inline value syntax', () => {
    it('parses --port=9999', () => {
      const { config } = mergeArgvIntoProfileConfig(['--port=9999'], EMPTY)
      expect(config.port).toBe(9999)
    })

    it('parses --alias=myname', () => {
      const { config } = mergeArgvIntoProfileConfig(['--alias=myname'], EMPTY)
      expect(config.alias).toBe('myname')
    })
  })

  describe('tracked keys removal', () => {
    it('removes tracked key from base when not present in argv', () => {
      const base: ProfileConfig = { gpuLayers: 20, contextSize: 4096 }
      const { config } = mergeArgvIntoProfileConfig(['-ngl', '35'], base)
      // gpuLayers present in argv → updated; contextSize not in argv → removed
      expect(config.gpuLayers).toBe(35)
      expect(config.contextSize).toBeUndefined()
    })

    it('preserves non-tracked fields from base', () => {
      const base: ProfileConfig = {
        env: { CUDA_VISIBLE_DEVICES: '0' },
        prependCudaToPath: true,
        launchMode: 'builder',
      }
      const { config } = mergeArgvIntoProfileConfig(['-ngl', '10'], base)
      expect(config.env).toEqual({ CUDA_VISIBLE_DEVICES: '0' })
      expect(config.prependCudaToPath).toBe(true)
      expect(config.launchMode).toBe('builder')
    })
  })

  describe('mixed real-world command', () => {
    it('parses a typical llama-server invocation', () => {
      const args = [
        '-m', '/models/qwen3-8b.gguf',
        '-ngl', '99',
        '-c', '32768',
        '-fa', 'on',
        '--parallel', '2',
        '--host', '127.0.0.1',
        '--port', '8080',
        '--api-key', 'sk-abc',
        '--temp', '0.6',
      ]
      const { config, apiKey } = mergeArgvIntoProfileConfig(args, EMPTY)
      expect(config.gpuLayers).toBe(99)
      expect(config.contextSize).toBe(32768)
      expect(config.flashAttn).toBe('on')
      expect(config.parallel).toBe(2)
      expect(config.host).toBe('127.0.0.1')
      expect(config.port).toBe(8080)
      expect(config.temp).toBeCloseTo(0.6)
      expect(apiKey).toBe('sk-abc')
    })
  })
})
