import { ipcMain } from 'electron'
import { scanModels } from '../services/modelScanner'
import { listModels, getModel, deleteModel } from '../db/repos/models.repo'
import { getSettings } from '../db/repos/settings.repo'
import { listProfiles } from '../db/repos/profiles.repo'
import { listInstances, deleteInstance } from '../db/repos/serverInstances.repo'
import { clearModelBinding } from '../db/repos/conversations.repo'
import { stopProcess, clearArchivedLogs } from '../services/processManager'
import { deleteApiKey } from '../services/keychain'
import { getQueue, cancelQueued } from '../services/serverQueue'
import { deleteModelGgufFiles } from '../services/deleteModelFiles'

export function registerModelsIpc(): void {
  ipcMain.handle('models:scan', async () => {
    const settings = getSettings()
    await scanModels(settings.modelsDirs)
    // Return DB list (ORDER BY name) so UI order matches fetchModels and stays stable.
    return listModels()
  })

  ipcMain.handle('models:list', async () => {
    return listModels()
  })

  ipcMain.handle('models:get', async (_e, id: string) => {
    return getModel(id)
  })

  ipcMain.handle('models:delete', async (_e, modelId: string) => {
    const model = getModel(modelId)
    if (!model) throw new Error(`Model ${modelId} not found`)

    const instances = listInstances().filter((i) => i.modelId === modelId)
    for (const inst of instances) {
      await stopProcess(inst.id)
      deleteInstance(inst.id)
      clearArchivedLogs(inst.id)
    }

    const profiles = listProfiles(modelId)
    const profileIds = new Set(profiles.map((p) => p.id))
    for (const q of getQueue()) {
      if (q.profileId && profileIds.has(q.profileId)) cancelQueued(q.id)
    }
    for (const p of profiles) {
      await deleteApiKey(p.id)
    }

    await deleteModelGgufFiles(model)

    clearModelBinding(modelId)
    deleteModel(modelId)
  })
}
