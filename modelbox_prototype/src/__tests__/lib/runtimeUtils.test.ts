import { describe, it, expect } from 'vitest'
import { isVllmConfigured } from '@renderer/lib/runtimeUtils'
import type { AppSettings, VllmRuntimeInfo } from '@shared/types'
import { makeSettings } from '../helpers/makeSettings'

const INSTALLED: VllmRuntimeInfo = { status: 'installed', venvPath: '/venv', wslDistro: null, error: null }
const NOT_INSTALLED: VllmRuntimeInfo = { status: 'not-installed', venvPath: null, wslDistro: null, error: null }

describe('isVllmConfigured', () => {
  it('returns false for null settings and null runtimeInfo', () => {
    expect(isVllmConfigured(null, null)).toBe(false)
  })

  it('returns false for undefined settings and undefined runtimeInfo', () => {
    expect(isVllmConfigured(undefined, undefined)).toBe(false)
  })

  it('returns true when runtimeInfo is installed regardless of settings', () => {
    expect(isVllmConfigured(null, INSTALLED)).toBe(true)
    expect(isVllmConfigured(undefined, INSTALLED)).toBe(true)
  })

  describe('conda envKind', () => {
    function makeCondaSettings(overrides?: Partial<AppSettings['vllmRuntime']>): AppSettings {
      return makeSettings({
        vllmRuntime: {
          envKind: 'conda',
          condaEnvName: 'vllm',
          condaShPath: '',
          venvPath: '',
          dockerImage: '',
          dockerExtraArgs: '',
          wslDistro: '',
          ...overrides,
        },
      })
    }

    it('returns false with default conda settings (condaEnvName=vllm, no condaShPath)', () => {
      expect(isVllmConfigured(makeCondaSettings(), NOT_INSTALLED)).toBe(false)
    })

    it('returns true when condaEnvName differs from default "vllm"', () => {
      expect(isVllmConfigured(makeCondaSettings({ condaEnvName: 'myenv' }), NOT_INSTALLED)).toBe(true)
    })

    it('returns true when condaShPath is set (even with default env name)', () => {
      expect(
        isVllmConfigured(
          makeCondaSettings({ condaShPath: '/home/user/miniconda3/etc/profile.d/conda.sh' }),
          NOT_INSTALLED
        )
      ).toBe(true)
    })

    it('returns false when condaEnvName is empty', () => {
      expect(isVllmConfigured(makeCondaSettings({ condaEnvName: '' }), NOT_INSTALLED)).toBe(false)
    })
  })

  describe('venv envKind', () => {
    function makeVenvSettings(venvPath: string): AppSettings {
      return makeSettings({
        vllmRuntime: {
          envKind: 'venv',
          condaEnvName: '',
          condaShPath: '',
          venvPath,
          dockerImage: '',
          dockerExtraArgs: '',
          wslDistro: '',
        },
      })
    }

    it('returns false when venvPath is empty', () => {
      expect(isVllmConfigured(makeVenvSettings(''), NOT_INSTALLED)).toBe(false)
    })

    it('returns true when venvPath is set', () => {
      expect(isVllmConfigured(makeVenvSettings('\\\\wsl$\\Ubuntu\\home\\user\\.modelbox\\vllm-env'), NOT_INSTALLED)).toBe(true)
    })
  })

  describe('docker envKind', () => {
    function makeDockerSettings(dockerImage: string): AppSettings {
      return makeSettings({
        vllmRuntime: {
          envKind: 'docker',
          condaEnvName: '',
          condaShPath: '',
          venvPath: '',
          dockerImage,
          dockerExtraArgs: '',
          wslDistro: '',
        },
      })
    }

    it('returns false when dockerImage is empty', () => {
      expect(isVllmConfigured(makeDockerSettings(''), NOT_INSTALLED)).toBe(false)
    })

    it('returns true when dockerImage is set', () => {
      expect(isVllmConfigured(makeDockerSettings('vllm/vllm-openai:latest'), NOT_INSTALLED)).toBe(true)
    })
  })
})
