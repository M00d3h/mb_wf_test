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
  createConversation,
  getConversation,
  listConversations,
  listArchivedConversations,
  updateConversation,
  deleteConversation,
  toggleArchive,
  searchConversations,
} = await import('@main/db/repos/conversations.repo')

const BASE_CONV = {
  id: 'c1',
  title: 'Test conversation',
}

describe.skipIf(!sqlite)('conversations.repo', () => {
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { ctx?.close(); ctx = null })

  describe('createConversation / getConversation', () => {
    it('inserts and retrieves a conversation by id', () => {
      createConversation(BASE_CONV)
      const c = getConversation('c1')
      expect(c).not.toBeNull()
      expect(c!.title).toBe('Test conversation')
      expect(c!.isArchived).toBe(false)
    })

    it('returns null for unknown id', () => {
      expect(getConversation('unknown')).toBeNull()
    })

    it('stores systemPrompt when provided', () => {
      createConversation({ ...BASE_CONV, systemPrompt: 'You are helpful.' })
      expect(getConversation('c1')!.systemPrompt).toBe('You are helpful.')
    })

    it('systemPrompt is null when not provided', () => {
      createConversation(BASE_CONV)
      expect(getConversation('c1')!.systemPrompt).toBeNull()
    })

    it('stores chatParams JSON and round-trips it', () => {
      const params = { temp: 0.7, topP: 0.95 }
      createConversation({ ...BASE_CONV, chatParams: params as never })
      expect(getConversation('c1')!.chatParams).toMatchObject(params)
    })
  })

  describe('listConversations', () => {
    it('returns empty array when no conversations', () => {
      expect(listConversations()).toEqual([])
    })

    it('lists only non-archived conversations', () => {
      createConversation({ ...BASE_CONV, id: 'c1', title: 'Active' })
      createConversation({ ...BASE_CONV, id: 'c2', title: 'Archived', isArchived: true })
      const list = listConversations()
      expect(list).toHaveLength(1)
      expect(list[0].title).toBe('Active')
    })

    it('returns conversations ordered by updated_at desc', () => {
      createConversation({ ...BASE_CONV, id: 'c1', title: 'First' })
      createConversation({ ...BASE_CONV, id: 'c2', title: 'Second' })
      // datetime('now') has 1-second precision — force c2 ahead of c1 explicitly
      ctx!.db.prepare(
        "UPDATE conversations SET updated_at = datetime('now', '+1 second') WHERE id = 'c2'"
      ).run()
      const titles = listConversations().map((c) => c.title)
      expect(titles[0]).toBe('Second')
    })
  })

  describe('listArchivedConversations', () => {
    it('returns only archived conversations', () => {
      createConversation({ ...BASE_CONV, id: 'c1', title: 'Active' })
      createConversation({ ...BASE_CONV, id: 'c2', title: 'Archived', isArchived: true })
      const list = listArchivedConversations()
      expect(list).toHaveLength(1)
      expect(list[0].title).toBe('Archived')
    })
  })

  describe('toggleArchive', () => {
    it('archives a non-archived conversation', () => {
      createConversation(BASE_CONV)
      const updated = toggleArchive('c1')
      expect(updated.isArchived).toBe(true)
      // listConversations should no longer include it
      expect(listConversations()).toHaveLength(0)
    })

    it('unarchives an archived conversation', () => {
      createConversation({ ...BASE_CONV, isArchived: true })
      const updated = toggleArchive('c1')
      expect(updated.isArchived).toBe(false)
      expect(listConversations()).toHaveLength(1)
    })

    it('throws when conversation not found', () => {
      expect(() => toggleArchive('no-such-id')).toThrow()
    })
  })

  describe('updateConversation', () => {
    it('updates title', () => {
      createConversation(BASE_CONV)
      const updated = updateConversation('c1', { title: 'New title' })
      expect(updated.title).toBe('New title')
    })

    it('partial update preserves unchanged fields', () => {
      createConversation({ ...BASE_CONV, systemPrompt: 'original' })
      updateConversation('c1', { title: 'Changed' })
      expect(getConversation('c1')!.systemPrompt).toBe('original')
    })

    it('throws when conversation not found', () => {
      expect(() => updateConversation('no-such-id', { title: 'x' })).toThrow()
    })
  })

  describe('deleteConversation', () => {
    it('removes the conversation', () => {
      createConversation(BASE_CONV)
      deleteConversation('c1')
      expect(getConversation('c1')).toBeNull()
    })

    it('is idempotent', () => {
      expect(() => deleteConversation('no-such-id')).not.toThrow()
    })
  })

  describe('searchConversations', () => {
    it('matches conversations by title substring', () => {
      createConversation({ ...BASE_CONV, id: 'c1', title: 'How to bake bread' })
      createConversation({ ...BASE_CONV, id: 'c2', title: 'History of Rome' })
      const results = searchConversations('bake')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('How to bake bread')
    })

    it('search is case-insensitive', () => {
      createConversation({ ...BASE_CONV, title: 'How to bake BREAD' })
      expect(searchConversations('bread')).toHaveLength(1)
    })

    it('returns empty array for no matches', () => {
      createConversation(BASE_CONV)
      expect(searchConversations('xyzzy')).toHaveLength(0)
    })

    it('does not return archived conversations in search results', () => {
      createConversation({ ...BASE_CONV, title: 'Archived bake', isArchived: true })
      expect(searchConversations('bake')).toHaveLength(0)
    })

    it('deduplicates when title and content both match', async () => {
      // Create a conversation whose title matches AND whose message content matches
      createConversation({ ...BASE_CONV, id: 'c1', title: 'About baking' })
      // Directly insert a message that also matches
      ctx!.db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content) VALUES ('msg1', 'c1', 'user', 'How do I bake?')`
      ).run()
      const results = searchConversations('bak')
      // Should appear only once even though it matches both title and content
      expect(results.filter((c) => c.id === 'c1')).toHaveLength(1)
    })
  })
})
