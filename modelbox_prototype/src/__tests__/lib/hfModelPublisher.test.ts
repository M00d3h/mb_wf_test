import { describe, it, expect } from 'vitest'
import {
  guessHfPublisherSlugFromText,
  guessHfPublisherSlugFromModel,
  getHfProviderFolderSlugFromModel,
  getProviderFromModelDir,
  publisherNeedsWhiteAvatarBackground,
} from '@renderer/lib/hfModelPublisher'
import { makeModel } from '../helpers/makeModel'

// ─── guessHfPublisherSlugFromText ─────────────────────────────────────────────

describe('guessHfPublisherSlugFromText', () => {
  it('returns null for unrecognized text', () => {
    expect(guessHfPublisherSlugFromText('some-unknown-model-7B')).toBeNull()
  })

  it('recognizes Qwen models', () => {
    expect(guessHfPublisherSlugFromText('Qwen3-8B-Instruct')).toBe('Qwen')
  })

  it('recognizes qwen2 variants', () => {
    expect(guessHfPublisherSlugFromText('qwen2.5-14b')).toBe('Qwen')
  })

  it('recognizes DeepSeek models', () => {
    expect(guessHfPublisherSlugFromText('DeepSeek-R1-7B')).toBe('deepseek-ai')
  })

  it('recognizes Mistral models', () => {
    expect(guessHfPublisherSlugFromText('Mistral-7B-Instruct-v0.3')).toBe('mistralai')
  })

  it('recognizes Mixtral variants', () => {
    expect(guessHfPublisherSlugFromText('Mixtral-8x7B-Instruct')).toBe('mistralai')
  })

  it('recognizes Llama models', () => {
    expect(guessHfPublisherSlugFromText('Llama-3-8B-Instruct')).toBe('meta-llama')
  })

  it('recognizes Meta-Llama variants', () => {
    expect(guessHfPublisherSlugFromText('Meta-Llama-3.1-70B')).toBe('meta-llama')
  })

  it('recognizes Gemma models', () => {
    expect(guessHfPublisherSlugFromText('gemma-2-9b-it')).toBe('google')
  })

  it('recognizes Phi models', () => {
    expect(guessHfPublisherSlugFromText('Phi-3.5-mini-instruct')).toBe('microsoft')
  })

  it('recognizes BGE embedding models', () => {
    expect(guessHfPublisherSlugFromText('bge-m3')).toBe('BAAI')
  })

  it('recognizes Kimi/Moonshot models', () => {
    expect(guessHfPublisherSlugFromText('kimi-k1-7B')).toBe('moonshotai')
  })

  it('recognizes GLM models', () => {
    expect(guessHfPublisherSlugFromText('glm-4-9b-chat')).toBe('zai-org')
  })

  it('recognizes Falcon models', () => {
    expect(guessHfPublisherSlugFromText('falcon-7b-instruct')).toBe('tiiuae')
  })

  it('recognizes StarCoder models', () => {
    // starcoder2 has no \b after "starcoder" — use hyphenated form
    expect(guessHfPublisherSlugFromText('starcoder-15b')).toBe('bigcode')
  })

  it('recognizes Hermes / NousResearch', () => {
    // Avoid "llama" in the name — llama pattern takes priority
    expect(guessHfPublisherSlugFromText('Hermes-2-Pro-7B')).toBe('NousResearch')
  })

  it('recognizes InternLM', () => {
    // internlm2 has no \b after "internlm" — use hyphenated form
    expect(guessHfPublisherSlugFromText('internlm-chat-7b')).toBe('internlm')
  })

  it('recognizes StableLM', () => {
    expect(guessHfPublisherSlugFromText('stable-lm-3b')).toBe('stabilityai')
  })

  it('is case-insensitive', () => {
    expect(guessHfPublisherSlugFromText('QWEN3-72B-INSTRUCT')).toBe('Qwen')
  })
})

// ─── guessHfPublisherSlugFromModel ────────────────────────────────────────────

describe('guessHfPublisherSlugFromModel', () => {
  it('returns null for undefined', () => {
    expect(guessHfPublisherSlugFromModel(undefined)).toBeNull()
  })

  it('infers publisher from model name', () => {
    const model = makeModel({ name: 'Qwen3-8B-Instruct' })
    expect(guessHfPublisherSlugFromModel(model)).toBe('Qwen')
  })

  it('infers publisher from ggufPath filename', () => {
    const model = makeModel({
      name: 'custom-name',
      ggufPath: '/models/deepseek-r1-7b-q4.gguf',
    })
    expect(guessHfPublisherSlugFromModel(model)).toBe('deepseek-ai')
  })

  it('infers publisher from modelDir', () => {
    const model = makeModel({
      name: 'custom-name',
      ggufPath: '/models/flat/model.gguf',
      modelDir: '/models/mistral-7b',
    })
    expect(guessHfPublisherSlugFromModel(model)).toBe('mistralai')
  })
})

// ─── getHfProviderFolderSlugFromModel ─────────────────────────────────────────

describe('getHfProviderFolderSlugFromModel', () => {
  it('returns null when no modelsDirs', () => {
    const model = makeModel({ modelDir: '/models/Qwen/Qwen3-8B' })
    expect(getHfProviderFolderSlugFromModel(model, [])).toBeNull()
  })

  it('returns the first folder segment under the models root', () => {
    const model = makeModel({
      name: 'Qwen3-8B-Instruct',
      ggufPath: '/models/Qwen/Qwen3-8B/model-q4.gguf',
      modelDir: '/models/Qwen/Qwen3-8B',
    })
    expect(getHfProviderFolderSlugFromModel(model, ['/models'])).toBe('Qwen')
  })

  it('returns null when model sits directly under root', () => {
    const model = makeModel({
      name: 'Qwen3-8B',
      ggufPath: '/models/qwen3-8b-q4.gguf',
      modelDir: '/models',
    })
    expect(getHfProviderFolderSlugFromModel(model, ['/models'])).toBeNull()
  })

  it('returns null when provider folder equals the model name', () => {
    const model = makeModel({
      name: 'Qwen3-8B',
      ggufPath: '/models/Qwen3-8B/model.gguf',
      modelDir: '/models/Qwen3-8B',
    })
    expect(getHfProviderFolderSlugFromModel(model, ['/models'])).toBeNull()
  })

  it('returns null when provider folder equals the gguf stem', () => {
    const model = makeModel({
      name: 'Some Model',
      ggufPath: '/models/mymodel/mymodel.gguf',
      modelDir: '/models/mymodel',
    })
    expect(getHfProviderFolderSlugFromModel(model, ['/models'])).toBeNull()
  })

  it('returns null when model is not under any configured root', () => {
    const model = makeModel({
      name: 'Model',
      ggufPath: '/other/Qwen/model.gguf',
      modelDir: '/other/Qwen',
    })
    expect(getHfProviderFolderSlugFromModel(model, ['/models'])).toBeNull()
  })
})

// ─── getProviderFromModelDir ──────────────────────────────────────────────────

describe('getProviderFromModelDir', () => {
  it('returns null when no modelsDirs', () => {
    expect(getProviderFromModelDir('/models/Qwen/model', [])).toBeNull()
  })

  it('extracts provider folder from dir', () => {
    expect(getProviderFromModelDir('/models/deepseek-ai/DeepSeek-R1', ['/models'])).toBe('deepseek-ai')
  })

  it('returns null when dir equals root', () => {
    expect(getProviderFromModelDir('/models', ['/models'])).toBeNull()
  })

  it('returns null when not under any configured root', () => {
    expect(getProviderFromModelDir('/other/Qwen', ['/models'])).toBeNull()
  })

  it('normalizes backslashes on Windows-style paths', () => {
    expect(getProviderFromModelDir('C:/models/Qwen/model', ['C:/models'])).toBe('Qwen')
  })
})

// ─── publisherNeedsWhiteAvatarBackground ──────────────────────────────────────

describe('publisherNeedsWhiteAvatarBackground', () => {
  it('returns true for openai', () => {
    expect(publisherNeedsWhiteAvatarBackground('openai')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(publisherNeedsWhiteAvatarBackground('OpenAI')).toBe(true)
  })

  it('returns false for other publishers', () => {
    expect(publisherNeedsWhiteAvatarBackground('Qwen')).toBe(false)
    expect(publisherNeedsWhiteAvatarBackground('meta-llama')).toBe(false)
  })
})
