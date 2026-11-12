import type { ProfileConfig } from '@shared/types'

/** Keys we can infer from llama-server style argv (matches commandBuilder.ts). */
const TRACKED: (keyof ProfileConfig)[] = [
  'alias',
  'mmproj',
  'embeddings',
  'contextSize',
  'gpuLayers',
  'nCpuMoe',
  'flashAttn',
  'fit',
  'backendSampling',
  'parallel',
  'kvCacheTypeK',
  'kvCacheTypeV',
  'host',
  'port',
  'temp',
  'topP',
  'minP',
  'topK',
  'repeatPenalty',
  'presencePenalty',
  'specType',
  'specNgramSizeN',
  'draftMin',
  'draftMax'
]

function parseFloatStrict(s: string): number | undefined {
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Supports e.g. 8192, 100k, 1.5M, 2G (decimal k/m/g multipliers). */
export function parseScaledInt(raw: string): number | undefined {
  const s = raw.trim().toLowerCase().replace(/_/g, '')
  const m = /^(\d+(?:\.\d+)?)(k|m|g)?$/i.exec(s)
  if (!m) return undefined
  let n = parseFloat(m[1]!)
  if (Number.isNaN(n)) return undefined
  const suf = m[2]?.toLowerCase()
  if (suf === 'k') n *= 1000
  else if (suf === 'm') n *= 1_000_000
  else if (suf === 'g') n *= 1_000_000_000
  return Math.round(n)
}

function parseIntStrict(s: string): number | undefined {
  const n = parseInt(s.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Merge argv-derived flags into profile config for Apply custom command.
 * Tracked keys that appear in argv are set; tracked keys not present in argv
 * are removed so the structured UI matches the command. Non-tracked fields
 * (e.g. env, prependCudaToPath) are preserved from base.
 * Returns the merged config and the extracted API key (if --api-key was present).
 */
export function mergeArgvIntoProfileConfig(
  args: string[],
  base: ProfileConfig
): { config: ProfileConfig; apiKey: string | undefined } {
  const extracted: Partial<ProfileConfig> = {}
  const seen = new Set<keyof ProfileConfig>()
  let extractedApiKey: string | undefined

  const setNum = (key: keyof ProfileConfig, v: number | undefined): void => {
    if (v === undefined) return
    seen.add(key)
    ;(extracted as Record<string, unknown>)[key] = v
  }

  const setStr = (key: keyof ProfileConfig, v: string | undefined): void => {
    if (v === undefined) return
    seen.add(key)
    ;(extracted as Record<string, unknown>)[key] = v
  }

  const setBool = (key: keyof ProfileConfig, v: boolean): void => {
    seen.add(key)
    ;(extracted as Record<string, unknown>)[key] = v
  }

  let i = 0
  while (i < args.length) {
    let tok = args[i]!
    if (!tok.startsWith('-')) {
      i++
      continue
    }

    const eq = tok.indexOf('=')
    let flag = tok
    let inlineVal: string | undefined
    if (eq !== -1) {
      flag = tok.slice(0, eq)
      inlineVal = tok.slice(eq + 1)
    }

    const nextVal = (): string | undefined => {
      if (inlineVal !== undefined) return inlineVal
      const n = args[i + 1]
      if (n !== undefined && !n.startsWith('-')) {
        i++
        return n
      }
      return undefined
    }

    const captureApiKey = (): void => {
      const v = inlineVal !== undefined
        ? inlineVal
        : (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-') ? args[++i] : undefined)
      if (v !== undefined) extractedApiKey = v
    }

    switch (flag) {
      case '-m':
      case '--model': {
        nextVal()
        break
      }
      case '-a':
      case '--alias': {
        const v = nextVal()
        if (v !== undefined) setStr('alias', v)
        break
      }
      case '--mmproj': {
        const v = nextVal()
        if (v !== undefined) setStr('mmproj', v)
        break
      }
      case '--embeddings':
        setBool('embeddings', true)
        break
      case '-c':
      case '--ctx-size':
      case '--context-size': {
        const v = nextVal()
        if (v !== undefined) {
          const n = parseScaledInt(v) ?? parseIntStrict(v)
          setNum('contextSize', n)
        }
        break
      }
      case '-ngl':
      case '--n-gpu-layers': {
        const v = nextVal()
        if (v !== undefined) setNum('gpuLayers', parseIntStrict(v))
        break
      }
      case '--n-cpu-moe': {
        const v = nextVal()
        if (v !== undefined) setNum('nCpuMoe', parseIntStrict(v))
        break
      }
      case '-fa': {
        const v = nextVal()
        if (v === 'on' || v === 'off') {
          seen.add('flashAttn')
          extracted.flashAttn = v
        }
        break
      }
      case '--backend-sampling':
        setBool('backendSampling', true)
        break
      case '--fit': {
        const v = nextVal()
        if (v !== undefined) setStr('fit', v)
        break
      }
      case '--parallel': {
        const v = nextVal()
        if (v !== undefined) setNum('parallel', parseIntStrict(v))
        break
      }
      case '-ctk': {
        const v = nextVal()
        if (v !== undefined) setStr('kvCacheTypeK', v)
        break
      }
      case '-ctv': {
        const v = nextVal()
        if (v !== undefined) setStr('kvCacheTypeV', v)
        break
      }
      case '--host': {
        const v = nextVal()
        if (v !== undefined) setStr('host', v)
        break
      }
      case '--port': {
        const v = nextVal()
        if (v !== undefined) setNum('port', parseIntStrict(v))
        break
      }
      case '--api-key':
        captureApiKey()
        break
      case '--temp': {
        const v = nextVal()
        if (v !== undefined) setNum('temp', parseFloatStrict(v))
        break
      }
      case '--top-p': {
        const v = nextVal()
        if (v !== undefined) setNum('topP', parseFloatStrict(v))
        break
      }
      case '--min-p': {
        const v = nextVal()
        if (v !== undefined) setNum('minP', parseFloatStrict(v))
        break
      }
      case '--top-k':
      case '--top_k': {
        const v = nextVal()
        if (v !== undefined) setNum('topK', parseFloatStrict(v))
        break
      }
      case '--repeat-penalty': {
        const v = nextVal()
        if (v !== undefined) setNum('repeatPenalty', parseFloatStrict(v))
        break
      }
      case '--presence-penalty': {
        const v = nextVal()
        if (v !== undefined) setNum('presencePenalty', parseFloatStrict(v))
        break
      }
      case '--spec-type': {
        const v = nextVal()
        if (v !== undefined) setStr('specType', v)
        break
      }
      case '--spec-ngram-size-n': {
        const v = nextVal()
        if (v !== undefined) setNum('specNgramSizeN', parseIntStrict(v))
        break
      }
      case '--draft-min': {
        const v = nextVal()
        if (v !== undefined) setNum('draftMin', parseIntStrict(v))
        break
      }
      case '--draft-max': {
        const v = nextVal()
        if (v !== undefined) setNum('draftMax', parseIntStrict(v))
        break
      }
      default:
        break
    }

    i++
  }

  const next: ProfileConfig = { ...base }
  for (const k of TRACKED) {
    if (seen.has(k)) {
      const v = (extracted as Record<string, unknown>)[k as string]
      if (v === undefined) delete next[k]
      else (next as Record<string, unknown>)[k as string] = v
    } else {
      delete next[k]
    }
  }

  return { config: next, apiKey: extractedApiKey }
}
