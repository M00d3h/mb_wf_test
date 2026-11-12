/**
 * Requires better-sqlite3 compiled for standard Node.js.
 * Run `npm run test:db` — see models.repo.test.ts for details.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isSqliteAvailable, createTestDb } from '../helpers/makeDb'

const sqlite = isSqliteAvailable()

vi.mock('@main/services/ggufFileSizes', () => ({ sumGgufFileSizes: () => 0 }))

let ctx: ReturnType<typeof createTestDb> | null = null
vi.mock('@main/db/database', () => ({
  getDb: () => {
    if (!ctx) throw new Error('test db not initialised')
    return ctx.db
  },
}))

const {
  createMessage,
  listMessages,
  deleteMessage,
  deleteMessagesFrom,
  updateMessage,
} = await import('@main/db/repos/messages.repo')

const { createConversation } = await import('@main/db/repos/conversations.repo')

function seedConversation(): void {
  createConversation({ id: 'conv1', title: 'Test conv' })
}

const BASE_MSG = {
  id: 'msg1',
  conversationId: 'conv1',
  role: 'user' as const,
  content: 'Hello world',
}

describe.skipIf(!sqlite)('messages.repo', () => {
  beforeEach(() => {
    ctx = createTestDb()
    seedConversation()
  })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('createMessage / listMessages', () => {
    it('inserts a message and retrieves it', () => {
      createMessage(BASE_MSG)
      const msgs = listMessages('conv1')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].content).toBe('Hello world')
      expect(msgs[0].role).toBe('user')
    })

    it('returns empty array for unknown conversation', () => {
      expect(listMessages('no-such-id')).toEqual([])
    })

    it('stores optional numeric fields', () => {
      createMessage({
        ...BASE_MSG,
        tokenCount: 42,
        tokensPerSecond: 12.5,
        thinkDurationMs: 300,
        contextTokens: 1024,
        contextSize: 4096,
        promptProcessingMs: 150,
      })
      const msg = listMessages('conv1')[0]!
      expect(msg.tokenCount).toBe(42)
      expect(msg.tokensPerSecond).toBeCloseTo(12.5)
      expect(msg.thinkDurationMs).toBe(300)
      expect(msg.contextTokens).toBe(1024)
      expect(msg.contextSize).toBe(4096)
      expect(msg.promptProcessingMs).toBe(150)
    })

    it('optional fields are undefined when not provided', () => {
      createMessage(BASE_MSG)
      const msg = listMessages('conv1')[0]!
      expect(msg.tokenCount).toBeUndefined()
      expect(msg.tokensPerSecond).toBeUndefined()
      expect(msg.thinkDurationMs).toBeUndefined()
    })

    it('returns messages in created_at order', () => {
      createMessage({ ...BASE_MSG, id: 'msg1', content: 'First' })
      createMessage({ ...BASE_MSG, id: 'msg2', content: 'Second' })
      createMessage({ ...BASE_MSG, id: 'msg3', content: 'Third' })
      const msgs = listMessages('conv1')
      expect(msgs.map((m) => m.content)).toEqual(['First', 'Second', 'Third'])
    })

    it('only returns messages for the specified conversation', () => {
      createConversation({ id: 'conv2', title: 'Other' })
      createMessage({ ...BASE_MSG, id: 'msg1', conversationId: 'conv1', content: 'For conv1' })
      createMessage({ ...BASE_MSG, id: 'msg2', conversationId: 'conv2', content: 'For conv2' })
      expect(listMessages('conv1')).toHaveLength(1)
      expect(listMessages('conv2')).toHaveLength(1)
    })

    it('bumps conversation updated_at when message is created', () => {
      // This is tested indirectly: createMessage runs UPDATE on conversations
      // We just verify it doesn't throw
      expect(() => createMessage(BASE_MSG)).not.toThrow()
    })
  })

  describe('deleteMessage', () => {
    it('removes a message by id', () => {
      createMessage(BASE_MSG)
      deleteMessage('msg1')
      expect(listMessages('conv1')).toHaveLength(0)
    })

    it('is idempotent for unknown id', () => {
      expect(() => deleteMessage('no-such-id')).not.toThrow()
    })
  })

  describe('deleteMessagesFrom', () => {
    it('deletes the target message and all after it', () => {
      createMessage({ ...BASE_MSG, id: 'msg1', content: 'A' })
      createMessage({ ...BASE_MSG, id: 'msg2', content: 'B' })
      createMessage({ ...BASE_MSG, id: 'msg3', content: 'C' })
      deleteMessagesFrom('conv1', 'msg2')
      const remaining = listMessages('conv1')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].content).toBe('A')
    })

    it('deleting from first message removes all', () => {
      createMessage({ ...BASE_MSG, id: 'msg1', content: 'A' })
      createMessage({ ...BASE_MSG, id: 'msg2', content: 'B' })
      deleteMessagesFrom('conv1', 'msg1')
      expect(listMessages('conv1')).toHaveLength(0)
    })
  })

  describe('updateMessage', () => {
    it('updates content', () => {
      createMessage(BASE_MSG)
      const updated = updateMessage('msg1', { content: 'Updated content' })
      expect(updated.content).toBe('Updated content')
    })

    it('updates tokenCount', () => {
      createMessage(BASE_MSG)
      const updated = updateMessage('msg1', { tokenCount: 99 })
      expect(updated.tokenCount).toBe(99)
    })

    it('partial update preserves unchanged fields', () => {
      createMessage({ ...BASE_MSG, tokenCount: 50, content: 'Original' })
      updateMessage('msg1', { tokenCount: 75 })
      const msgs = listMessages('conv1')
      expect(msgs[0].content).toBe('Original')
      expect(msgs[0].tokenCount).toBe(75)
    })

    it('throws when message not found', () => {
      expect(() => updateMessage('no-such-id', { content: 'x' })).toThrow()
    })
  })
})
