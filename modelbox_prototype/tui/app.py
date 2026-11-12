"""ModelBox TUI — main Textual application. Owns DB and server registry."""

from __future__ import annotations

import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any

from textual.app import App

from tui import db as DB
from tui.config import get_db_path


# ─── llama.cpp log → "running" detection ────────────────────────────────────
# Fallback for when the /health poll times out under heavy GPU/disk load.
# "all slots are idle" is used exclusively — it fires from the slot-manager's
# update loop only after weights AND KV-cache/context are fully initialized,
# so it's the same readiness point the /health 200 response signals.
# ("model loaded" fires earlier, before slots are ready, and is too premature.)
_LLAMA_RUNNING_PATTERNS: tuple[str, ...] = (
    "all slots are idle",
)


# ─── vLLM log → state patterns (mirrors processManager.ts exactly) ───────────

# Each entry: (substring, target_state). Checked in order; first match wins.
_VLLM_LOG_PATTERNS: list[tuple[str, str]] = [
    ("Loading weights",            "vllm-shards"),
    ("loading weights",            "vllm-shards"),
    ("Loading model shards",       "vllm-shards"),
    ("Compiling",                  "vllm-compile"),
    ("torch.compile",              "vllm-compile"),
    ("Capturing cudagraphs",       "vllm-cudagraph"),
    ("Application startup complete", "running"),
    ("application startup complete", "running"),
]

# Used to enforce forward-only state progression
_VLLM_STATE_ORDER = ["starting", "vllm-shards", "vllm-compile", "vllm-cudagraph", "running"]


def _vllm_next_state(line: str, current: str) -> str:
    """Return the next vLLM state if a log line triggers a transition."""
    if current in ("stopped", "error", "running"):
        return current
    curr_idx = _VLLM_STATE_ORDER.index(current) if current in _VLLM_STATE_ORDER else 0
    for pattern, state in _VLLM_LOG_PATTERNS:
        if pattern in line:
            new_idx = _VLLM_STATE_ORDER.index(state) if state in _VLLM_STATE_ORDER else 0
            if new_idx > curr_idx:
                return state
    return current

MAX_LOG_LINES = 2000


@dataclass
class ServerEntry:
    instance_id: str
    title: str
    kind: str          # "llama" | "vllm"
    host: str
    port: int
    state: str         # "starting"|"loading"|"vllm-shards"|"vllm-compile"|"vllm-cudagraph"|"running"|"stopped"|"error"
    started_at: float
    argv: list
    env: dict
    display: str = ""      # friendly command (no WSL wrapper) for display
    profile_name: str = ""
    pid: int | None = None
    exit_code: int | None = None
    logs: list = field(default_factory=list)
    _proc: Any = field(default=None, repr=False, compare=False)

    def uptime_str(self) -> str:
        if self.state in ("stopped", "error"):
            return "stopped" if self.exit_code == 0 else "error"
        secs = int(time.time() - self.started_at)
        if secs < 60:
            return f"{secs}s"
        if secs < 3600:
            return f"{secs // 60}m {secs % 60}s"
        return f"{secs // 3600}h {(secs % 3600) // 60}m"


class ModelBoxApp(App):
    """Root Textual application. Holds the shared DB connection and server processes."""

    TITLE = "ModelBox"
    CSS = """
    App { background: #0d0d0d; }
    """

    def __init__(self) -> None:
        super().__init__()
        self.db: sqlite3.Connection | None = None
        self.servers: dict[str, ServerEntry] = {}
        self.ports_being_started: set[int] = set()
        self.tick: int = 0        # Flips every ~1.2s for state pulse animation

    def on_mount(self) -> None:
        db_path = get_db_path()
        if db_path.exists():
            self.db = DB.open_db(db_path)
            self._reset_stale_instances()
        from tui.screens import REPLScreen
        self.push_screen(REPLScreen())
        self.set_interval(1.2, self._increment_tick)

    def _reset_stale_instances(self) -> None:
        """Mark any DB-running instances as stopped on startup.

        These are left over from a previous session that exited without cleanup
        (e.g. Ctrl+Q, crash). They cause port numbers to increment on each launch
        because resolve_launch_port skips ports that appear running in the DB.
        """
        if not self.db:
            return
        try:
            for inst in DB.get_running_instances(self.db):
                DB.update_instance_state(self.db, inst["id"], "stopped")
        except Exception:
            pass

    def _increment_tick(self) -> None:
        self.tick = (self.tick + 1) % 2

    def on_unmount(self) -> None:
        for entry in self.servers.values():
            if entry._proc and entry._proc.poll() is None:
                try:
                    entry._proc.terminate()
                except Exception:
                    pass
            # Mark stopped in DB so the port isn't treated as occupied next session.
            if self.db and entry.instance_id:
                try:
                    DB.update_instance_state(self.db, entry.instance_id, "stopped")
                except Exception:
                    pass
        if self.db:
            self.db.close()
            self.db = None

    # ── Server lifecycle ──────────────────────────────────────────────────────

    def launch_server(
        self,
        argv: list[str],
        env: dict,
        *,
        instance_id: str,
        title: str,
        kind: str,
        host: str,
        port: int,
        display: str = "",
        profile_name: str = "",
    ) -> None:
        """Spawn the server in a daemon thread. Logs accumulate in servers[id].logs."""
        entry = ServerEntry(
            instance_id=instance_id,
            title=title,
            kind=kind,
            host=host,
            port=port,
            state="starting",
            started_at=time.time(),
            argv=list(argv),
            env=dict(env),
            display=display,
            profile_name=profile_name,
        )
        self.servers[instance_id] = entry
        conn = self.db

        def _set_state(state: str) -> None:
            """Thread-safe state update (GIL covers simple attribute write)."""
            entry.state = state
            if conn:
                try:
                    DB.update_instance_state(conn, instance_id, state)
                except Exception:
                    pass

        def _poll_health() -> None:
            """Poll /health until running or the process exits.
            Mirrors healthPoller.ts: 503 → loading (llama only), 200 → running.
            timeout=30 matches TS healthPoller default timeoutMs=30000; the 2 s
            value caused false timeouts when the OS was under heavy GPU load."""
            check_host = "127.0.0.1" if host in ("0.0.0.0", "") else host
            url        = f"http://{check_host}:{port}/health"
            healthy_fired = False
            while not healthy_fired and entry.state not in ("running", "stopped", "error"):
                time.sleep(2.0)
                if entry.state in ("running", "stopped", "error"):
                    break
                try:
                    with urllib.request.urlopen(url, timeout=30) as r:
                        if r.status == 200:
                            healthy_fired = True
                            _set_state("running")
                except urllib.error.HTTPError as exc:
                    if exc.code == 503 and kind == "llama":
                        if entry.state not in ("running", "stopped", "error"):
                            _set_state("loading")
                except Exception:
                    # Connection refused / timeout — process not yet listening
                    if kind == "llama" and entry.state not in ("running", "stopped", "error"):
                        _set_state("loading")

        def _run() -> None:
            try:
                proc = subprocess.Popen(
                    argv,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    bufsize=1,
                )
                entry._proc = proc
                entry.pid   = proc.pid
                # State stays "starting" — health poller and log scanner advance it.

                # Health poller handles both llama (loading → running) and vLLM
                # (only running, since vLLM uses log scanning for intermediate states).
                ht = threading.Thread(
                    target=_poll_health, daemon=True, name=f"hp-{instance_id[:8]}"
                )
                ht.start()

                for raw in proc.stdout:
                    line = raw.rstrip()
                    entry.logs.append(line)
                    if len(entry.logs) > MAX_LOG_LINES:
                        del entry.logs[: len(entry.logs) - MAX_LOG_LINES]

                    # vLLM intermediate states driven by log content
                    if kind == "vllm":
                        new_state = _vllm_next_state(line, entry.state)
                        if new_state != entry.state:
                            _set_state(new_state)
                    # llama.cpp: detect "model loaded" from logs as a fallback
                    # for when the /health poll times out under heavy GPU load.
                    elif kind == "llama" and entry.state in ("starting", "loading"):
                        for _pat in _LLAMA_RUNNING_PATTERNS:
                            if _pat in line:
                                _set_state("running")
                                break

                rc = proc.wait()
                entry.exit_code = rc
                _set_state("stopped" if rc == 0 else "error")
                entry.logs.append(f"[dim]Process exited (code {rc})[/dim]")

            except FileNotFoundError:
                _set_state("error")
                entry.logs.append(f"[red]Executable not found: {argv[0]}[/red]")
            except Exception as exc:
                _set_state("error")
                entry.logs.append(f"[red]Error: {exc}[/red]")

        t = threading.Thread(target=_run, daemon=True, name=f"srv-{instance_id[:8]}")
        t.start()

    def stop_server(self, instance_id: str) -> None:
        entry = self.servers.get(instance_id)
        if entry and entry._proc and entry._proc.poll() is None:
            try:
                entry._proc.terminate()
            except Exception:
                pass

    def do_launch(
        self,
        argv: list[str],
        env: dict,
        *,
        display: str,
        title: str,
        kind: str,
        host: str,
        port: int,
        model: dict,
        profile: dict,
    ) -> None:
        """Called from ServerLaunchModal. Inserts DB record, starts process, navigates."""
        # Alias/servedModelName live inside profile["config"], not at the top level
        _cfg = profile.get("config") or {}
        if kind == "llama" and _cfg.get("alias"):
            title = str(_cfg["alias"])
        elif kind == "vllm" and _cfg.get("servedModelName"):
            title = str(_cfg["servedModelName"])

        # Reserve the port so concurrent launches can't collide (mirrors GUI portsBeingStarted).
        # Port was already reserved in ServerLaunchModal._build_preview; re-add in case the
        # set was cleared (e.g. app restart) and release after the process is spawned.
        self.ports_being_started.add(port)

        try:
            conn = self.db
            if conn:
                try:
                    iid = DB.insert_server_instance(
                        conn, kind,
                        model.get("id") if kind == "llama" else None,
                        profile.get("id") if kind == "llama" else None,
                        model.get("id") if kind == "vllm"  else None,
                        profile.get("id") if kind == "vllm"  else None,
                        host, port, 0,
                    )
                except Exception:
                    iid = str(uuid.uuid4())
            else:
                iid = str(uuid.uuid4())

            self.launch_server(
                argv, env,
                instance_id=iid,
                title=title,
                kind=kind,
                host=host,
                port=port,
                display=display,
                profile_name=profile.get("name", ""),
            )
            # Defer navigation so the current event finishes processing first
            self.call_later(self._open_log_viewer, iid, title)
        finally:
            self.ports_being_started.discard(port)

    def _open_log_viewer(self, instance_id: str, title: str) -> None:
        # Just push the viewer — action_go_back() handles the clean-up pop
        from tui.modals import ServerOutputScreen
        self.push_screen(ServerOutputScreen(instance_id=instance_id, title=title))
