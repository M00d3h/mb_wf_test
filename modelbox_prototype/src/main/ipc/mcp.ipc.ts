import { ipcMain } from 'electron'
import {
  listMCPServers,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
} from '../db/repos/mcp.repo'
import {
  getMCPTools,
  getMCPStatus,
  callMCPTool,
  initMCPServers,
  reconnectServer,
} from '../services/mcpManager'
import type { MCPServerConfig } from '@shared/types'

export function registerMCPIpc(): void {
  // ── Server CRUD ───────────────────────────────────────────────────────────

  ipcMain.handle('mcp:servers:list', () => listMCPServers())

  ipcMain.handle(
    'mcp:servers:create',
    (_e, data: Omit<MCPServerConfig, 'id' | 'createdAt'>) => {
      const server = createMCPServer(data)
      // Reconnect to pick up the new server
      void reconnectServer(server)
      return server
    }
  )

  ipcMain.handle(
    'mcp:servers:update',
    (_e, id: string, patch: Partial<Omit<MCPServerConfig, 'id' | 'createdAt'>>) => {
      const server = updateMCPServer(id, patch)
      void reconnectServer(server)
      return server
    }
  )

  ipcMain.handle('mcp:servers:delete', (_e, id: string) => {
    const servers = listMCPServers()
    const target = servers.find((s) => s.id === id)
    if (target) {
      // Disconnect before deleting
      void reconnectServer({ ...target, enabled: false })
    }
    deleteMCPServer(id)
  })

  // ── Tool listing ──────────────────────────────────────────────────────────

  ipcMain.handle('mcp:tools:list', () => getMCPTools())

  // ── Status ────────────────────────────────────────────────────────────────

  ipcMain.handle('mcp:status', () => getMCPStatus())

  // ── Tool execution ────────────────────────────────────────────────────────

  ipcMain.handle(
    'mcp:tools:call',
    (
      _e,
      serverName: string,
      toolName: string,
      args: Record<string, unknown>
    ) => callMCPTool(serverName, toolName, args)
  )

  // ── Reconnect all (e.g. after bulk enable/disable) ────────────────────────

  ipcMain.handle('mcp:reconnect-all', async () => {
    await initMCPServers(listMCPServers())
    return getMCPStatus()
  })
}
