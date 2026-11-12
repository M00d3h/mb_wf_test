import type { AppSettings, VllmRuntimeInfo } from '@shared/types'

/**
 * True if vLLM can be launched — either via the managed venv OR an intentionally
 * configured custom runtime. The default DB settings (conda/""/no condaShPath)
 * are treated as unconfigured so they don't bypass the "not installed" block.
 */
export function isVllmConfigured(
  settings: AppSettings | null | undefined,
  runtimeInfo: VllmRuntimeInfo | null | undefined,
): boolean {
  if (runtimeInfo?.status === 'installed') return true
  const rt = settings?.vllmRuntime
  if (!rt) return false
  if (rt.envKind === 'conda') {
    // Any non-empty env name counts as intentional configuration.
    // Default is { condaEnvName: "", condaShPath: "" } — not intentional config.
    const hasEnvName = !!rt.condaEnvName
    const hasCondaSh = !!rt.condaShPath
    return hasEnvName || hasCondaSh
  }
  if (rt.envKind === 'venv') return !!rt.venvPath
  if (rt.envKind === 'docker') return !!rt.dockerImage
  return false
}
