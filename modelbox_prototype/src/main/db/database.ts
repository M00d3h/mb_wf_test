import Database from "better-sqlite3";
import { existsSync, statSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";


let _db: Database.Database | null = null;

/**
 * Migrate data from the old "llamafront" userData directory to the current
 * "modelbox" one. Electron derives the userData path from the `name` field in
 * package.json; the app was previously distributed as "llamafront" and later
 * renamed to "modelbox". We copy the old DB only when it is larger (has more
 * data) than the current one, so existing users keep their history.
 */
function migrateLegacyDb(): void {
  const currentDir = app.getPath("userData");
  const currentPath = join(currentDir, "llamafront.db");
  const parentDir = dirname(currentDir);

  const legacyNames = ["llamafront"];

  let bestPath: string | null = null;
  let bestSize = 0;
  for (const name of legacyNames) {
    const candidate = join(parentDir, name, "llamafront.db");
    if (!existsSync(candidate)) continue;
    const sz = statSync(candidate).size;
    if (sz > bestSize) { bestSize = sz; bestPath = candidate; }
  }

  if (!bestPath) return;

  const currentSize = existsSync(currentPath) ? statSync(currentPath).size : 0;
  if (bestSize <= currentSize) return;

  copyFileSync(bestPath, currentPath);
  for (const ext of ["-wal", "-shm"]) {
    const src = bestPath.replace(".db", ext);
    const dst = currentPath.replace(".db", ext);
    if (existsSync(src)) copyFileSync(src, dst);
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;

  migrateLegacyDb();
  const dbPath = join(app.getPath("userData"), "llamafront.db");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  seedDefaults(_db);

  // Processes can't survive an app restart — delete any instances the previous
  // session left in an active state (race between stopAllProcesses and app.exit).
  _db.prepare(
    "DELETE FROM server_instances WHERE last_state IN ('running', 'starting', 'loading', 'vllm-shards', 'vllm-compile', 'vllm-cudagraph')"
  ).run();

  return _db;
}

const SCHEMA = `
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
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role                TEXT NOT NULL,
  content             TEXT NOT NULL,
  token_count         INTEGER,
  tokens_per_second   REAL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS server_instances (
  id          TEXT PRIMARY KEY,
  model_id    TEXT NOT NULL REFERENCES models(id),
  profile_id  TEXT NOT NULL REFERENCES profiles(id),
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL,
  last_state  TEXT NOT NULL DEFAULT 'stopped',
  pid         INTEGER,
  started_at  TEXT,
  stopped_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function initSchema(db: Database.Database): void {
  db.exec(SCHEMA);
  // Additive migrations — each is idempotent (ALTER TABLE fails silently if column exists)
  const migrations = [
    "ALTER TABLE messages ADD COLUMN think_duration_ms INTEGER",
    "ALTER TABLE messages ADD COLUMN context_tokens INTEGER",
    "ALTER TABLE messages ADD COLUMN context_size INTEGER",
    "ALTER TABLE messages ADD COLUMN prompt_processing_ms INTEGER",
    "ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL",
    "ALTER TABLE models ADD COLUMN max_context_tokens INTEGER",
    "ALTER TABLE models ADD COLUMN block_count INTEGER",
    "ALTER TABLE models ADD COLUMN quant_label TEXT",
    "ALTER TABLE conversations ADD COLUMN instance_id TEXT",
    `CREATE TABLE IF NOT EXISTS mcp_servers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      transport   TEXT NOT NULL,
      command     TEXT,
      args        TEXT,
      url         TEXT,
      env         TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "ALTER TABLE mcp_servers ADD COLUMN token TEXT",
    "CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)",
    "CREATE INDEX IF NOT EXISTS idx_conversations_is_archived ON conversations(is_archived)",
    "CREATE INDEX IF NOT EXISTS idx_conversations_model_id ON conversations(model_id)",
    "CREATE INDEX IF NOT EXISTS idx_instances_kind ON server_instances(instance_kind)",
    "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)",
    "ALTER TABLE vllm_models ADD COLUMN is_multimodal INTEGER NOT NULL DEFAULT 0",
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
  migrateVllmSchema(db);
  migrateVllmProfiles(db);
  deduplicateVllmPaths(db);
  normalizeVllmProfileConfigs(db);
}

/**
 * vLLM: `vllm_models` table + `server_instances` with nullable llama FKs
 * and `instance_kind` / `vllm_model_id` (replaces old NOT NULL model/profile FK only for llama rows).
 */
function migrateVllmSchema(db: import("better-sqlite3").Database): void {
  const hasVllmModels = (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vllm_models'",
      )
      .get() as { 1: number } | undefined
  );
  if (!hasVllmModels) {
    db.exec(`
      CREATE TABLE vllm_models (
        id              TEXT PRIMARY KEY,
        path            TEXT NOT NULL UNIQUE,
        display_name    TEXT NOT NULL,
        config_json     TEXT NOT NULL DEFAULT '{}',
        dtype           TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } else {
    // Add dtype column to existing tables (may already exist from a prior run).
    try {
      db.exec("ALTER TABLE vllm_models ADD COLUMN dtype TEXT");
    } catch {
      /* column already exists */
    }
  }

  const colCheck = db.prepare("PRAGMA table_info(server_instances)").all() as {
    name: string;
  }[];
  if (colCheck.some((c) => c.name === "instance_kind")) {
    return;
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE server_instances_migrated (
        id              TEXT PRIMARY KEY,
        model_id        TEXT REFERENCES models(id) ON DELETE CASCADE,
        profile_id      TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        vllm_model_id   TEXT REFERENCES vllm_models(id) ON DELETE CASCADE,
        host            TEXT NOT NULL,
        port            INTEGER NOT NULL,
        last_state      TEXT NOT NULL DEFAULT 'stopped',
        pid             INTEGER,
        started_at      TEXT,
        stopped_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        instance_kind   TEXT NOT NULL DEFAULT 'llama',
        CHECK (
          (instance_kind = 'llama' AND model_id IS NOT NULL AND profile_id IS NOT NULL AND vllm_model_id IS NULL)
          OR
          (instance_kind = 'vllm' AND vllm_model_id IS NOT NULL AND model_id IS NULL AND profile_id IS NULL)
        )
      );
      INSERT INTO server_instances_migrated (
        id, model_id, profile_id, vllm_model_id, host, port, last_state, pid, started_at, stopped_at, created_at, instance_kind
      )
      SELECT
        id, model_id, profile_id, NULL, host, port, last_state, pid, started_at, stopped_at, created_at, 'llama'
      FROM server_instances;
      DROP TABLE server_instances;
      ALTER TABLE server_instances_migrated RENAME TO server_instances;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Per–vLLM-model launch profiles (mirrors `profiles` for llama.cpp).
 */
function migrateVllmProfiles(db: Database.Database): void {
  const exists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vllm_profiles'",
    )
    .get() as { 1: number } | undefined;
  if (!exists) {
    db.exec(`
      CREATE TABLE vllm_profiles (
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
    `);
  }

  type MRow = { id: string; display_name: string; config_json: string };
  const models = db
    .prepare("SELECT id, display_name, config_json FROM vllm_models")
    .all() as MRow[];
  const insert = db.prepare(
    `INSERT INTO vllm_profiles (id, vllm_model_id, name, active, config_json)
     VALUES (?, ?, ?, 1, ?)`,
  );
  const countFor = db.prepare(
    "SELECT COUNT(*) as c FROM vllm_profiles WHERE vllm_model_id = ?",
  );
  for (const m of models) {
    const c = (countFor.get(m.id) as { c: number }).c;
    if (c > 0) continue;
    const id = uuidv4();
    const cfg =
      m.config_json && m.config_json.trim() && m.config_json.trim() !== "{}"
        ? m.config_json
        : "{}";
    insert.run(id, m.id, "default", cfg);
  }

  try {
    db.exec(
      "ALTER TABLE server_instances ADD COLUMN vllm_profile_id TEXT REFERENCES vllm_profiles(id) ON DELETE SET NULL",
    );
  } catch {
    /* column exists */
  }

  db.prepare(
    `UPDATE vllm_models SET config_json = '{}' WHERE id IN (
       SELECT vllm_model_id FROM vllm_profiles
     )`,
  ).run();
}

/**
 * Merge \\wsl.localhost\ duplicates into their \\wsl$\ counterparts.
 *
 * Root cause: when WSL init is slow the scan falls through to the native Windows
 * file API, which stores paths under the configured root form (\\wsl.localhost\…).
 * A later scan with WSL available stores the same model under \\wsl$\… via
 * linuxPathToWslUnc, producing two DB rows for the same physical directory.
 *
 * Fix: for every \\wsl.localhost\ row, check whether a canonical \\wsl$\ row exists.
 *  - If yes  → delete the wsl.localhost duplicate (FK CASCADE cleans up profiles/instances).
 *  - If no   → rename in-place to the canonical form.
 */
function deduplicateVllmPaths(db: Database.Database): void {
  // Remove HF hub .no_exist/ negative-cache entries mistakenly stored as models.
  // These appear when find(1) picks up config.json stubs inside .no_exist/<hash>/.
  db.prepare("DELETE FROM vllm_models WHERE path LIKE '%\\.no_exist\\%' OR path LIKE '%/.no_exist/%'").run();

  if (process.platform !== "win32") return;

  // Merge \\wsl.localhost\ duplicates into their \\wsl$\ counterparts.
  type Row = { id: string; path: string };
  const dupes = db
    .prepare("SELECT id, path FROM vllm_models WHERE path LIKE ?")
    .all("\\\\wsl.localhost\\%") as Row[];
  for (const row of dupes) {
    const canonical = row.path.replace(/^\\\\wsl\.localhost\\/i, "\\\\wsl$\\");
    const existing = db
      .prepare("SELECT id FROM vllm_models WHERE path = ?")
      .get(canonical) as { id: string } | undefined;
    if (existing) {
      db.prepare("DELETE FROM vllm_models WHERE id = ?").run(row.id);
    } else {
      db.prepare("UPDATE vllm_models SET path = ? WHERE id = ?").run(canonical, row.id);
    }
  }
}

/**
 * Strip shell quotes from vLLM profile config string fields.
 *
 * The display command used single quotes (e.g. '0.0.0.0') but the command-line
 * parser only understood double-quotes, so copying the display command as a
 * custom command-line embedded literal single-quotes in the stored config.
 * This migration cleans up any already-tainted values.
 */
function normalizeVllmProfileConfigs(db: Database.Database): void {
  const STR_FIELDS = [
    "host", "reasoningParser", "toolCallParser",
    "servedModelName", "kvCacheDtype", "speculativeConfig",
  ];
  type Row = { id: string; config_json: string };
  const profiles = db
    .prepare("SELECT id, config_json FROM vllm_profiles")
    .all() as Row[];
  const update = db.prepare(
    "UPDATE vllm_profiles SET config_json = ? WHERE id = ?",
  );
  const stripQuotes = (v: string): string => v.replace(/^(['"])(.*)\1$/s, '$2');
  for (const p of profiles) {
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(p.config_json);
    } catch {
      continue;
    }
    let dirty = false;
    for (const key of STR_FIELDS) {
      const v = cfg[key];
      if (typeof v !== "string" || !v) continue;
      const cleaned = stripQuotes(v);
      if (cleaned !== v) {
        cfg[key] = cleaned;
        dirty = true;
      }
    }
    if (dirty) {
      update.run(JSON.stringify(cfg), p.id);
    }
  }
}

function seedDefaults(db: Database.Database): void {
  const home = app.getPath("home");
  const managedLlamaExe =
    process.platform === "win32"
      ? join(home, ".modelbox", "runtime", "llama", "llama-server.exe")
      : join(home, ".modelbox", "runtime", "llama", "llama-server");

  const defaults: Record<string, string> = {
    models_dirs: JSON.stringify([join(home, ".modelbox", "models")]),
    vllm_model_dirs: JSON.stringify(
      process.platform === "win32"
        ? []
        : [join(home, ".cache", "huggingface", "hub")]
    ),
    llama_server_path: managedLlamaExe,
    cuda_bin_path:
      "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v13.1\\bin",
    default_host: "0.0.0.0",
    base_port: "8502",
    first_run: "1",
  };

  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  const insertMany = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) insert.run(k, v);
  });
  insertMany(Object.entries(defaults));
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
