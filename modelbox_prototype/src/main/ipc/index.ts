import { ipcMain } from 'electron'
import { registerModelsIpc } from './models.ipc'
import { registerProfilesIpc } from './profiles.ipc'
import { registerServerIpc } from './server.ipc'
import { registerChatIpc } from './chat.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerSysStatsIpc } from './sysStats.ipc'
import { registerFoldersIpc } from './folders.ipc'
import { registerHuggingfaceIpc } from './huggingface.ipc'
import { registerVllmIpc } from './vllm.ipc'
import { registerMCPIpc } from './mcp.ipc'
import { registerRuntimeIpc } from './runtime.ipc'
import { registerUpdateIpc } from './update.ipc'

type HandleListener = Parameters<typeof ipcMain.handle>[1]

/** Wrap an ipcMain handler with timing and error logging. */
export function wrapIpc(channel: string, listener: HandleListener): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const t0 = Date.now()
    try {
      const result = await listener(event, ...args)
      console.log(`[ipc] ${channel} (${Date.now() - t0}ms)`)
      return result
    } catch (err) {
      console.error(`[ipc] ${channel} error (${Date.now() - t0}ms):`, err)
      throw err
    }
  })
}

export function registerAllIpc(): void {
  registerModelsIpc()
  registerProfilesIpc()
  registerServerIpc()
  registerVllmIpc()
  registerChatIpc()
  registerSettingsIpc()
  registerSysStatsIpc()
  registerFoldersIpc()
  registerHuggingfaceIpc()
  registerMCPIpc()
  registerRuntimeIpc()
  registerUpdateIpc()
}
