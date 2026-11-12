import { getDb } from '../database'
import type { Message } from '@shared/types'

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  token_count: number | null
  tokens_per_second: number | null
  think_duration_ms: number | null
  context_tokens: number | null
  context_size: number | null
  prompt_processing_ms: number | null
  created_at: string
}

function rowToMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as Message['role'],
    content: r.content,
    tokenCount: r.token_count ?? undefined,
    tokensPerSecond: r.tokens_per_second ?? undefined,
    thinkDurationMs: r.think_duration_ms ?? undefined,
    contextTokens: r.context_tokens ?? undefined,
    contextSize: r.context_size ?? undefined,
    promptProcessingMs: r.prompt_processing_ms ?? undefined,
    createdAt: r.created_at
  }
}

export function listMessages(conversationId: string): Message[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at'
    )
    .all(conversationId) as MessageRow[]
  return rows.map(rowToMessage)
}

export function createMessage(msg: {
  id: string
  conversationId: string
  role: Message['role']
  content: string
  tokenCount?: number
  tokensPerSecond?: number
  thinkDurationMs?: number
  contextTokens?: number
  contextSize?: number
  promptProcessingMs?: number
}): Message {
  const db = getDb()
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, token_count, tokens_per_second, think_duration_ms, context_tokens, context_size, prompt_processing_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    msg.conversationId,
    msg.role,
    msg.content,
    msg.tokenCount ?? null,
    msg.tokensPerSecond ?? null,
    msg.thinkDurationMs ?? null,
    msg.contextTokens ?? null,
    msg.contextSize ?? null,
    msg.promptProcessingMs ?? null
  )
  // bump conversation updated_at
  db.prepare(`
    UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
  `).run(msg.conversationId)
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(msg.id) as MessageRow
  return rowToMessage(row)
}

export function deleteMessage(id: string): void {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id)
}

export function deleteMessagesFrom(conversationId: string, fromMessageId: string): void {
  // Use rowid for ordering — created_at has 1-second precision and can have ties
  getDb()
    .prepare(
      `DELETE FROM messages
       WHERE conversation_id = ?
         AND rowid >= (SELECT rowid FROM messages WHERE id = ?)`
    )
    .run(conversationId, fromMessageId)
}

export function updateMessage(
  id: string,
  patch: { content?: string; tokenCount?: number; tokensPerSecond?: number }
): Message {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(id) as MessageRow | undefined
  if (!row) throw new Error(`Message ${id} not found`)
  db.prepare(`
    UPDATE messages SET
      content = ?,
      token_count = ?,
      tokens_per_second = ?
    WHERE id = ?
  `).run(
    patch.content ?? row.content,
    patch.tokenCount ?? row.token_count,
    patch.tokensPerSecond ?? row.tokens_per_second,
    id
  )
  return rowToMessage(
    db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow
  )
}
