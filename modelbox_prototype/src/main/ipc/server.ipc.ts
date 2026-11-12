import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getProfile } from '../db/repos/profiles.repo'
import { getModel } from '../db/repos/models.repo'
import { getSettings } from '../db/repos/settings.repo'
import {
  createInstance,
  listInstances,
  getInstance,
  deleteInstance
} from '../db/repos/serverInstances.repo'
import {
  applyListenPortToArgs,
  buildCommand,
  buildEnvFromConfig,
  resolveConfigMmproj
} from '../services/commandBuilder'
import { parseCommandLine } from '../services/commandLineParse'
import {
  startProcess,
  stopProcess,
  getLogs,
  isRunning,
  clearArchivedLogs,
  getConnectionHost
} from '../services/processManager'
import { findFreePort, isPortFree } from '../services/portChecker'
import { getApiKey } from '../services/keychain'
import { hostPortMatchInstance } from '@shared/hostPortMatch'
import { cancelQueued, getQueue } from '../services/serverQueue'
import { getVllmModel } from '../db/repos/vllmModels.repo'
import { getVllmProfile } from '../db/repos/vllmProfiles.repo'
import { buildVllmCommandPlan } from '../services/vllmCommandBuilder'
import { getWslVmIp } from '../utils/wslPath'
import { basename } from 'node:path'

// Tracks ports currently being started so concurrent start calls don't both
// allocate the same port before either has created a DB record.
// Using a Set is safe because JS is single-threaded: after an await resolves,
// the block runs synchronously until the next yield, so add/has/delete are atomic.
const portsBeingStarted = new Set<number>()

export function registerServerIpc(): void {
  ipcMain.handle('server:start', async (_e, profileId: string) => {
    const profile = getProfile(profileId)
    if (!profile) throw new Error(`Profile ${profileId} not found`)
    const model = getModel(profile.modelId)
    if (!model) throw new Error(`Model ${profile.modelId} not found`)
    const settings = getSettings()
    const apiKey = await getApiKey(profileId)

    const requestedPort = profile.config.port ?? settings.llamaBasePort
    const host = profile.config.host ?? settings.llamaDefaultHost

    // Find the actual port to launch on. If the configured port is taken (by
    // another running instance, a concurrent start, or a non-ModelBox process),
    // try successive ports without modifying the profile — the profile always
    // remembers the user's intended port so future solo launches use it directly.
    let actualPort = requestedPort
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!portsBeingStarted.has(actualPort)) {
        const dbConflict = listInstances().some(
          (i) =>
            i.port === actualPort &&
            isRunning(i.id) &&
            (i.state === 'running' || i.state === 'starting' || i.state === 'loading')
        )
        if (!dbConflict) break
      }
      actualPort++
    }
    if (actualPort >= requestedPort + 100) {
      throw new Error(`No free port found starting from ${requestedPort}`)
    }
    portsBeingStarted.add(actualPort)

    let executable: string
    let args: string[]
    let env: NodeJS.ProcessEnv
    if (profile.config.launchMode === 'custom' && profile.config.customCommandLine?.trim()) {
      try {
        const parsed = parseCommandLine(profile.config.customCommandLine.trim())
        executable = parsed.executable
        args = applyListenPortToArgs(parsed.args, actualPort)
        env = buildEnvFromConfig(profile.config, settings)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`Invalid custom command line: ${msg}`)
      }
    } else {
      // Instance + health checks use `actualPort`; argv must use the same port or the
      // process binds to the profile default while the poller hits the incremented port.
      const configWithListenPort = { ...profile.config, port: actualPort }
      const built = buildCommand(
        model.ggufPath,
        resolveConfigMmproj(configWithListenPort, model.detectedFiles),
        apiKey ?? undefined,
        settings
      )
      executable = built.executable
      args = built.args
      env = built.env
    }

    const id = uuidv4()
    try {
      createInstance({
        id,
        instanceKind: 'llama',
        modelId: model.id,
        profileId,
        host,
        port: actualPort
      })
      startProcess(id, executable, args, env, host, actualPort)
    } finally {
      portsBeingStarted.delete(actualPort)
    }
    const inst = getInstance(id)!
    return { instance: inst, queued: false }
  })

  ipcMain.handle('server:stop', async (_e, instanceId: string) => {
    await stopProcess(instanceId)
    // Remove stopped instance from DB so it doesn't linger in the list
    deleteInstance(instanceId)
    clearArchivedLogs(instanceId)
  })

  ipcMain.handle('server:clear-instance', async (_e, instanceId: string) => {
    deleteInstance(instanceId)
    clearArchivedLogs(instanceId)
  })

  ipcMain.handle(
    'server:get-api-key',
    async (
      _e,
      host: string,
      port: number,
      instanceId?: string,
      profileIdHint?: string,
    ) => {
      const instances = listInstances()
      // Prefer exact instanceId lookup so the correct profile key is returned
      // even when two instances share the same port in an edge-case scenario.
      let inst = instanceId
        ? instances.find((i) => i.id === instanceId)
        : undefined
      if (!inst) {
        inst = instances.find((i) => hostPortMatchInstance(host, port, i))
      }
      const profileId = inst?.profileId ?? profileIdHint
      if (!profileId || inst?.instanceKind === 'vllm') return null
      const key = await getApiKey(profileId)
      const trimmed = key?.trim()
      return trimmed ? trimmed : null
    },
  )

  ipcMain.handle('server:restart', async (_e, instanceId: string) => {
    const inst = getInstance(instanceId)
    if (!inst) throw new Error(`Instance ${instanceId} not found`)
    await stopProcess(instanceId)
    const settings = getSettings()

    if (inst.instanceKind === 'vllm') {
      const vm = inst.vllmModelId ? getVllmModel(inst.vllmModelId) : null
      if (!vm) throw new Error('vLLM model not found for restart')
      const vp =
        inst.vllmProfileId != null ? getVllmProfile(inst.vllmProfileId) : null
      const cfg = vp?.config ?? {}
      const plan = buildVllmCommandPlan(vm, cfg, settings, inst.port)
      const isDockerPlan = /^docker$/i.test(basename(plan.executable))
      let connectionHost: string | undefined
      if (process.platform === 'win32' && !isDockerPlan) {
        const wslIp = getWslVmIp()
        if (wslIp) connectionHost = wslIp
      }
      startProcess(instanceId, plan.executable, plan.args, plan.env, inst.host, inst.port, 'vllm', connectionHost)
      return getInstance(instanceId)
    }

    const profile = getProfile(inst.profileId!)
    if (!profile) throw new Error('Profile not found for restart')
    const model = getModel(inst.modelId!)
    if (!model) throw new Error('Model not found for restart')
    const apiKey = await getApiKey(inst.profileId!)
    let executable: string
    let args: string[]
    let env: NodeJS.ProcessEnv
    if (profile.config.launchMode === 'custom' && profile.config.customCommandLine?.trim()) {
      try {
        const parsed = parseCommandLine(profile.config.customCommandLine.trim())
        executable = parsed.executable
        args = applyListenPortToArgs(parsed.args, inst.port)
        env = buildEnvFromConfig(profile.config, settings)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`Invalid custom command line: ${msg}`)
      }
    } else {
      const configWithListenPort = { ...profile.config, port: inst.port }
      const built = buildCommand(
        model.ggufPath,
        resolveConfigMmproj(configWithListenPort, model.detectedFiles),
        apiKey ?? undefined,
        settings
      )
      executable = built.executable
      args = built.args
      env = built.env
    }
    startProcess(instanceId, executable, args, env, inst.host, inst.port, 'llama')
    return getInstance(instanceId)
  })

  ipcMain.handle('server:list', async () => {
    const instances = listInstances()
    const rt = getSettings().vllmRuntime
    const runtimeLabel = `${rt.envKind}${rt.envKind === 'conda' && rt.condaEnvName ? `:${rt.condaEnvName}` : ''}`
    return instances.map((inst) => {
      let modelName = inst.modelName
      let profileName = inst.profileName
      if (inst.instanceKind === 'vllm' && inst.vllmModelId) {
        const vm = getVllmModel(inst.vllmModelId)
        const vp =
          inst.vllmProfileId != null ? getVllmProfile(inst.vllmProfileId) : null
        if (vm) {
          modelName = vp?.config?.servedModelName?.trim() || vm.displayName
          profileName = vp?.name ?? runtimeLabel
        }
      }
      return {
        ...inst,
        modelName,
        profileName,
        connectionHost: getConnectionHost(inst.id),
        state: isRunning(inst.id)
          ? inst.state // trust live DB state (starting / loading / running)
          : inst.state === 'running' || inst.state === 'starting' || inst.state === 'loading'
            ? ('error' as const) // process gone but DB thinks it was active
            : inst.state,
      }
    })
  })

  ipcMain.handle('server:get-logs', async (_e, instanceId: string) => {
    return getLogs(instanceId)
  })

  ipcMain.handle('port:check', async (_e, port: number) => {
    const available = await isPortFree(port)
    if (available) return { available: true }
    const suggestedPort = await findFreePort(port + 1).catch(() => null)
    return { available: false, suggestedPort }
  })

  ipcMain.handle('server:queue-list', async () => {
    return getQueue()
  })

  ipcMain.handle('server:queue-cancel', async (_e, id: string) => {
    cancelQueued(id)
  })
}
