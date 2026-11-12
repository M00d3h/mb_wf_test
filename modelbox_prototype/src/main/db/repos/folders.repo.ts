import { getDb } from "../database";
import type { Folder } from "@shared/types";

interface FolderRow {
  id: string;
  name: string;
  created_at: string;
}

function rowToFolder(r: FolderRow): Folder {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

export function listFolders(): Folder[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM folders ORDER BY name ASC")
    .all() as FolderRow[];
  return rows.map(rowToFolder);
}

export function createFolder(id: string, name: string): Folder {
  const db = getDb();
  db.prepare("INSERT INTO folders (id, name) VALUES (?, ?)").run(id, name);
  return rowToFolder(
    db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as FolderRow,
  );
}

export function deleteFolder(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM folders WHERE id = ?").run(id);
}

export function setConversationFolder(
  convId: string,
  folderId: string | null,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE conversations SET folder_id = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(folderId, convId);
}
