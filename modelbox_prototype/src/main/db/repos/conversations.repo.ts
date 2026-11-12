import { getDb } from "../database";
import type { Conversation, ChatParams } from "@shared/types";

interface ConversationRow {
  id: string;
  title: string;
  model_id: string | null;
  instance_id: string | null;
  instance_host: string | null;
  instance_port: number | null;
  system_prompt: string | null;
  chat_params: string;
  folder_id: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

function rowToConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    modelId: r.model_id,
    instanceId: r.instance_id ?? null,
    instanceHost: r.instance_host,
    instancePort: r.instance_port,
    systemPrompt: r.system_prompt,
    chatParams: JSON.parse(r.chat_params) as ChatParams,
    folderId: r.folder_id,
    isArchived: r.is_archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listConversations(): Conversation[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM conversations WHERE is_archived = 0 ORDER BY updated_at DESC",
    )
    .all() as ConversationRow[];
  return rows.map(rowToConversation);
}

export function listArchivedConversations(): Conversation[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM conversations WHERE is_archived = 1 ORDER BY updated_at DESC",
    )
    .all() as ConversationRow[];
  return rows.map(rowToConversation);
}

/** Clear model / instance binding when a model is removed from the library (chat history kept). */
export function clearModelBinding(modelId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE conversations SET
      model_id = NULL,
      instance_id = NULL,
      instance_host = NULL,
      instance_port = NULL,
      updated_at = datetime('now')
     WHERE model_id = ?`,
  ).run(modelId);
}

export function getConversation(id: string): Conversation | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | ConversationRow
    | undefined;
  return row ? rowToConversation(row) : null;
}

export function createConversation(conv: {
  id: string;
  title: string;
  modelId?: string | null;
  instanceId?: string | null;
  instanceHost?: string | null;
  instancePort?: number | null;
  systemPrompt?: string | null;
  chatParams?: ChatParams;
  isArchived?: boolean;
}): Conversation {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO conversations (id, title, model_id, instance_id, instance_host, instance_port, system_prompt, chat_params, is_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    conv.id,
    conv.title,
    conv.modelId ?? null,
    conv.instanceId ?? null,
    conv.instanceHost ?? null,
    conv.instancePort ?? null,
    conv.systemPrompt ?? null,
    JSON.stringify(conv.chatParams ?? {}),
    conv.isArchived ? 1 : 0,
  );
  return getConversation(conv.id)!;
}

export function updateConversation(
  id: string,
  patch: Partial<Omit<Conversation, "id" | "createdAt" | "updatedAt">>,
): Conversation {
  const current = getConversation(id);
  if (!current) throw new Error(`Conversation ${id} not found`);
  const db = getDb();
  db.prepare(
    `
    UPDATE conversations SET
      title = ?,
      model_id = ?,
      instance_id = ?,
      instance_host = ?,
      instance_port = ?,
      system_prompt = ?,
      chat_params = ?,
      is_archived = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(
    patch.title ?? current.title,
    patch.modelId !== undefined ? patch.modelId : current.modelId,
    patch.instanceId !== undefined ? patch.instanceId : current.instanceId,
    patch.instanceHost !== undefined
      ? patch.instanceHost
      : current.instanceHost,
    patch.instancePort !== undefined
      ? patch.instancePort
      : current.instancePort,
    patch.systemPrompt !== undefined
      ? patch.systemPrompt
      : current.systemPrompt,
    JSON.stringify(patch.chatParams ?? current.chatParams),
    patch.isArchived !== undefined
      ? patch.isArchived
        ? 1
        : 0
      : current.isArchived
        ? 1
        : 0,
    id,
  );
  return getConversation(id)!;
}

export function deleteConversation(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function toggleArchive(id: string): Conversation {
  const current = getConversation(id);
  if (!current) throw new Error(`Conversation ${id} not found`);
  return updateConversation(id, { isArchived: !current.isArchived });
}

export function searchConversations(query: string): Conversation[] {
  const db = getDb();
  const like = `%${query}%`;

  // Title matches
  const byTitle = db
    .prepare(`SELECT * FROM conversations WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC`)
    .all(like) as ConversationRow[];

  // Content matches (distinct conversations only)
  const byContent = db
    .prepare(
      `SELECT DISTINCT c.* FROM conversations c
       INNER JOIN messages m ON m.conversation_id = c.id
       WHERE c.is_archived = 0 AND m.content LIKE ?
       ORDER BY c.updated_at DESC`,
    )
    .all(like) as ConversationRow[];

  // Merge, title matches first, deduplicate by id
  const seen = new Set<string>();
  const merged: ConversationRow[] = [];
  for (const row of [...byTitle, ...byContent]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged.map(rowToConversation);
}
