import { describe, it, expect } from 'vitest'
import { mergeArgvIntoVllmConfig } from '@main/services/argvToVllmConfig'
import type { VllmModelConfig } from '@shared/types'

const EMPTY: VllmModelConfig = {}

describe('mergeArgvIntoVllmConfig', () => {
  describe('basic flags', () => {
    it('returns empty config for empty args', () => {
      expect(mergeArgvIntoVllmConfig([], EMPTY)).toEqual({})
    })

    it('extracts --host', () => {
      const cfg = mergeArgvIntoVllmConfig(['--host', '0.0.0.0'], EMPTY)
      expect(cfg.host).toBe('0.0.0.0')
    })

    it('extracts --port', () => {
      const cfg = mergeArgvIntoVllmConfig(['--port', '8000'], EMPTY)
      expect(cfg.port).toBe(8000)
    })

    it('extracts --max-model-len', () => {
      const cfg = mergeArgvIntoVllmConfig(['--max-model-len', '16384'], EMPTY)
      expect(cfg.maxModelLen).toBe(16384)
    })

    it('extracts --reasoning-parser', () => {
      const cfg = mergeArgvIntoVllmConfig(['--reasoning-parser', 'deepseek_r1'], EMPTY)
      expect(cfg.reasoningParser).toBe('deepseek_r1')
    })

    it('extracts --enable-auto-tool-choice as bool', () => {
      const cfg = mergeArgvIntoVllmConfig(['--enable-auto-tool-choice'], EMPTY)
      expect(cfg.enableAutoToolChoice).toBe(true)
    })

    it('extracts --tool-call-parser', () => {
      const cfg = mergeArgvIntoVllmConfig(['--tool-call-parser', 'hermes'], EMPTY)
      expect(cfg.toolCallParser).toBe('hermes')
    })

    it('extracts --served-model-name', () => {
      const cfg = mergeArgvIntoVllmConfig(['--served-model-name', 'my-model'], EMPTY)
      expect(cfg.servedModelName).toBe('my-model')
    })

    it('extracts --max-num-seqs', () => {
      const cfg = mergeArgvIntoVllmConfig(['--max-num-seqs', '256'], EMPTY)
      expect(cfg.maxNumSeqs).toBe(256)
    })

    it('extracts --gpu-memory-utilization', () => {
      const cfg = mergeArgvIntoVllmConfig(['--gpu-memory-utilization', '0.9'], EMPTY)
      expect(cfg.gpuMemoryUtilization).toBeCloseTo(0.9)
    })

    it('extracts --kv-cache-dtype', () => {
      const cfg = mergeArgvIntoVllmConfig(['--kv-cache-dtype', 'fp8'], EMPTY)
      expect(cfg.kvCacheDtype).toBe('fp8')
    })
  })

  describe('inline = syntax', () => {
    it('parses --port=9000', () => {
      const cfg = mergeArgvIntoVllmConfig(['--port=9000'], EMPTY)
      expect(cfg.port).toBe(9000)
    })

    it('parses --reasoning-parser=qwen3', () => {
      const cfg = mergeArgvIntoVllmConfig(['--reasoning-parser=qwen3'], EMPTY)
      expect(cfg.reasoningParser).toBe('qwen3')
    })
  })

  describe('--override-generation-config JSON', () => {
    it('extracts temperature', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"temperature": 0.7}'],
        EMPTY
      )
      expect(cfg.temperature).toBeCloseTo(0.7)
    })

    it('extracts top_p', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"top_p": 0.9}'],
        EMPTY
      )
      expect(cfg.topP).toBeCloseTo(0.9)
    })

    it('extracts top_k as integer', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"top_k": 40}'],
        EMPTY
      )
      expect(cfg.topK).toBe(40)
    })

    it('extracts min_p', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"min_p": 0.05}'],
        EMPTY
      )
      expect(cfg.minP).toBeCloseTo(0.05)
    })

    it('extracts repetition_penalty', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"repetition_penalty": 1.1}'],
        EMPTY
      )
      expect(cfg.repetitionPenalty).toBeCloseTo(1.1)
    })

    it('extracts presence_penalty and frequency_penalty', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"presence_penalty": 0.2, "frequency_penalty": 0.3}'],
        EMPTY
      )
      expect(cfg.presencePenalty).toBeCloseTo(0.2)
      expect(cfg.frequencyPenalty).toBeCloseTo(0.3)
    })

    it('ignores non-numeric values in JSON', () => {
      const cfg = mergeArgvIntoVllmConfig(
        ['--override-generation-config', '{"temperature": "hot"}'],
        EMPTY
      )
      expect(cfg.temperature).toBeUndefined()
    })

    it('ignores invalid JSON silently', () => {
      expect(() =>
        mergeArgvIntoVllmConfig(['--override-generation-config', '{bad json}'], EMPTY)
      ).not.toThrow()
    })
  })

  describe('--speculative-config', () => {
    it('extracts JSON string as-is', () => {
      const raw = '{"method":"mtp","num_speculative_tokens":4}'
      const cfg = mergeArgvIntoVllmConfig(['--speculative-config', raw], EMPTY)
      expect(cfg.speculativeConfig).toBe(raw)
    })

    it('strips surrounding single quotes', () => {
      const inner = '{"method":"mtp","num_speculative_tokens":4}'
      const cfg = mergeArgvIntoVllmConfig(['--speculative-config', `'${inner}'`], EMPTY)
      expect(cfg.speculativeConfig).toBe(inner)
    })

    it('strips surrounding double quotes', () => {
      const inner = '{"method":"mtp","num_speculative_tokens":4}'
      const cfg = mergeArgvIntoVllmConfig(['--speculative-config', `"${inner}"`], EMPTY)
      expect(cfg.speculativeConfig).toBe(inner)
    })
  })

  describe('tracked key removal', () => {
    it('removes tracked key from base when not present in argv', () => {
      const base: VllmModelConfig = { maxModelLen: 8192, port: 8000 }
      const cfg = mergeArgvIntoVllmConfig(['--port', '9999'], base)
      // port updated; maxModelLen not in argv → removed
      expect(cfg.port).toBe(9999)
      expect(cfg.maxModelLen).toBeUndefined()
    })

    it('preserves non-tracked fields from base', () => {
      const base: VllmModelConfig = {
        launchMode: 'builder',
        customCommandLine: 'vllm serve model',
      }
      const cfg = mergeArgvIntoVllmConfig(['--port', '8000'], base)
      expect(cfg.launchMode).toBe('builder')
      expect(cfg.customCommandLine).toBe('vllm serve model')
    })
  })

  describe('shell quote stripping on string values', () => {
    it('strips single quotes from --tool-call-parser value', () => {
      const cfg = mergeArgvIntoVllmConfig(["--tool-call-parser", "'hermes'"], EMPTY)
      expect(cfg.toolCallParser).toBe('hermes')
    })
  })

  describe('mixed real-world command', () => {
    it('parses a typical vLLM invocation', () => {
      const args = [
        'vllm', 'serve', '/models/qwen2.5-7b',
        '--host', '127.0.0.1',
        '--port', '8000',
        '--max-model-len', '16384',
        '--reasoning-parser', 'deepseek_r1',
        '--enable-auto-tool-choice',
        '--tool-call-parser', 'hermes',
        '--gpu-memory-utilization', '0.85',
        '--override-generation-config', '{"temperature": 0.6, "top_p": 0.9}',
      ]
      const cfg = mergeArgvIntoVllmConfig(args, EMPTY)
      expect(cfg.host).toBe('127.0.0.1')
      expect(cfg.port).toBe(8000)
      expect(cfg.maxModelLen).toBe(16384)
      expect(cfg.reasoningParser).toBe('deepseek_r1')
      expect(cfg.enableAutoToolChoice).toBe(true)
      expect(cfg.toolCallParser).toBe('hermes')
      expect(cfg.gpuMemoryUtilization).toBeCloseTo(0.85)
      expect(cfg.temperature).toBeCloseTo(0.6)
      expect(cfg.topP).toBeCloseTo(0.9)
    })
  })
})
