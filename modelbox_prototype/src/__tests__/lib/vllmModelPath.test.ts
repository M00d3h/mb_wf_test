import { describe, it, expect } from 'vitest'
import {
  parseHfHubFolderName,
  parseHfHubSegmentFromPath,
  resolveHfHubSegment,
  extractVllmQuantLabel,
  dtypeToLabel,
} from '@renderer/lib/vllmModelPath'

// ─── parseHfHubFolderName ─────────────────────────────────────────────────────

describe('parseHfHubFolderName', () => {
  it('parses a standard hub folder name', () => {
    const r = parseHfHubFolderName('models--Qwen--Qwen3.5-27B-AWQ-4bit')
    expect(r).toEqual({ namespace: 'Qwen', modelName: 'Qwen3.5-27B-AWQ-4bit' })
  })

  it('handles org slugs with single hyphens', () => {
    const r = parseHfHubFolderName('models--deepseek-ai--DeepSeek-R1-7B')
    expect(r).toEqual({ namespace: 'deepseek-ai', modelName: 'DeepSeek-R1-7B' })
  })

  it('handles org slugs with dots', () => {
    const r = parseHfHubFolderName('models--microsoft--Phi-3.5-mini')
    expect(r).toEqual({ namespace: 'microsoft', modelName: 'Phi-3.5-mini' })
  })

  it('returns null for non-hub folder names', () => {
    expect(parseHfHubFolderName('Qwen3.5-27B-AWQ')).toBeNull()
  })

  it('returns null for folder starting with models-- but missing second --', () => {
    expect(parseHfHubFolderName('models--Qwen')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseHfHubFolderName('')).toBeNull()
  })

  it('returns null when namespace is empty after split', () => {
    expect(parseHfHubFolderName('models----modelname')).toBeNull()
  })
})

// ─── parseHfHubSegmentFromPath ────────────────────────────────────────────────

describe('parseHfHubSegmentFromPath', () => {
  it('finds the hub folder segment in a POSIX path', () => {
    const r = parseHfHubSegmentFromPath(
      '/root/.cache/huggingface/hub/models--Qwen--Qwen3.5-7B/snapshots/abc123'
    )
    expect(r).toEqual({ namespace: 'Qwen', modelName: 'Qwen3.5-7B' })
  })

  it('finds the hub folder segment in a UNC WSL path', () => {
    const r = parseHfHubSegmentFromPath(
      '\\\\wsl$\\Ubuntu\\root\\.cache\\huggingface\\hub\\models--deepseek-ai--DeepSeek-R1\\snapshots\\hash'
    )
    expect(r).toEqual({ namespace: 'deepseek-ai', modelName: 'DeepSeek-R1' })
  })

  it('returns null when no hub segment found', () => {
    expect(parseHfHubSegmentFromPath('/models/flat/Qwen3.5-7B')).toBeNull()
  })

  it('returns null for empty path', () => {
    expect(parseHfHubSegmentFromPath('')).toBeNull()
  })
})

// ─── resolveHfHubSegment ──────────────────────────────────────────────────────

describe('resolveHfHubSegment', () => {
  it('uses path-based parsing when hub folder present', () => {
    const r = resolveHfHubSegment(
      '/hub/models--Qwen--Qwen3.5-7B/snapshots/abc',
      'SomeOtherName'
    )
    expect(r).toEqual({ namespace: 'Qwen', modelName: 'Qwen3.5-7B' })
  })

  it('falls back to displayName with slash when no hub folder in path', () => {
    const r = resolveHfHubSegment('/flat/path/qwen3', 'Qwen/Qwen3.5-7B')
    expect(r).toEqual({ namespace: 'Qwen', modelName: 'Qwen3.5-7B' })
  })

  it('returns null when neither path nor displayName yields a segment', () => {
    expect(resolveHfHubSegment('/flat/path/model', 'NoSlashName')).toBeNull()
  })

  it('returns null when displayName has only a leading slash', () => {
    expect(resolveHfHubSegment('/flat/path/model', '/model')).toBeNull()
  })

  it('returns null when displayName has only a trailing slash', () => {
    expect(resolveHfHubSegment('/flat/path/model', 'namespace/')).toBeNull()
  })
})

// ─── extractVllmQuantLabel ────────────────────────────────────────────────────

describe('extractVllmQuantLabel', () => {
  it('detects AWQ', () => {
    expect(extractVllmQuantLabel('Qwen3.5-27B-AWQ-4bit')).toBe('AWQ')
  })

  it('detects GPTQ', () => {
    expect(extractVllmQuantLabel('Mistral-7B-GPTQ')).toBe('GPTQ')
  })

  it('detects FP8', () => {
    expect(extractVllmQuantLabel('Llama-3-8B-FP8')).toBe('FP8')
  })

  it('detects FP8 with suffix (fp8_e4m3fn)', () => {
    expect(extractVllmQuantLabel('model-fp8_e4m3fn')).toBe('FP8')
  })

  it('detects INT8', () => {
    expect(extractVllmQuantLabel('model-INT8-v2')).toBe('INT8')
  })

  it('detects INT4', () => {
    expect(extractVllmQuantLabel('model-INT4')).toBe('INT4')
  })

  it('detects BF16', () => {
    expect(extractVllmQuantLabel('Qwen3-72B-BF16')).toBe('BF16')
  })

  it('detects FP16', () => {
    expect(extractVllmQuantLabel('model-FP16')).toBe('FP16')
  })

  it('detects NVFP4', () => {
    expect(extractVllmQuantLabel('Llama-3.1-8B-NVFP4')).toBe('NVFP4')
  })

  it('detects MXFP4', () => {
    expect(extractVllmQuantLabel('model-MXFP4')).toBe('MXFP4')
  })

  it('is case-insensitive', () => {
    expect(extractVllmQuantLabel('Qwen3.5-27B-awq-4bit')).toBe('AWQ')
  })

  it('returns null for a plain model name without quant info', () => {
    expect(extractVllmQuantLabel('Qwen3-8B-Instruct')).toBeNull()
  })

  it('NVFP4 matches before AWQ (priority)', () => {
    // NVFP4 check is before AWQ in the function
    expect(extractVllmQuantLabel('model-NVFP4')).toBe('NVFP4')
  })
})

// ─── dtypeToLabel ─────────────────────────────────────────────────────────────

describe('dtypeToLabel', () => {
  it('returns null for null input', () => {
    expect(dtypeToLabel(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(dtypeToLabel(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(dtypeToLabel('')).toBeNull()
  })

  it('maps bfloat16 to BF16', () => {
    expect(dtypeToLabel('bfloat16')).toBe('BF16')
  })

  it('maps float16 to FP16', () => {
    expect(dtypeToLabel('float16')).toBe('FP16')
  })

  it('maps half to FP16', () => {
    expect(dtypeToLabel('half')).toBe('FP16')
  })

  it('maps float32 to FP32', () => {
    expect(dtypeToLabel('float32')).toBe('FP32')
  })

  it('maps float8_e4m3fn to FP8', () => {
    expect(dtypeToLabel('float8_e4m3fn')).toBe('FP8')
  })

  it('maps int8 to INT8', () => {
    expect(dtypeToLabel('int8')).toBe('INT8')
  })

  it('maps int4 to INT4', () => {
    expect(dtypeToLabel('int4')).toBe('INT4')
  })

  it('maps awq-containing string to AWQ', () => {
    expect(dtypeToLabel('compressed-tensors-awq')).toBe('AWQ')
  })

  it('maps gptq-containing string to GPTQ', () => {
    expect(dtypeToLabel('gptq')).toBe('GPTQ')
  })

  it('maps nvfp4 to NVFP4', () => {
    expect(dtypeToLabel('nvfp4')).toBe('NVFP4')
  })

  it('maps mxfp4 to MXFP4', () => {
    expect(dtypeToLabel('mxfp4')).toBe('MXFP4')
  })

  it('returns null for unknown dtype', () => {
    expect(dtypeToLabel('some_custom_dtype')).toBeNull()
  })

  it('is case-insensitive (trims and lowercases)', () => {
    expect(dtypeToLabel('  BFloat16  ')).toBe('BF16')
  })
})
