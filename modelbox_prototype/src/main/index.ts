import { app, BrowserWindow, shell, Menu, nativeTheme } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const ICON_PATH = resolve(__dirname, '../../resources/icon.ico')
import { getDb, closeDb } from './db/database'
import { registerAllIpc } from './ipc/index'
import { ensureModelboxDirs } from './services/runtimeManager'
import { stopAllProcesses, clearAllLogs } from './services/processManager'
import { initMCPServers, shutdownMCP } from './services/mcpManager'
import { listMCPServers } from './db/repos/mcp.repo'
import { clearAllInstances } from './db/repos/serverInstances.repo'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    icon: ICON_PATH,
    // Helps with initial white flash and matches theme
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#09090b' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.modelbox.app')

  // Disable the default menu bar (Alt key behavior)
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, win) => {
    optimizer.watchWindowShortcuts(win)
  })

  // Init DB (applies schema + seeds defaults)
  getDb()
  ensureModelboxDirs()

  // Clear server instances and logs on startup so the list is fresh
  clearAllInstances()
  clearAllLogs()

  // Register all IPC handlers
  registerAllIpc()

  // Connect to any enabled MCP servers
  void initMCPServers(listMCPServers())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

let isQuitting = false
app.on('before-quit', (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true
  Promise.allSettled([stopAllProcesses(), shutdownMCP()])
    .finally(() => {
      closeDb()
      app.exit(0)
    })
})
