/**
 * Creates a fresh in-memory better-sqlite3 database with the full LlamaFront
 * schema and migrations applied.
 *
 * NOTE: better-sqlite3 must be compiled for the standard Node.js runtime to
 * work in the vitest environment. The default build targets Electron.
 *
 * To rebuild for Node.js:
 *   npm run test:rebuild-native
 *
 * To restore the Electron build after testing:
 *   npm run rebuild
 *
 * Or run the full DB test cycle in one step:
 *   npm run test:db
 */

/**
 * Returns true when better-sqlite3 can be instantiated in the current Node.js process.
 * `require()` alone is not enough — the native `.node` binding is loaded lazily on
 * `new Database()`, so we must actually instantiate it to detect an ABI mismatch.
 */
export function isSqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

type DbType = import('better-sqlite3').Database

/** Full schema + migrations — mirrors database.ts exactly. */
function applySchema(db: DbType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      gguf_path       TEXT NOT NULL UNIQUE,
      model_dir       TEXT NOT NULL,
      is_embedding    INTEGER NOT NULL DEFAULT 0,
      is_multimodal   INTEGER NOT NULL DEFAULT 0,
      detected_files  TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id          TEXT PRIMARY KEY,
      model_id    TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 0,
      config      TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TRIGGER IF NOT EXISTS single_active_profile_insert
      BEFORE INSERT ON profiles WHEN NEW.active = 1
      BEGIN
        UPDATE profiles SET active = 0
        WHERE model_id = NEW.model_id AND active = 1;
      END;

    CREATE TRIGGER IF NOT EXISTS single_active_profile_update
      BEFORE UPDATE ON profiles WHEN NEW.active = 1
      BEGIN
        UPDATE profiles SET active = 0
        WHERE model_id = NEW.model_id AND active = 1 AND id != NEW.id;
      END;

    CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      model_id        TEXT REFERENCES models(id),
      instance_host   TEXT,
      instance_port   INTEGER,
      system_prompt   TEXT,
      chat_params     TEXT NOT NULL DEFAULT '{}',
      is_archived     INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id                      TEXT PRIMARY KEY,
      conversation_id         TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role                    TEXT NOT NULL,
      content                 TEXT NOT NULL,
      token_count             INTEGER,
      tokens_per_second       REAL,
      think_duration_ms       INTEGER,
      context_tokens          INTEGER,
      context_size            INTEGER,
      prompt_processing_ms    INTEGER,
      created_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      transport   TEXT NOT NULL,
      command     TEXT,
      args        TEXT,
      url         TEXT,
      env         TEXT,
      token       TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vllm_models (
      id              TEXT PRIMARY KEY,
      path            TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL,
      config_json     TEXT NOT NULL DEFAULT '{}',
      dtype           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vllm_profiles (
      id              TEXT PRIMARY KEY,
      vllm_model_id   TEXT NOT NULL REFERENCES vllm_models(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      active          INTEGER NOT NULL DEFAULT 0,
      config_json     TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TRIGGER IF NOT EXISTS single_active_vllm_profile_insert
      BEFORE INSERT ON vllm_profiles WHEN NEW.active = 1
    BEGIN
      UPDATE vllm_profiles SET active = 0
      WHERE vllm_model_id = NEW.vllm_model_id AND active = 1;
    END;

    CREATE TRIGGER IF NOT EXISTS single_active_vllm_profile_update
      BEFORE UPDATE ON vllm_profiles WHEN NEW.active = 1
    BEGIN
      UPDATE vllm_profiles SET active = 0
      WHERE vllm_model_id = NEW.vllm_model_id AND active = 1 AND id != NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS server_instances (
      id              TEXT PRIMARY KEY,
      model_id        TEXT REFERENCES models(id) ON DELETE CASCADE,
      profile_id      TEXT REFERENCES profiles(id) ON DELETE CASCADE,
      vllm_model_id   TEXT REFERENCES vllm_models(id) ON DELETE CASCADE,
      vllm_profile_id TEXT REFERENCES vllm_profiles(id) ON DELETE SET NULL,
      host            TEXT NOT NULL,
      port            INTEGER NOT NULL,
      last_state      TEXT NOT NULL DEFAULT 'stopped',
      pid             INTEGER,
      started_at      TEXT,
      stopped_at      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      instance_kind   TEXT NOT NULL DEFAULT 'llama'
    );
  `)

  // indexes
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_is_archived ON conversations(is_archived)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_model_id ON conversations(model_id)',
    'CREATE INDEX IF NOT EXISTS idx_instances_kind ON server_instances(instance_kind)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)',
  ]) {
    try { db.exec(sql) } catch { /* already exists */ }
  }

  // folder_id column on conversations
  try {
    db.exec('ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL')
  } catch { /* already exists */ }

  // instance_id column on conversations
  try {
    db.exec('ALTER TABLE conversations ADD COLUMN instance_id TEXT')
  } catch { /* already exists */ }

  // model metadata columns
  for (const col of [
    'ALTER TABLE models ADD COLUMN max_context_tokens INTEGER',
    'ALTER TABLE models ADD COLUMN block_count INTEGER',
    'ALTER TABLE models ADD COLUMN quant_label TEXT',
  ]) {
    try { db.exec(col) } catch { /* already exists */ }
  }
}

/**
 * Creates a fresh in-memory database with the full schema.
 * Returns the db and a `close()` teardown function.
 *
 * Throws (and tests should skip via `isSqliteAvailable()`) when
 * better-sqlite3 is compiled for Electron's ABI, not Node.js's.
 */
export function createTestDb(): { db: DbType; close: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  return { db, close: () => db.close() }
}
