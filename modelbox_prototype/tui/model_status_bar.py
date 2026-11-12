from rich.style import Style
from rich.text import Text
from textual.reactive import reactive
from textual.widget import Widget


class ModelStatusBar(Widget):
    """One-line bar: model name  │  context usage bar  │  tok/s."""

    _model_label:    reactive[str]   = reactive("—")
    _context_window: reactive[int]   = reactive(0)
    _prompt_tokens:  reactive[int]   = reactive(0)
    _toks_per_sec:   reactive[float] = reactive(0.0)

    DEFAULT_CSS = """
    ModelStatusBar {
        height: 1;
        background: $surface-lighten-1;
        color: $text-muted;
    }
    """

    def render(self) -> Text:
        t = Text(no_wrap=True, overflow="ellipsis")

        used = self._prompt_tokens
        win  = self._context_window
        tps  = self._toks_per_sec

        sep   = "   │   "
        bar_w = 12

        # ── Model ──────────────────────────────────────────────────
        t.append("  󰙴  ", style=Style(color="cyan"))
        t.append(self._model_label, style=Style(color="white", bold=True))

        # ── Context bar ─────────────────────────────────────────────
        t.append(sep, style=Style(color="#45475a"))

        used_str = f"{used:,}" if used < 10_000 else f"{used // 1_000}k"
        win_str  = f"{win // 1_000}k" if win >= 1_000 else str(win)

        if win > 0:
            pct    = min(used / win, 1.0)
            filled = round(bar_w * pct)
            bar_color = (
                "cyan"   if pct < 0.70 else
                "yellow" if pct < 0.90 else
                "red"
            )
            t.append(f"{used_str}/{win_str} ", style=Style(color="#6c7086"))
            t.append("|",                       style=Style(color="#45475a"))
            t.append("█" * filled,             style=Style(color=bar_color))
            t.append("░" * (bar_w - filled),    style=Style(color="#313244"))
            t.append("|",                       style=Style(color="#45475a"))
            t.append(f" {pct * 100:.0f}%",     style=Style(color="#6c7086"))
        elif used > 0:
            t.append(f"{used_str}/? ", style=Style(color="#6c7086"))
            t.append("|",              style=Style(color="#45475a"))
            t.append("░" * bar_w,      style=Style(color="#313244"))
            t.append("|",              style=Style(color="#45475a"))
        else:
            t.append("|",          style=Style(color="#45475a"))
            t.append("░" * bar_w,  style=Style(color="#313244"))
            t.append("|",          style=Style(color="#45475a"))

        # ── tok/s ────────────────────────────────────────────────────
        if tps > 0:
            t.append(sep, style=Style(color="#45475a"))
            t.append(f"{tps:.1f} tok/s", style=Style(color="#6c7086", dim=True))

        return t

    def set_model(self, label: str) -> None:
        self._model_label = label

    def set_context_window(self, context_window: int) -> None:
        self._context_window = context_window

    def set_tokens(self, prompt_tokens: int, toks_per_sec: float = 0.0) -> None:
        self._prompt_tokens = prompt_tokens
        self._toks_per_sec  = toks_per_sec
