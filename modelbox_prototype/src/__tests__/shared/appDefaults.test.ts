import { describe, it, expect } from 'vitest'
import { persistModelsDirs, persistVllmModelDirs, DEFAULT_MODELS_DIRS } from '@shared/appDefaults'

describe('DEFAULT_MODELS_DIRS', () => {
  it('is an empty array', () => {
    expect(DEFAULT_MODELS_DIRS).toEqual([])
  })
})

describe('persistModelsDirs', () => {
  it('trims whitespace from each path', () => {
    expect(persistModelsDirs(['  /models/fast  ', ' /models/slow'])).toEqual([
      '/models/fast',
      '/models/slow',
    ])
  })

  it('filters out blank strings', () => {
    expect(persistModelsDirs(['/models/a', '', '   ', '/models/b'])).toEqual([
      '/models/a',
      '/models/b',
    ])
  })

  it('returns empty array for all-blank input', () => {
    expect(persistModelsDirs(['', '  '])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(persistModelsDirs([])).toEqual([])
  })

  it('preserves valid paths unchanged', () => {
    expect(persistModelsDirs(['/models'])).toEqual(['/models'])
  })
})

describe('persistVllmModelDirs', () => {
  it('trims and filters same as persistModelsDirs', () => {
    expect(persistVllmModelDirs(['  /hf/hub ', '', '/models'])).toEqual([
      '/hf/hub',
      '/models',
    ])
  })

  it('returns empty array for empty input', () => {
    expect(persistVllmModelDirs([])).toEqual([])
  })
})
