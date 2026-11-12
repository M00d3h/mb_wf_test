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
