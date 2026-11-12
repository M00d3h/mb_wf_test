"""Main screens: REPLScreen and ChatScreen."""

from __future__ import annotations

import re
import time
from typing import Any

from rich.padding import Padding as RichPadding
from rich.style import Style
from rich.syntax import Syntax as RichSyntax
from rich.text import Text
from textual import events, on, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import Input, RichLog, Static

from tui import db as DB
from tui.config import (
    ASCII_LOGO, COMMANDS, MB_END_COLOR, MB_START_COLOR, MB_UNSEL_COLOR, lerp_color,
    LLAMA_TAG_COLOR, VLLM_TAG_COLOR, VLLM_TAG_ACCENT,
    STATE_LABELS, ACTIVE_STATES, get_state_markup,
)
from tui.markdown import render_markdown
from tui.model_status_bar import ModelStatusBar
from tui.transport import ChatMessage, OpenAICompatTransport, LlamaCppNativeTransport, resolve_transport


# ─── Gradient banner ──────────────────────────────────────────────────────────

def _make_banner() -> Text:
    result = Text(no_wrap=True, overflow="fold")
    lines  = ASCII_LOGO.split("\n")
    n = len(lines)
    for i, line in enumerate(lines):
        t = i / max(n - 1, 1)
        color = lerp_color(MB_START_COLOR, MB_END_COLOR, t)
        result.append(line, style=f"bold {color}")
        if i < n - 1:
            result.append("\n")
    return result


# ─── REPL screen ──────────────────────────────────────────────────────────────

class REPLScreen(Screen):
    """Main screen: gradient banner, server panel, metrics, and command input."""

    BINDINGS = [
        Binding("ctrl+h", "open_chats",   "New chat",    priority=True),
        Binding("ctrl+f", "expand_logs",  "Server logs"),
        Binding("ctrl+c", "use_claude_code", "Claude Code"),
        Binding("ctrl+q", "app.quit",     "Quit"),
    ]

    DEFAULT_CSS = """
    REPLScreen {
        layout: vertical;
        background: $surface;
    }
    REPLScreen #banner {
        height: auto;
        padding: 1 2;
    }
    REPLScreen #subtitle {
        height: 1;
        color: $text-muted;
        padding: 0 2;
        margin-bottom: 1;
    }
    REPLScreen #server-panel {
        display: none;
        border: round rgb(0,150,152);
        margin: 0 1;
        padding: 0 1;
        height: auto;
        max-height: 10;
    }
    REPLScreen #server-panel.has-servers {
        display: block;
    }
    REPLScreen #metrics-panel {
        border: round rgb(60,60,60);
        margin: 0 1;
        padding: 0 1;
        height: auto;
        max-height: 10;
    }
    REPLScreen #completions {
        height: auto;
        margin: 0 0;
        padding: 0 0;
        display: none;
    }
    REPLScreen #completions.visible {
        display: block;
    }
    REPLScreen #input-row {
        height: 3;
        margin: 0 1;
    }
    REPLScreen #cmd-input {
        width: 1fr;
        border: round cyan;
    }
    """

    _COMP_MAX_VISIBLE = 6

    def __init__(self) -> None:
        super().__init__()
        # Each candidate is (cmd_key, description)
        self._comp_candidates: list[tuple[str, str]] = []
        self._comp_idx: int = 0

    def compose(self) -> ComposeResult:
        yield Static(_make_banner(), id="banner")
        yield Static(
            "[dim]Local AI Terminal  ·  Type [bold cyan]/help[/bold cyan] to get started[/dim]",
            id="subtitle", markup=True,
        )
        yield Static("", id="server-panel", markup=True)
        yield Static("", id="metrics-panel", markup=True)
        yield Static("", id="completions", markup=True)
        yield Input(placeholder="> type a command…", id="cmd-input")

    def on_mount(self) -> None:
        self.query_one("#cmd-input", Input).focus()
        self.set_interval(1.0, self._refresh_server_panel)
        self._refresh_metrics_bg()
        self.set_interval(2.0, self._refresh_metrics_bg)

    # ── input handling ────────────────────────────────────────────────────────

    @on(Input.Changed, "#cmd-input")
    def _input_changed(self, event: Input.Changed) -> None:
        text = event.value
        if text.startswith("/"):
            word = text[1:].split()[0] if text[1:] else ""
            # Store (key, description) — markup is built at render time
            self._comp_candidates = [
                (k, v)
                for k, v in COMMANDS.items()
                if k.startswith(word) or word in k
            ]
            # Exact full match → no dropdown needed
            if len(self._comp_candidates) == 1 and self._comp_candidates[0][0] == word:
                self._hide_completions()
            else:
                self._comp_idx = 0
                self._render_completions()
        else:
            self._hide_completions()

    def _render_completions(self) -> None:
        comp = self.query_one("#completions", Static)
        if not self._comp_candidates:
            comp.update("")
            comp.remove_class("visible")
            return

        total       = len(self._comp_candidates)
        sel         = self._comp_idx
        max_display = min(self._COMP_MAX_VISIBLE, total)

        # Scroll so the selected item stays visible (original logic)
        scroll = 0
        if sel >= max_display:
            scroll = sel - max_display + 1
        scroll = min(scroll, total - max_display)
        scroll = max(0, scroll)

        visible = self._comp_candidates[scroll : scroll + max_display]

        # Align all names to the same column width (mirrors max_name_len in original)
        name_col = max((len(k) + 1 for k, _ in self._comp_candidates), default=8)
        name_col = max(name_col, 16)

        indent = "    "
        lines: list[str] = []

        r, g, b = MB_UNSEL_COLOR
        unsel = f"rgb({r},{g},{b})"

        for i, (key, desc) in enumerate(visible):
            actual = scroll + i
            name   = f"/{key}".ljust(name_col)
            if actual == sel:
                lines.append(f"{indent}[bold cyan]{name}  {desc}[/bold cyan]")
            else:
                lines.append(f"{indent}[{unsel}]{name}  {desc}[/{unsel}]")

        # Footer: arrows + counter on their own line (exact original layout)
        can_up   = sel > 0
        can_down = sel < total - 1
        if can_up and can_down:
            arrow = "▲▼"
        elif can_up:
            arrow = "▲"
        elif can_down:
            arrow = "▼"
        else:
            arrow = ""

        counter = f"({sel + 1}/{total})"
        if arrow:
            lines.append(f"{indent}[cyan]{arrow}[/cyan] [dim]{counter}[/dim]")
        else:
            lines.append(f"{indent}[dim]{counter}[/dim]")

        comp.update("\n".join(lines))
        comp.add_class("visible")

    def _hide_completions(self) -> None:
        comp = self.query_one("#completions", Static)
        comp.update("")
        comp.remove_class("visible")
        self._comp_candidates = []
        self._comp_idx = 0

    def on_key(self, event) -> None:
        if not self._comp_candidates:
            if event.key == "escape":
                self._hide_completions()
            return

        if event.key in ("tab", "down"):
            self._comp_idx = (self._comp_idx + 1) % len(self._comp_candidates)
            self._render_completions()
            event.prevent_default()
        elif event.key == "up":
            self._comp_idx = (self._comp_idx - 1) % len(self._comp_candidates)
            self._render_completions()
            event.prevent_default()
        elif event.key == "escape":
            self._hide_completions()

    @on(Input.Submitted, "#cmd-input")
    async def _submitted(self, event: Input.Submitted) -> None:
        raw = event.value.strip()
        self.query_one("#cmd-input", Input).value = ""

        if not raw.startswith("/"):
            self._hide_completions()
            if raw:
                self.app.notify("Commands start with / - try /help", severity="warning")
            return

        word = raw[1:].split()[0].lower() if raw[1:] else ""

        # Resolve: exact match > highlighted completion > first completion
        if word in COMMANDS:
            cmd = word
        elif self._comp_candidates:
            cmd = self._comp_candidates[self._comp_idx][0]
        else:
            self._hide_completions()
            self.app.notify(f"Unknown command: {raw} - try /help", severity="warning")
            return

        self._hide_completions()
        args = raw[1 + len(word):].strip() if word in COMMANDS else ""
        await self._dispatch(cmd, args)

    async def _dispatch(self, cmd: str, args: str) -> None:
        if cmd == "help":
            from tui.modals import HelpModal
            await self.app.push_screen(HelpModal())
        elif cmd in ("exit", "exit (quit)"):
            self.app.exit()
        elif cmd == "models":
            from tui.modals import ModelListModal
            await self.app.push_screen(ModelListModal())
        elif cmd == "download":
            from tui.modals import DownloadFlowModal
            await self.app.push_screen(DownloadFlowModal())
        elif cmd == "settings":
            from tui.modals import SettingsModal
            await self.app.push_screen(SettingsModal())
        elif cmd == "configure":
            from tui.modals import ModelListModal
            await self.app.push_screen(ModelListModal(mode="configure"))
        elif cmd == "serve":
            from tui.modals import ModelListModal
            await self.app.push_screen(ModelListModal(mode="serve"))
        elif cmd == "chat":
            self.action_open_chats()
        elif cmd == "resume":
            self.action_resume_chats()
        else:
            self.app.notify(f"Unknown command: /{cmd} - try /help", severity="warning")
    # ── Server panel ──────────────────────────────────────────────────────────

    def _refresh_server_panel(self) -> None:
        panel = self.query_one("#server-panel", Static)
        servers = list(self.app.servers.values())
        if not servers:
            panel.remove_class("has-servers")
            return

        # Size columns to actual content so short names don't leave huge gaps.
        # "llamacpp" = 8 chars → " llamacpp " = 10 visible; prefix = 1+10+1 = 12.
        name_w = max(max(len(e.title) for e in servers), len("Model"))
        name_w = min(name_w, 40)
        prof_w = max(max(len(e.profile_name or "—") for e in servers), len("Profile"))
        prof_w = min(prof_w, 24)

        # " llamacpp " = 10 visible; "vLLM" = 4 → pad 6 trailing spaces to match
        _TAG = {
            "llama": f"[bold {LLAMA_TAG_COLOR}] llamacpp [/bold {LLAMA_TAG_COLOR}]",
            "vllm":  f" [bold {VLLM_TAG_COLOR}]v[/bold {VLLM_TAG_COLOR}][bold {VLLM_TAG_ACCENT}]LLM[/bold {VLLM_TAG_ACCENT}]     ",
        }

        S = "   "   # 3-space separator between all columns
        # 1(row prefix) + 10(" llamacpp ") + 1(space before name) = 12 chars before Model
        hdr = (
            f" [dim]{'Runtime':<10} {'Model':<{name_w}}{S}{'Profile':<{prof_w}}{S}"
            f"{'Host:Port':<18}{S}{'PID':<7}{S}{'Uptime':<9}{S}State[/dim]"
        )
        lines: list[str] = [hdr]

        for e in servers:
            tag   = _TAG.get(e.kind, e.kind)

            name_raw = e.title[:name_w]
            prof_raw = (e.profile_name or "—")[:prof_w]
            ep_raw   = f"{e.host}:{e.port}"[:18]
            pid_raw  = str(e.pid or "—")[:7]
            upt_raw  = e.uptime_str()[:9]

            # Trailing padding kept OUTSIDE markup so Rich measures widths correctly
            np = " " * (name_w - len(name_raw))
            pp = " " * (prof_w - len(prof_raw))
            ep = " " * (18 - len(ep_raw))
            dp = " " * (7  - len(pid_raw))
            up = " " * (9  - len(upt_raw))

            lines.append(
                f"{tag}  [bold]{name_raw}[/bold]{np}{S}"
                f"[dim]{prof_raw}[/dim]{pp}{S}"
                f"[dim]{ep_raw}[/dim]{ep}{S}"
                f"[dim]{pid_raw}[/dim]{dp}{S}"
                f"[dim]{upt_raw}[/dim]{up}{S}"
                f"{get_state_markup(e.state, self.app.tick)}"
            )

        has_running = any(e.state in ACTIVE_STATES for e in servers)
        if has_running:
            lines.append("")
            lines.append(" [dim cyan]Ctrl+F expand logs   Ctrl+C Claude Code[/dim cyan]")

        panel.update("\n".join(lines))
        panel.add_class("has-servers")

    @work(thread=True)
    def _refresh_metrics_bg(self) -> None:
        from tui import sysmetrics
        stats = sysmetrics.get_system_stats()
        text  = sysmetrics.render_metrics(stats)
        self.app.call_from_thread(self.query_one("#metrics-panel", Static).update, text)

    def action_expand_logs(self) -> None:
        from tui.modals import ServerOutputScreen
        servers = list(self.app.servers.values())
        if not servers:
            return
        if len(servers) == 1:
            target = servers[0]
            self.app.push_screen(
                ServerOutputScreen(instance_id=target.instance_id, title=target.title)
            )
        else:
            from tui.modals import PickModal
            items = [f"{e.title}  [{STATE_LABELS.get(e.state, e.state)}]  :{e.port}" for e in servers]
            def _on_pick(idx: int | None) -> None:
                if idx is None:
                    return
                t = servers[idx]
                self.app.push_screen(
                    ServerOutputScreen(instance_id=t.instance_id, title=t.title)
                )
            self.app.push_screen(PickModal("Select server", items), callback=_on_pick)

    def action_use_claude_code(self) -> None:
        servers = list(self.app.servers.values())
        running = [e for e in servers if e.state in ACTIVE_STATES]
        if not running:
            self.app.notify("No running server.", severity="warning")
            return
        if len(running) == 1:
            self._do_claude_code(running[0])
        else:
            from tui.modals import PickModal
            items = [f"{e.title}  [{STATE_LABELS.get(e.state, e.state)}]  :{e.port}" for e in running]
            def _on_pick(idx: int | None) -> None:
                if idx is None:
                    return
                self._do_claude_code(running[idx])
            self.app.push_screen(PickModal("Select server for Claude Code", items), callback=_on_pick)

    def _do_claude_code(self, entry) -> None:
        from tui.modals import _copy_to_clipboard, _get_api_key, _build_claude_code_commands
        profile_id = None
        conn = self.app.db
        if conn:
            try:
                row = conn.execute(
                    "SELECT profile_id, vllm_profile_id FROM server_instances WHERE id = ?",
                    (entry.instance_id,),
                ).fetchone()
                if row:
                    profile_id = row["profile_id"] or row["vllm_profile_id"]
            except Exception:
                pass
        api_key = _get_api_key(profile_id)
        commands = _build_claude_code_commands(entry.host, entry.port, api_key, entry.title)
        if _copy_to_clipboard(commands):
            msg = "Copied Claude Code commands to clipboard — paste into your terminal."
            if not api_key:
                msg += " (No API key set — the token field is empty.)"
            self.app.notify(msg, severity="information")
        else:
            self.app.notify("Could not copy to clipboard.", severity="error")

    def action_open_chats(self) -> None:
        """Open a new chat immediately — AI generates the title after the first message."""
        conn = self.app.db
        if conn is None:
            self.app.notify("No database connection.", severity="error")
            return
        instance = DB.get_any_running_instance(conn)
        if instance is None:
            self.app.notify("No running server — use /serve first.", severity="warning")
            return
        host = instance.get("host") or "127.0.0.1"
        port = int(instance.get("port") or 8080)
        cid = DB.create_conversation(conn, "New conversation", host, port)
        conv = {"id": cid, "title": "New conversation", "instance_host": host, "instance_port": port}
        self.app.push_screen(ChatScreen(conv))

    def action_resume_chats(self) -> None:
        """Pick an existing conversation to resume."""
        from tui.modals import ConversationListModal
        def _on_conv(conv: dict | None) -> None:
            if conv:
                self.app.push_screen(ChatScreen(conv))
        self.app.push_screen(ConversationListModal(), callback=_on_conv)


# ─── Chat screen ──────────────────────────────────────────────────────────────

class ChatScreen(Screen):
    """Full-screen chat view for a conversation."""

    BINDINGS = [
        Binding("escape",  "go_back",    "Back"),
        Binding("ctrl+h",  "pick_chat",  "Switch chat"),
        Binding("ctrl+x",  "clear_chat", "Clear chat"),
        Binding("ctrl+q",  "app.quit",   "Quit"),
    ]

    DEFAULT_CSS = """
    ChatScreen {
        layout: vertical;
        background: $surface;
    }
    ChatScreen #chat-header {
        height: 1;
        background: cyan;
        color: black;
        text-style: bold;
        padding: 0 1;
    }
    ChatScreen #chat-log {
        height: 1fr;
        border: round cyan;
        margin: 0 1;
        scrollbar-gutter: stable;
    }
    ChatScreen #model-status {
        height: 1;
        margin: 0 1;
    }
    ChatScreen #chat-input {
        height: 3;
        margin: 0 1;
        border: round cyan;
    }
    ChatScreen #chat-footer {
        height: 1;
        color: $text-muted;
        padding: 0 1;
    }
    """

    def __init__(self, conversation: dict | None = None) -> None:
        super().__init__()
        self._conv = conversation
        self._messages: list[ChatMessage] = []
        self._streaming = False
        # Streaming status indicator (○ blinking while active, ● cyan when done)
        self._status_active     = False  # tick animates while True
        self._status_blink_on   = False  # True=● False=○
        self._status_phase      = "idle" # "processing"|"thinking"|"generating"|"idle"
        self._streaming_content = ""     # current content_buf; tick reads this for generating redraws
        # Thinking text animation
        self._think_dot_phase = 0
        self._thinking_preview = ""
        self._streaming_think_state = ""
        # Think block expand/collapse — set of message indices currently expanded
        self._think_expanded: set[int] = set()
        # Maps message index → estimated document line of its think-header (for click detection)
        self._think_header_lines: dict[int, int] = {}
        # Title generation
        self._title_worker = None        # active Worker from _generate_title, or None

    def compose(self) -> ComposeResult:
        title = self._conv.get("title", "Chat") if self._conv else "Chat"
        yield Static(
            f" {title}  ·  Esc back  ·  Ctrl+H switch  ·  Ctrl+X clear",
            id="chat-header",
        )
        yield RichLog(
            id="chat-log", markup=True, highlight=False,
            auto_scroll=True, wrap=True,
        )
        yield ModelStatusBar(id="model-status")
        yield Input(placeholder="> send a message…", id="chat-input")
        yield Static(
            "[dim]Enter send  ·  Ctrl+H switch conversation  ·  Ctrl+X clear[/dim]",
            id="chat-footer", markup=True,
        )

    def on_mount(self) -> None:
        self._load_history()
        self.query_one("#chat-input", Input).focus()
        self.set_interval(0.4, self._tick_status)
        self._refresh_model_status()

    @work(exclusive=True, group="model-status-probe")
    async def _refresh_model_status(self) -> None:
        """Probe /v1/models and update the status bar; retries every 5 s until
        the server returns a real model name (not the 'local' fallback)."""
        import asyncio
        host = (self._conv.get("instance_host") or "127.0.0.1") if self._conv else "127.0.0.1"
        port = int(self._conv.get("instance_port") or 8080) if self._conv else 8080
        for _ in range(12):  # up to ~60 s of retries (12 × 5 s)
            transport = await resolve_transport(host, port)
            bar = self.query_one("#model-status", ModelStatusBar)
            bar.set_model(transport.model_name)
            bar.set_context_window(transport.context_window)
            if transport.model_name != "local":
                return  # resolved — stop retrying
            await asyncio.sleep(5.0)

    def _tick_status(self) -> None:
        """Toggle ○/● and redraw every 0.4 s across all active phases."""
        if not self._status_active:
            return
        self._status_blink_on = not self._status_blink_on
        if self._status_phase == "thinking":
            self._think_dot_phase = (self._think_dot_phase + 1) % 3
            dots = "·" * (self._think_dot_phase + 1)
            raw_lines = [ln for ln in self._thinking_preview.split("\n") if ln.strip()]
            preview = raw_lines[-1][-80:] if raw_lines else ""
            self._streaming_think_state = (
                f"[bold]🧠 Thinking{dots}[/bold]\n[bold #FF69B4]{preview}[/bold #FF69B4]"
                if preview else
                f"[bold]🧠 Thinking{dots}[/bold]"
            )
        log = self.query_one("#chat-log", RichLog)
        log.clear()
        self._rerender_history(log)
        self._write_streaming_state(log, self._streaming_content)

    def _write_streaming_state(self, log: RichLog, content: str = "") -> None:
        """Write circle + think state inline, then streaming content below."""
        circle = "●" if self._status_blink_on else "○"
        if self._streaming_think_state:
            log.write(Text.from_markup(
                f"[dim]{circle}[/dim]  {self._streaming_think_state}"
            ))
        else:
            log.write(Text.from_markup(f"[dim]{circle}[/dim]"))
        for r in render_markdown(content):
            log.write(r)

    def _load_history(self) -> None:
        if self._conv is None:
            return
        conn = self.app.db
        if conn is None:
            return
        log = self.query_one("#chat-log", RichLog)
        msgs = DB.get_messages(conn, self._conv["id"])
        for m in msgs:
            role    = m["role"]
            content = m["content"]
            think_state = ""
            if role == "assistant" and m.get("think_duration_ms"):
                think_state = f"💭 Thought for {m['think_duration_ms'] / 1000:.1f} seconds"
            if role == "user":
                log.write(Text("❯  " + content, style="bold cyan"))
                log.write("")
            elif role == "assistant":
                header = Text()
                header.append("●", style="cyan")
                if think_state:
                    header.append("  " + think_state, style="dim")
                log.write(header)
                for r in render_markdown(content):
                    log.write(r)
                log.write("")
            self._messages.append(ChatMessage(role=role, content=content, think_state=think_state))

    @on(Input.Submitted, "#chat-input")
    async def _send(self, event: Input.Submitted) -> None:
        if self._streaming:
            return
        text = event.value.strip()
        if not text:
            return
        self.query_one("#chat-input", Input).value = ""
        await self._send_message(text)

    async def _send_message(self, text: str) -> None:
        # Abort any in-flight title generation so it frees the server slot
        if self._title_worker is not None:
            self._title_worker.cancel()
            self._title_worker = None

        log = self.query_one("#chat-log", RichLog)

        log.write(Text("❯  " + text, style="bold cyan"))
        log.write("")

        # Persist user message
        if self._conv:
            conn = self.app.db
            if conn:
                DB.add_message(conn, self._conv["id"], "user", text)

        self._messages.append(ChatMessage(role="user", content=text))
        self._streaming = True

        # Resolve endpoint — stored host:port from conversation, or any running instance
        host = "127.0.0.1"
        port = 8080
        if self._conv:
            host = self._conv.get("instance_host") or "127.0.0.1"
            port = int(self._conv.get("instance_port") or 8080)
        else:
            conn = self.app.db
            if conn:
                inst = DB.get_any_running_instance(conn)
                if inst:
                    host = inst.get("host") or "127.0.0.1"
                    port = int(inst.get("port") or 8080)

        self._stream_response(host, port)

    @work(exclusive=True)
    async def _stream_response(self, host: str, port: int) -> None:
        log = self.query_one("#chat-log", RichLog)
        bar = self.query_one("#model-status", ModelStatusBar)

        content_buf:       str   = ""
        thinking_buf:      str   = ""
        captured_thinking: str   = ""
        in_think:          bool  = False
        think_started_at:  float | None = None
        think_duration_ms: int   | None = None
        final_think_state: str   = ""   # plain text only — saved to ChatMessage
        gen_started_at:    float | None = None
        prompt_tokens:     int   | None = None
        completion_tokens: int   | None = None
        stream_error:      str   = ""

        # Reset per-response state
        self._status_active     = True
        self._status_blink_on   = False   # start with ○ (waiting)
        self._status_phase      = "processing"
        self._streaming_content = ""
        self._think_dot_phase   = 0
        self._thinking_preview  = ""
        self._streaming_think_state = ""

        # Resolve transport (probe /v1/models, cache result) — mirrors resolveTransport() in TS
        transport = await resolve_transport(host, port)
        # Refresh the status bar with the real model name; the on_mount probe may
        # have timed out (especially for large models still warming up) and left
        # the bar showing "local".  Here we have a freshly-resolved transport.
        bar.set_model(transport.model_name)
        bar.set_context_window(transport.context_window)

        # Draw processing indicator while waiting for first token
        log.clear()
        self._rerender_history(log)
        self._write_streaming_state(log)

        async for chunk in transport.stream(self._messages):
            if chunk.error:
                stream_error = chunk.error
                break
            if chunk.done:
                break

            # Capture usage stats (every chunk with continuous_usage_stats)
            if chunk.prompt_tokens is not None:
                prompt_tokens = chunk.prompt_tokens
            if chunk.completion_tokens is not None:
                completion_tokens = chunk.completion_tokens

            token = chunk.token
            if not token:
                continue

            # ── <think> / </think> markers: render state inside the log ────────
            if token == "<think>":
                in_think = True
                self._status_phase     = "thinking"
                self._thinking_preview = ""
                self._streaming_think_state = "[bold]🧠 Thinking·[/bold]"
                self._think_dot_phase  = 0
                think_started_at = time.monotonic()
                # Draw immediately so thinking is visible even for sub-tick durations
                log.clear()
                self._rerender_history(log)
                self._write_streaming_state(log)
                continue

            if token == "</think>":
                in_think = False
                self._status_phase = "generating"
                if think_started_at is not None:
                    think_duration_ms = int((time.monotonic() - think_started_at) * 1000)
                    final_think_state = f"💭 Thought for {think_duration_ms / 1000:.1f} seconds"
                    self._streaming_think_state = final_think_state
                else:
                    self._streaming_think_state = ""
                captured_thinking = thinking_buf
                thinking_buf = ""
                gen_started_at = time.monotonic()
                continue

            if in_think:
                thinking_buf += token
                self._thinking_preview = thinking_buf
                continue

            # ── Content token ────────────────────────────────────────────────
            if gen_started_at is None:
                gen_started_at = time.monotonic()
                self._status_phase = "generating"

            content_buf += token
            self._streaming_content = content_buf

            if completion_tokens and gen_started_at:
                elapsed = time.monotonic() - gen_started_at
                if elapsed > 0:
                    tps = completion_tokens / elapsed
                    bar.set_tokens(prompt_tokens or 0, tps)

            log.clear()
            self._rerender_history(log)
            self._write_streaming_state(log, content_buf)

        # ── Finalize ──────────────────────────────────────────────────────────
        self._status_active = False
        self._status_phase  = "idle"
        if content_buf:
            self._messages.append(ChatMessage(
                role="assistant",
                content=content_buf,
                think_state=final_think_state,
                think_content=captured_thinking,
            ))
        # Redraw so the dim streaming ○/● is replaced by the static cyan ● from history
        log.clear()
        self._rerender_history(log)
        if stream_error:
            log.write(Text.from_markup(f"[red]Error: {stream_error}[/red]"))

        # Compute final tokens/sec from generation phase
        tps: float | None = None
        if completion_tokens and gen_started_at:
            elapsed = time.monotonic() - gen_started_at
            if elapsed > 0:
                tps = completion_tokens / elapsed

        if self._conv:
            conn = self.app.db
            if conn and content_buf:
                DB.add_message(
                    conn,
                    self._conv["id"],
                    "assistant",
                    content_buf,
                    tokens_per_second=tps,
                    token_count=completion_tokens,
                    think_duration_ms=think_duration_ms,
                    context_tokens=prompt_tokens,
                )
                # Trigger AI title gen whenever the title is still the placeholder.
                # Mirrors the GUI: retried after each response until it succeeds,
                # and cancelled if the user sends another message first.
                if self._conv.get("title", "") in ("New conversation", ""):
                    first_user = next(
                        (m.content for m in self._messages if m.role == "user"), ""
                    )
                    if first_user:
                        self._title_worker = self._generate_title(
                            transport, first_user, self._conv["id"]
                        )

        bar.set_tokens(prompt_tokens or 0, 0.0)

        log.write("")
        self._streaming = False

    @work
    async def _generate_title(
        self,
        transport: OpenAICompatTransport | LlamaCppNativeTransport,
        first_user_msg: str,
        conv_id: str,
    ) -> None:
        """Generate a short conversation title via the model — matches generateTitle() in chatStore.ts."""
        title_messages = [
            ChatMessage(
                role="system",
                content="Generate a short title (3-6 words) for this chat. Reply with ONLY the title — no quotes, no punctuation at the end.",
            ),
            ChatMessage(role="user", content=first_user_msg),
        ]
        raw = ""
        async for chunk in transport.stream(title_messages, no_thinking=True):
            if chunk.error or chunk.done:
                break
            if chunk.token and chunk.token not in ("<think>", "</think>"):
                raw += chunk.token

        # Strip any stray <think>...</think> blocks and trim punctuation (mirrors GUI)
        cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.IGNORECASE).strip()
        title = cleaned.strip("\"'*").strip()[:60]
        if not title:
            return

        conn = self.app.db
        if conn:
            DB.update_conversation_title(conn, conv_id, title)
        if self._conv and self._conv.get("id") == conv_id:
            self._conv["title"] = title
            self.query_one("#chat-header", Static).update(
                f" {title}  ·  Esc back  ·  Ctrl+H switch  ·  Ctrl+X clear"
            )

    def _rerender_history(self, log: RichLog) -> None:
        self._think_header_lines.clear()
        # Estimate content width for wrap counting (border + scrollbar ≈ 4 cols)
        content_w = max(40, (log.size.width or 80) - 4)
        line_num = 0
        for i, m in enumerate(self._messages):
            if m.role == "user":
                text = "❯  " + m.content
                log.write(Text(text, style="bold cyan"))
                line_num += max(1, (len(text) + content_w - 1) // content_w)
                log.write("")
                line_num += 1
            elif m.role == "assistant":
                header = Text()
                header.append("●", style="cyan")
                if m.think_state:
                    if m.think_content:
                        self._think_header_lines[i] = line_num
                        arrow = "▼" if i in self._think_expanded else "▶"
                        header.append(
                            f"  {m.think_state} {arrow}",
                            style=Style(color="#6c7086"),
                        )
                    else:
                        header.append(f"  {m.think_state}", style="dim")
                log.write(header)
                line_num += 1
                if i in self._think_expanded and m.think_content:
                    log.write(Text("  ┄ thinking ┄", style=Style(color="#FF69B4", dim=True)))
                    line_num += 1
                    for line in m.think_content.strip().split("\n"):
                        log.write(Text("  " + line, style=Style(color="#FF69B4", dim=True)))
                        line_num += max(1, (len(line) + 2 + content_w - 1) // content_w)
                    log.write(Text("  ┄──────────", style=Style(color="#FF69B4", dim=True)))
                    line_num += 1
                    log.write("")
                    line_num += 1
                for r in render_markdown(m.content):
                    log.write(r)
                    inner = r.renderable if isinstance(r, RichPadding) else r
                    if isinstance(inner, RichSyntax):
                        line_num += inner.code.count("\n") + 1
                    else:
                        line_num += 1
                log.write("")
                line_num += 1

    @on(events.Click, "#chat-log")
    def _on_chat_log_click(self, event: events.Click) -> None:
        if not self._think_header_lines:
            return
        log = self.query_one("#chat-log", RichLog)
        clicked_line = int(log.scroll_y) + event.y
        for msg_idx, header_line in self._think_header_lines.items():
            if abs(clicked_line - header_line) <= 1:
                self.action_toggle_think(str(msg_idx))
                event.stop()
                return

    def action_toggle_think(self, idx: str) -> None:
        i = int(idx)
        log = self.query_one("#chat-log", RichLog)
        old_scroll = log.scroll_y
        if i in self._think_expanded:
            self._think_expanded.discard(i)
        else:
            self._think_expanded.add(i)
        log.clear()
        self._rerender_history(log)
        log.scroll_to(y=old_scroll, animate=False)

    def action_go_back(self) -> None:
        self.app.pop_screen()

    def action_pick_chat(self) -> None:
        from tui.modals import ConversationListModal
        def _on_conv(conv: dict | None) -> None:
            if conv:
                self._conv          = conv
                self._messages      = []
                self._think_expanded.clear()
                self._think_header_lines.clear()
                log = self.query_one("#chat-log", RichLog)
                log.clear()
                self.query_one("#chat-header", Static).update(
                    f" {conv.get('title','Chat')}  ·  Esc back  ·  Ctrl+H switch  ·  Ctrl+X clear"
                )
                self._load_history()
        self.app.push_screen(ConversationListModal(), callback=_on_conv)

    def action_clear_chat(self) -> None:
        self._messages = []
        self._think_expanded.clear()
        self._think_header_lines.clear()
        self.query_one("#chat-log", RichLog).clear()
