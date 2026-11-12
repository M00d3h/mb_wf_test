import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  duplicateProfile
} from '../db/repos/profiles.repo'
import { getModel } from '../db/repos/models.repo'
import { getSettings } from '../db/repos/settings.repo'
import { setApiKey, getApiKey, deleteApiKey } from '../services/keychain'
import {
  argsIncludeApiKeyFlag,
  buildCommandResult,
  resolveConfigMmproj
} from '../services/commandBuilder'
import { tryParseCommandLine, parseCommandLine } from '../services/commandLineParse'
import { mergeArgvIntoProfileConfig } from '../services/argvToProfileConfig'
import type { ProfileConfig } from '@shared/types'

export function registerProfilesIpc(): void {
  ipcMain.handle('profiles:list', async (_e, modelId: string) => {
    return listProfiles(modelId)
  })

  ipcMain.handle(
    'profiles:create',
    async (
      _e,
      modelId: string,
      name: string,
      config: ProfileConfig,
      apiKey?: string
    ) => {
      const id = uuidv4()
      const profiles = listProfiles(modelId)
      const profile = createProfile(id, modelId, name, config, profiles.length === 0)
      if (apiKey != null) await setApiKey(id, apiKey)
      return profile
    }
  )

  ipcMain.handle(
    'profiles:update',
    async (
      _e,
      id: string,
      patch: { name?: string; config?: ProfileConfig; apiKey?: string | null }
    ) => {
      const profile = updateProfile(id, patch)
      if (patch.apiKey !== undefined) {
        if (patch.apiKey === null) {
          await deleteApiKey(id)
        } else {
          await setApiKey(id, patch.apiKey)
        }
      }
      return profile
    }
  )

  ipcMain.handle('profiles:delete', async (_e, id: string) => {
    await deleteApiKey(id)
    deleteProfile(id)
  })

  ipcMain.handle('profiles:set-active', async (_e, id: string) => {
    setActiveProfile(id)
  })

  ipcMain.handle('profiles:duplicate', async (_e, id: string) => {
    const source = getProfile(id)
    if (!source) throw new Error(`Profile ${id} not found`)
    const newId = uuidv4()
    const newName = `${source.name} (copy)`
    const profile = duplicateProfile(id, newId, newName)
    // copy api key too
    const apiKey = await getApiKey(id)
    if (apiKey) await setApiKey(newId, apiKey)
    return profile
  })

  ipcMain.handle(
    'profiles:build-command',
    async (
      _e,
      id: string,
      opts?: {
        forceBuilder?: boolean
        configOverride?: ProfileConfig
        apiKeyOverride?: string | null
      }
    ) => {
      const profile = getProfile(id)
      if (!profile) throw new Error(`Profile ${id} not found`)
      const model = getModel(profile.modelId)
      if (!model) throw new Error(`Model ${profile.modelId} not found`)
      const apiKey =
        opts?.apiKeyOverride !== undefined
          ? opts.apiKeyOverride || undefined
          : (await getApiKey(id)) ?? undefined
      const settings = getSettings()
      let config: ProfileConfig = opts?.configOverride ?? profile.config
      if (opts?.forceBuilder === true) {
        config = { ...config, launchMode: 'builder' as const }
      }
      config = resolveConfigMmproj(config, model.detectedFiles)
      return buildCommandResult(model.ggufPath, config, apiKey, settings, opts?.configOverride !== undefined)
    }
  )

  ipcMain.handle('profiles:parse-command-line', async (_e, line: string) => {
    return tryParseCommandLine(line)
  })

  ipcMain.handle(
    'profiles:apply-custom-command-line',
    async (_e, id: string, line: string) => {
      const profile = getProfile(id)
      if (!profile) throw new Error(`Profile ${id} not found`)
      const trimmed = line.trim()
      if (!trimmed) throw new Error('Command line is empty')
      let parsed: { executable: string; args: string[] }
      try {
        parsed = parseCommandLine(trimmed)
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e))
      }
      const { config: merged, apiKey: parsedApiKey } = mergeArgvIntoProfileConfig(parsed.args, profile.config)
      const updated = updateProfile(id, {
        config: {
          ...merged,
          launchMode: 'custom',
          customCommandLine: trimmed,
        },
      })
      if (argsIncludeApiKeyFlag(parsed.args)) {
        if (parsedApiKey != null && String(parsedApiKey).trim() !== '') {
          await setApiKey(id, parsedApiKey)
        } else {
          await deleteApiKey(id)
        }
      } else {
        await deleteApiKey(id)
      }
      return updated
    }
  )

  ipcMain.handle('profiles:get-api-key', async (_e, id: string) => {
    return getApiKey(id)
  })

  ipcMain.handle('profiles:set-api-key', async (_e, id: string, apiKey: string) => {
    await setApiKey(id, apiKey)
  })
}
