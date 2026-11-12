import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { MCPServerConfig, MCPTool, MCPServerStatus, ToolCallRequest } from '@shared/types'

// ── Always-allow list ─────────────────────────────────────────────────────────
// Keyed by "serverName:toolName". Stored in localStorage for simplicity.
// (Could be persisted via settings IPC — localStorage suffices for a desktop app.)

const ALWAYS_ALLOW_KEY = 'mcp:always-allow'
const TOOL_ENABLED_KEY = 'mcp:tool-enabled'
const GLOBAL_MCP_ENABLED_KEY = 'mcp:global-enabled'

function loadMcpGloballyEnabled(): boolean {
  try {
    const raw = localStorage.getItem(GLOBAL_MCP_ENABLED_KEY)
    if (raw === null) return true
    return raw === 'true'
  } catch {
    return true
  }
}

function saveMcpGloballyEnabled(enabled: boolean): void {
  localStorage.setItem(GLOBAL_MCP_ENABLED_KEY, enabled ? 'true' : 'false')
}

function loadAlwaysAllow(): Set<string> {
  try {
    const raw = localStorage.getItem(ALWAYS_ALLOW_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveAlwaysAllow(set: Set<string>): void {
  localStorage.setItem(ALWAYS_ALLOW_KEY, JSON.stringify([...set]))
}

function loadToolEnabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(TOOL_ENABLED_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function saveToolEnabled(map: Record<string, boolean>): void {
  localStorage.setItem(TOOL_ENABLED_KEY, JSON.stringify(map))
}

function toolKey(serverName: string, toolName: string): string {
  return `${serverName}:${toolName}`
}

/** Rewrite localStorage prefs when an MCP server display name changes. */
function migratePrefsOnServerRename(
  alwaysAllow: Set<string>,
  toolEnabled: Record<string, boolean>,
  oldName: string,
  newName: string,
): { alwaysAllow: Set<string>; toolEnabled: Record<string, boolean> } {
  if (oldName === newName) {
    return { alwaysAllow, toolEnabled }
  }
  const prefix = `${oldName}:`
  const nextAlways = new Set<string>()
  for (const k of alwaysAllow) {
    if (k.startsWith(prefix)) {
      nextAlways.add(toolKey(newName, k.slice(prefix.length)))
    } else {
      nextAlways.add(k)
    }
  }
  const nextTe: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(toolEnabled)) {
    if (k.startsWith(prefix)) {
      nextTe[toolKey(newName, k.slice(prefix.length))] = v
    } else {
      nextTe[k] = v
    }
  }
  saveAlwaysAllow(nextAlways)
  saveToolEnabled(nextTe)
  return { alwaysAllow: nextAlways, toolEnabled: nextTe }
}

function removePrefsForServer(
  alwaysAllow: Set<string>,
  toolEnabled: Record<string, boolean>,
  serverName: string,
): { alwaysAllow: Set<string>; toolEnabled: Record<string, boolean> } {
  const prefix = `${serverName}:`
  const nextAlways = new Set([...alwaysAllow].filter((k) => !k.startsWith(prefix)))
  const nextTe: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(toolEnabled)) {
    if (!k.startsWith(prefix)) nextTe[k] = v
  }
  saveAlwaysAllow(nextAlways)
  saveToolEnabled(nextTe)
  return { alwaysAllow: nextAlways, toolEnabled: nextTe }
}

// ── Pending approval ──────────────────────────────────────────────────────────

type ApprovalResolveFn = (result: { content: string; isError: boolean } | null) => void

interface PendingApproval {
  request: ToolCallRequest
  resolve: ApprovalResolveFn
}

// Module-level map so the store can hand the resolve function to the UI
const pendingApprovals = new Map<string, PendingApproval>()

// ── Store ─────────────────────────────────────────────────────────────────────

interface MCPStore {
  servers: MCPServerConfig[]
  status: MCPServerStatus[]
  tools: MCPTool[]
  /** Master switch: when false, no tools are offered to the model; per-tool prefs are preserved. */
  mcpGloballyEnabled: boolean
  /** toolKey → enabled (global). Defaults to true for unknown tools. */
  toolEnabled: Record<string, boolean>
  alwaysAllow: Set<string>

  /** Current tool call waiting for user approval (one at a time). */
  pendingCall: ToolCallRequest | null

  // ── Actions ─────────────────────────────────────────────────────────────────

  loadServers: () => Promise<void>
  loadTools: () => Promise<void>
  refreshStatus: () => Promise<void>
  createServer: (data: Omit<MCPServerConfig, 'id' | 'createdAt'>) => Promise<MCPServerConfig>
  updateServer: (id: string, patch: Partial<Omit<MCPServerConfig, 'id' | 'createdAt'>>) => Promise<MCPServerConfig>
  deleteServer: (id: string) => Promise<void>
  reconnectAll: () => Promise<void>

  setMcpGloballyEnabled: (enabled: boolean) => void
  setToolEnabled: (serverName: string, toolName: string, enabled: boolean) => void
  setServerToolsEnabled: (serverName: string, enabled: boolean) => void
  /** Persist whether this tool skips the approval prompt (stored in localStorage). */
  setAlwaysAllowForTool: (serverName: string, toolName: string, always: boolean) => void

  /** Called by transport — shows approval card and waits for user action. */
  requestApproval: (req: ToolCallRequest) => Promise<{ content: string; isError: boolean } | null>
  /** User clicks Allow once */
  approvePending: (result: { content: string; isError: boolean }) => void
  /** User clicks Always Allow */
  alwaysApprovePending: (result: { content: string; isError: boolean }) => void
  /** User clicks Deny */
  denyPending: () => void

  /** Called when main pushes an auto-reconnect status update. */
  applyStatusUpdate: (status: MCPServerStatus[]) => void

  isToolEnabled: (serverName: string, toolName: string) => boolean
  isAlwaysAllowed: (serverName: string, toolName: string) => boolean
  getEnabledTools: () => MCPTool[]
}

export const useMCPStore = create<MCPStore>((set, get) => ({
  servers: [],
  status: [],
  tools: [],
  mcpGloballyEnabled: loadMcpGloballyEnabled(),
  toolEnabled: loadToolEnabled(),
  alwaysAllow: loadAlwaysAllow(),
  pendingCall: null,

  loadServers: async () => {
    const servers = await api.mcp.listServers()
    set({ servers })
  },

  loadTools: async () => {
    const [tools, status] = await Promise.all([
      api.mcp.listTools(),
      api.mcp.getStatus(),
    ])
    set({ tools, status })
  },

  refreshStatus: async () => {
    const status = await api.mcp.getStatus()
    set({ status })
    // Also refresh tool list — new connections may have discovered new tools
    const tools = await api.mcp.listTools()
    set({ tools })
  },

  createServer: async (data) => {
    const server = await api.mcp.createServer(data)
    set((s) => ({ servers: [...s.servers, server] }))
    // Refresh status after a short delay for connection to establish
    setTimeout(() => { void get().refreshStatus() }, 1500)
    return server
  },

  updateServer: async (id, patch) => {
    const prev = get().servers.find((s) => s.id === id)
    const server = await api.mcp.updateServer(id, patch)
    set((s) => {
      let nextAlways = s.alwaysAllow
      let nextTe = s.toolEnabled
      if (prev && server.name !== prev.name) {
        const migrated = migratePrefsOnServerRename(
          s.alwaysAllow,
          s.toolEnabled,
          prev.name,
          server.name,
        )
        nextAlways = migrated.alwaysAllow
        nextTe = migrated.toolEnabled
      }
      return {
        servers: s.servers.map((sv) => (sv.id === id ? server : sv)),
        alwaysAllow: nextAlways,
        toolEnabled: nextTe,
      }
    })
    setTimeout(() => { void get().refreshStatus() }, 1500)
    return server
  },

  deleteServer: async (id) => {
    const removed = get().servers.find((s) => s.id === id)
    await api.mcp.deleteServer(id)
    set((s) => {
      const { alwaysAllow, toolEnabled } = removed
        ? removePrefsForServer(s.alwaysAllow, s.toolEnabled, removed.name)
        : { alwaysAllow: s.alwaysAllow, toolEnabled: s.toolEnabled }
      return {
        servers: s.servers.filter((sv) => sv.id !== id),
        status: s.status.filter((st) => st.serverName !== removed?.name),
        alwaysAllow,
        toolEnabled,
      }
    })
    void get().loadTools()
  },

  reconnectAll: async () => {
    const status = await api.mcp.reconnectAll()
    set({ status })
    const tools = await api.mcp.listTools()
    set({ tools })
  },

  setMcpGloballyEnabled: (enabled) => {
    saveMcpGloballyEnabled(enabled)
    set({ mcpGloballyEnabled: enabled })
  },

  setToolEnabled: (serverName, toolName, enabled) => {
    const key = `${serverName}:${toolName}`
    set((s) => {
      const next = { ...s.toolEnabled, [key]: enabled }
      saveToolEnabled(next)
      return { toolEnabled: next }
    })
  },

  setServerToolsEnabled: (serverName, enabled) => {
    const { tools, toolEnabled } = get()
    const serverTools = tools.filter((t) => t.serverName === serverName)
    const next = { ...toolEnabled }
    for (const t of serverTools) {
      next[toolKey(serverName, t.name)] = enabled
    }
    saveToolEnabled(next)
    set({ toolEnabled: next })
  },

  setAlwaysAllowForTool: (serverName, toolName, always) => {
    set((s) => {
      const next = new Set(s.alwaysAllow)
      const key = toolKey(serverName, toolName)
      if (always) {
        next.add(key)
      } else {
        next.delete(key)
      }
      saveAlwaysAllow(next)
      return { alwaysAllow: next }
    })
  },

  applyStatusUpdate: (status) => {
    set({ status })
    // Re-fetch tool list so newly-connected servers expose their tools
    void api.mcp.listTools().then((tools) => set({ tools }))
  },

  isToolEnabled: (serverName, toolName) => {
    const key = toolKey(serverName, toolName)
    const { toolEnabled } = get()
    // Default to true if no explicit setting
    return key in toolEnabled ? toolEnabled[key] : true
  },

  isAlwaysAllowed: (serverName, toolName) => {
    return get().alwaysAllow.has(toolKey(serverName, toolName))
  },

  getEnabledTools: () => {
    const { tools, mcpGloballyEnabled } = get()
    if (!mcpGloballyEnabled) return []
    return tools.filter((t) => get().isToolEnabled(t.serverName, t.name))
  },

  requestApproval: (req) => {
    return new Promise<{ content: string; isError: boolean } | null>((resolve) => {
      pendingApprovals.set(req.id, { request: req, resolve })
      set({ pendingCall: req })
    })
  },

  approvePending: (result) => {
    const { pendingCall } = get()
    if (!pendingCall) return
    const approval = pendingApprovals.get(pendingCall.id)
    if (approval) {
      approval.resolve(result)
      pendingApprovals.delete(pendingCall.id)
    }
    set({ pendingCall: null })
  },

  alwaysApprovePending: (result) => {
    const { pendingCall, alwaysAllow } = get()
    if (!pendingCall) return
    const newSet = new Set(alwaysAllow)
    newSet.add(toolKey(pendingCall.serverName, pendingCall.name))
    saveAlwaysAllow(newSet)
    const approval = pendingApprovals.get(pendingCall.id)
    if (approval) {
      approval.resolve(result)
      pendingApprovals.delete(pendingCall.id)
    }
    set({ pendingCall: null, alwaysAllow: newSet })
  },

  denyPending: () => {
    const { pendingCall } = get()
    if (!pendingCall) return
    const approval = pendingApprovals.get(pendingCall.id)
    if (approval) {
      // Must resolve with `null` so chatStore's onToolCall skips callTool and returns the
      // denial message. A truthy object was treated as approval and executed the tool.
      approval.resolve(null)
      pendingApprovals.delete(pendingCall.id)
    }
    set({ pendingCall: null })
  },
}))
