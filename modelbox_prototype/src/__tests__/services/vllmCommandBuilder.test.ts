import { describe, it, expect } from 'vitest'
import { basename } from 'path'
import {
  buildVllmCommandPlan,
  buildVllmFullCommandDisplay,
} from '@main/services/vllmCommandBuilder'
import { makeSettings } from '../helpers/makeSettings'
import { makeVllmModel } from '../helpers/makeVllmModel'
import type { VllmModelConfig } from '@shared/types'

// Unix-style paths are returned as-is by windowsPathToWslMnt on Windows,
// so these tests are platform-neutral.
const MODEL_PATH = '/home/user/models/Mistral-7B-Instruct-v0.3'
const HF_MODEL_PATH =
  '/home/user/.cache/huggingface/hub/models--mistralai--Mistral-7B-v0.3/snapshots/abc123'
const VENV_PATH = '/home/user/vllm-env'

// ─── buildVllmFullCommandDisplay — builder mode ──────────────────────────────

describe('buildVllmFullCommandDisplay — builder mode', () => {
  it('starts with "vllm serve"', () => {
    const result = buildVllmFullCommandDisplay(
      makeVllmModel({ path: MODEL_PATH }),
      {},
      makeSettings(),
      8000
    )
    expect(result).toMatch(/^vllm serve /)
  })

  it('includes the model path (single-quoted)', () => {
    const result = buildVllmFullCommandDisplay(
      makeVllmModel({ path: MODEL_PATH }),
      {},
      makeSettings({ vllmDefaultHost: '127.0.0.1' }),
      8000
    )
    expect(result).toContain(`'${MODEL_PATH}'`)
  })

  it('includes --host and --port', () => {
    const result = buildVllmFullCommandDisplay(
      makeVllmModel({ path: MODEL_PATH }),
      {},
      makeSettings({ vllmDefaultHost: '0.0.0.0' }),
      9001
    )
    expect(result).toContain("--host '0.0.0.0'")
    expect(result).toContain('--port 9001')
  })

  it('uses cfg.host over settings.vllmDefaultHost when set', () => {
    const result = buildVllmFullCommandDisplay(
      makeVllmModel({ path: MODEL_PATH }),
      { host: '192.168.1.1' },
      makeSettings({ vllmDefaultHost: '127.0.0.1' }),
      8000
    )
    expect(result).toContain("--host '192.168.1.1'")
    expect(result).not.toContain('127.0.0.1')
  })

  it('falls back to 127.0.0.1 when host is empty string', () => {
    const result = buildVllmFullCommandDisplay(
      makeVllmModel({ path: MODEL_PATH }),
      { host: '' },
      makeSettings({ vllmDefaultHost: '' }),
      8000
    )
    expect(result).toContain("--host '127.0.0.1'")
  })

  describe('HuggingFace hub cache path detection', () => {
    it('extracts namespace/repo from HF cache path', () => {
      const result = buildVllmFullCommandDisplay(
        makeVllmModel({ path: HF_MODEL_PATH }),
        {},
        makeSettings(),
        8000
      )
      expect(result).toContain("'mistralai/Mistral-7B-v0.3'")
      expect(result).not.toContain(HF_MODEL_PATH)
    })

    it('uses the raw path for non-HF models', () => {
      const result = buildVllmFullCommandDisplay(
        makeVllmModel({ path: MODEL_PATH }),
        {},
        makeSettings(),
        8000
      )
      expect(result).toContain(`'${MODEL_PATH}'`)
    })
  })

  describe('vllmConfigToArgs — flag emission', () => {
    it('emits --max-model-len when set', () => {
      const cfg: VllmModelConfig = { maxModelLen: 4096 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--max-model-len 4096')
    })

    it('omits --max-model-len when undefined', () => {
      const result = buildVllmFullCommandDisplay(makeVllmModel(), {}, makeSettings(), 8000)
      expect(result).not.toContain('--max-model-len')
    })

    it('rounds maxModelLen to integer', () => {
      const cfg: VllmModelConfig = { maxModelLen: 4096.7 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--max-model-len 4097')
    })

    it('emits --max-num-seqs when set', () => {
      const cfg: VllmModelConfig = { maxNumSeqs: 32 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--max-num-seqs 32')
    })

    it('emits --gpu-memory-utilization when set', () => {
      const cfg: VllmModelConfig = { gpuMemoryUtilization: 0.9 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--gpu-memory-utilization 0.9')
    })

    it('emits --reasoning-parser when set', () => {
      const cfg: VllmModelConfig = { reasoningParser: 'deepseek_r1' }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--reasoning-parser')
      expect(result).toContain('deepseek_r1')
    })

    it('emits --enable-auto-tool-choice when true', () => {
      const cfg: VllmModelConfig = { enableAutoToolChoice: true }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--enable-auto-tool-choice')
    })

    it('omits --enable-auto-tool-choice when false', () => {
      const cfg: VllmModelConfig = { enableAutoToolChoice: false }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).not.toContain('--enable-auto-tool-choice')
    })

    it('emits --kv-cache-dtype when set', () => {
      const cfg: VllmModelConfig = { kvCacheDtype: 'fp8' }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--kv-cache-dtype')
      expect(result).toContain('fp8')
    })

    it('emits --served-model-name when set', () => {
      const cfg: VllmModelConfig = { servedModelName: 'my-custom-name' }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--served-model-name')
      expect(result).toContain('my-custom-name')
    })

    it('emits --speculative-config when set', () => {
      const cfg: VllmModelConfig = { speculativeConfig: '{"method":"mtp","num_speculative_tokens":4}' }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--speculative-config')
      expect(result).toContain('"method"')
    })

    it('skips non-finite numeric values (NaN, Infinity)', () => {
      const cfg: VllmModelConfig = { maxModelLen: NaN, maxNumSeqs: Infinity }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).not.toContain('--max-model-len')
      expect(result).not.toContain('--max-num-seqs')
    })

    it('skips non-positive maxModelLen', () => {
      const cfg: VllmModelConfig = { maxModelLen: 0 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).not.toContain('--max-model-len')
    })
  })

  describe('sampling override JSON', () => {
    it('emits --override-generation-config with temperature', () => {
      const cfg: VllmModelConfig = { temperature: 0.7 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--override-generation-config')
      expect(result).toContain('"temperature":0.7')
    })

    it('packs multiple sampling params into one JSON object', () => {
      const cfg: VllmModelConfig = { temperature: 0.8, topP: 0.95, topK: 40 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('--override-generation-config')
      expect(result).toContain('"temperature":0.8')
      expect(result).toContain('"top_p":0.95')
      expect(result).toContain('"top_k":40')
    })

    it('omits --override-generation-config when no sampling params are set', () => {
      const result = buildVllmFullCommandDisplay(makeVllmModel(), {}, makeSettings(), 8000)
      expect(result).not.toContain('--override-generation-config')
    })

    it('rounds topK to integer in the JSON', () => {
      const cfg: VllmModelConfig = { topK: 40.6 }
      const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
      expect(result).toContain('"top_k":41')
    })
  })
})

// ─── buildVllmFullCommandDisplay — custom mode ───────────────────────────────

describe('buildVllmFullCommandDisplay — custom mode', () => {
  it('unwraps wsl.exe bash -ic wrapper to expose inner vllm serve', () => {
    const cfg: VllmModelConfig = {
      launchMode: 'custom',
      customCommandLine: `wsl.exe bash -ic "vllm serve '/models/my-model' --host '0.0.0.0' --port 8000"`,
    }
    const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
    expect(result).toMatch(/^vllm serve /)
    expect(result).not.toContain('wsl.exe')
    expect(result).not.toContain('bash')
  })

  it('returns plain vllm serve command unchanged (no wrapper to strip)', () => {
    const cfg: VllmModelConfig = {
      launchMode: 'custom',
      customCommandLine: "vllm serve '/models/my-model' --host '0.0.0.0' --port 8000",
    }
    const result = buildVllmFullCommandDisplay(makeVllmModel(), cfg, makeSettings(), 8000)
    expect(result).toMatch(/^vllm serve /)
  })

  it('falls back to builder mode when customCommandLine is blank', () => {
    const cfg: VllmModelConfig = {
      launchMode: 'custom',
      customCommandLine: '',
    }
    const result = buildVllmFullCommandDisplay(makeVllmModel({ path: MODEL_PATH }), cfg, makeSettings(), 8000)
    expect(result).toMatch(/^vllm serve /)
    expect(result).toContain(MODEL_PATH)
  })
})

// ─── buildVllmCommandPlan — docker ───────────────────────────────────────────

describe('buildVllmCommandPlan — docker runtime', () => {
  const dockerSettings = makeSettings({
    vllmRuntime: { envKind: 'docker', dockerImage: 'vllm/vllm-openai:latest' },
  })
  const model = makeVllmModel({ path: '/home/user/models/mistral-7b' })

  it('uses docker as executable', () => {
    const plan = buildVllmCommandPlan(model, {}, dockerSettings, 8000)
    expect(plan.executable).toBe('docker')
  })

  it('uses docker run --rm with GPU and port flags', () => {
    const plan = buildVllmCommandPlan(model, {}, dockerSettings, 8000)
    expect(plan.args[0]).toBe('run')
    expect(plan.args).toContain('--rm')
    expect(plan.args).toContain('--gpus')
    expect(plan.args).toContain('all')
    expect(plan.args).toContain('-p')
  })

  it('maps port correctly (host:container)', () => {
    const plan = buildVllmCommandPlan(model, {}, dockerSettings, 9090)
    const pIdx = plan.args.indexOf('-p')
    expect(plan.args[pIdx + 1]).toBe('9090:9090')
  })

  it('mounts the model parent directory at /models', () => {
    const plan = buildVllmCommandPlan(model, {}, dockerSettings, 8000)
    const vIdx = plan.args.indexOf('-v')
    // /home/user/models/mistral-7b → parent is /home/user/models
    expect(plan.args[vIdx + 1]).toMatch(/\/home\/user\/models:\/models/)
  })

  it('passes the image name followed by vllm serve', () => {
    const plan = buildVllmCommandPlan(model, {}, dockerSettings, 8000)
    const imgIdx = plan.args.indexOf('vllm/vllm-openai:latest')
    expect(imgIdx).toBeGreaterThan(-1)
    expect(plan.args[imgIdx + 1]).toBe('vllm')
    expect(plan.args[imgIdx + 2]).toBe('serve')
  })

  it('appends dockerExtraArgs (space-split) between -v and image', () => {
    const settings = makeSettings({
      vllmRuntime: {
        envKind: 'docker',
        dockerImage: 'vllm/vllm-openai:latest',
        dockerExtraArgs: '--ipc host --privileged',
      },
    })
    const plan = buildVllmCommandPlan(model, {}, settings, 8000)
    expect(plan.args).toContain('--ipc')
    expect(plan.args).toContain('host')
    expect(plan.args).toContain('--privileged')
  })

  it('passes config flags to the container command', () => {
    const cfg: VllmModelConfig = { maxModelLen: 8192, reasoningParser: 'deepseek_r1' }
    const plan = buildVllmCommandPlan(model, cfg, dockerSettings, 8000)
    expect(plan.args).toContain('--max-model-len')
    expect(plan.args).toContain('8192')
    expect(plan.args).toContain('--reasoning-parser')
    expect(plan.args).toContain('deepseek_r1')
  })
})

// ─── buildVllmCommandPlan — Windows WSL paths ────────────────────────────────
// These tests run only on win32; other platforms take different branches.

describe('buildVllmCommandPlan — Windows WSL (venv/conda)', () => {
  if (process.platform !== 'win32') {
    it.skip('skipped on non-Windows platforms', () => {})
    return
  }

  describe('venv runtime', () => {
    it('uses wsl.exe as executable', () => {
      const s = makeSettings({ vllmRuntime: { envKind: 'venv', venvPath: VENV_PATH } })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      expect(basename(plan.executable).toLowerCase()).toMatch(/^wsl/)
    })

    it('includes bash -ic in args', () => {
      const s = makeSettings({ vllmRuntime: { envKind: 'venv', venvPath: VENV_PATH } })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      expect(plan.args).toContain('bash')
      expect(plan.args).toContain('-ic')
    })

    it('bash script activates the venv', () => {
      const s = makeSettings({ vllmRuntime: { envKind: 'venv', venvPath: VENV_PATH } })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      const icIdx = plan.args.indexOf('-ic')
      const script = plan.args[icIdx + 1] as string
      expect(script).toContain('activate')
      expect(script).toContain(VENV_PATH)
    })

    it('bash script invokes vllm serve with the model', () => {
      const s = makeSettings({ vllmRuntime: { envKind: 'venv', venvPath: VENV_PATH } })
      const plan = buildVllmCommandPlan(makeVllmModel({ path: MODEL_PATH }), {}, s, 8000)
      const icIdx = plan.args.indexOf('-ic')
      const script = plan.args[icIdx + 1] as string
      expect(script).toContain('vllm serve')
      expect(script).toContain(MODEL_PATH)
      expect(script).toContain('--port 8000')
    })

    it('includes -d DISTRO when wslDistro is set', () => {
      const s = makeSettings({
        vllmRuntime: { envKind: 'venv', venvPath: VENV_PATH, wslDistro: 'Ubuntu-22.04' },
      })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      expect(plan.args).toContain('-d')
      expect(plan.args).toContain('Ubuntu-22.04')
    })

    it('omits -d flag when wslDistro is not set', () => {
      const s = makeSettings({ vllmRuntime: { envKind: 'venv', venvPath: VENV_PATH } })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      expect(plan.args).not.toContain('-d')
    })
  })

  describe('conda runtime', () => {
    it('uses wsl.exe as executable', () => {
      const s = makeSettings({
        vllmRuntime: { envKind: 'conda', condaEnvName: 'vllm' },
      })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      expect(basename(plan.executable).toLowerCase()).toMatch(/^wsl/)
    })

    it('bash script uses conda run', () => {
      const s = makeSettings({
        vllmRuntime: { envKind: 'conda', condaEnvName: 'my-vllm-env' },
      })
      const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
      const icIdx = plan.args.indexOf('-ic')
      const script = plan.args[icIdx + 1] as string
      expect(script).toContain('conda run')
      expect(script).toContain('my-vllm-env')
      expect(script).toContain('vllm serve')
    })
  })
})

// ─── buildVllmCommandPlan — custom mode ──────────────────────────────────────

describe('buildVllmCommandPlan — custom mode', () => {
  describe('non-Windows (or when executable is docker)', () => {
    it('uses the parsed executable and applies port to args', () => {
      if (process.platform === 'win32') return // tested separately below
      const cfg: VllmModelConfig = {
        launchMode: 'custom',
        customCommandLine: 'vllm serve /models/my-model --port 7000',
      }
      const plan = buildVllmCommandPlan(makeVllmModel(), cfg, makeSettings(), 9999)
      expect(plan.executable).toBe('vllm')
      expect(plan.args).toContain('--port')
      expect(plan.args[plan.args.indexOf('--port') + 1]).toBe('9999')
      expect(plan.args).not.toContain('7000')
    })
  })

  describe('Windows — wsl.exe command', () => {
    if (process.platform !== 'win32') return

    it('passes through with port patched inside -ic script', () => {
      const cfg: VllmModelConfig = {
        launchMode: 'custom',
        customCommandLine: `wsl.exe bash -ic "vllm serve '/models/my-model' --port 7000"`,
      }
      const plan = buildVllmCommandPlan(makeVllmModel(), cfg, makeSettings(), 9999)
      expect(basename(plan.executable).toLowerCase()).toMatch(/^wsl/)
      const icIdx = plan.args.indexOf('-ic')
      const script = plan.args[icIdx + 1] as string
      expect(script).toContain('--port 9999')
      expect(script).not.toContain('--port 7000')
    })

    it('wraps a plain vllm serve command in WSL', () => {
      const cfg: VllmModelConfig = {
        launchMode: 'custom',
        customCommandLine: "vllm serve '/models/my-model' --port 7000",
      }
      const plan = buildVllmCommandPlan(makeVllmModel(), cfg, makeSettings(), 9999)
      expect(basename(plan.executable).toLowerCase()).toMatch(/^wsl/)
      expect(plan.args).toContain('-ic')
      const icIdx = plan.args.indexOf('-ic')
      const script = plan.args[icIdx + 1] as string
      expect(script).toContain('vllm')
      expect(script).toContain('--port 9999')
    })
  })
})

// ─── normalizeVllmRuntime coercion ────────────────────────────────────────────

describe('normalizeVllmRuntime coercion (tested via buildVllmCommandPlan)', () => {
  it('coerces null/undefined envKind to "conda" (never falls to bare vllm on Windows)', () => {
    const s = makeSettings({ vllmRuntime: { envKind: undefined as unknown as 'conda' } })
    const plan = buildVllmCommandPlan(makeVllmModel(), {}, s, 8000)
    if (process.platform === 'win32') {
      // Coerced to conda → WSL plan
      expect(basename(plan.executable).toLowerCase()).toMatch(/^wsl/)
    } else {
      // Coerced to conda → bash -ic with conda run
      expect(plan.executable).toBe('bash')
      expect(plan.args).toContain('-ic')
    }
  })
})
