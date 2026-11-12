import { getDb } from '../database'
import { v4 as uuidv4 } from 'uuid'
import type { MCPServerConfig } from '@shared/types'

interface MCPServerRow {
  id: string
  name: string
  transport: string
  command: string | null
  args: string | null
  url: string | null
  token: string | null
  env: string | null
  enabled: number
  created_at: string
}

function rowToConfig(row: MCPServerRow): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as MCPServerConfig['transport'],
    command: row.command ?? undefined,
    args: row.args ?? undefined,
    url: row.url ?? undefined,
    token: row.token ?? undefined,
    env: row.env ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  }
}

export function listMCPServers(): MCPServerConfig[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all() as MCPServerRow[]
  return rows.map(rowToConfig)
}

export function getMCPServer(id: string): MCPServerConfig | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as MCPServerRow | undefined
  return row ? rowToConfig(row) : null
}

export function createMCPServer(
  data: Omit<MCPServerConfig, 'id' | 'createdAt'>
): MCPServerConfig {
  const db = getDb()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args, url, token, env, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.transport,
    data.command ?? null,
    data.args ?? null,
    data.url ?? null,
    data.token ?? null,
    data.env ?? null,
    data.enabled ? 1 : 0
  )
  return getMCPServer(id)!
}

export function updateMCPServer(
  id: string,
  patch: Partial<Omit<MCPServerConfig, 'id' | 'createdAt'>>
): MCPServerConfig {
  const db = getDb()
  const existing = getMCPServer(id)
  if (!existing) throw new Error(`MCP server ${id} not found`)
  const merged = { ...existing, ...patch }
  db.prepare(
    `UPDATE mcp_servers SET name=?, transport=?, command=?, args=?, url=?, token=?, env=?, enabled=? WHERE id=?`
  ).run(
    merged.name,
    merged.transport,
    merged.command ?? null,
    merged.args ?? null,
    merged.url ?? null,
    merged.token ?? null,
    merged.env ?? null,
    merged.enabled ? 1 : 0,
    id
  )
  return getMCPServer(id)!
}

export function deleteMCPServer(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}
