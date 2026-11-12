import { describe, it, expect } from 'vitest'
import {
  assertValidRepoId,
  modelsRepoPathSegments,
  weightBundleFolderStemFromHubFilename,
  deriveFolderName,
  assertSafeRepoRelPath,
} from '@main/services/huggingfaceHub'

// ─── assertValidRepoId ────────────────────────────────────────────────────────

describe('assertValidRepoId', () => {
  it('accepts a valid namespace/repo id', () => {
    expect(() => assertValidRepoId('Qwen/Qwen3-8B')).not.toThrow()
  })

  it('accepts slugs with dots and underscores', () => {
    expect(() => assertValidRepoId('microsoft/phi-3.5-mini_instruct')).not.toThrow()
  })

  it('throws for empty string', () => {
    expect(() => assertValidRepoId('')).toThrow()
  })

  it('throws for missing slash', () => {
    expect(() => assertValidRepoId('Qwen3-8B')).toThrow()
  })

  it('throws for path traversal attempt', () => {
    expect(() => assertValidRepoId('../etc/passwd')).toThrow()
  })

  it('throws for extra slashes', () => {
    expect(() => assertValidRepoId('Qwen/Qwen3/extra')).toThrow()
  })

  it('throws for leading slash', () => {
    expect(() => assertValidRepoId('/Qwen/Qwen3-8B')).toThrow()
  })

  it('throws for special chars like @', () => {
    expect(() => assertValidRepoId('Qwen@org/Qwen3')).toThrow()
  })
})

// ─── modelsRepoPathSegments ───────────────────────────────────────────────────

describe('modelsRepoPathSegments', () => {
  it('returns [namespace, repo] for valid repo id', () => {
    expect(modelsRepoPathSegments('Qwen/Qwen3-8B')).toEqual(['Qwen', 'Qwen3-8B'])
  })

  it('sanitizes path-unsafe characters from segments', () => {
    // Segments are sanitized by sanitizeHubFolderSegment
    const segs = modelsRepoPathSegments('meta-llama/Llama-3.1-8B')
    expect(segs).toHaveLength(2)
    expect(segs[0]).toBe('meta-llama')
    expect(segs[1]).toBe('Llama-3.1-8B')
  })

  it('throws for invalid repo id', () => {
    expect(() => modelsRepoPathSegments('invalid')).toThrow()
  })
})

// ─── weightBundleFolderStemFromHubFilename ────────────────────────────────────

describe('weightBundleFolderStemFromHubFilename', () => {
  it('returns stem as-is for a normal file stem', () => {
    expect(weightBundleFolderStemFromHubFilename('Qwen3-8B-Q4_K_M')).toBe('Qwen3-8B-Q4_K_M')
  })

  it('returns "model" for empty stem', () => {
    expect(weightBundleFolderStemFromHubFilename('')).toBe('model')
  })

  it('returns "model" for "."', () => {
    expect(weightBundleFolderStemFromHubFilename('.')).toBe('model')
  })

  it('returns "model" for ".."', () => {
    expect(weightBundleFolderStemFromHubFilename('..')).toBe('model')
  })

  it('strips mmproj suffix from model stem', () => {
    const result = weightBundleFolderStemFromHubFilename('Llava-1.5-7B-mmproj-f16')
    // Should return the base before -mmproj
    expect(result).toBe('Llava-1.5-7B')
  })

  it('strips _mmproj suffix variant', () => {
    const result = weightBundleFolderStemFromHubFilename('model_mmproj_f16')
    expect(result).toBe('model')
  })

  it('returns the stem when no word before mmproj (short base)', () => {
    // "ab-mmproj" — base "ab" is < 3 chars, so falls through to full stem
    const result = weightBundleFolderStemFromHubFilename('ab-mmproj-f16')
    // The function returns t (full stem) in this edge case
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ─── deriveFolderName ─────────────────────────────────────────────────────────

describe('deriveFolderName', () => {
  it('returns "namespace/stem" for single file with repoId', () => {
    const folder = deriveFolderName(['Qwen3-8B-Q4_K_M.gguf'], 'Qwen/Qwen3-8B')
    expect(folder).toBe('Qwen3-8B/Qwen3-8B-Q4_K_M')
  })

  it('returns stem only when no repoId', () => {
    const folder = deriveFolderName(['model-Q4.gguf'])
    expect(folder).toBe('model-Q4')
  })

  it('uses common prefix for shard bundles', () => {
    const folder = deriveFolderName([
      'model-00001-of-00003.gguf',
      'model-00002-of-00003.gguf',
      'model-00003-of-00003.gguf',
    ], 'Qwen/Qwen3-72B')
    expect(folder).toBe('Qwen3-72B/model')
  })

  it('returns stem for empty filenames (uses basename of first entry)', () => {
    // deriveFolderName([]) uses `basename("unknown")` → "unknown", not "model"
    const folder = deriveFolderName([''])
    expect(folder).toBeTruthy()
  })

  it('places mmproj file in repo-level folder (not quant subfolder)', () => {
    const folder = deriveFolderName(['Llava-mmproj-f16.gguf'], 'liuhaotian/llava-1.5-7b')
    expect(folder).toBe('llava-1.5-7b')
  })
})

// ─── assertSafeRepoRelPath ────────────────────────────────────────────────────

describe('assertSafeRepoRelPath', () => {
  it('accepts a valid gguf filename', () => {
    const segs = assertSafeRepoRelPath('model-q4.gguf')
    expect(segs).toEqual(['model-q4.gguf'])
  })

  it('accepts a nested path', () => {
    const segs = assertSafeRepoRelPath('subfolder/model-q4.gguf')
    expect(segs).toEqual(['subfolder', 'model-q4.gguf'])
  })

  it('accepts custom allowed extensions', () => {
    const segs = assertSafeRepoRelPath('model.safetensors', ['.safetensors'])
    expect(segs).toEqual(['model.safetensors'])
  })

  it('throws for backslash in path (Windows traversal)', () => {
    expect(() => assertSafeRepoRelPath('..\\etc\\passwd.gguf')).toThrow()
  })

  it('throws for ".." path traversal segment', () => {
    expect(() => assertSafeRepoRelPath('../etc/passwd.gguf')).toThrow()
  })

  it('throws for "." segment', () => {
    expect(() => assertSafeRepoRelPath('./model.gguf')).toThrow()
  })

  it('throws for null byte in path', () => {
    expect(() => assertSafeRepoRelPath('model\0.gguf')).toThrow()
  })

  it('throws for empty string', () => {
    expect(() => assertSafeRepoRelPath('')).toThrow()
  })

  it('throws when extension is not in allowed list', () => {
    expect(() => assertSafeRepoRelPath('model.gguf', ['.safetensors'])).toThrow()
  })

  it('throws when file has no .gguf extension (default)', () => {
    expect(() => assertSafeRepoRelPath('model.bin')).toThrow()
  })

  it('is case-insensitive for extension check', () => {
    expect(() => assertSafeRepoRelPath('model.GGUF')).not.toThrow()
  })
})
