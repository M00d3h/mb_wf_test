import { describe, it, expect } from 'vitest'
import { normalizeVllmRuntime } from '@shared/vllmRuntime'

describe('normalizeVllmRuntime', () => {
  it('returns the same object when envKind is already valid', () => {
    const rt = { envKind: 'conda' as const }
    expect(normalizeVllmRuntime(rt)).toBe(rt)
  })

  it('accepts venv envKind unchanged', () => {
    const rt = { envKind: 'venv' as const }
    expect(normalizeVllmRuntime(rt)).toBe(rt)
  })

  it('accepts docker envKind unchanged', () => {
    const rt = { envKind: 'docker' as const }
    expect(normalizeVllmRuntime(rt)).toBe(rt)
  })

  it('coerces null envKind to conda', () => {
    const rt = { envKind: null as never }
    expect(normalizeVllmRuntime(rt).envKind).toBe('conda')
  })

  it('coerces undefined envKind to conda', () => {
    const rt = { envKind: undefined as never }
    expect(normalizeVllmRuntime(rt).envKind).toBe('conda')
  })

  it('coerces an unknown string to conda', () => {
    const rt = { envKind: 'pip' as never }
    expect(normalizeVllmRuntime(rt).envKind).toBe('conda')
  })

  it('preserves other fields when coercing', () => {
    const rt = {
      envKind: 'bad' as never,
      condaEnvName: 'myenv',
      venvPath: '/some/path',
    }
    const result = normalizeVllmRuntime(rt)
    expect(result.condaEnvName).toBe('myenv')
    expect(result.venvPath).toBe('/some/path')
  })
})
