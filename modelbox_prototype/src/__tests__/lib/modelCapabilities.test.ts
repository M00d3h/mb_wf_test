import { describe, it, expect } from 'vitest'
import {
  isThinkingCapableModel,
  isThinkingCapableVllmModel,
  pathLooksLikeMmprojFile,
  modelHasVisionCapability,
  resolveProfileMmprojForModel,
} from '@renderer/lib/modelCapabilities'
import { makeModel } from '../helpers/makeModel'
import { makeVllmModel } from '../helpers/makeVllmModel'
import type { Profile } from '@shared/types'

// ─── isThinkingCapableModel ──────────────────────────────────────────────────

describe('isThinkingCapableModel', () => {
  it('returns false for undefined', () => {
    expect(isThinkingCapableModel(undefined)).toBe(false)
  })

  it('returns false for embedding models', () => {
    expect(isThinkingCapableModel(makeModel({ isEmbedding: true, name: 'qwen3' }))).toBe(false)
  })

  describe('Qwen3 family', () => {
    it('matches qwen3 in name', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'Qwen3-8B-Instruct' }))).toBe(true)
    })

    it('matches qwen-3 with hyphen', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'Qwen-3-14B' }))).toBe(true)
    })

    it('matches qwen2.5 in name', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'Qwen2.5-7B-Instruct' }))).toBe(true)
    })

    it('is case-insensitive', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'QWEN3-72B' }))).toBe(true)
    })
  })

  describe('DeepSeek-R1 family', () => {
    it('matches deepseek-r1', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'DeepSeek-R1-Distill-Qwen-7B' }))).toBe(true)
    })

    it('matches r1-distill', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'R1-Distill-14B' }))).toBe(true)
    })

    it('matches deepseek reasoner', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'DeepSeek-Reasoner-7B' }))).toBe(true)
    })
  })

  describe('generic "thinking" pattern', () => {
    it('matches filename containing .think.', () => {
      expect(
        isThinkingCapableModel(makeModel({ ggufPath: '/models/model.think.gguf' }))
      ).toBe(true)
    })

    it('matches standalone "thinking" word in model name', () => {
      // \bthinking\b fires when surrounded by word boundaries
      expect(
        isThinkingCapableModel(makeModel({ name: 'gemma-thinking-v3' }))
      ).toBe(true)
    })
  })

  describe('embedding exclusion overrides', () => {
    it('rejects model whose name contains "embedding"', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'qwen3-embedding' }))).toBe(false)
    })

    it('rejects model whose name matches bge- prefix', () => {
      expect(isThinkingCapableModel(makeModel({ name: 'bge-m3-v2' }))).toBe(false)
    })
  })

  it('returns false for a plain non-thinking model', () => {
    expect(isThinkingCapableModel(makeModel({ name: 'Llama-3-8B-Instruct' }))).toBe(false)
  })

  it('returns false for Mistral', () => {
    expect(isThinkingCapableModel(makeModel({ name: 'Mistral-7B-Instruct-v0.3' }))).toBe(false)
  })
})

// ─── isThinkingCapableVllmModel ──────────────────────────────────────────────

describe('isThinkingCapableVllmModel', () => {
  it('returns false for undefined', () => {
    expect(isThinkingCapableVllmModel(undefined)).toBe(false)
  })

  it('returns true when reasoningParser is set on config', () => {
    const model = makeVllmModel({ config: { reasoningParser: 'deepseek_r1' } })
    expect(isThinkingCapableVllmModel(model)).toBe(true)
  })

  it('uses displayName for pattern matching', () => {
    const model = makeVllmModel({ displayName: 'DeepSeek-R1-7B' })
    expect(isThinkingCapableVllmModel(model)).toBe(true)
  })

  it('returns false for non-thinking vLLM model', () => {
    const model = makeVllmModel({ displayName: 'Mistral-7B-Instruct', path: '/models/mistral' })
    expect(isThinkingCapableVllmModel(model)).toBe(false)
  })
})

// ─── pathLooksLikeMmprojFile ─────────────────────────────────────────────────

describe('pathLooksLikeMmprojFile', () => {
  it('returns false for undefined', () => {
    expect(pathLooksLikeMmprojFile(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(pathLooksLikeMmprojFile('')).toBe(false)
  })

  it('returns false for whitespace-only string', () => {
    expect(pathLooksLikeMmprojFile('   ')).toBe(false)
  })

  it('returns true for filename containing mmproj', () => {
    expect(pathLooksLikeMmprojFile('/models/llava-mmproj-f16.gguf')).toBe(true)
  })

  it('is case-insensitive (MmProj)', () => {
    expect(pathLooksLikeMmprojFile('/models/llava-MmProj-f16.gguf')).toBe(true)
  })

  it('returns false for non-mmproj paths', () => {
    expect(pathLooksLikeMmprojFile('/models/llama-7b-q4.gguf')).toBe(false)
  })

  it('checks only the filename component, not parent dirs', () => {
    expect(pathLooksLikeMmprojFile('/mmproj-dir/llama-7b-q4.gguf')).toBe(false)
  })
})

// ─── modelHasVisionCapability ────────────────────────────────────────────────

describe('modelHasVisionCapability', () => {
  it('returns false for undefined model', () => {
    expect(modelHasVisionCapability(undefined, undefined)).toBe(false)
  })

  it('returns false for embedding model', () => {
    expect(modelHasVisionCapability(makeModel({ isEmbedding: true }), undefined)).toBe(false)
  })

  it('returns true when isMultimodal flag is set on model', () => {
    expect(modelHasVisionCapability(makeModel({ isMultimodal: true }), undefined)).toBe(true)
  })

  it('returns true when detected files include an mmproj file', () => {
    const model = makeModel({
      detectedFiles: ['/models/llava-q4.gguf', '/models/llava-mmproj-f16.gguf'],
    })
    expect(modelHasVisionCapability(model, undefined)).toBe(true)
  })

  it('returns false when no detected mmproj and isMultimodal is false', () => {
    const model = makeModel({ detectedFiles: ['/models/llama-q4.gguf'] })
    expect(modelHasVisionCapability(model, undefined)).toBe(false)
  })

  it('returns true when profileMmproj path looks like an mmproj file', () => {
    const model = makeModel({ isMultimodal: false, detectedFiles: [] })
    expect(modelHasVisionCapability(model, '/custom/llava-mmproj.gguf')).toBe(true)
  })

  it('returns false when profileMmproj is a non-mmproj path', () => {
    const model = makeModel({ isMultimodal: false, detectedFiles: [] })
    expect(modelHasVisionCapability(model, '/custom/llama-7b.gguf')).toBe(false)
  })
})

// ─── resolveProfileMmprojForModel ────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    modelId: 'm1',
    name: 'default',
    active: false,
    config: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('resolveProfileMmprojForModel', () => {
  it('returns undefined when no profiles exist for the model', () => {
    expect(resolveProfileMmprojForModel('m1', {})).toBeUndefined()
  })

  it('returns undefined when profiles list is empty', () => {
    expect(resolveProfileMmprojForModel('m1', { m1: [] })).toBeUndefined()
  })

  it('returns mmproj from the active profile first', () => {
    const profiles = [
      makeProfile({ active: false, config: { mmproj: '/inactive.gguf' } }),
      makeProfile({ active: true, config: { mmproj: '/active-mmproj.gguf' } }),
    ]
    expect(resolveProfileMmprojForModel('m1', { m1: profiles })).toBe('/active-mmproj.gguf')
  })

  it('falls back to first profile with mmproj when none is active', () => {
    const profiles = [
      makeProfile({ active: false, config: {} }),
      makeProfile({ active: false, config: { mmproj: '/fallback-mmproj.gguf' } }),
    ]
    expect(resolveProfileMmprojForModel('m1', { m1: profiles })).toBe('/fallback-mmproj.gguf')
  })

  it('returns undefined when profiles exist but none have mmproj', () => {
    const profiles = [makeProfile({ active: true, config: {} })]
    expect(resolveProfileMmprojForModel('m1', { m1: profiles })).toBeUndefined()
  })
})
