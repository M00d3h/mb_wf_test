import { ipcMain, dialog, nativeTheme } from 'electron'
import { getSettings, updateSettings } from '../db/repos/settings.repo'
import type { AppSettings } from '@shared/types'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async () => {
    return getSettings()
  })

  ipcMain.handle('settings:set', async (_e, patch: Partial<AppSettings>) => {
    return updateSettings(patch)
  })

  ipcMain.on('settings:set-theme', (_e, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme
  })

  ipcMain.handle('settings:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('settings:pick-file', async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters ?? [{ name: 'All Files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
