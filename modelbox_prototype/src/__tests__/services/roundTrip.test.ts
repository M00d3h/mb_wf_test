/**
 * Round-trip tests: set param in config → build launch command → parse command
 * back → assert the param value is identical.
 *
 * These catch divergence between commandBuilder/vllmCommandBuilder (params → command)
 * and argvToProfileConfig/argvToVllmConfig (command → params). If a flag is renamed
 * in one side but not the other, the round-trip breaks.
 */
import { describe, it, expect } from 'vitest'
import { buildCommand } from '@main/services/commandBuilder'
import { mergeArgvIntoProfileConfig } from '@main/services/argvToProfileConfig'
import { vllmConfigToArgs } from '@main/services/vllmCommandBuilder'
import { mergeArgvIntoVllmConfig } from '@main/services/argvToVllmConfig'
import type { ProfileConfig, AppSettings, VllmModelConfig } from '@shared/types'

// ─── Stubs ────────────────────────────────────────────────────────────────────

const SETTINGS: AppSettings = {
  llamaServerPath: '/llama-server',
  cudaBinPath: '',
  modelsDirs: [],
  vllmModelDirs: [],
  vllmRuntime: { envKind: 'venv' },
  llamaDefaultHost: '0.0.0.0',
  llamaBasePort: 8080,
  vllmDefaultHost: '0.0.0.0',
  vllmBasePort: 8000,
  firstRun: false,
  fontSize: 14,
  wslMode: false,
}

const MODEL_PATH = '/models/llama.gguf'

/** Build a command from a ProfileConfig then parse it back. */
function rtLlama(config: ProfileConfig): ProfileConfig {
  const { args } = buildCommand(MODEL_PATH, config, undefined, SETTINGS)
  return mergeArgvIntoProfileConfig(args, {}).config
}

/**
 * Build vLLM args from a VllmModelConfig then parse them back.
 * host/port are not emitted by vllmConfigToArgs — they're added by the full
 * builder — so we inject them manually here to cover those fields.
 */
function rtVllm(cfg: VllmModelConfig): VllmModelConfig {
  const inner = vllmConfigToArgs(cfg)
  const hostPort: string[] = []
  if (cfg.host != null) hostPort.push('--host', cfg.host)
  if (cfg.port != null) hostPort.push('--port', String(cfg.port))
  return mergeArgvIntoVllmConfig([...hostPort, ...inner], {})
}

// ─── llama.cpp: individual param round-trips ──────────────────────────────────

describe('llama.cpp: param → command → param (individual)', () => {
  it('alias', () => {
    expect(rtLlama({ alias: 'my-model' }).alias).toBe('my-model')
  })

  it('alias with spaces survives quoting', () => {
    expect(rtLlama({ alias: 'Meta Llama 3' }).alias).toBe('Meta Llama 3')
  })

  it('mmproj', () => {
    expect(rtLlama({ mmproj: '/models/llava-mmproj.gguf' }).mmproj).toBe('/models/llava-mmproj.gguf')
  })

  it('embeddings: true', () => {
    expect(rtLlama({ embeddings: true }).embeddings).toBe(true)
  })

  it('embeddings: undefined → not present in result', () => {
    expect(rtLlama({}).embeddings).toBeUndefined()
  })

  it('contextSize', () => {
    expect(rtLlama({ contextSize: 4096 }).contextSize).toBe(4096)
  })

  it('contextSize large value', () => {
    expect(rtLlama({ contextSize: 131072 }).contextSize).toBe(131072)
  })

  it('gpuLayers', () => {
    expect(rtLlama({ gpuLayers: 33 }).gpuLayers).toBe(33)
  })

  it('gpuLayers: 0', () => {
    expect(rtLlama({ gpuLayers: 0 }).gpuLayers).toBe(0)
  })

  it('nCpuMoe', () => {
    expect(rtLlama({ nCpuMoe: 4 }).nCpuMoe).toBe(4)
  })

  it('flashAttn: on', () => {
    expect(rtLlama({ flashAttn: 'on' }).flashAttn).toBe('on')
  })

  it('flashAttn: off', () => {
    expect(rtLlama({ flashAttn: 'off' }).flashAttn).toBe('off')
  })

  it('fit', () => {
    expect(rtLlama({ fit: 'content' }).fit).toBe('content')
  })

  it('backendSampling: true', () => {
    expect(rtLlama({ backendSampling: true }).backendSampling).toBe(true)
  })

  it('parallel', () => {
    expect(rtLlama({ parallel: 2 }).parallel).toBe(2)
  })

  it('kvCacheTypeK', () => {
    expect(rtLlama({ kvCacheTypeK: 'q8_0' }).kvCacheTypeK).toBe('q8_0')
  })

  it('kvCacheTypeV', () => {
    expect(rtLlama({ kvCacheTypeV: 'q4_0' }).kvCacheTypeV).toBe('q4_0')
  })

  it('host', () => {
    expect(rtLlama({ host: '127.0.0.1' }).host).toBe('127.0.0.1')
  })

  it('port', () => {
    expect(rtLlama({ port: 8080 }).port).toBe(8080)
  })

  it('temp', () => {
    expect(rtLlama({ temp: 0.7 }).temp).toBe(0.7)
  })

  it('temp: 0 (greedy)', () => {
    expect(rtLlama({ temp: 0 }).temp).toBe(0)
  })

  it('topP', () => {
    expect(rtLlama({ topP: 0.95 }).topP).toBe(0.95)
  })

  it('minP', () => {
    expect(rtLlama({ minP: 0.05 }).minP).toBe(0.05)
  })

  it('topK', () => {
    expect(rtLlama({ topK: 40 }).topK).toBe(40)
  })

  it('repeatPenalty', () => {
    expect(rtLlama({ repeatPenalty: 1.1 }).repeatPenalty).toBe(1.1)
  })

  it('presencePenalty', () => {
    expect(rtLlama({ presencePenalty: 0.2 }).presencePenalty).toBe(0.2)
  })

  it('specType', () => {
    expect(rtLlama({ specType: 'ngram' }).specType).toBe('ngram')
  })

  it('specNgramSizeN', () => {
    expect(rtLlama({ specNgramSizeN: 5 }).specNgramSizeN).toBe(5)
  })

  it('draftMin', () => {
    expect(rtLlama({ draftMin: 1 }).draftMin).toBe(1)
  })

  it('draftMax', () => {
    expect(rtLlama({ draftMax: 8 }).draftMax).toBe(8)
  })
})

// ─── llama.cpp: omitted params are cleared from result ────────────────────────

describe('llama.cpp: absent param is cleared from result', () => {
  const ALL_PARAMS: ProfileConfig = {
    alias: 'x', mmproj: '/x.gguf', embeddings: true, contextSize: 1024,
    gpuLayers: 1, nCpuMoe: 1, flashAttn: 'on', fit: 'width', backendSampling: true,
    parallel: 1, kvCacheTypeK: 'f16', kvCacheTypeV: 'f16', host: '127.0.0.1',
    port: 9000, temp: 0.5, topP: 0.9, minP: 0.01, topK: 20,
    repeatPenalty: 1.0, presencePenalty: 0.0, specType: 'ngram',
    specNgramSizeN: 3, draftMin: 1, draftMax: 4,
  }

  it.each([
    'alias', 'mmproj', 'embeddings', 'contextSize', 'gpuLayers', 'nCpuMoe',
    'flashAttn', 'fit', 'backendSampling', 'parallel', 'kvCacheTypeK', 'kvCacheTypeV',
    'host', 'port', 'temp', 'topP', 'minP', 'topK', 'repeatPenalty', 'presencePenalty',
    'specType', 'specNgramSizeN', 'draftMin', 'draftMax',
  ] as (keyof ProfileConfig)[])(
    '%s is cleared when absent from command',
    (key) => {
      // Build from a config that has all OTHER params but NOT this one
      const withoutKey = { ...ALL_PARAMS }
      delete withoutKey[key]
      const result = rtLlama(withoutKey)
      expect(result[key]).toBeUndefined()
    }
  )
})

// ─── llama.cpp: full config round-trip ───────────────────────────────────────

describe('llama.cpp: full config round-trip (all params simultaneously)', () => {
  const FULL: ProfileConfig = {
    alias: 'Meta-Llama-3-8B',
    mmproj: '/models/llava-v1.5-7b-mmproj-f16.gguf',
    embeddings: true,
    contextSize: 8192,
    gpuLayers: 35,
    nCpuMoe: 4,
    flashAttn: 'on',
    fit: 'content',
    backendSampling: true,
    parallel: 4,
    kvCacheTypeK: 'q8_0',
    kvCacheTypeV: 'q4_0',
    host: '0.0.0.0',
    port: 8502,
    temp: 0.8,
    topP: 0.95,
    minP: 0.05,
    topK: 40,
    repeatPenalty: 1.1,
    presencePenalty: 0.1,
    specType: 'ngram',
    specNgramSizeN: 5,
    draftMin: 1,
    draftMax: 8,
  }

  it('all 24 tracked params survive round-trip', () => {
    const result = rtLlama(FULL)
    expect(result.alias).toBe(FULL.alias)
    expect(result.mmproj).toBe(FULL.mmproj)
    expect(result.embeddings).toBe(FULL.embeddings)
    expect(result.contextSize).toBe(FULL.contextSize)
    expect(result.gpuLayers).toBe(FULL.gpuLayers)
    expect(result.nCpuMoe).toBe(FULL.nCpuMoe)
    expect(result.flashAttn).toBe(FULL.flashAttn)
    expect(result.fit).toBe(FULL.fit)
    expect(result.backendSampling).toBe(FULL.backendSampling)
    expect(result.parallel).toBe(FULL.parallel)
    expect(result.kvCacheTypeK).toBe(FULL.kvCacheTypeK)
    expect(result.kvCacheTypeV).toBe(FULL.kvCacheTypeV)
    expect(result.host).toBe(FULL.host)
    expect(result.port).toBe(FULL.port)
    expect(result.temp).toBe(FULL.temp)
    expect(result.topP).toBe(FULL.topP)
    expect(result.minP).toBe(FULL.minP)
    expect(result.topK).toBe(FULL.topK)
    expect(result.repeatPenalty).toBe(FULL.repeatPenalty)
    expect(result.presencePenalty).toBe(FULL.presencePenalty)
    expect(result.specType).toBe(FULL.specType)
    expect(result.specNgramSizeN).toBe(FULL.specNgramSizeN)
    expect(result.draftMin).toBe(FULL.draftMin)
    expect(result.draftMax).toBe(FULL.draftMax)
  })

  it('non-tracked fields (env, prependCudaToPath) are preserved from base', () => {
    const base: ProfileConfig = { env: { FOO: 'bar' }, prependCudaToPath: true }
    const { args } = buildCommand(MODEL_PATH, FULL, undefined, SETTINGS)
    const { config: result } = mergeArgvIntoProfileConfig(args, base)
    expect(result.env).toEqual({ FOO: 'bar' })
    expect(result.prependCudaToPath).toBe(true)
  })
})

// ─── llama.cpp: documented non-round-trip fields ─────────────────────────────

describe('llama.cpp: mmprojDisabled is UI-only (no command representation)', () => {
  it('mmprojDisabled: true suppresses --mmproj in command', () => {
    const { args } = buildCommand(MODEL_PATH, { mmproj: '/x.gguf', mmprojDisabled: true }, undefined, SETTINGS)
    expect(args).not.toContain('--mmproj')
  })

  it('mmprojDisabled is not parseable from command (by design)', () => {
    // There is no --no-mmproj flag — disable state lives only in the UI field.
    const result = rtLlama({ mmprojDisabled: true })
    expect(result.mmprojDisabled).toBeUndefined()
  })
})

// ─── vLLM: individual param round-trips ──────────────────────────────────────

describe('vLLM: param → command → param (individual)', () => {
  it('host', () => {
    expect(rtVllm({ host: '0.0.0.0' }).host).toBe('0.0.0.0')
  })

  it('port', () => {
    expect(rtVllm({ port: 8000 }).port).toBe(8000)
  })

  it('maxModelLen', () => {
    expect(rtVllm({ maxModelLen: 4096 }).maxModelLen).toBe(4096)
  })

  it('maxModelLen: large value', () => {
    expect(rtVllm({ maxModelLen: 131072 }).maxModelLen).toBe(131072)
  })

  it('reasoningParser', () => {
    expect(rtVllm({ reasoningParser: 'deepseek_r1' }).reasoningParser).toBe('deepseek_r1')
  })

  it('enableAutoToolChoice: true', () => {
    expect(rtVllm({ enableAutoToolChoice: true }).enableAutoToolChoice).toBe(true)
  })

  it('enableAutoToolChoice: undefined → not emitted, cleared in result', () => {
    expect(rtVllm({}).enableAutoToolChoice).toBeUndefined()
  })

  it('toolCallParser', () => {
    expect(rtVllm({ toolCallParser: 'hermes' }).toolCallParser).toBe('hermes')
  })

  it('servedModelName', () => {
    expect(rtVllm({ servedModelName: 'my-custom-model' }).servedModelName).toBe('my-custom-model')
  })

  it('maxNumSeqs', () => {
    expect(rtVllm({ maxNumSeqs: 256 }).maxNumSeqs).toBe(256)
  })

  it('gpuMemoryUtilization', () => {
    expect(rtVllm({ gpuMemoryUtilization: 0.9 }).gpuMemoryUtilization).toBe(0.9)
  })

  it('gpuMemoryUtilization: 0.85', () => {
    expect(rtVllm({ gpuMemoryUtilization: 0.85 }).gpuMemoryUtilization).toBe(0.85)
  })

  it('kvCacheDtype', () => {
    expect(rtVllm({ kvCacheDtype: 'fp8' }).kvCacheDtype).toBe('fp8')
  })

  it('speculativeConfig: JSON string', () => {
    const sc = '{"method":"mtp","num_speculative_tokens":5}'
    expect(rtVllm({ speculativeConfig: sc }).speculativeConfig).toBe(sc)
  })

  it('temperature', () => {
    expect(rtVllm({ temperature: 0.7 }).temperature).toBe(0.7)
  })

  it('temperature: 0', () => {
    expect(rtVllm({ temperature: 0 }).temperature).toBe(0)
  })

  it('topP', () => {
    expect(rtVllm({ topP: 0.95 }).topP).toBe(0.95)
  })

  it('topK (integer)', () => {
    expect(rtVllm({ topK: 40 }).topK).toBe(40)
  })

  it('topK is rounded to integer in command', () => {
    // vllmConfigToArgs rounds topK via Math.round
    expect(rtVllm({ topK: 40.7 }).topK).toBe(41)
  })

  it('minP', () => {
    expect(rtVllm({ minP: 0.05 }).minP).toBe(0.05)
  })

  it('repetitionPenalty', () => {
    expect(rtVllm({ repetitionPenalty: 1.1 }).repetitionPenalty).toBe(1.1)
  })

  it('presencePenalty', () => {
    expect(rtVllm({ presencePenalty: 0.1 }).presencePenalty).toBe(0.1)
  })

  it('frequencyPenalty', () => {
    expect(rtVllm({ frequencyPenalty: 0.2 }).frequencyPenalty).toBe(0.2)
  })
})

// ─── vLLM: omitted params are cleared from result ─────────────────────────────

describe('vLLM: absent param is cleared from result', () => {
  const ALL_PARAMS: VllmModelConfig = {
    host: '0.0.0.0', port: 8000, maxModelLen: 4096,
    reasoningParser: 'deepseek_r1', enableAutoToolChoice: true,
    toolCallParser: 'hermes', servedModelName: 'x', maxNumSeqs: 8,
    gpuMemoryUtilization: 0.9, kvCacheDtype: 'fp8',
    speculativeConfig: '{}', temperature: 0.7, topP: 0.95, topK: 40,
    minP: 0.05, repetitionPenalty: 1.1, presencePenalty: 0.1, frequencyPenalty: 0.2,
  }

  it.each([
    'host', 'port', 'maxModelLen', 'reasoningParser', 'enableAutoToolChoice',
    'toolCallParser', 'servedModelName', 'maxNumSeqs', 'gpuMemoryUtilization',
    'kvCacheDtype', 'speculativeConfig', 'temperature', 'topP', 'topK', 'minP',
    'repetitionPenalty', 'presencePenalty', 'frequencyPenalty',
  ] as (keyof VllmModelConfig)[])(
    '%s is cleared when absent from command',
    (key) => {
      const withoutKey = { ...ALL_PARAMS }
      delete withoutKey[key]
      const result = rtVllm(withoutKey)
      expect(result[key]).toBeUndefined()
    }
  )
})

// ─── vLLM: full config round-trip ────────────────────────────────────────────

describe('vLLM: full config round-trip (all params simultaneously)', () => {
  const FULL: VllmModelConfig = {
    host: '0.0.0.0',
    port: 8000,
    maxModelLen: 32768,
    reasoningParser: 'deepseek_r1',
    enableAutoToolChoice: true,
    toolCallParser: 'hermes',
    servedModelName: 'Qwen3-8B',
    maxNumSeqs: 256,
    gpuMemoryUtilization: 0.9,
    kvCacheDtype: 'fp8',
    speculativeConfig: '{"method":"mtp","num_speculative_tokens":5}',
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
    minP: 0.05,
    repetitionPenalty: 1.05,
    presencePenalty: 0.1,
    frequencyPenalty: 0.2,
  }

  it('all 18 tracked params survive round-trip', () => {
    const result = rtVllm(FULL)
    expect(result.host).toBe(FULL.host)
    expect(result.port).toBe(FULL.port)
    expect(result.maxModelLen).toBe(FULL.maxModelLen)
    expect(result.reasoningParser).toBe(FULL.reasoningParser)
    expect(result.enableAutoToolChoice).toBe(FULL.enableAutoToolChoice)
    expect(result.toolCallParser).toBe(FULL.toolCallParser)
    expect(result.servedModelName).toBe(FULL.servedModelName)
    expect(result.maxNumSeqs).toBe(FULL.maxNumSeqs)
    expect(result.gpuMemoryUtilization).toBe(FULL.gpuMemoryUtilization)
    expect(result.kvCacheDtype).toBe(FULL.kvCacheDtype)
    expect(result.speculativeConfig).toBe(FULL.speculativeConfig)
    expect(result.temperature).toBe(FULL.temperature)
    expect(result.topP).toBe(FULL.topP)
    expect(result.topK).toBe(FULL.topK)
    expect(result.minP).toBe(FULL.minP)
    expect(result.repetitionPenalty).toBe(FULL.repetitionPenalty)
    expect(result.presencePenalty).toBe(FULL.presencePenalty)
    expect(result.frequencyPenalty).toBe(FULL.frequencyPenalty)
  })

  it('non-tracked fields (launchMode, customCommandLine) are preserved from base', () => {
    const base: VllmModelConfig = { launchMode: 'custom', customCommandLine: 'vllm serve x' }
    const inner = vllmConfigToArgs(FULL)
    const result = mergeArgvIntoVllmConfig(inner, base)
    expect(result.launchMode).toBe('custom')
    expect(result.customCommandLine).toBe('vllm serve x')
  })
})
