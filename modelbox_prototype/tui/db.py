"""SQLite access layer — opens the shared llamafront.db in WAL read-write mode."""

import json
import os
import platform
import sqlite3
import subprocess
import uuid
from pathlib import Path
from typing import Any


def open_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ─── Models ──────────────────────────────────────────────────────────────────

def list_llama_models(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, name, gguf_path, model_dir, quant_label, max_context_tokens, block_count "
        "FROM models ORDER BY name"
    ).fetchall()
    return [dict(r) for r in rows]


def list_vllm_models(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, display_name, path, config_json, dtype "
        "FROM vllm_models ORDER BY display_name"
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["config"] = json.loads(d.get("config_json") or "{}")
        result.append(d)
    return result


def delete_llama_model(conn: sqlite3.Connection, model_id: str) -> None:
    conn.execute("DELETE FROM models WHERE id = ?", (model_id,))
    conn.commit()


def delete_vllm_model(conn: sqlite3.Connection, model_id: str) -> None:
    conn.execute("DELETE FROM vllm_models WHERE id = ?", (model_id,))
    conn.commit()


# ─── llama.cpp profiles ───────────────────────────────────────────────────────

def list_profiles(conn: sqlite3.Connection, model_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, name, active, config FROM profiles WHERE model_id = ? ORDER BY name",
        (model_id,),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["config"] = json.loads(d.get("config") or "{}")
        result.append(d)
    return result


def update_profile_config(conn: sqlite3.Connection, profile_id: str, config: dict) -> None:
    conn.execute(
        "UPDATE profiles SET config = ?, updated_at = datetime('now') WHERE id = ?",
        (json.dumps(config), profile_id),
    )
    conn.commit()


def create_llama_profile(conn: sqlite3.Connection, model_id: str, name: str, config: dict) -> str:
    pid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO profiles (id, model_id, name, active, config, created_at, updated_at) "
        "VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))",
        (pid, model_id, name, json.dumps(config)),
    )
    conn.commit()
    return pid


def ensure_default_llama_profile(conn: sqlite3.Connection, model_id: str, settings: dict[str, Any] | None = None) -> None:
    if list_profiles(conn, model_id):
        return
    settings = settings or get_settings(conn)
    conn.execute(
        "INSERT INTO profiles (id, model_id, name, active, config, created_at, updated_at) "
        "VALUES (?, ?, 'Default', 1, ?, datetime('now'), datetime('now'))",
        (
            str(uuid.uuid4()),
            model_id,
            json.dumps({
                "host": settings.get("llamaDefaultHost") or "0.0.0.0",
                "port": settings.get("llamaBasePort") or 8502,
                "fit": "on",
            }),
        ),
    )
    conn.commit()


def delete_profile(conn: sqlite3.Connection, profile_id: str) -> None:
    conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
    conn.commit()


def set_active_profile(conn: sqlite3.Connection, model_id: str, profile_id: str) -> None:
    # The DB trigger enforces exactly one active per model, so just set the new one.
    conn.execute("UPDATE profiles SET active = 0 WHERE model_id = ?", (model_id,))
    conn.execute(
        "UPDATE profiles SET active = 1, updated_at = datetime('now') WHERE id = ?",
        (profile_id,),
    )
    conn.commit()


def set_active_vllm_profile(conn: sqlite3.Connection, vllm_model_id: str, profile_id: str) -> None:
    conn.execute("UPDATE vllm_profiles SET active = 0 WHERE vllm_model_id = ?", (vllm_model_id,))
    conn.execute(
        "UPDATE vllm_profiles SET active = 1, updated_at = datetime('now') WHERE id = ?",
        (profile_id,),
    )
    conn.commit()


# ─── vLLM profiles ────────────────────────────────────────────────────────────

def list_vllm_profiles(conn: sqlite3.Connection, vllm_model_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, name, active, config_json FROM vllm_profiles "
        "WHERE vllm_model_id = ? ORDER BY name",
        (vllm_model_id,),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["config"] = json.loads(d.get("config_json") or "{}")
        result.append(d)
    return result


def update_vllm_profile_config(conn: sqlite3.Connection, profile_id: str, config: dict) -> None:
    conn.execute(
        "UPDATE vllm_profiles SET config_json = ?, updated_at = datetime('now') WHERE id = ?",
        (json.dumps(config), profile_id),
    )
    conn.commit()


def create_vllm_profile(conn: sqlite3.Connection, vllm_model_id: str, name: str, config: dict) -> str:
    pid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO vllm_profiles (id, vllm_model_id, name, active, config_json, created_at, updated_at) "
        "VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))",
        (pid, vllm_model_id, name, json.dumps(config)),
    )
    conn.commit()
    return pid


def ensure_default_vllm_profile(conn: sqlite3.Connection, vllm_model_id: str) -> None:
    if list_vllm_profiles(conn, vllm_model_id):
        return
    conn.execute(
        "INSERT INTO vllm_profiles (id, vllm_model_id, name, active, config_json, created_at, updated_at) "
        "VALUES (?, ?, 'default', 1, ?, datetime('now'), datetime('now'))",
        (str(uuid.uuid4()), vllm_model_id, json.dumps({"port": 8000})),
    )
    conn.commit()


def delete_vllm_profile(conn: sqlite3.Connection, profile_id: str) -> None:
    conn.execute("DELETE FROM vllm_profiles WHERE id = ?", (profile_id,))
    conn.commit()


# ─── Conversations & messages ─────────────────────────────────────────────────

def list_conversations(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT c.id, c.title, c.folder_id, c.updated_at, c.is_archived,
               c.instance_host, c.instance_port, c.model_id,
               f.name AS folder_name
        FROM conversations c
        LEFT JOIN folders f ON c.folder_id = f.id
        WHERE c.is_archived = 0
        ORDER BY c.updated_at DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


def list_folders(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT id, name FROM folders ORDER BY name").fetchall()
    return [dict(r) for r in rows]


def get_messages(conn: sqlite3.Connection, conversation_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, role, content, created_at, tokens_per_second, think_duration_ms "
        "FROM messages WHERE conversation_id = ? ORDER BY created_at",
        (conversation_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def create_conversation(
    conn: sqlite3.Connection,
    title: str,
    instance_host: str,
    instance_port: int,
    model_id: str | None = None,
) -> str:
    cid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO conversations
           (id, title, model_id, instance_host, instance_port,
            system_prompt, chat_params, created_at, updated_at, is_archived)
           VALUES (?, ?, ?, ?, ?, NULL, '{}', datetime('now'), datetime('now'), 0)""",
        (cid, title, model_id, instance_host, instance_port),
    )
    conn.commit()
    return cid


def add_message(
    conn: sqlite3.Connection,
    conversation_id: str,
    role: str,
    content: str,
    tokens_per_second: float | None = None,
    token_count: int | None = None,
    think_duration_ms: int | None = None,
    context_tokens: int | None = None,
) -> str:
    mid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO messages "
        "(id, conversation_id, role, content, token_count, tokens_per_second, think_duration_ms, context_tokens, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        (mid, conversation_id, role, content, token_count, tokens_per_second, think_duration_ms, context_tokens),
    )
    conn.execute(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
        (conversation_id,),
    )
    conn.commit()
    return mid


def update_conversation_title(conn: sqlite3.Connection, conversation_id: str, title: str) -> None:
    conn.execute(
        "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
        (title, conversation_id),
    )
    conn.commit()


# ─── Server instances ─────────────────────────────────────────────────────────

def get_running_instances(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """SELECT id, instance_kind, host, port, last_state, model_id, vllm_model_id
           FROM server_instances WHERE last_state = 'running'
           ORDER BY started_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


def get_any_running_instance(conn: sqlite3.Connection) -> dict | None:
    instances = get_running_instances(conn)
    return instances[0] if instances else None


def insert_server_instance(
    conn: sqlite3.Connection,
    kind: str,
    model_id: str | None,
    profile_id: str | None,
    vllm_model_id: str | None,
    vllm_profile_id: str | None,
    host: str,
    port: int,
    pid: int,
) -> str:
    iid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO server_instances
           (id, instance_kind, model_id, profile_id, vllm_model_id, vllm_profile_id,
            host, port, last_state, pid, started_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, datetime('now'), datetime('now'))""",
        (iid, kind, model_id, profile_id, vllm_model_id, vllm_profile_id, host, port, pid),
    )
    conn.commit()
    return iid


def update_instance_state(conn: sqlite3.Connection, instance_id: str, state: str) -> None:
    conn.execute(
        "UPDATE server_instances SET last_state = ? WHERE id = ?",
        (state, instance_id),
    )
    conn.commit()


# ─── Settings ─────────────────────────────────────────────────────────────────

def _wsl_default_hf_cache_dir() -> str | None:
    if platform.system() != "Windows":
        return None
    try:
        raw = subprocess.check_output(["wsl.exe", "--list", "--verbose"], timeout=5)
        text = raw.decode("utf-8", errors="ignore").replace("\x00", "").replace("\r", "")
        line = next((ln for ln in text.split("\n") if ln.strip().startswith("*")), "")
        distro = line.strip().lstrip("*").strip().split()[0] if line.strip() else ""
        if not distro:
            return None
        user_raw = subprocess.check_output(["wsl.exe", "-d", distro, "--", "whoami"], timeout=5)
        username = user_raw.decode("utf-8", errors="ignore").replace("\x00", "").replace("\r", "").strip()
        if not username:
            return None
        return f"\\\\wsl$\\{distro}\\home\\{username}\\.cache\\huggingface\\hub"
    except Exception:
        return None


def get_settings(conn: sqlite3.Connection) -> dict[str, Any]:
    """Return settings translated to camelCase — mirrors rowsToSettings() in settings.repo.ts."""
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    m: dict[str, str] = {r["key"]: r["value"] for r in rows}

    def _json_list(key: str) -> list[str] | None:
        raw = m.get(key)
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
                    cleaned = [x.strip() for x in parsed if x.strip()]
                    if cleaned:
                        return cleaned
            except (json.JSONDecodeError, TypeError):
                pass
        return None

    def _int(key: str, fallback: int) -> int:
        try:
            return int(m.get(key, fallback))
        except (ValueError, TypeError):
            return fallback

    _rt_defaults: dict[str, Any] = {
        "envKind": "conda",
        "condaEnvName": "vllm",
        "condaShPath": "",
        "venvPath": "",
        "dockerImage": "vllm/vllm-openai:latest",
        "dockerExtraArgs": "",
        "wslDistro": "",
    }
    try:
        rt_raw = json.loads(m.get("vllm_runtime_json") or "{}")
        vllm_runtime: dict[str, Any] = {**_rt_defaults, **rt_raw} if isinstance(rt_raw, dict) else _rt_defaults
    except (json.JSONDecodeError, TypeError):
        vllm_runtime = _rt_defaults

    models_dirs = _json_list("models_dirs")
    if not models_dirs:
        legacy = (m.get("models_dir") or "").strip()
        models_dirs = [legacy] if legacy else [str(Path.home() / ".modelbox" / "models")]

    vllm_dirs = _json_list("vllm_model_dirs")
    if vllm_dirs is None:
        wsl_dir = _wsl_default_hf_cache_dir()
        vllm_dirs = [wsl_dir] if wsl_dir else ([] if platform.system() == "Windows" else [str(Path.home() / ".cache" / "huggingface" / "hub")])

    return {
        "modelsDirs":       models_dirs,
        "vllmModelDirs":    vllm_dirs,
        "llamaServerPath":  m.get("llama_server_path", ""),
        "cudaBinPath":      m.get("cuda_bin_path", ""),
        "llamaDefaultHost": m.get("llama_default_host") or m.get("default_host") or "0.0.0.0",
        "llamaBasePort":    _int("llama_base_port", _int("base_port", 8502)),
        "vllmDefaultHost":  m.get("vllm_default_host") or "0.0.0.0",
        "vllmBasePort":     _int("vllm_base_port", 8000),
        "vllmRuntime":      vllm_runtime,
        "firstRun":         m.get("first_run") != "0",
        "wslMode":          m.get("wsl_mode") == "1",
    }


def update_model_dirs(conn: sqlite3.Connection, *, models_dirs: list[str] | None = None, vllm_model_dirs: list[str] | None = None) -> None:
    if models_dirs is not None:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('models_dirs', ?)",
            (json.dumps([d.strip() for d in models_dirs if d.strip()]),),
        )
    if vllm_model_dirs is not None:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('vllm_model_dirs', ?)",
            (json.dumps([d.strip() for d in vllm_model_dirs if d.strip()]),),
        )
    conn.commit()


def update_settings(conn: sqlite3.Connection, patch: dict) -> None:
    """Write an AppSettings patch to the DB — mirrors updateSettings() in settings.repo.ts."""
    def _set(key: str, value: str) -> None:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )

    if "modelsDirs" in patch:
        dirs = patch["modelsDirs"]
        if isinstance(dirs, list):
            _set("models_dirs", json.dumps([d.strip() for d in dirs if d.strip()]))

    if "vllmModelDirs" in patch:
        dirs = patch["vllmModelDirs"]
        if isinstance(dirs, list):
            _set("vllm_model_dirs", json.dumps([d.strip() for d in dirs if d.strip()]))

    if "llamaServerPath" in patch:
        _set("llama_server_path", str(patch["llamaServerPath"]))

    if "cudaBinPath" in patch:
        _set("cuda_bin_path", str(patch["cudaBinPath"]))

    if "llamaDefaultHost" in patch:
        host = patch["llamaDefaultHost"]
        if host in ("127.0.0.1", "0.0.0.0"):
            _set("llama_default_host", host)

    if "llamaBasePort" in patch:
        try:
            p = int(patch["llamaBasePort"])
            if 1 <= p <= 65535:
                _set("llama_base_port", str(p))
        except (ValueError, TypeError):
            pass

    if "vllmDefaultHost" in patch:
        host = patch["vllmDefaultHost"]
        if host in ("127.0.0.1", "0.0.0.0"):
            _set("vllm_default_host", host)

    if "vllmBasePort" in patch:
        try:
            p = int(patch["vllmBasePort"])
            if 1 <= p <= 65535:
                _set("vllm_base_port", str(p))
        except (ValueError, TypeError):
            pass

    if "wslMode" in patch:
        _set("wsl_mode", "1" if patch["wslMode"] else "0")

    if "vllmRuntime" in patch:
        rt = patch["vllmRuntime"]
        if isinstance(rt, dict):
            _set("vllm_runtime_json", json.dumps(rt))

    conn.commit()


def upsert_llama_model(
    conn: sqlite3.Connection,
    *,
    model_id: str,
    name: str,
    gguf_path: str,
    model_dir: str,
    detected_files: list[str],
    quant_label: str | None = None,
    is_multimodal: bool = False,
) -> str:
    path = os.path.normpath(gguf_path)
    row = conn.execute(
        "SELECT id FROM models WHERE lower(gguf_path) = lower(?) LIMIT 1" if os.name == "nt" else
        "SELECT id FROM models WHERE gguf_path = ? LIMIT 1",
        (path,),
    ).fetchone()
    mid = row["id"] if row else model_id
    conn.execute(
        """
        INSERT INTO models
          (id, name, gguf_path, model_dir, is_embedding, is_multimodal,
           detected_files, max_context_tokens, block_count, quant_label, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, NULL, NULL, ?, datetime('now'))
        ON CONFLICT(gguf_path) DO UPDATE SET
          name = excluded.name,
          model_dir = excluded.model_dir,
          is_multimodal = excluded.is_multimodal,
          detected_files = excluded.detected_files,
          quant_label = excluded.quant_label,
          updated_at = datetime('now')
        """,
        (
            mid,
            name,
            path,
            os.path.normpath(model_dir),
            1 if is_multimodal else 0,
            json.dumps([os.path.normpath(p) for p in detected_files]),
            quant_label,
        ),
    )
    conn.commit()
    ensure_default_llama_profile(conn, mid)
    return mid


def upsert_vllm_model(conn: sqlite3.Connection, *, path: str, display_name: str, dtype: str | None = None) -> str:
    canonical = path.replace("\\\\wsl.localhost\\", "\\\\wsl$\\")
    row = conn.execute("SELECT id FROM vllm_models WHERE path = ?", (canonical,)).fetchone()
    if row:
        mid = row["id"]
        conn.execute(
            "UPDATE vllm_models SET display_name = ?, dtype = ?, updated_at = datetime('now') WHERE id = ?",
            (display_name, dtype, mid),
        )
    else:
        mid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO vllm_models (id, path, display_name, config_json, dtype, created_at, updated_at) "
            "VALUES (?, ?, ?, '{}', ?, datetime('now'), datetime('now'))",
            (mid, canonical, display_name, dtype),
        )
    conn.commit()
    ensure_default_vllm_profile(conn, mid)
    return mid
