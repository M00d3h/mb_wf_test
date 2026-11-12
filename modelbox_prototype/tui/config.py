"""Colors, paths, ASCII art, and command registry."""

import os
import platform
from pathlib import Path

# ─── ModelBox gradient (primary theme) ───────────────────────────────────────
MB_START_COLOR = (0, 210, 211)    # aqua / cyan
MB_END_COLOR   = (255, 255, 255)  # white
MB_UNSEL_COLOR = (0, 150, 152)    # same hue as MB_START_COLOR, darker

# ─── vLLM legacy colors — kept as named vars for tags, highlights etc. ───────
VLLM_START_COLOR   = (235, 180, 49)   # yellow
VLLM_END_COLOR     = (99,  161, 252)  # blue
VLLM_ACCENT_COLOR  = (99,  161, 252)
VLLM_UNSEL_COLOR   = (160, 195, 253)
VLLM_DESC_COLOR    = (235, 180, 49)

# ─── Per-backend tag colors ───────────────────────────────────────────────────
LLAMA_TAG_COLOR = "rgb(255,150,50)"   # orange text
LLAMA_TAG_BG    = "rgb(40,40,40)"
VLLM_TAG_COLOR  = "rgb(99,161,252)"   # blue text
VLLM_TAG_ACCENT = "rgb(235,180,49)"   # yellow accent

# ─── Server state display (mirrors GUI StatusBadge, adapted to TUI palette) ──
# Colors sourced from the GUI's Tailwind palette, adjusted to match TUI accent
# brightness (same hue family, same saturation range as metric gauge colors).
STATE_COLORS: dict[str, str] = {
    "starting":       "rgb(250,204,21)",   # amber   — Tailwind yellow-400
    "loading":        "rgb(99,161,252)",   # blue    — same as vLLM tag
    "vllm-shards":    "rgb(129,140,248)",  # indigo  — Tailwind indigo-400
    "vllm-compile":   "rgb(167,139,250)",  # violet  — same as RAM gauge
    "vllm-cudagraph": "rgb(34,211,238)",   # cyan    — Tailwind cyan-400 / near app primary
    "running":        "rgb(52,211,153)",   # emerald — same as GPU gauge
    "stopped":        "dim",
    "error":          "rgb(248,113,113)",  # rose    — Tailwind red-400
}

STATE_LABELS: dict[str, str] = {
    "starting":       "Starting",
    "loading":        "Loading",
    "vllm-shards":    "Loading shards",
    "vllm-compile":   "Compiling",
    "vllm-cudagraph": "CUDA graph",
    "running":        "Running",
    "stopped":        "Stopped",
    "error":          "Error",
}

# States where the server is still active (not yet terminal)
ACTIVE_STATES: frozenset[str] = frozenset({
    "starting", "loading", "vllm-shards", "vllm-compile", "vllm-cudagraph", "running",
})

# Transient states that get a pulsing animation (normal ↔ bright color)
ANIMATED_STATES: dict[str, tuple[str, str]] = {
    "starting":       ("rgb(250,204,21)",  "rgb(255,235,110)"),
    "loading":        ("rgb(99,161,252)",  "rgb(160,200,255)"),
    "vllm-shards":    ("rgb(129,140,248)", "rgb(200,200,255)"),
    "vllm-compile":   ("rgb(167,139,250)", "rgb(220,200,255)"),
    "vllm-cudagraph": ("rgb(34,211,238)",  "rgb(130,240,255)"),
}

# Thinking-phase label for each animated state
_THINK_LABELS: dict[str, str] = {
    "starting":       "Starting",
    "loading":        "Loading",
    "vllm-shards":    "Loading shards",
    "vllm-compile":   "Compiling",
    "vllm-cudagraph": "CUDA graph",
}


def get_state_markup(state: str, tick: int) -> str:
    """Return Rich markup for a state label, with pulse animation for transient states."""
    if pairs := ANIMATED_STATES.get(state):
        color = pairs[tick % 2]
        label = _THINK_LABELS.get(state, state)
        return f"[bold {color}]{label}[/bold {color}]"
    color = STATE_COLORS.get(state, "white")
    label = STATE_LABELS.get(state, state)
    return f"[{color}]{label}[/{color}]"

# ─── ASCII logo (MODELBOX in Doom block-letter style) ─────────────────────────
ASCII_LOGO = """\
███╗   ███╗ ██████╗ ██████╗ ███████╗██╗     ██████╗  ██████╗ ██╗  ██╗
████╗ ████║██╔═══██╗██╔══██╗██╔════╝██║     ██╔══██╗██╔═══██╗╚██╗██╔╝
██╔████╔██║██║   ██║██║  ██║█████╗  ██║     ██████╔╝██║   ██║ ╚███╔╝
██║╚██╔╝██║██║   ██║██║  ██║██╔══╝  ██║     ██╔══██╗██║   ██║ ██╔██╗
██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗███████╗██████╔╝╚██████╔╝██╔╝ ██╗
╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝"""

# ─── Command registry ─────────────────────────────────────────────────────────
COMMANDS: dict[str, str] = {
    "help":      "Show available commands",
    "models":    "List and manage all models (llama.cpp + vLLM)",
    "download":  "🤗 Download a model from Hugging Face",
    "settings":  "Manage model directories",
    "serve":     "Quick-launch: pick model → pick profile → start server",
    "configure": "Manage model profiles",
    "chat":      "Start a new conversation  (also: Ctrl+H)",
    "resume":    "Resume an existing conversation",
    "exit (quit)": "Exit ModelBox",
}


def get_db_path() -> Path:
    """Resolve llamafront.db path — mirrors Electron's app.getPath('userData')."""
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "modelbox" / "llamafront.db"
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "modelbox" / "llamafront.db"
    # Linux / other
    xdg = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
    return Path(xdg) / "modelbox" / "llamafront.db"


def get_llama_server_default() -> Path:
    """Default llama-server binary path (matches runtimeManager defaults)."""
    system = platform.system()
    exe = "llama-server.exe" if system == "Windows" else "llama-server"
    return Path.home() / ".modelbox" / "runtime" / "llama" / exe


def lerp_color(start: tuple[int, int, int], end: tuple[int, int, int], t: float) -> str:
    r = int(start[0] + (end[0] - start[0]) * t)
    g = int(start[1] + (end[1] - start[1]) * t)
    b = int(start[2] + (end[2] - start[2]) * t)
    return f"rgb({r},{g},{b})"
