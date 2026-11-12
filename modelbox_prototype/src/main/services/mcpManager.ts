/**
 * mcpManager — manages MCP client connections for all configured servers.
 *
 * Lifecycle:
 *  - init(configs) on app start / after any settings change
 *  - Connects to all enabled servers, discovers tools
 *  - callTool(serverName, toolName, args) → result string
 *  - getTools() → flat list of MCPTool from all connected servers
 *  - getStatus() → per-server connection status
 *  - shutdown() on app quit
 */

import { BrowserWindow } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { MCPServerConfig, MCPTool, MCPServerStatus } from '@shared/types'
import { listMCPServers } from '../db/repos/mcp.repo'

interface ServerEntry {
  config: MCPServerConfig
  client: Client
  tools: MCPTool[]
  connected: boolean
  error?: string
}

const servers = new Map<string, ServerEntry>()

let retryTimer: ReturnType<typeof setInterval> | null = null
let healthTimer: ReturnType<typeof setInterval> | null = null

function pushStatusUpdate(): void {
  const status = getMCPStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mcp:status-update', status)
  }
}

function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setInterval(async () => {
    const failed = [...servers.values()].filter((e) => !e.connected)
    if (failed.length === 0) {
      clearInterval(retryTimer!)
      retryTimer = null
      return
    }
    let anyReconnected = false
    for (const entry of failed) {
      await disconnectServer(entry)
      servers.delete(entry.config.name)
      await connectServer(entry.config)
      if (servers.get(entry.config.name)?.connected) anyReconnected = true
    }
    if (anyReconnected) pushStatusUpdate()
  }, 15_000)
}

/** Ping all connected servers every 5 s; mark gone ones as disconnected immediately.
 *  SSE/HTTP transports don't fire onclose when the remote drops, so we need this. */
function scheduleHealthCheck(): void {
  if (healthTimer) return
  healthTimer = setInterval(async () => {
    const connected = [...servers.values()].filter((e) => e.connected)
    if (connected.length === 0) {
      clearInterval(healthTimer!)
      healthTimer = null
      return
    }
    let anyLost = false
    for (const entry of connected) {
      try {
        await entry.client.ping({ signal: AbortSignal.timeout(3000) })
      } catch {
        entry.connected = false
        entry.error = 'Connection lost'
        anyLost = true
      }
    }
    if (anyLost) {
      pushStatusUpdate()
      scheduleRetry()
    }
  }, 5_000)
}

export async function initMCPServers(configs: MCPServerConfig[]): Promise<void> {
  // Shutdown any existing connections not in the new config
  const newNames = new Set(configs.map((c) => c.name))
  for (const [name, entry] of servers) {
    if (!newNames.has(name)) {
      await disconnectServer(entry)
      servers.delete(name)
    }
  }

  for (const config of configs) {
    if (!config.enabled) {
      // Disconnect if previously connected
      const existing = servers.get(config.name)
      if (existing) {
        await disconnectServer(existing)
        servers.delete(config.name)
      }
      continue
    }

    // Re-connect if config changed or if a previous connect attempt failed
    const existing = servers.get(config.name)
    const configChanged = existing && JSON.stringify(existing.config) !== JSON.stringify(config)
    if (existing && !configChanged && existing.connected) continue // already connected, unchanged

    if (existing) {
      await disconnectServer(existing)
      servers.delete(config.name)
    }

    await connectServer(config)
  }

  // Start background retry for any servers that failed to connect
  const hasFailed = [...servers.values()].some((e) => !e.connected)
  if (hasFailed) scheduleRetry()
}

async function connectServer(config: MCPServerConfig): Promise<void> {
  const client = new Client({ name: 'modelbox', version: '1.0.0' })

  const entry: ServerEntry = {
    config,
    client,
    tools: [],
    connected: false,
  }
  servers.set(config.name, entry)

  try {
    const transport = buildTransport(config)
    await client.connect(transport)

    const { tools: discovered } = await client.listTools()
    entry.tools = (discovered ?? []).map((t) => ({
      serverName: config.name,
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }))
    entry.connected = true
    entry.error = undefined

    // For transports that fire onclose on remote drop (e.g. stdio process exit)
    client.onclose = () => {
      if (entry.connected) {
        entry.connected = false
        entry.error = 'Connection closed'
        pushStatusUpdate()
        scheduleRetry()
      }
    }

    // For SSE/HTTP transports that don't fire onclose on remote drop
    scheduleHealthCheck()
  } catch (err) {
    entry.connected = false
    entry.error = (err as Error).message
  }
}

async function disconnectServer(entry: ServerEntry): Promise<void> {
  try {
    await entry.client.close()
  } catch {
    // ignore
  }
}

function buildTransport(config: MCPServerConfig) {
  if (config.transport === 'stdio') {
    if (!config.command) throw new Error(`MCP server "${config.name}" requires a command`)
    let parsedArgs: string[] = []
    if (config.args) {
      const raw: unknown = JSON.parse(config.args)
      if (!Array.isArray(raw) || raw.some((a) => typeof a !== 'string')) {
        throw new Error(`MCP server "${config.name}": args must be a JSON array of strings`)
      }
      parsedArgs = raw as string[]
    }
    const parsedEnv: Record<string, string> = config.env
      ? (JSON.parse(config.env) as Record<string, string>)
      : {}
    return new StdioClientTransport({
      command: config.command,
      args: parsedArgs,
      env: { ...process.env, ...parsedEnv } as Record<string, string>,
    })
  }

  if (config.transport === 'sse') {
    if (!config.url) throw new Error(`MCP server "${config.name}" requires a URL`)
    const headers: Record<string, string> = {}
    if (config.token) {
      if (/[\r\n]/.test(config.token)) throw new Error(`MCP server "${config.name}": token contains invalid characters`)
      headers['Authorization'] = `Bearer ${config.token}`
    }
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers },
      eventSourceInit: { fetch: (url, init) => fetch(url as string, { ...init, headers: { ...(init as RequestInit)?.headers, ...headers } }) },
    })
  }

  if (config.transport === 'http') {
    if (!config.url) throw new Error(`MCP server "${config.name}" requires a URL`)
    const headers: Record<string, string> = {}
    if (config.token) {
      if (/[\r\n]/.test(config.token)) throw new Error(`MCP server "${config.name}": token contains invalid characters`)
      headers['Authorization'] = `Bearer ${config.token}`
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
    })
  }

  throw new Error(`Unknown MCP transport: ${config.transport as string}`)
}

export function getMCPTools(): MCPTool[] {
  const all: MCPTool[] = []
  for (const entry of servers.values()) {
    if (entry.connected) all.push(...entry.tools)
  }
  return all
}

export function getMCPStatus(): MCPServerStatus[] {
  return [...servers.values()].map((e) => ({
    serverName: e.config.name,
    connected: e.connected,
    error: e.error,
    tools: e.tools,
  }))
}

/** True when a fresh init may fix the failure (stale SSE after gateway restart, half-open session, etc.). */
function shouldReconnectAfterToolFailure(message: string): boolean {
  const m = message.toLowerCase()
  if (m.includes('invalid during session initialization')) return true
  if (m.includes('is not connected')) return true
  if (m.includes('econnrefused')) return true
  if (m.includes('econnreset')) return true
  if (m.includes('etimedout')) return true
  if (m.includes('socket hang up')) return true
  if (m.includes('fetch failed')) return true
  if (m.includes('networkerror')) return true
  return false
}

export async function callMCPTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
  const runOnce = async (): Promise<{ content: string; isError: boolean }> => {
    const entry = servers.get(serverName)
    if (!entry || !entry.connected) {
      return { content: `MCP server "${serverName}" is not connected`, isError: true }
    }

    try {
      const result = await entry.client.callTool({ name: toolName, arguments: args })
      // MCP tool results can be an array of content blocks
      const contentArr = result.content as Array<{ type: string; text?: string }> | undefined
      const text = (contentArr ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n')
      const isError = result.isError === true
      return { content: text || JSON.stringify(result.content), isError }
    } catch (err) {
      return { content: (err as Error).message, isError: true }
    }
  }

  let out = await runOnce()
  if (out.isError && shouldReconnectAfterToolFailure(out.content)) {
    await initMCPServers(listMCPServers())
    out = await runOnce()
  }
  return out
}

export async function shutdownMCP(): Promise<void> {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null }
  for (const entry of servers.values()) {
    await disconnectServer(entry)
  }
  servers.clear()
}

/** Reconnect a single server (e.g. after editing its config). */
export async function reconnectServer(config: MCPServerConfig): Promise<void> {
  const existing = servers.get(config.name)
  if (existing) {
    await disconnectServer(existing)
    servers.delete(config.name)
  }
  if (config.enabled) {
    await connectServer(config)
  }
}
