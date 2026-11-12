// @vitest-environment happy-dom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { MCPTool, ToolCallRequest } from '@shared/types'

// Mock IPC before any store imports so module-level `api = window.api` doesn't throw
vi.mock('@renderer/lib/ipc', () => ({
  api: {
    mcp: {
      listServers: vi.fn().mockResolvedValue([]),
      listTools: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue([]),
      createServer: vi.fn(),
      updateServer: vi.fn(),
      deleteServer: vi.fn(),
      reconnectAll: vi.fn().mockResolvedValue([]),
    },
    settings: { setTheme: vi.fn() },
  },
}))

const { useMCPStore } = await import('@renderer/store/mcpStore')

function resetStore(): void {
  localStorage.clear()
  useMCPStore.setState({
    servers: [],
    status: [],
    tools: [],
    mcpGloballyEnabled: true,
    toolEnabled: {},
    alwaysAllow: new Set(),
    pendingCall: null,
  })
}

// ─── isToolEnabled ────────────────────────────────────────────────────────────

describe('isToolEnabled', () => {
  beforeEach(resetStore)

  it('returns true by default for unknown tool', () => {
    const { isToolEnabled } = useMCPStore.getState()
    expect(isToolEnabled('server', 'read_file')).toBe(true)
  })

  it('returns false after tool is disabled', () => {
    const { setToolEnabled, isToolEnabled } = useMCPStore.getState()
    setToolEnabled('server', 'read_file', false)
    expect(isToolEnabled('server', 'read_file')).toBe(false)
  })

  it('returns true after tool is re-enabled', () => {
    const { setToolEnabled, isToolEnabled } = useMCPStore.getState()
    setToolEnabled('server', 'read_file', false)
    setToolEnabled('server', 'read_file', true)
    expect(isToolEnabled('server', 'read_file')).toBe(true)
  })

  it('persists tool-enabled state to localStorage', () => {
    useMCPStore.getState().setToolEnabled('server', 'write_file', false)
    const stored = JSON.parse(localStorage.getItem('mcp:tool-enabled')!)
    expect(stored['server:write_file']).toBe(false)
  })

  it('tool key includes server prefix (server1 !== server2)', () => {
    const { setToolEnabled, isToolEnabled } = useMCPStore.getState()
    setToolEnabled('server1', 'read_file', false)
    expect(isToolEnabled('server2', 'read_file')).toBe(true)
  })
})

// ─── setMcpGloballyEnabled ────────────────────────────────────────────────────

describe('setMcpGloballyEnabled', () => {
  beforeEach(resetStore)

  it('disables MCP globally', () => {
    useMCPStore.getState().setMcpGloballyEnabled(false)
    expect(useMCPStore.getState().mcpGloballyEnabled).toBe(false)
  })

  it('persists to localStorage', () => {
    useMCPStore.getState().setMcpGloballyEnabled(false)
    expect(localStorage.getItem('mcp:global-enabled')).toBe('false')
  })

  it('re-enables after disabling', () => {
    useMCPStore.getState().setMcpGloballyEnabled(false)
    useMCPStore.getState().setMcpGloballyEnabled(true)
    expect(useMCPStore.getState().mcpGloballyEnabled).toBe(true)
  })
})

// ─── getEnabledTools ─────────────────────────────────────────────────────────

const MOCK_TOOLS: MCPTool[] = [
  { name: 'read_file', description: 'Read a file', inputSchema: {}, serverName: 'filesystem' },
  { name: 'write_file', description: 'Write a file', inputSchema: {}, serverName: 'filesystem' },
  { name: 'search', description: 'Search', inputSchema: {}, serverName: 'browser' },
]

describe('getEnabledTools', () => {
  beforeEach(() => {
    resetStore()
    useMCPStore.setState({ tools: MOCK_TOOLS })
  })

  it('returns all tools when everything is enabled', () => {
    const tools = useMCPStore.getState().getEnabledTools()
    expect(tools).toHaveLength(3)
  })

  it('returns empty array when MCP is globally disabled', () => {
    useMCPStore.getState().setMcpGloballyEnabled(false)
    expect(useMCPStore.getState().getEnabledTools()).toHaveLength(0)
  })

  it('excludes individually disabled tools', () => {
    useMCPStore.getState().setToolEnabled('filesystem', 'write_file', false)
    const tools = useMCPStore.getState().getEnabledTools()
    expect(tools).toHaveLength(2)
    expect(tools.every((t) => t.name !== 'write_file')).toBe(true)
  })

  it('returns no tools when all disabled', () => {
    useMCPStore.getState().setMcpGloballyEnabled(false)
    const tools = useMCPStore.getState().getEnabledTools()
    expect(tools).toHaveLength(0)
  })
})

// ─── setServerToolsEnabled ────────────────────────────────────────────────────

describe('setServerToolsEnabled', () => {
  beforeEach(() => {
    resetStore()
    useMCPStore.setState({ tools: MOCK_TOOLS })
  })

  it('disables all tools for a server', () => {
    useMCPStore.getState().setServerToolsEnabled('filesystem', false)
    const { isToolEnabled } = useMCPStore.getState()
    expect(isToolEnabled('filesystem', 'read_file')).toBe(false)
    expect(isToolEnabled('filesystem', 'write_file')).toBe(false)
    // Other server unaffected
    expect(isToolEnabled('browser', 'search')).toBe(true)
  })

  it('enables all tools for a server', () => {
    useMCPStore.getState().setToolEnabled('filesystem', 'read_file', false)
    useMCPStore.getState().setToolEnabled('filesystem', 'write_file', false)
    useMCPStore.getState().setServerToolsEnabled('filesystem', true)
    const { isToolEnabled } = useMCPStore.getState()
    expect(isToolEnabled('filesystem', 'read_file')).toBe(true)
    expect(isToolEnabled('filesystem', 'write_file')).toBe(true)
  })
})

// ─── isAlwaysAllowed / setAlwaysAllowForTool ──────────────────────────────────

describe('alwaysAllow', () => {
  beforeEach(resetStore)

  it('returns false by default', () => {
    expect(useMCPStore.getState().isAlwaysAllowed('server', 'tool')).toBe(false)
  })

  it('returns true after setAlwaysAllowForTool(true)', () => {
    useMCPStore.getState().setAlwaysAllowForTool('server', 'tool', true)
    expect(useMCPStore.getState().isAlwaysAllowed('server', 'tool')).toBe(true)
  })

  it('returns false after removing always-allow', () => {
    useMCPStore.getState().setAlwaysAllowForTool('server', 'tool', true)
    useMCPStore.getState().setAlwaysAllowForTool('server', 'tool', false)
    expect(useMCPStore.getState().isAlwaysAllowed('server', 'tool')).toBe(false)
  })

  it('persists always-allow to localStorage', () => {
    useMCPStore.getState().setAlwaysAllowForTool('server', 'tool', true)
    const stored = JSON.parse(localStorage.getItem('mcp:always-allow')!)
    expect(stored).toContain('server:tool')
  })
})

// ─── requestApproval / approvePending / denyPending ──────────────────────────

const MOCK_REQUEST: ToolCallRequest = {
  id: 'call-1',
  name: 'read_file',
  serverName: 'filesystem',
  args: { path: '/tmp/test.txt' },
}

describe('approval flow', () => {
  beforeEach(resetStore)

  it('requestApproval sets pendingCall', async () => {
    void useMCPStore.getState().requestApproval(MOCK_REQUEST)
    expect(useMCPStore.getState().pendingCall?.id).toBe('call-1')
  })

  it('approvePending resolves the promise with the result', async () => {
    const result = { content: 'file contents', isError: false }
    const promise = useMCPStore.getState().requestApproval(MOCK_REQUEST)
    useMCPStore.getState().approvePending(result)
    expect(await promise).toEqual(result)
    expect(useMCPStore.getState().pendingCall).toBeNull()
  })

  it('denyPending resolves with null', async () => {
    const promise = useMCPStore.getState().requestApproval(MOCK_REQUEST)
    useMCPStore.getState().denyPending()
    expect(await promise).toBeNull()
    expect(useMCPStore.getState().pendingCall).toBeNull()
  })

  it('alwaysApprovePending resolves with result and adds to alwaysAllow', async () => {
    const result = { content: 'ok', isError: false }
    const promise = useMCPStore.getState().requestApproval(MOCK_REQUEST)
    useMCPStore.getState().alwaysApprovePending(result)
    expect(await promise).toEqual(result)
    expect(useMCPStore.getState().pendingCall).toBeNull()
    expect(useMCPStore.getState().isAlwaysAllowed('filesystem', 'read_file')).toBe(true)
  })

  it('approvePending does nothing when no pending call', () => {
    expect(() => {
      useMCPStore.getState().approvePending({ content: 'x', isError: false })
    }).not.toThrow()
  })

  it('denyPending does nothing when no pending call', () => {
    expect(() => useMCPStore.getState().denyPending()).not.toThrow()
  })
})

// ─── applyStatusUpdate ────────────────────────────────────────────────────────

describe('applyStatusUpdate', () => {
  beforeEach(resetStore)

  it('updates the status array', () => {
    const status = [{ serverName: 'filesystem', connected: true, error: null }]
    useMCPStore.getState().applyStatusUpdate(status)
    expect(useMCPStore.getState().status).toEqual(status)
  })
})
