"""All modal screens: model list, profile list, param editor, conversation picker."""

from __future__ import annotations

import os
import platform
import subprocess
from pathlib import Path
from typing import Any

from textual import on, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, ScrollableContainer
from textual.screen import ModalScreen
from textual.widgets import Button, Input, Label, ListItem, ListView, Static

from tui import db as DB
from tui.command_builder import (
    LLAMA_PARAMS, VLLM_PARAMS,
    build_llama_command, build_llama_env,
    build_vllm_command_plan, build_vllm_display_command,
    format_command_display,
    resolve_launch_port,
    resolve_launch_config,
)
from tui.config import (
    COMMANDS,
    LLAMA_TAG_COLOR, VLLM_TAG_COLOR, VLLM_TAG_ACCENT,
    STATE_LABELS, ACTIVE_STATES, get_state_markup,
    get_llama_server_default,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _tag(text: str, color: str, bg: str = "") -> str:
    style = f"bold {color}"
    if bg:
        style += f" on {bg}"
    return f"[{style}] {text} [/{style}]"


def _llama_tag() -> str:
    return _tag("llamacpp", LLAMA_TAG_COLOR)


def _vllm_tag() -> str:
    return f"[bold {VLLM_TAG_COLOR}]v[/bold {VLLM_TAG_COLOR}][bold {VLLM_TAG_ACCENT}]LLM[/bold {VLLM_TAG_ACCENT}]"


# ─── Generic "pick one from a list" modal ─────────────────────────────────────

class PickModal(ModalScreen[int | None]):
    """Show a titled list; returns selected index or None on dismiss."""

    BINDINGS = [
        Binding("escape", "dismiss(None)", "Cancel"),
        Binding("q", "dismiss(None)", "Cancel"),
    ]

    DEFAULT_CSS = """
    PickModal {
        align: center middle;
    }
    PickModal > Vertical {
        width: 70;
        max-height: 30;
        border: round cyan;
        background: $surface;
        padding: 0 1;
    }
    PickModal .modal-title {
        color: cyan;
        text-style: bold;
        padding: 0 1;
        height: 1;
    }
    PickModal ListView {
        height: 1fr;
        border: none;
    }
    PickModal .footer {
        color: $text-muted;
        height: 1;
        padding: 0 1;
    }
    """

    def __init__(self, title: str, items: list[str], *, markup: bool = False) -> None:
        super().__init__()
        self._title = title
        self._items = items
        self._markup = markup

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self._title, classes="modal-title")
            yield ListView(
                *[ListItem(Label(item, markup=self._markup)) for item in self._items]
            )
            yield Label("↑↓ navigate   Enter select   Esc cancel", classes="footer")

    @on(ListView.Selected)
    def _selected(self, event: ListView.Selected) -> None:
        self.dismiss(event.list_view.index)


# ─── Text input modal ─────────────────────────────────────────────────────────

class HelpModal(ModalScreen[None]):
    """Show command help. Escape dismisses the popup."""

    BINDINGS = [Binding("escape", "dismiss(None)", "Close")]

    DEFAULT_CSS = """
    HelpModal {
        align: center middle;
    }
    HelpModal > Vertical {
        width: 76;
        max-height: 28;
        border: round cyan;
        background: $surface;
        padding: 1 2;
    }
    HelpModal .modal-title {
        color: cyan;
        text-style: bold;
        height: 1;
        margin-bottom: 1;
    }
    HelpModal #help-body {
        height: auto;
        max-height: 22;
    }
    HelpModal .footer {
        color: $text-muted;
        height: 1;
        margin-top: 1;
    }
    """

    def compose(self) -> ComposeResult:
        lines = ["[bold cyan]Available commands[/bold cyan]", ""]
        for key, desc in COMMANDS.items():
            lines.append(f"  [bold cyan]/{key}[/bold cyan]  [dim]{desc}[/dim]")
        lines += [
            "",
            "[dim]Keyboard shortcuts:[/dim]",
            "  [bold]Ctrl+H[/bold]  New conversation",
            "  [bold]Ctrl+F[/bold]  Server logs",
            "  [bold]Ctrl+Q[/bold]  Quit",
            "  [bold]Tab[/bold]     Cycle autocomplete",
        ]

        with Vertical():
            yield Label("Help", classes="modal-title")
            yield Static("\n".join(lines), id="help-body", markup=True)
            yield Label("Esc close", classes="footer")


class TextInputModal(ModalScreen[str | None]):
    """Single-line text prompt modal. Returns entered string or None."""

    BINDINGS = [Binding("escape", "dismiss(None)", "Cancel")]

    DEFAULT_CSS = """
    TextInputModal { align: center middle; }
    TextInputModal > Vertical {
        width: 86; height: 11;
        border: round cyan; background: $surface; padding: 1 2;
    }
    TextInputModal Label { color: $text; margin-bottom: 1; }
    TextInputModal Input { width: 1fr; height: 3; }
    """

    def __init__(self, prompt: str, default: str = "") -> None:
        super().__init__()
        self._prompt = prompt
        self._default = default

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self._prompt)
            yield Input(value=self._default, id="ti-input")

    def on_mount(self) -> None:
        self.query_one("#ti-input", Input).focus()

    @on(Input.Submitted, "#ti-input")
    def _submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip() or None)


# ─── Confirm modal ────────────────────────────────────────────────────────────

class ConfirmModal(ModalScreen[bool]):
    """Yes/No confirmation. Returns True if confirmed."""

    BINDINGS = [Binding("escape", "dismiss(False)", "Cancel")]

    DEFAULT_CSS = """
    ConfirmModal { align: center middle; }
    ConfirmModal > Vertical {
        width: 60; height: 9;
        border: round red; background: $surface; padding: 1 2;
    }
    ConfirmModal .msg { color: $text; margin-bottom: 1; }
    ConfirmModal Horizontal { height: 3; align: center middle; }
    ConfirmModal Button { margin: 0 1; }
    """

    def __init__(self, message: str) -> None:
        super().__init__()
        self._message = message

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self._message, classes="msg")
            with Horizontal():
                yield Button("Yes", variant="error", id="yes")
                yield Button("No",  variant="default", id="no")

    @on(Button.Pressed, "#yes")
    def _yes(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#no")
    def _no(self) -> None:
        self.dismiss(False)


# ─── Settings helpers ─────────────────────────────────────────────────────────

_HF_TOKEN_ACCOUNT = "__hf_token__"
_KEYCHAIN_SERVICE  = "llamafront"


def _get_hf_token() -> str:
    try:
        import keyring  # type: ignore[import-not-found]
        return (keyring.get_password(_KEYCHAIN_SERVICE, _HF_TOKEN_ACCOUNT) or "").strip()
    except Exception:
        return ""


def _set_hf_token(token: str) -> None:
    try:
        import keyring  # type: ignore[import-not-found]
        if token:
            keyring.set_password(_KEYCHAIN_SERVICE, _HF_TOKEN_ACCOUNT, token)
        else:
            try:
                keyring.delete_password(_KEYCHAIN_SERVICE, _HF_TOKEN_ACCOUNT)
            except Exception:
                pass
    except Exception:
        pass


# ─── Settings rows definition ─────────────────────────────────────────────────
# Rows are one of:
#   {"section": "<Rich markup string>"}   — non-selectable colored header
#   {"sep": True}                         — blank spacer line
#   {"key": ..., "label": ..., "type": ..., ...}  — editable field

_SETTINGS_ROWS: list[dict] = [
    # ── LlamaCpp settings ────────────────────────────────────────────────────
    {"sep": True},
    {"section": f"[bold {LLAMA_TAG_COLOR}]LlamaCpp settings[/bold {LLAMA_TAG_COLOR}]"},
    {"key": "llamaDefaultHost",   "label": "Default bind host",  "type": "choice", "choices": ["0.0.0.0", "127.0.0.1"]},
    {"key": "llamaBasePort",      "label": "Default port",       "type": "int",    "hint": "1-65535", "min": 1, "max": 65535},
    {"key": "modelsDirs",         "label": "Model dirs",         "type": "paths"},
    {"key": "llamaServerPath",    "label": "llama-server path",  "type": "str"},
    {"key": "cudaBinPath",        "label": "CUDA bin path",      "type": "str"},
    # ── vLLM ─────────────────────────────────────────────────────────────────
    {"sep": True},
    {"section": f"[bold {VLLM_TAG_COLOR}]v[/bold {VLLM_TAG_COLOR}][bold {VLLM_TAG_ACCENT}]LLM[/bold {VLLM_TAG_ACCENT}]"},
    {"key": "vllmDefaultHost",    "label": "Default bind host",  "type": "choice", "choices": ["0.0.0.0", "127.0.0.1"]},
    {"key": "vllmBasePort",       "label": "Default port",       "type": "int",    "hint": "1-65535", "min": 1, "max": 65535},
    {"key": "vllmModelDirs",      "label": "Model dirs",         "type": "paths"},
    {"key": "rt.envKind",         "label": "Runtime",            "type": "choice", "choices": ["conda", "venv", "docker"]},
    {"key": "rt.condaEnvName",    "label": "Conda env name",     "type": "str"},
    {"key": "rt.condaShPath",     "label": "Conda.sh path",      "type": "str"},
    {"key": "rt.venvPath",        "label": "Virtualenv path",    "type": "str"},
    {"key": "rt.dockerImage",     "label": "Docker image",       "type": "str"},
    {"key": "rt.dockerExtraArgs", "label": "Docker extra args",  "type": "str"},
    {"key": "rt.wslDistro",       "label": "WSL distro",         "type": "str"},
    # ── HuggingFace ───────────────────────────────────────────────────────────
    {"sep": True},
    {"section": f"🤗 [bold {VLLM_TAG_ACCENT}]HuggingFace[/bold {VLLM_TAG_ACCENT}]"},
    {"key": "hfToken",            "label": "Access token",       "type": "secret"},
    # ── Claude Code integration ───────────────────────────────────────────────
    {"sep": True},
    {"section": "[bold rgb(167,139,250)]Claude Code integration[/bold rgb(167,139,250)]"},
    {"key": "wslMode",            "label": "WSL mode",           "type": "bool"},
]

_SETTINGS_SELECTABLE: list[int] = [i for i, r in enumerate(_SETTINGS_ROWS) if "key" in r]


def _settings_to_flat(settings: dict) -> dict:
    """Flatten AppSettings (nested vllmRuntime) into a single-level editing dict."""
    skip = {"vllmRuntime", "firstRun"}
    flat = {k: v for k, v in settings.items() if k not in skip}
    for k, v in (settings.get("vllmRuntime") or {}).items():
        flat[f"rt.{k}"] = v
    flat["hfToken"] = _get_hf_token()
    return flat


def _flat_to_db_patch(flat: dict) -> dict:
    """Reconstruct an AppSettings DB patch from the flat editing dict (excludes hfToken)."""
    rt: dict = {}
    patch: dict = {}
    for k, v in flat.items():
        if k in ("hfToken", "firstRun"):
            continue
        if k.startswith("rt."):
            rt[k[3:]] = v
        else:
            patch[k] = v
    if rt:
        patch["vllmRuntime"] = rt
    return patch


class SettingsModal(ModalScreen):
    """Full settings editor — same fields and backend as the GUI settings page.

    Every change auto-saves to the shared SQLite DB (or keychain for the HF
    token) so the GUI reflects it immediately without needing a separate save.
    """

    BINDINGS = [
        Binding("escape", "dismiss(None)", "Close"),
        Binding("up",     "move_up",       "Up"),
        Binding("down",   "move_down",     "Down"),
        Binding("enter",  "edit_field",    "Edit"),
    ]

    DEFAULT_CSS = """
    SettingsModal { align: center middle; }
    SettingsModal > Vertical {
        width: 84; max-height: 36;
        border: round cyan; background: $surface; padding: 0 1;
    }
    SettingsModal .st-title   { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    SettingsModal .st-footer  { color: $text-muted; height: 1; padding: 0 1; }
    SettingsModal ScrollableContainer { height: 1fr; }
    SettingsModal .st-row     { height: 1; padding: 0 1; }
    SettingsModal .st-row-sel { height: 1; padding: 0 1; background: cyan; color: black; text-style: bold; }
    SettingsModal .st-section { height: 1; padding: 0 1; }
    SettingsModal .st-sep     { height: 1; }
    """

    def __init__(self) -> None:
        super().__init__()
        self._flat: dict = {}
        self._cursor_sel: int = 0  # index into _SETTINGS_SELECTABLE

    def compose(self) -> ComposeResult:
        selected_row = _SETTINGS_SELECTABLE[self._cursor_sel]
        with Vertical():
            yield Label("Settings", classes="st-title")
            with ScrollableContainer(id="st-scroll"):
                for i, row in enumerate(_SETTINGS_ROWS):
                    if "sep" in row:
                        yield Label("", classes="st-sep", id=f"st-row-{i}")
                    elif "section" in row:
                        yield Label(row["section"], classes="st-section", id=f"st-row-{i}", markup=True)
                    else:
                        cls = "st-row-sel" if i == selected_row else "st-row"
                        yield Label("", classes=cls, id=f"st-row-{i}", markup=False)
            yield Label("↑↓ move   Enter edit   Esc close", classes="st-footer")

    def on_mount(self) -> None:
        self._load()

    def _load(self) -> None:
        conn = self.app.db
        settings = DB.get_settings(conn) if conn else {}
        self._flat = _settings_to_flat(settings)
        self._refresh_rows()

    def _row_text(self, i: int) -> str:
        row   = _SETTINGS_ROWS[i]
        key   = row["key"]
        label = row["label"].ljust(22)
        val   = self._flat.get(key)
        if row["type"] == "paths":
            dirs = val if isinstance(val, list) else []
            val_str = " ; ".join(dirs) if dirs else "(none)"
        elif row["type"] == "bool":
            val_str = "on" if val else "off"
        elif row["type"] == "secret":
            val_str = "••••••••" if val else "(not set)"
        elif val is None:
            val_str = "—"
        else:
            val_str = str(val)
        return f"  {label}: {val_str}"

    def _refresh_rows(self) -> None:
        selected_row = _SETTINGS_SELECTABLE[self._cursor_sel]
        for i, row in enumerate(_SETTINGS_ROWS):
            if "section" in row or "sep" in row:
                continue
            try:
                lbl = self.query_one(f"#st-row-{i}", Label)
                lbl.update(self._row_text(i))
                lbl.set_classes("st-row-sel" if i == selected_row else "st-row")
            except Exception:
                pass

    def _autosave(self) -> None:
        """Write current flat state to DB and keychain — called after every field change."""
        conn = self.app.db
        if conn:
            DB.update_settings(conn, _flat_to_db_patch(self._flat))
        _set_hf_token(self._flat.get("hfToken") or "")

    def action_move_up(self) -> None:
        if self._cursor_sel > 0:
            self._cursor_sel -= 1
            self._refresh_rows()
            self._scroll_to_cursor()

    def action_move_down(self) -> None:
        if self._cursor_sel < len(_SETTINGS_SELECTABLE) - 1:
            self._cursor_sel += 1
            self._refresh_rows()
            self._scroll_to_cursor()

    def _scroll_to_cursor(self) -> None:
        try:
            self.query_one(f"#st-row-{_SETTINGS_SELECTABLE[self._cursor_sel]}", Label).scroll_visible()
        except Exception:
            pass

    def action_edit_field(self) -> None:
        row_idx = _SETTINGS_SELECTABLE[self._cursor_sel]
        row     = _SETTINGS_ROWS[row_idx]
        key     = row["key"]
        current = self._flat.get(key)

        if row["type"] == "choice":
            choices = row.get("choices", [])
            items   = [f"{'● ' if c == current else '  '}{c}" for c in choices]
            def _on_pick(idx: int | None) -> None:
                if idx is not None:
                    self._flat[key] = choices[idx]
                    self._refresh_rows()
                    self._autosave()
            self.app.push_screen(PickModal(f"Choose {row['label']}", items), callback=_on_pick)

        elif row["type"] == "bool":
            self._flat[key] = not bool(current)
            self._refresh_rows()
            self._autosave()

        elif row["type"] == "paths":
            dirs    = current if isinstance(current, list) else []
            default = "; ".join(dirs)
            def _on_paths(val: str | None) -> None:
                if val is not None:
                    self._flat[key] = [x.strip() for x in val.split(";") if x.strip()]
                    self._refresh_rows()
                    self._autosave()
            self.app.push_screen(
                TextInputModal(f"{row['label']} (semicolon-separated):", default=default),
                callback=_on_paths,
            )

        elif row["type"] == "int":
            hint        = row.get("hint", "")
            lo, hi      = row.get("min"), row.get("max")
            default_str = str(current) if current is not None else ""
            label_hint  = f"{row['label']} ({hint}):" if hint else f"{row['label']}:"
            def _on_int(val: str | None) -> None:
                if val is None:
                    return
                try:
                    n = int(val)
                except ValueError:
                    self.app.notify("Enter a valid integer.", severity="warning")
                    return
                if lo is not None and n < lo:
                    self.app.notify(f"Minimum is {lo}.", severity="warning")
                    return
                if hi is not None and n > hi:
                    self.app.notify(f"Maximum is {hi}.", severity="warning")
                    return
                self._flat[key] = n
                self._refresh_rows()
                self._autosave()
            self.app.push_screen(TextInputModal(label_hint, default=default_str), callback=_on_int)

        elif row["type"] == "secret":
            # Show current token unmasked so user can edit it; display stays masked
            default_str = self._flat.get(key) or ""
            def _on_secret(val: str | None) -> None:
                if val is not None:
                    self._flat[key] = val.strip()
                    self._refresh_rows()
                    self._autosave()
            self.app.push_screen(
                TextInputModal(f"{row['label']}:", default=default_str),
                callback=_on_secret,
            )

        else:  # str
            default_str = str(current) if current is not None else ""
            def _on_str(val: str | None) -> None:
                if val is not None:
                    self._flat[key] = val
                    self._refresh_rows()
                    self._autosave()
            self.app.push_screen(
                TextInputModal(f"{row['label']}:", default=default_str),
                callback=_on_str,
            )


class DownloadFlowModal(ModalScreen):
    """Choose backend, search Hugging Face, choose files, and download."""

    BINDINGS = [Binding("escape", "dismiss(None)", "Cancel")]

    DEFAULT_CSS = """
    DownloadFlowModal { align: center middle; }
    DownloadFlowModal > Vertical {
        width: 82; max-height: 32;
        border: round cyan; background: $surface; padding: 0 1;
    }
    DownloadFlowModal .dl-title { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    DownloadFlowModal .dl-footer { color: $text-muted; height: 1; padding: 0 1; }
    DownloadFlowModal ListView { height: 1fr; }
    """

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("🤗 Download from Hugging Face", classes="dl-title")
            yield ListView(
                ListItem(Label("  llama.cpp / GGUF")),
                ListItem(Label("  vLLM / safetensors")),
                id="download-kind",
            )
            yield Label("Enter select   Esc cancel", classes="dl-footer")

    @on(ListView.Selected, "#download-kind")
    def _kind_selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx is None:
            return
        library = "llama" if idx == 0 else "vllm"
        def _on_query(query: str | None) -> None:
            if not query:
                return
            self.app.push_screen(HfSearchModal(library, query))
        self.app.push_screen(TextInputModal("Search Hugging Face models:"), callback=_on_query)


class HfSearchModal(ModalScreen):
    BINDINGS = [Binding("escape", "dismiss(None)", "Back")]
    PAGE_SIZE = 25

    DEFAULT_CSS = """
    HfSearchModal { align: center middle; }
    HfSearchModal > Vertical {
        width: 90; max-height: 34;
        border: round cyan; background: $surface; padding: 0 1;
    }
    HfSearchModal .hf-title { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    HfSearchModal .hf-footer { color: $text-muted; height: 1; padding: 0 1; }
    HfSearchModal ListView { height: 1fr; }
    """

    def __init__(self, library: str, query: str) -> None:
        super().__init__()
        self._library = library
        self._query = query
        self._models = []
        self._limit = self.PAGE_SIZE
        self._loading = False

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(f"Search: {self._query}", classes="hf-title")
            yield ListView(ListItem(Label("  Searching...")), id="hf-results")
            yield Label("Enter select   + Load more   Esc back", classes="hf-footer")

    def on_mount(self) -> None:
        self._search()

    @work(thread=True)
    def _search(self) -> None:
        from tui import hf
        self._loading = True
        try:
            models = hf.search_models(self._query, self._library, limit=self._limit)
            self.app.call_from_thread(self._show_results, models, None)
        except Exception as exc:
            self.app.call_from_thread(self._show_results, [], str(exc))
        finally:
            self._loading = False

    def _show_results(self, models, error: str | None) -> None:
        self._models = models
        self.query_one(".hf-title", Label).update(
            f"Search: {self._query}  showing {len(models)}"
        )
        lv = self.query_one("#hf-results", ListView)
        lv.clear()
        if error:
            lv.append(ListItem(Label(f"  Error: {error}")))
            return
        if not models:
            lv.append(ListItem(Label("  No models found")))
            return
        for m in models:
            stats = []
            if m.downloads is not None:
                stats.append(f"{m.downloads:,} downloads")
            if m.likes is not None:
                stats.append(f"{m.likes:,} likes")
            suffix = f"  [dim]{' · '.join(stats)}[/dim]" if stats else ""
            lv.append(ListItem(Label(f"  {m.id}{suffix}", markup=True)))
        lv.append(ListItem(Label("  [cyan]+ Load more results[/cyan]", markup=True)))

    @on(ListView.Selected, "#hf-results")
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx is None:
            return
        if idx == len(self._models):
            if self._loading:
                return
            self._limit += self.PAGE_SIZE
            lv = self.query_one("#hf-results", ListView)
            lv.clear()
            lv.append(ListItem(Label("  Loading more...")))
            self._search()
            return
        if idx >= len(self._models):
            return
        self.app.push_screen(HfFileModal(self._library, self._models[idx].id))


class HfFileModal(ModalScreen):
    BINDINGS = [Binding("escape", "dismiss(None)", "Back")]

    DEFAULT_CSS = """
    HfFileModal { align: center middle; }
    HfFileModal > Vertical {
        width: 92; max-height: 34;
        border: round cyan; background: $surface; padding: 0 1;
    }
    HfFileModal .hf-title { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    HfFileModal .hf-footer { color: $text-muted; height: 1; padding: 0 1; }
    HfFileModal ListView { height: 1fr; }
    """

    def __init__(self, library: str, repo_id: str) -> None:
        super().__init__()
        self._library = library
        self._repo_id = repo_id
        self._choices = []

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(f"{self._repo_id}", classes="hf-title")
            yield ListView(ListItem(Label("  Loading files...")), id="hf-files")
            yield Label("Enter download   Esc back", classes="hf-footer")

    def on_mount(self) -> None:
        self._load_files()

    @work(thread=True)
    def _load_files(self) -> None:
        from tui import hf
        try:
            files = hf.list_repo_files(self._repo_id)
            if self._library == "vllm":
                choice = hf.vllm_choice(files)
                choices = [choice] if choice else []
            else:
                choices = hf.llama_choices(files)
            self.app.call_from_thread(self._show_files, choices, None)
        except Exception as exc:
            self.app.call_from_thread(self._show_files, [], str(exc))

    def _show_files(self, choices, error: str | None) -> None:
        from tui import hf
        self._choices = [c for c in choices if c]
        lv = self.query_one("#hf-files", ListView)
        lv.clear()
        if error:
            lv.append(ListItem(Label(f"  Error: {error}")))
            return
        if not self._choices:
            lv.append(ListItem(Label("  No compatible files found")))
            return
        for choice_idx, (label, files) in enumerate(self._choices):
            lv.append(ListItem(Label(f"  {label}")))
            if self._library == "vllm" and choice_idx == 0:
                for f in files:
                    lv.append(ListItem(Label(f"    [dim]{f.path}  {hf.format_bytes(f.size)}[/dim]", markup=True)))

    @on(ListView.Selected, "#hf-files")
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx is None or idx >= len(self._choices):
            return
        label, files = self._choices[idx]
        conn = self.app.db
        settings = DB.get_settings(conn) if conn else {}
        roots = settings.get("vllmModelDirs") if self._library == "vllm" else settings.get("modelsDirs")
        roots = [r for r in (roots or []) if r.strip()]
        if not roots:
            self.app.push_screen(ConfirmModal("No model directory configured. Use /settings first."))
            return
        def _on_root(root_idx: int | None) -> None:
            if root_idx is None:
                return
            self.app.push_screen(DownloadProgressModal(self._library, self._repo_id, files, roots[root_idx]))
        self.app.push_screen(PickModal("Download into", roots), callback=_on_root)


class DownloadProgressModal(ModalScreen):
    BINDINGS = [Binding("escape", "dismiss(None)", "Hide")]

    DEFAULT_CSS = """
    DownloadProgressModal { align: center middle; }
    DownloadProgressModal > Vertical {
        width: 82; height: 12;
        border: round cyan; background: $surface; padding: 1 2;
    }
    DownloadProgressModal #dp-title { color: cyan; text-style: bold; height: 1; }
    DownloadProgressModal #dp-status { height: 1fr; color: $text; }
    """

    def __init__(self, library: str, repo_id: str, files: list, root: str) -> None:
        super().__init__()
        self._library = library
        self._repo_id = repo_id
        self._files = files
        self._root = root

    def compose(self) -> ComposeResult:
        yield Vertical(
            Label(f"Downloading {self._repo_id}", id="dp-title"),
            Static("Starting...", id="dp-status"),
        )

    def on_mount(self) -> None:
        self._download()

    def _set_status(self, message: str) -> None:
        self.query_one("#dp-status", Static).update(message)

    @work(thread=True)
    def _download(self) -> None:
        from tui import hf
        try:
            def progress(msg: str) -> None:
                self.app.call_from_thread(self._set_status, msg)
            model_dir, saved = hf.download_files(
                repo_id=self._repo_id,
                files=self._files,
                models_dir=self._root,
                vllm_target=self._library == "vllm",
                progress=progress,
            )
            conn = self.app.db
            if conn is not None:
                settings = DB.get_settings(conn)
                hf.register_download(conn, library=self._library, repo_id=self._repo_id, model_dir=model_dir, saved=saved, settings=settings)
            self.app.call_from_thread(self._set_status, f"Complete: {model_dir}")
        except Exception as exc:
            self.app.call_from_thread(self._set_status, f"Error: {exc}")


# ─── Param editor modal ───────────────────────────────────────────────────────

class ParamEditorModal(ModalScreen[dict | None]):
    """Arrow-key parameter editor. Returns updated config dict or None."""

    BINDINGS = [
        Binding("escape",   "dismiss(None)", "Cancel"),
        Binding("s",        "save",          "Save"),
        Binding("up",       "move_up",       "Up"),
        Binding("down",     "move_down",     "Down"),
        Binding("enter",    "edit_param",    "Edit"),
    ]

    DEFAULT_CSS = """
    ParamEditorModal { align: center middle; }
    ParamEditorModal > Vertical {
        width: 72; max-height: 36;
        border: round cyan; background: $surface; padding: 0 1;
    }
    ParamEditorModal .pe-title  { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    ParamEditorModal .pe-footer { color: $text-muted; height: 1; padding: 0 1; }
    ParamEditorModal ScrollableContainer { height: 1fr; }
    ParamEditorModal .pe-row    { height: 1; padding: 0 1; }
    ParamEditorModal .pe-row-sel { height: 1; padding: 0 1; background: cyan; color: black; text-style: bold; }
    """

    def __init__(
        self,
        title: str,
        params: list[dict[str, Any]],
        config: dict[str, Any],
    ) -> None:
        super().__init__()
        self._title  = title
        self._params = params
        self._config = dict(config)
        self._cursor = 0

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self._title, classes="pe-title")
            with ScrollableContainer(id="pe-scroll"):
                for i, p in enumerate(self._params):
                    cls = "pe-row-sel" if i == self._cursor else "pe-row"
                    yield Label(self._row_text(i), classes=cls, id=f"pe-row-{i}", markup=False)
            yield Label("↑↓ move   Enter edit   s save   Esc cancel", classes="pe-footer")

    def _row_text(self, i: int) -> str:
        p = self._params[i]
        val = self._config.get(p["key"])
        val_str = str(val) if val is not None else "—"
        label = p["label"].ljust(26)
        return f"  {label}: {val_str}"

    def _refresh_rows(self) -> None:
        for i, p in enumerate(self._params):
            try:
                lbl = self.query_one(f"#pe-row-{i}", Label)
                lbl.update(self._row_text(i))
                lbl.set_classes("pe-row-sel" if i == self._cursor else "pe-row")
            except Exception:
                pass

    def action_move_up(self) -> None:
        if self._cursor > 0:
            self._cursor -= 1
            self._refresh_rows()

    def action_move_down(self) -> None:
        if self._cursor < len(self._params) - 1:
            self._cursor += 1
            self._refresh_rows()

    def action_edit_param(self) -> None:
        p = self._params[self._cursor]
        current = self._config.get(p["key"])
        default_str = str(current) if current is not None else ""

        if p["type"] == "choice":
            choices = p.get("choices", [])
            items = [f"{'● ' if c == current else '  '}{c}" for c in choices]
            def _on_pick(idx: int | None) -> None:
                if idx is not None:
                    self._config[p["key"]] = choices[idx]
                    self._refresh_rows()
            self.app.push_screen(PickModal(f"Choose {p['label']}", items), callback=_on_pick)
        elif p["type"] == "bool":
            self._config[p["key"]] = not bool(self._config.get(p["key"], False))
            self._refresh_rows()
        else:
            hint = p.get("hint", "")
            prompt = f"{p['label']}" + (f" ({hint})" if hint else "")
            def _on_input(val: str | None) -> None:
                if val is not None:
                    try:
                        if p["type"] == "int":
                            self._config[p["key"]] = int(val)
                        elif p["type"] == "float":
                            self._config[p["key"]] = float(val)
                        else:
                            self._config[p["key"]] = val
                    except ValueError:
                        pass
                    self._refresh_rows()
            self.app.push_screen(TextInputModal(prompt, default=default_str), callback=_on_input)

    def action_save(self) -> None:
        self.dismiss(self._config)


# ─── Model list modal ─────────────────────────────────────────────────────────

class ModelListModal(ModalScreen):
    """List all llama.cpp + vLLM models. On select, push ModelActionModal."""

    BINDINGS = [
        Binding("escape",  "dismiss(None)", "Cancel"),
        Binding("q",       "dismiss(None)", "Cancel"),
        Binding("ctrl+r",  "refresh",       "Refresh"),
        Binding("ctrl+c",  "configure",     "Configure"),
        Binding("ctrl+s",  "serve",         "Serve"),
    ]

    DEFAULT_CSS = """
    ModelListModal { align: center middle; }
    ModelListModal > Vertical {
        width: 80; max-height: 40;
        border: round cyan; background: $surface; padding: 0 1;
    }
    ModelListModal .ml-title  { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    ModelListModal .ml-footer { color: $text-muted; height: 1; padding: 0 1; }
    ModelListModal #ml-search {
        height: 1;
        border: none;
        padding: 0 1;
        margin: 0;
        background: $panel;
        background-tint: $foreground 3%;
        color: $foreground;
    }
    ModelListModal #ml-search:focus {
        background: $panel;
        background-tint: $foreground 3%;
    }
    ModelListModal #ml-search > .input--placeholder {
        color: $text-muted;
    }
    ModelListModal .ml-sep {
        height: 1;
        color: cyan;
        padding: 0;
    }
    ModelListModal ListView { height: 1fr; }
    ModelListModal ListView:focus {
        background: transparent;
    }
    ModelListModal ListView > ListItem.-hovered {
        background: cyan 30%;
    }
    ModelListModal ListView > ListItem.-highlight {
        background: cyan;
        color: black;
        text-style: bold;
    }
    ModelListModal ListView:focus > ListItem.-highlight {
        background: cyan;
        color: black;
        text-style: bold;
    }
    """

    def __init__(self, *, mode: str = "serve") -> None:
        super().__init__()
        self._mode = mode   # "serve" | "configure"
        self._llama: list[dict] = []
        self._vllm: list[dict] = []
        self._filtered_llama: list[dict] = []
        self._filtered_vllm: list[dict] = []

    def compose(self) -> ComposeResult:
        footer = (
            "↑↓ move   Enter serve   Ctrl+R refresh   Ctrl+C configure   Esc cancel"
            if self._mode == "serve"
            else "↑↓ move   Enter configure   Ctrl+R refresh   Ctrl+S serve   Esc cancel"
        )
        with Vertical():
            yield Label("Models", classes="ml-title")
            yield Input(placeholder="⌕  Filter models…", id="ml-search")
            yield Static("─" * 76, classes="ml-sep", markup=False)
            yield ListView(id="ml-list")
            yield Static("─" * 76, classes="ml-sep", markup=False)
            yield Label(footer, classes="ml-footer")

    def on_mount(self) -> None:
        self._load()
        self.query_one("#ml-search", Input).focus()
        self.query_one("#ml-list", ListView).can_focus = False

    def _load(self) -> None:
        conn = self.app.db
        if conn is None:
            return
        self._llama = DB.list_llama_models(conn)
        self._vllm  = DB.list_vllm_models(conn)
        try:
            query = self.query_one("#ml-search", Input).value
        except Exception:
            query = ""
        self._apply_filter(query)

    def _apply_filter(self, query: str) -> None:
        q = query.strip().lower()
        if q:
            self._filtered_llama = [
                m for m in self._llama
                if q in (m.get("name") or m.get("gguf_path", "")).lower()
            ]
            self._filtered_vllm = [
                m for m in self._vllm
                if q in (m.get("display_name") or m.get("path", "")).lower()
            ]
        else:
            self._filtered_llama = list(self._llama)
            self._filtered_vllm  = list(self._vllm)
        self._render_list()

    def _render_list(self) -> None:
        conn = self.app.db
        settings = DB.get_settings(conn) if conn else {}
        models_dir = (settings.get("modelsDirs") or [None])[0]
        lv = self.query_one("#ml-list", ListView)
        lv.clear()
        for m in self._filtered_llama:
            name = m.get("name") or m.get("gguf_path", "?")
            if "/" not in name and m.get("model_dir") and models_dir:
                try:
                    rel = Path(m["model_dir"]).relative_to(models_dir)
                    parts = rel.parts
                    if len(parts) >= 2:
                        name = f"[dim]{parts[0]}[/dim]/{name}"
                except Exception:
                    pass
            quant = m.get("quant_label") or ""
            label = f"{name}  [dim]{quant}[/dim]  {_llama_tag()}"
            lv.append(ListItem(Label(label, markup=True)))
        for m in self._filtered_vllm:
            name = m.get("display_name") or m.get("path", "?")
            if "/" in name:
                provider, model = name.split("/", 1)
                name = f"[dim]{provider}[/dim]/{model}"
            label = f"{name}  {_vllm_tag()}"
            lv.append(ListItem(Label(label, markup=True)))

    @on(Input.Changed, "#ml-search")
    def _filter_changed(self, event: Input.Changed) -> None:
        self._apply_filter(event.value)

    def on_key(self, event) -> None:
        """Arrow keys cycle list highlight without moving focus from the search bar."""
        lv = self.query_one("#ml-list", ListView)
        total = len(self._filtered_llama) + len(self._filtered_vllm)
        if total == 0:
            return

        if event.key == "down":
            cur = lv.index if lv.index is not None else -1
            lv.index = (cur + 1) % total
            event.prevent_default()
        elif event.key == "up":
            cur = lv.index if lv.index is not None else 0
            lv.index = (cur - 1) % total
            event.prevent_default()
        elif event.key == "enter":
            event.prevent_default()
            idx = lv.index
            if idx is None:
                return
            n_llama = len(self._filtered_llama)
            if idx < n_llama:
                model = self._filtered_llama[idx]
                kind = "llama"
            else:
                model = self._filtered_vllm[idx - n_llama]
                kind = "vllm"
            if self._mode == "serve":
                self.app.push_screen(ProfileListModal(model, kind, mode="launch"))
            elif self._mode == "configure":
                self.app.push_screen(ProfileListModal(model, kind, mode="configure"))
            else:
                self.app.push_screen(ModelActionModal(model, kind))

    def action_refresh(self) -> None:
        self._load()

    def action_configure(self) -> None:
        """Push ProfileListModal for the selected model in configure mode."""
        lv = self.query_one("#ml-list", ListView)
        idx = lv.index
        if idx is None:
            return
        n_llama = len(self._filtered_llama)
        if idx < n_llama:
            model = self._filtered_llama[idx]
            kind  = "llama"
        else:
            model = self._filtered_vllm[idx - n_llama]
            kind  = "vllm"
        self.app.push_screen(ProfileListModal(model, kind, mode="configure"))

    def action_serve(self) -> None:
        """Push ProfileListModal for the selected model in serve mode."""
        lv = self.query_one("#ml-list", ListView)
        idx = lv.index
        if idx is None:
            return
        n_llama = len(self._filtered_llama)
        if idx < n_llama:
            model = self._filtered_llama[idx]
            kind  = "llama"
        else:
            model = self._filtered_vllm[idx - n_llama]
            kind  = "vllm"
        self.app.push_screen(ProfileListModal(model, kind, mode="launch"))

    @on(ListView.Selected)
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx is None:
            return
        n_llama = len(self._filtered_llama)
        if idx < n_llama:
            model = self._filtered_llama[idx]
            kind  = "llama"
        else:
            model = self._filtered_vllm[idx - n_llama]
            kind  = "vllm"

        if self._mode == "serve":
            self.app.push_screen(ProfileListModal(model, kind, mode="launch"))
        elif self._mode == "configure":
            self.app.push_screen(ProfileListModal(model, kind, mode="configure"))
        else:
            self.app.push_screen(ModelActionModal(model, kind))


# ─── Model action modal ───────────────────────────────────────────────────────

class ModelActionModal(ModalScreen):
    """Actions for a selected model: Launch, Configure, Delete."""

    BINDINGS = [Binding("escape", "dismiss(None)", "Back")]

    DEFAULT_CSS = """
    ModelActionModal { align: center middle; }
    ModelActionModal > Vertical {
        width: 60; max-height: 20;
        border: round cyan; background: $surface; padding: 0 1;
    }
    ModelActionModal .ma-title  { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    ModelActionModal .ma-footer { color: $text-muted; height: 1; padding: 0 1; }
    ModelActionModal ListView   { height: 1fr; }
    """

    def __init__(self, model: dict, kind: str) -> None:
        super().__init__()
        self._model = model
        self._kind  = kind  # "llama" | "vllm"

    def compose(self) -> ComposeResult:
        name = self._model.get("name") or self._model.get("display_name") or "?"
        with Vertical():
            yield Label(f"[cyan]{name}[/cyan]", classes="ma-title", markup=True)
            yield ListView(
                ListItem(Label("  Launch")),
                ListItem(Label("  Configure")),
                ListItem(Label("  Delete")),
            )
            yield Label("Enter select   Esc back", classes="ma-footer")

    @on(ListView.Selected)
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx == 0:
            self.app.push_screen(ProfileListModal(self._model, self._kind, mode="launch"))
        elif idx == 1:
            self.app.push_screen(ProfileListModal(self._model, self._kind, mode="configure"))
        elif idx == 2:
            self._delete()

    def _delete(self) -> None:
        name = self._model.get("name") or self._model.get("display_name") or "?"
        def _on_confirm(confirmed: bool) -> None:
            if confirmed:
                conn = self.app.db
                if self._kind == "llama":
                    DB.delete_llama_model(conn, self._model["id"])
                else:
                    DB.delete_vllm_model(conn, self._model["id"])
                self.dismiss(None)
        self.app.push_screen(
            ConfirmModal(f"Delete '{name}' from the database?\n(Files on disk are NOT removed.)"),
            callback=_on_confirm,
        )


# ─── Profile list modal ───────────────────────────────────────────────────────

class ProfileListModal(ModalScreen):
    """List profiles for a model. Enter → ProfileActionModal or direct launch."""

    BINDINGS = [
        Binding("escape", "dismiss(None)", "Back"),
        Binding("n",      "new_profile",   "New"),
        Binding("a",      "set_active",    "Set active"),
    ]

    DEFAULT_CSS = """
    ProfileListModal { align: center middle; }
    ProfileListModal > Vertical {
        width: 70; max-height: 28;
        border: round cyan; background: $surface; padding: 0 1;
    }
    ProfileListModal .pl-title  { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    ProfileListModal .pl-footer { color: $text-muted; height: 1; padding: 0 1; }
    ProfileListModal ListView   { height: 1fr; }
    """

    def __init__(self, model: dict, kind: str, *, mode: str = "configure") -> None:
        super().__init__()
        self._model   = model
        self._kind    = kind
        self._mode    = mode   # "configure" | "launch"
        self._profiles: list[dict] = []

    def compose(self) -> ComposeResult:
        name   = self._model.get("name") or self._model.get("display_name") or "?"
        action = "Launch" if self._mode == "launch" else "Configure"
        footer = (
            "↑↓ move   Enter launch   a set-active   n new   Esc back"
            if self._mode == "launch"
            else "↑↓ move   Enter configure   a set-active   n new   Esc back"
        )
        with Vertical():
            yield Label(f"{action}: [cyan]{name}[/cyan]  — select a profile", classes="pl-title", markup=True)
            yield ListView(id="pl-list")
            yield Label(footer, classes="pl-footer")

    def on_mount(self) -> None:
        self._load()

        # Launch mode: if there's exactly one active profile, launch it immediately
        if self._mode == "launch":
            active = [p for p in self._profiles if p.get("active")]
            if len(active) == 1:
                self.call_after_refresh(self._auto_launch, active[0])

        # Highlight active profile after render (without firing Selected)
        for i, p in enumerate(self._profiles):
            if p.get("active"):
                self.call_after_refresh(lambda idx=i: self._set_highlight(idx))
                break

    def _set_highlight(self, idx: int) -> None:
        lv = self.query_one("#pl-list", ListView)
        lv.index = idx

    def _load(self) -> None:
        conn = self.app.db
        if conn is None:
            return
        mid = self._model["id"]
        if self._kind == "llama":
            self._profiles = DB.list_profiles(conn, mid)
        else:
            self._profiles = DB.list_vllm_profiles(conn, mid)

        lv = self.query_one("#pl-list", ListView)
        lv.clear()
        for p in self._profiles:
            active_dot = " [bold cyan]●[/bold cyan]" if p.get("active") else "  "
            lv.append(ListItem(Label(f"{active_dot} {p['name']}", markup=True)))

    def _auto_launch(self, profile: dict) -> None:
        self.dismiss(None)
        conn = self.app.db
        settings = DB.get_settings(conn) if conn else {}
        argv, env, port, display = resolve_launch_config(
            self.app, self._model, self._kind, profile, settings
        )
        self.app.do_launch(
            argv, env,
            display=display,
            title=self._model.get("name") or self._model.get("display_name") or "server",
            kind=self._kind,
            host=profile.get("host") or "127.0.0.1",
            port=port,
            model=self._model,
            profile=profile,
        )

    def action_new_profile(self) -> None:
        def _on_name(name: str | None) -> None:
            if name:
                conn = self.app.db
                mid  = self._model["id"]
                if self._kind == "llama":
                    DB.create_llama_profile(conn, mid, name, {})
                else:
                    DB.create_vllm_profile(conn, mid, name, {})
                self._load()
        self.app.push_screen(TextInputModal("New profile name:"), callback=_on_name)

    async def action_set_active(self) -> None:
        lv  = self.query_one("#pl-list", ListView)
        idx = lv.index
        if idx is None or idx >= len(self._profiles):
            return
        profile = self._profiles[idx]
        conn    = self.app.db
        mid     = self._model["id"]
        if self._kind == "llama":
            DB.set_active_profile(conn, mid, profile["id"])
        else:
            DB.set_active_vllm_profile(conn, mid, profile["id"])
        self._load()

    @on(ListView.Selected)
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx is None or idx >= len(self._profiles):
            return
        profile = self._profiles[idx]
        if self._mode == "launch":
            conn = self.app.db
            settings = DB.get_settings(conn) if conn else {}
            argv, env, port, display = resolve_launch_config(
                self.app, self._model, self._kind, profile, settings
            )
            self.dismiss(None)
            self.app.do_launch(
                argv, env,
                display=display,
                title=self._model.get("name") or self._model.get("display_name") or "server",
                kind=self._kind,
                host=profile.get("host") or "127.0.0.1",
                port=port,
                model=self._model,
                profile=profile,
            )
        else:
            self.app.push_screen(
                ProfileActionModal(self._model, self._kind, profile, refresh_cb=self._load)
            )


# ─── Profile action modal ─────────────────────────────────────────────────────

class ProfileActionModal(ModalScreen):
    """Actions on a profile: Configure Params, Edit Launch Command, Delete."""

    BINDINGS = [Binding("escape", "dismiss(None)", "Back")]

    DEFAULT_CSS = """
    ProfileActionModal { align: center middle; }
    ProfileActionModal > Vertical {
        width: 60; max-height: 18;
        border: round cyan; background: $surface; padding: 0 1;
    }
    ProfileActionModal .pa-title  { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    ProfileActionModal .pa-footer { color: $text-muted; height: 1; padding: 0 1; }
    ProfileActionModal ListView   { height: 1fr; }
    """

    def __init__(self, model: dict, kind: str, profile: dict, *, refresh_cb=None) -> None:
        super().__init__()
        self._model      = model
        self._kind       = kind
        self._profile    = profile
        self._refresh_cb = refresh_cb

    def compose(self) -> ComposeResult:
        name = self._profile.get("name", "?")
        with Vertical():
            yield Label(f"Profile: [cyan]{name}[/cyan]", classes="pa-title", markup=True)
            yield ListView(
                ListItem(Label("  Configure parameters")),
                ListItem(Label("  Edit launch command")),
                ListItem(Label("  Delete profile")),
            )
            yield Label("Enter select   Esc back", classes="pa-footer")

    @on(ListView.Selected)
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx == 0:
            self._configure_params()
        elif idx == 1:
            self._edit_command()
        elif idx == 2:
            self._delete()

    def _configure_params(self) -> None:
        params = LLAMA_PARAMS if self._kind == "llama" else VLLM_PARAMS
        name   = self._profile.get("name", "?")
        model_name = self._model.get("name") or self._model.get("display_name") or "?"
        def _on_config(new_config: dict | None) -> None:
            if new_config is not None:
                conn = self.app.db
                pid  = self._profile["id"]
                if self._kind == "llama":
                    DB.update_profile_config(conn, pid, new_config)
                else:
                    DB.update_vllm_profile_config(conn, pid, new_config)
                self._profile["config"] = new_config
                if self._refresh_cb:
                    self._refresh_cb()
        self.app.push_screen(
            ParamEditorModal(
                f"Configure · {model_name} · {name}",
                params,
                self._profile.get("config", {}),
            ),
            callback=_on_config,
        )

    def _edit_command(self) -> None:
        current_cmd = self._profile.get("config", {}).get("customCommandLine", "")
        def _on_cmd(new_cmd: str | None) -> None:
            if new_cmd is not None:
                config = dict(self._profile.get("config", {}))
                config["launchMode"] = "custom"
                config["customCommandLine"] = new_cmd
                conn = self.app.db
                pid  = self._profile["id"]
                if self._kind == "llama":
                    DB.update_profile_config(conn, pid, config)
                else:
                    DB.update_vllm_profile_config(conn, pid, config)
                self._profile["config"] = config
        self.app.push_screen(
            TextInputModal("Launch command (full command line):", default=current_cmd),
            callback=_on_cmd,
        )

    def _delete(self) -> None:
        name = self._profile.get("name", "?")
        def _on_confirm(confirmed: bool) -> None:
            if confirmed:
                conn = self.app.db
                pid  = self._profile["id"]
                if self._kind == "llama":
                    DB.delete_profile(conn, pid)
                else:
                    DB.delete_vllm_profile(conn, pid)
                if self._refresh_cb:
                    self._refresh_cb()
                self.dismiss(None)
        self.app.push_screen(ConfirmModal(f"Delete profile '{name}'?"), callback=_on_confirm)


# ─── Server launch modal ──────────────────────────────────────────────────────

class ServerLaunchModal(ModalScreen):
    """Show resolved command, then launch the server. Streams output to ServerOutputScreen."""

    BINDINGS = [Binding("escape", "dismiss(None)", "Back")]

    DEFAULT_CSS = """
    ServerLaunchModal { align: center middle; }
    ServerLaunchModal > Vertical {
        width: 74; max-height: 26;
        border: round cyan; background: $surface; padding: 1 2;
    }
    ServerLaunchModal .cmd-label { color: $text; height: 1; }
    ServerLaunchModal #cmd-text  { color: $text-muted; text-style: italic; margin-bottom: 1; }
    ServerLaunchModal Horizontal { height: 3; align: center middle; }
    ServerLaunchModal Button { margin: 0 1; }
    """

    def __init__(self, model: dict, kind: str, profile: dict) -> None:
        super().__init__()
        self._model   = model
        self._kind    = kind
        self._profile = profile
        self._argv:    list[str] = []
        self._env:     dict = {}
        self._port:    int  = 0
        self._display: str  = ""

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Ready to launch:", classes="cmd-label")
            yield Static("", id="cmd-text")
            with Horizontal():
                yield Button("Launch", variant="success", id="launch-btn")
                yield Button("Cancel", variant="default",  id="cancel-btn")

    def on_mount(self) -> None:
        self._build_preview()

    def _build_preview(self) -> None:
        import textwrap
        conn     = self.app.db
        settings = DB.get_settings(conn) if conn else {}
        config   = self._profile.get("config", {})

        if self._kind == "llama":
            server_path = settings.get("llamaServerPath") or ""
            if not server_path or not os.path.exists(server_path):
                server_path = str(get_llama_server_default())
            preferred = int(config.get("port") or 8080)
            self._port = resolve_launch_port(self.app, self._kind, preferred)
            cfg_no_port = {k: v for k, v in config.items() if k != "port"}
            argv = build_llama_command(
                self._model.get("gguf_path", ""),
                cfg_no_port,
                server_path,
                port=self._port,
            )
            self._env = build_llama_env(config, cuda_bin_path=settings.get("cudaBinPath") or None)
        else:
            preferred = int(config.get("port") or 8000)
            self._port = resolve_launch_port(self.app, self._kind, preferred)
            plan = build_vllm_command_plan(self._model, config, settings, self._port)
            self._env = plan.get("env", dict(os.environ))
            argv = [plan["executable"]] + plan["args"]

        # Reserve the port so a second concurrent launch modal can't claim it
        self.app.ports_being_started.add(self._port)

        self._argv = argv
        if self._kind == "vllm":
            self._display = build_vllm_display_command(self._model, config, settings, self._port)
        else:
            self._display = format_command_display(argv)
        wrapped = "\n".join(textwrap.wrap(self._display, width=68, break_on_hyphens=False))
        self.query_one("#cmd-text", Static).update(wrapped)

    @on(Button.Pressed, "#launch-btn")
    def _launch(self) -> None:
        title  = self._model.get("name") or self._model.get("display_name") or "server"
        config = self._profile.get("config", {})
        host   = config.get("host") or "127.0.0.1"
        self.app.do_launch(
            self._argv, self._env,
            display=self._display,
            title=title,
            kind=self._kind,
            host=host,
            port=self._port,
            model=self._model,
            profile=self._profile,
        )

    @on(Button.Pressed, "#cancel-btn")
    def _cancel(self) -> None:
        self.app.ports_being_started.discard(self._port)
        self.dismiss(None)


# ─── Claude Code helper ────────────────────────────────────────────────────────

def _copy_to_clipboard(text: str) -> bool:
    """Copy text to clipboard via the platform clipboard command."""
    try:
        if platform.system() == "Windows":
            with subprocess.Popen(["clip"], stdin=subprocess.PIPE, text=True) as p:
                p.communicate(input=text)
            return p.returncode == 0
        elif platform.system() == "Darwin":
            with subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE, text=True) as p:
                p.communicate(input=text)
            return p.returncode == 0
        else:
            with subprocess.Popen(["xclip", "-selection", "clipboard"], stdin=subprocess.PIPE, text=True) as p:
                p.communicate(input=text)
            return p.returncode == 0
    except FileNotFoundError:
        return False


def _get_api_key(profile_id: str | None) -> str:
    """Try to get the API key from the system keychain (service=llamafront)."""
    if not profile_id:
        return ""
    try:
        import keyring  # type: ignore[import-not-found]
        key = keyring.get_password("llamafront", profile_id)
        return (key or "").strip()
    except Exception:
        return ""


def _resolve_host(host: str) -> str:
    """Resolve 0.0.0.0 to 127.0.0.1 for local connections."""
    return "127.0.0.1" if host in ("0.0.0.0", "") else host


def _build_claude_code_commands(host: str, port: int, api_key: str, model_name: str) -> str:
    """Build the shell commands for 'Use with Claude Code' — mirrors the GUI exactly."""
    base_url = f"http://{_resolve_host(host)}:{port}"
    is_windows = platform.system() == "Windows"
    if is_windows:
        lines = [
            f'$env:ANTHROPIC_BASE_URL="{base_url}"',
            f'$env:ANTHROPIC_AUTH_TOKEN="{api_key}"',
            f'$env:ANTHROPIC_MODEL="{model_name}"',
            f'$env:ANTHROPIC_SMALL_FAST_MODEL="{model_name}"',
            f'$env:ANTHROPIC_DEFAULT_SONNET_MODEL="{model_name}"',
            f'$env:ANTHROPIC_DEFAULT_OPUS_MODEL="{model_name}"',
            f'$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="{model_name}"',
            "claude",
        ]
    else:
        lines = [
            f'export ANTHROPIC_BASE_URL={base_url}',
            f'export ANTHROPIC_AUTH_TOKEN={api_key}',
            f'export ANTHROPIC_MODEL={model_name}',
            f'export ANTHROPIC_SMALL_FAST_MODEL={model_name}',
            f'export ANTHROPIC_DEFAULT_SONNET_MODEL={model_name}',
            f'export ANTHROPIC_DEFAULT_OPUS_MODEL={model_name}',
            f'export ANTHROPIC_DEFAULT_HAIKU_MODEL={model_name}',
            "claude",
        ]
    return "\n".join(lines)


# ─── Server output screen ─────────────────────────────────────────────────────

from textual.screen import Screen
from textual.widgets import RichLog


class ServerOutputScreen(Screen):
    """Log viewer for a server process managed by ModelBoxApp.servers."""

    BINDINGS = [
        Binding("ctrl+q", "stop_server", "Stop server"),
        Binding("escape", "go_back",     "Back (server keeps running)"),
        Binding("ctrl+h", "chat",        "Chat", priority=True),
        Binding("ctrl+c", "use_with_claude_code", "Claude Code"),
    ]

    DEFAULT_CSS = """
    ServerOutputScreen { layout: vertical; }
    ServerOutputScreen #sos-header {
        height: 1; background: cyan; color: black;
        text-style: bold; padding: 0 1;
    }
    ServerOutputScreen RichLog {
        height: 1fr; border: round cyan; scrollbar-gutter: stable;
    }
    ServerOutputScreen #sos-footer {
        height: 1; color: $text-muted; padding: 0 1;
    }
    """

    def __init__(self, *, instance_id: str, title: str) -> None:
        super().__init__()
        self._instance_id = instance_id
        self._title       = title

    def compose(self) -> ComposeResult:
        yield Static(
            f" {self._title}  ·  Ctrl+Q stop  ·  Ctrl+H chat  ·  Ctrl+C Claude Code  ·  Esc back",
            id="sos-header",
        )
        yield RichLog(id="sos-log", markup=True, highlight=False, auto_scroll=True, wrap=True)
        yield Static("[dim]starting…[/dim]", id="sos-footer", markup=True)

    def on_mount(self) -> None:
        self._tail_logs()

    @work(thread=True)
    def _tail_logs(self) -> None:
        import time
        import textwrap as _tw

        try:
            log    = self.query_one("#sos-log", RichLog)
            footer = self.query_one("#sos-footer", Static)
        except Exception:
            return

        entry = self.app.servers.get(self._instance_id)
        if entry is None:
            self.app.call_from_thread(log.write, "[red]Server entry not found.[/red]")
            return

        if entry.display:
            parts = _tw.wrap(entry.display, width=76, break_on_hyphens=False)
            cmd = ("\n  " if len(parts) > 1 else "").join(parts)
            self.app.call_from_thread(log.write, f"[cyan]$ {cmd}[/cyan]")

        shown = 0
        while True:
            try:
                logs  = entry.logs
                state = entry.state
                if len(logs) > shown:
                    for line in logs[shown:]:
                        self.app.call_from_thread(log.write, line)
                    shown = len(logs)
                sfx   = "  [dim]Ctrl+Q to stop[/dim]" if state in ACTIVE_STATES else ""
                state_markup = get_state_markup(state, self.app.tick)
                self.app.call_from_thread(
                    footer.update,
                    f"{state_markup}  ·  {entry.host}:{entry.port}{sfx}",
                )
                if state in ("stopped", "error") and shown >= len(entry.logs):
                    break
            except Exception:
                break
            time.sleep(0.1)

    def action_stop_server(self) -> None:
        self.app.stop_server(self._instance_id)
        self._go_home()

    def action_go_back(self) -> None:
        self._go_home()

    def _go_home(self) -> None:
        from tui.screens import REPLScreen as _R
        # Pop this screen first, then any intermediate modals until REPLScreen is top
        self.app.pop_screen()
        while self.app.screen_stack and not isinstance(self.app.screen_stack[-1], _R):
            self.app.pop_screen()

    def action_chat(self) -> None:
        conn  = self.app.db
        entry = self.app.servers.get(self._instance_id)
        if conn is None or entry is None:
            return
        host = entry.host
        port = entry.port
        def _on_title(title: str | None) -> None:
            if title:
                from tui.screens import ChatScreen
                cid  = DB.create_conversation(conn, title, host, port)
                conv = {"id": cid, "title": title, "instance_host": host, "instance_port": port}
                self.app.push_screen(ChatScreen(conv))
        self.app.push_screen(
            TextInputModal("Conversation title:", default="New conversation"),
            callback=_on_title,
        )

    def action_use_with_claude_code(self) -> None:
        """Copy shell commands to use this server with Claude Code, mirroring the GUI button."""
        entry = self.app.servers.get(self._instance_id)
        if entry is None:
            self.notify("Server not found.", severity="error")
            return

        # Look up the profile_id from the DB to get the API key
        profile_id = None
        conn = self.app.db
        if conn:
            try:
                row = conn.execute(
                    "SELECT profile_id, vllm_profile_id FROM server_instances WHERE id = ?",
                    (self._instance_id,),
                ).fetchone()
                if row:
                    profile_id = row["profile_id"] or row["vllm_profile_id"]
            except Exception:
                pass

        api_key = _get_api_key(profile_id)
        model_name = entry.title
        commands = _build_claude_code_commands(entry.host, entry.port, api_key, model_name)

        if _copy_to_clipboard(commands):
            msg = "Copied Claude Code commands to clipboard — paste into your terminal."
            if not api_key:
                msg += " (No API key set — the token field is empty.)"
            self.notify(msg, severity="information")
        else:
            self.notify("Could not copy to clipboard.", severity="error")


# ─── Conversation list modal ───────────────────────────────────────────────────

class ConversationListModal(ModalScreen[dict | None]):
    """Ctrl+H chat picker. Returns selected conversation dict or None."""

    BINDINGS = [
        Binding("escape", "dismiss(None)", "Cancel"),
        Binding("n",      "new_conv",      "New"),
    ]

    DEFAULT_CSS = """
    ConversationListModal { align: center middle; }
    ConversationListModal > Vertical {
        width: 72; max-height: 34;
        border: round cyan; background: $surface; padding: 0 1;
    }
    ConversationListModal .cl-title  { color: cyan; text-style: bold; height: 1; padding: 0 1; }
    ConversationListModal .cl-footer { color: $text-muted; height: 1; padding: 0 1; }
    ConversationListModal ListView   { height: 1fr; }
    """

    def __init__(self) -> None:
        super().__init__()
        self._convs: list[dict] = []

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Conversations", classes="cl-title")
            yield ListView(id="cl-list")
            yield Label("↑↓ move   Enter open   n new   Esc cancel", classes="cl-footer")

    def on_mount(self) -> None:
        self._load()

    def _load(self) -> None:
        from rich.markup import escape as _esc
        conn = self.app.db
        if conn is None:
            return
        self._convs = DB.list_conversations(conn)
        lv = self.query_one("#cl-list", ListView)
        lv.clear()
        current_folder: str | None = "___unset___"
        for c in self._convs:
            folder = c.get("folder_name") or ""
            if folder != current_folder:
                current_folder = folder
                if folder:
                    lv.append(ListItem(Label(f"[bold dim]📁 {_esc(folder)}[/bold dim]", markup=True)))
            title   = _esc(c.get("title") or "Untitled")
            updated = (c.get("updated_at") or "")[:16]
            lv.append(ListItem(Label(f"  {title}  [dim]{updated}[/dim]", markup=True)))

    def action_new_conv(self) -> None:
        conn = self.app.db
        if conn is None:
            return
        instance = DB.get_any_running_instance(conn)
        if instance is None:
            self.app.push_screen(
                ConfirmModal("No running server found. Start one with /serve first.")
            )
            return
        host = instance.get("host") or "127.0.0.1"
        port = int(instance.get("port") or 8080)
        def _on_title(title: str | None) -> None:
            if title:
                cid  = DB.create_conversation(conn, title, host, port)
                conv = {
                    "id": cid, "title": title,
                    "instance_host": host, "instance_port": port,
                }
                self.dismiss(conv)
        self.app.push_screen(
            TextInputModal("Conversation title:", default="New conversation"),
            callback=_on_title,
        )

    @on(ListView.Selected)
    def _selected(self, event: ListView.Selected) -> None:
        idx = event.list_view.index
        if idx is None:
            return
        # Skip folder header items
        conv_items = [c for c in self._convs]
        # Map list index back to conversation (headers shift indices)
        current_folder: str | None = "___unset___"
        conv_idx = 0
        list_idx = 0
        for c in self._convs:
            folder = c.get("folder_name") or ""
            if folder != current_folder:
                current_folder = folder
                if folder:
                    if list_idx == idx:
                        return  # clicked a folder header
                    list_idx += 1
            if list_idx == idx:
                self.dismiss(c)
                return
            list_idx += 1
