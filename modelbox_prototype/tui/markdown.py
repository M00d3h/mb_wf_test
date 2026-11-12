"""Markdown → Rich renderables. Two-pass: extract code/tables, then render remainder."""

from __future__ import annotations

import re
from typing import Any

from rich.markdown import Markdown
from rich.padding import Padding
from rich.style import Style
from rich.syntax import Syntax
from rich.text import Text
from rich.box import SQUARE
from rich.table import Table

FENCED_RE = re.compile(r"^```(\w*)\n(.*?)^```\s*$", re.MULTILINE | re.DOTALL)

_TABLE_RE = re.compile(
    r"^(\|.+)\n"
    r"(\|[\s\-\|:]+)\n"
    r"((?:\|.+\n?)*)",
    re.MULTILINE,
)


def _resolve_theme() -> str:
    """Return the first available Pygments theme from the preference list."""
    from pygments.styles import get_style_by_name
    from pygments.util import ClassNotFound
    for name in ("nord", "github-dark", "dracula", "native", "monokai"):
        try:
            get_style_by_name(name)
            return name
        except ClassNotFound:
            continue
    return "monokai"


_THEME = _resolve_theme()


def _make_syntax(code: str, language: str, line_numbers: bool = True) -> Syntax:
    code = code.removesuffix("\n")
    lang = language or "text"
    return Syntax(
        code, lang,
        theme=_THEME,
        line_numbers=line_numbers,
        word_wrap=True,
        indent_guides=True,
    )


def _parse_cell(text: str) -> str:
    return text.strip()


def _md_to_rich(text: str) -> Text:
    out = text.replace("[", "\\[").replace("]", "\\]")
    out = re.sub(r"`([^`]+)`", r"[cyan]\1[/cyan]", out)
    out = re.sub(r"\*\*(.+?)\*\*", r"[bold]\1[/bold]", out)
    out = re.sub(r"\*(.+?)\*", r"[italic]\1[/italic]", out)
    out = re.sub(r"~~(.+?)~~", r"[overline]\1[/overline]", out)
    return Text.from_markup(out)


def _split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [_parse_cell(c) for c in line.split("|")]


def _make_table(text: str) -> Table:
    m = _TABLE_RE.match(text)
    if not m:
        raise ValueError("not a table")

    header = _split_row(m.group(1))
    separator = _split_row(m.group(2))
    body = [_split_row(ln) for ln in m.group(3).strip().split("\n") if m.group(3).strip()]

    alignments: list[str] = []
    for s in separator:
        s = s.strip()
        if s.startswith(":") and s.endswith(":"):
            alignments.append("center")
        elif s.startswith(":"):
            alignments.append("left")
        elif s.endswith(":"):
            alignments.append("right")
        else:
            alignments.append("left")

    t = Table(
        box=SQUARE,
        border_style=Style(color="cyan"),
        show_header=True,
        show_edge=True,
        show_lines=True,
        padding=(0, 1),
    )

    for i, col in enumerate(header):
        align = alignments[i] if i < len(alignments) else "left"
        t.add_column(_md_to_rich(col), no_wrap=True, justify=align)

    for row in body:
        t.add_row(*[_md_to_rich(cell) for cell in row])

    return t


def render_markdown(text: str) -> list[Any]:
    """Return a list of Rich renderables for the given markdown text.

    Code blocks: syntax-highlighted Syntax objects (monokai theme + line numbers).
    Tables: bordered Rich Table with cyan borders.
    Everything else: Rich's Markdown engine.
    """
    parts: list[Any] = []

    code_blocks: list[tuple[str, str]] = []

    def _save_code(m: re.Match) -> str:
        code_blocks.append((m.group(1), m.group(2)))
        return f"\n__CODE_BLOCK_{len(code_blocks) - 1}__\n"

    stripped = FENCED_RE.sub(_save_code, text)

    table_blocks: list[str] = []

    def _save_table(m: re.Match) -> str:
        table_blocks.append(m.group(0))
        return f"\n__TABLE_{len(table_blocks) - 1}__\n"

    stripped = _TABLE_RE.sub(_save_table, stripped)

    # Handle a partial (unclosed) code fence at the end — happens during streaming
    # when the closing ``` hasn't arrived yet. FENCED_RE only matches complete blocks,
    # so the partial block survives substitution as raw text. Convert it to a
    # placeholder so it gets the same Syntax+Padding treatment as finished blocks.
    _partial = re.search(r"```(\w*)\n(.*)$", stripped, re.DOTALL)
    if _partial:
        stripped = stripped[: _partial.start()] + f"\n__CODE_BLOCK_{len(code_blocks)}__\n"
        code_blocks.append((_partial.group(1), _partial.group(2)))

    for seg_type, seg_value in _split_placeholders(stripped):
        if seg_type == "code":
            idx = int(seg_value)
            language, code = code_blocks[idx]
            code = code.removesuffix("\n")
            num_lines = code.count("\n") + 1
            parts.append(Padding(_make_syntax(code, language, line_numbers=num_lines > 1), pad=(1, 3)))
        elif seg_type == "table":
            idx = int(seg_value)
            try:
                parts.append(_make_table(table_blocks[idx]))
            except Exception:
                parts.append(Markdown(table_blocks[idx]))
        else:
            block = seg_value.strip()
            if block:
                md = Markdown(block)
                md._code_theme = _THEME
                parts.append(md)

    return parts


def _split_placeholders(text: str) -> list[tuple[str, str]]:
    pattern = re.compile(r"__CODE_BLOCK_(\d+)__|__TABLE_(\d+)__")
    results: list[tuple[str, str]] = []
    last = 0

    for m in pattern.finditer(text):
        if m.start() > last:
            chunk = text[last:m.start()]
            if chunk.strip():
                results.append(("text", chunk))
        last = m.end()
        if m.group(1) is not None:
            results.append(("code", m.group(1)))
        else:
            results.append(("table", m.group(2)))

    if last < len(text):
        chunk = text[last:]
        if chunk.strip():
            results.append(("text", chunk))

    return results
