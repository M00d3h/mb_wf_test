import { API_KEY_COMMAND_MASK } from '@shared/apiKeyMask'
import type { ProfileConfig, AppSettings, BuildCommandResult } from '@shared/types'
import { parseCommandLine } from './commandLineParse'

/** Auto-fill mmproj from detected model files when the profile hasn't set one explicitly. */
export function resolveConfigMmproj(config: ProfileConfig, detectedFiles: string[]): ProfileConfig {
  if (config.mmprojDisabled || config.mmproj) return config
  const detected = detectedFiles.find((f) =>
    /mmproj/i.test(f.replace(/\\/g, '/').split('/').pop() ?? '')
  )
  return detected ? { ...config, mmproj: detected } : config
}

export function buildEnvFromConfig(
  config: ProfileConfig,
  settings: AppSettings
): NodeJS.ProcessEnv {
  let env: NodeJS.ProcessEnv = { ...process.env, ...(config.env ?? {}) }
  if (config.prependCudaToPath && settings.cudaBinPath) {
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${settings.cudaBinPath};${env[pathKey] ?? ''}`
  }
  return env
}

function buildEnvDisplay(
  env: NodeJS.ProcessEnv,
  config: ProfileConfig,
  settings: AppSettings
): Record<string, string> {
  const envDisplay: Record<string, string> = {}
  const baseKeys = new Set(Object.keys(process.env))
  for (const [k, v] of Object.entries(env)) {
    if (!baseKeys.has(k) || (config.env && k in config.env)) {
      envDisplay[k] = v ?? ''
    }
  }
  if (config.prependCudaToPath && settings.cudaBinPath) {
    envDisplay['PATH'] = `${settings.cudaBinPath};...`
  }
  return envDisplay
}

/** Flags (with a following value) that the builder manages — used to strip them from custom commands. */
const BUILDER_VALUE_FLAGS = new Set([
  '-m',
  '-a',
  '--model',
  '--alias',
  '--mmproj',
  '-c',
  '--ctx-size',
  '--context-size',
  '-ngl',
  '--n-gpu-layers',
  '--n-cpu-moe',
  '-fa',
  '--fit',
  '--parallel',
  '-ctk',
  '-ctv',
  '--host',
  '--port',
  '--api-key',
  '--temp',
  '--top-p',
  '--min-p',
  '--top-k',
  '--repeat-penalty',
  '--presence-penalty',
  '--spec-type',
  '--spec-ngram-size-n',
  '--draft-min',
  '--draft-max',
])
/** Standalone boolean flags the builder manages. */
const BUILDER_BOOL_FLAGS = new Set(['--embeddings', '--backend-sampling'])

/** Remove all builder-managed flags (and their values) from parsed args, returning any unknown ones. */
function stripBuilderArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!
    const eq = tok.indexOf('=')
    const baseFlag = eq === -1 ? tok : tok.slice(0, eq)
    if (BUILDER_VALUE_FLAGS.has(tok)) {
      i++ // skip separate value token
    } else if (eq !== -1 && BUILDER_VALUE_FLAGS.has(baseFlag)) {
      // e.g. --n-cpu-moe=4 — value is inline; do not skip the next argv token
    } else if (BUILDER_BOOL_FLAGS.has(tok)) {
      // skip boolean flag
    } else {
      result.push(tok)
    }
  }
  return result
}

export function argsIncludeApiKeyFlag(args: string[]): boolean {
  for (const a of args) {
    if (a === '--api-key' || a.startsWith('--api-key=')) return true
  }
  return false
}

function stripApiKeyFromArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!
    if (t === '--api-key') {
      i++
      continue
    }
    if (t.startsWith('--api-key=')) continue
    out.push(t)
  }
  return out
}

function maskArgsForDisplay(args: string[]): string[] {
  return args.map((arg, i) => {
    if (args[i - 1] === '--api-key') return API_KEY_COMMAND_MASK
    if (arg.startsWith('--api-key=')) {
      return `--api-key=${API_KEY_COMMAND_MASK}`
    }
    return arg
  })
}

function escapeForDoubleQuotedArg(a: string): string {
  return a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function needsArgQuotingForSpawn(a: string): boolean {
  return a.length === 0 || /[\s"]/.test(a)
}

/** Join executable + args for display/copy; inner `"` in args are escaped so values survive round-trip via parseCommandLine. */
export function formatSpawnCommand(executable: string, displayArgs: string[]): string {
  const q = (a: string): string =>
    needsArgQuotingForSpawn(a) ? `"${escapeForDoubleQuotedArg(a)}"` : a
  const exePart = needsArgQuotingForSpawn(executable)
    ? `"${escapeForDoubleQuotedArg(executable)}"`
    : executable
  return (
    exePart +
    (displayArgs.length ? ' ' : '') +
    displayArgs.map(q).join(' ')
  )
}

/**
 * Strips any `--port` / `--port=…` (and a following argv token) so the listen port can be
 * set explicitly — e.g. when the app picks a free port without saving it to the profile.
 */
export function applyListenPortToArgs(args: string[], port: number): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!
    const eq = tok.indexOf('=')
    const base = eq === -1 ? tok : tok.slice(0, eq)
    if (base === '--port') {
      if (eq === -1) i++
      continue
    }
    result.push(tok)
  }
  result.push('--port', String(port))
  return result
}

export function buildCommand(
  ggufPath: string,
  config: ProfileConfig,
  apiKey: string | undefined,
  settings: AppSettings
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  const args: string[] = ['-m', ggufPath]

  if (config.alias != null) args.push('-a', config.alias)
  if (config.mmproj != null && !config.mmprojDisabled) args.push('--mmproj', config.mmproj)
  if (config.embeddings) args.push('--embeddings')
  if (config.contextSize != null) args.push('-c', String(config.contextSize))
  if (config.gpuLayers != null) args.push('-ngl', String(config.gpuLayers))
  if (config.nCpuMoe != null) args.push('--n-cpu-moe', String(config.nCpuMoe))
  if (config.flashAttn != null) args.push('-fa', config.flashAttn)
  if (config.fit != null) args.push('--fit', config.fit)
  if (config.backendSampling) args.push('--backend-sampling')
  if (config.parallel != null) args.push('--parallel', String(config.parallel))
  if (config.kvCacheTypeK != null) args.push('-ctk', config.kvCacheTypeK)
  if (config.kvCacheTypeV != null) args.push('-ctv', config.kvCacheTypeV)
  if (config.host != null) args.push('--host', config.host)
  if (config.port != null) args.push('--port', String(config.port))
  if (apiKey) args.push('--api-key', apiKey)
  if (config.temp != null) args.push('--temp', String(config.temp))
  if (config.topP != null) args.push('--top-p', String(config.topP))
  if (config.minP != null) args.push('--min-p', String(config.minP))
  if (config.topK != null) args.push('--top-k', String(config.topK))
  if (config.repeatPenalty != null) args.push('--repeat-penalty', String(config.repeatPenalty))
  if (config.presencePenalty != null) args.push('--presence-penalty', String(config.presencePenalty))
  if (config.specType != null) args.push('--spec-type', config.specType)
  if (config.specNgramSizeN != null) args.push('--spec-ngram-size-n', String(config.specNgramSizeN))
  if (config.draftMin != null) args.push('--draft-min', String(config.draftMin))
  if (config.draftMax != null) args.push('--draft-max', String(config.draftMax))

  const env = buildEnvFromConfig(config, settings)
  return { executable: settings.llamaServerPath, args, env }
}

export function buildCommandResult(
  ggufPath: string,
  config: ProfileConfig,
  apiKey: string | undefined,
  settings: AppSettings,
  liveOverride = false
): BuildCommandResult {
  if (config.launchMode === 'custom' && config.customCommandLine?.trim()) {
    try {
      const { executable, args } = parseCommandLine(config.customCommandLine.trim())

      let finalArgs: string[]
      if (liveOverride) {
        // Live preview: apply all live config fields onto the custom command.
        // Strip every builder-managed flag, rebuild from config, preserve unknown flags.
        // Do not inject keychain into merged argv unless the custom line still includes
        // --api-key (user removed it from the command → preview must not re-add the key).
        const unknownArgs = stripBuilderArgs(args)
        let keyForBuild: string | undefined
        try {
          const { args: a } = parseCommandLine(config.customCommandLine.trim())
          keyForBuild = argsIncludeApiKeyFlag(a) ? apiKey : undefined
        } catch {
          keyForBuild = apiKey
        }
        const { args: configArgs } = buildCommand(ggufPath, config, keyForBuild, settings)
        finalArgs = [...configArgs, ...unknownArgs]
      } else if (apiKey !== undefined) {
        // Only re-inject the key from keychain when the saved line includes --api-key;
        // otherwise the literal custom argv is the source of truth.
        const stripped = stripApiKeyFromArgs(args)
        const hadApiKey = argsIncludeApiKeyFlag(args)
        if (apiKey && hadApiKey) {
          finalArgs = [...stripped, '--api-key', apiKey]
        } else {
          finalArgs = stripped
        }
      } else {
        finalArgs = args
      }

      const env = buildEnvFromConfig(config, settings)
      const displayArgs = maskArgsForDisplay(finalArgs)
      const envDisplay = buildEnvDisplay(env, config, settings)
      return {
        executable,
        args: displayArgs,
        envDisplay,
        fullCommand: formatSpawnCommand(executable, displayArgs)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`Invalid custom command line: ${msg}`)
    }
  }

  const { executable, args, env } = buildCommand(ggufPath, config, apiKey, settings)
  const displayArgs = maskArgsForDisplay(args)
  const envDisplay = buildEnvDisplay(env, config, settings)
  return {
    executable,
    args: displayArgs,
    envDisplay,
    fullCommand: formatSpawnCommand(executable, displayArgs)
  }
}
