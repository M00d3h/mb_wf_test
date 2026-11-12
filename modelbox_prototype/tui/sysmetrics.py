"""System metrics — mirrors src/main/services/sysStats.ts exactly.

Same nvidia-smi command, same ioreg command, same field names, same parsing logic.
"""
from __future__ import annotations

# Metric gauge colors — matched to app's existing accent palette (dark bg, rgb not ANSI)
_C_GPU  = "rgb(52,211,153)"    # emerald green
_C_VRAM = "rgb(99,161,252)"    # same blue as vLLM tag
_C_CPU  = "rgb(255,150,50)"    # same orange as llama.cpp tag
_C_RAM  = "rgb(167,139,250)"   # soft violet purple

import re
import subprocess
import sys

# ─── CPU (mirrors sampleCpu / getCpuPercent) ─────────────────────────────────

_prev_cpu: dict | None = None


def _sample_cpu() -> dict:
    import psutil
    times = psutil.cpu_times(percpu=True)
    total = sum(sum(t) for t in times)
    idle  = sum(t.idle for t in times)
    return {"total": total, "idle": idle}


def get_cpu_percent() -> float:
    global _prev_cpu
    try:
        curr = _sample_cpu()
    except Exception:
        return 0.0
    if _prev_cpu is None:
        _prev_cpu = curr
        return 0.0
    total_diff = curr["total"] - _prev_cpu["total"]
    idle_diff  = curr["idle"]  - _prev_cpu["idle"]
    _prev_cpu  = curr
    if total_diff <= 0:
        return 0.0
    return max(0.0, round((1 - idle_diff / total_diff) * 100))


# ─── RAM (mirrors getRam) ─────────────────────────────────────────────────────

def get_ram() -> dict:
    try:
        import psutil
        vm    = psutil.virtual_memory()
        total = vm.total
        free  = vm.free          # matches os.freemem() in Node.js
        used  = total - free
        return {
            "usedMb":  round(used  / 1048576),
            "totalMb": round(total / 1048576),
            "percent": round((used / total) * 100),
        }
    except Exception:
        return {"usedMb": 0, "totalMb": 0, "percent": 0}


# ─── GPU — NVIDIA (mirrors getGpu, exact same nvidia-smi invocation) ─────────

_NVIDIA_QUERY = (
    "name,utilization.gpu,utilization.memory,"
    "memory.used,memory.total,temperature.gpu,power.draw,power.limit"
)


def _get_gpu_nvidia() -> list[dict] | None:
    try:
        r = subprocess.run(
            [
                "nvidia-smi",
                f"--query-gpu={_NVIDIA_QUERY}",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True, text=True, timeout=2,
        )
        if r.returncode != 0 or not r.stdout.strip():
            return None

        gpus: list[dict] = []
        for line in r.stdout.strip().split("\n"):
            parts = [s.strip() for s in line.split(",")]
            if len(parts) < 5:
                continue

            def _f(idx: int):
                try:
                    v = float(parts[idx])
                    return None if v != v else v   # NaN → None
                except (ValueError, IndexError):
                    return None

            name      = parts[0]
            gpu_pct   = _f(1) or 0.0
            mem_pct   = _f(2) or 0.0
            mem_used  = _f(3) or 0.0
            mem_total = _f(4) or 0.0
            temp_raw  = _f(5)
            draw_raw  = _f(6)
            limit_raw = _f(7)

            temp    = round(temp_raw)                              if temp_raw  is not None else None
            draw    = round(draw_raw * 10) / 10                   if draw_raw  is not None else None
            limit   = limit_raw                                    if limit_raw is not None else None
            pwr_pct = round((draw / limit) * 100) \
                      if draw is not None and limit and limit > 0  else None

            gpus.append({
                "name":         name,
                "gpuPercent":   gpu_pct,
                "memPercent":   mem_pct,
                "memUsedMb":    mem_used,
                "memTotalMb":   mem_total,
                "temperatureC": temp,
                "powerDrawW":   draw,
                "powerLimitW":  limit,
                "powerPercent": pwr_pct,
            })
        return gpus or None
    except Exception:
        return None


# ─── GPU — macOS (mirrors getMacGpuPercent, exact same ioreg invocation) ─────

def _get_mac_gpu_percent() -> float | None:
    # AGXAccelerator = Apple Silicon, IOAccelerator = Intel Mac
    for cls in ("AGXAccelerator", "IOAccelerator"):
        try:
            r = subprocess.run(
                ["ioreg", "-r", "-d", "1", "-w", "0", "-c", cls],
                capture_output=True, text=True, timeout=2,
            )
            pattern = r'"Device Utilization %"\s*=\s*(\d+)'
            max_val: int | None = None
            for m in re.finditer(pattern, r.stdout):
                v = int(m.group(1))
                if max_val is None or v > max_val:
                    max_val = v
            if max_val is not None:
                return float(max_val)
        except Exception:
            pass
    return None


# ─── Main entry (mirrors getSystemStats) ─────────────────────────────────────

def get_system_stats() -> dict:
    is_mac  = sys.platform == "darwin"
    cpu_pct = get_cpu_percent()
    ram     = get_ram()
    gpu     = None                   if is_mac else _get_gpu_nvidia()
    mac_gpu = _get_mac_gpu_percent() if is_mac else None
    result: dict = {
        "cpu":      {"percent": cpu_pct},
        "ram":      ram,
        "gpu":      gpu,
        "platform": sys.platform,
    }
    if mac_gpu is not None:
        result["macGpuPercent"] = mac_gpu
    return result


# ─── Rich text renderer (mirrors SystemStatsPanel layout) ────────────────────

def _bar(pct: float, width: int = 20) -> str:
    filled = min(int(round(pct * width / 100)), width)
    return "█" * filled + "░" * (width - filled)


def _fmt_mb(mb: float) -> str:
    return f"{mb / 1024:.1f} GB" if mb >= 1024 else f"{mb:.0f} MB"


def render_metrics(stats: dict) -> str:
    """Return Rich markup string matching SystemStatsPanel's gauge layout."""
    is_mac  = stats.get("platform") == "darwin"
    cpu     = stats.get("cpu", {})
    ram     = stats.get("ram", {})
    gpu     = stats.get("gpu")
    mac_gpu = stats.get("macGpuPercent")

    cpu_pct = cpu.get("percent", 0)
    ram_pct = ram.get("percent", 0)
    ram_str = f"{_fmt_mb(ram.get('usedMb', 0))} / {_fmt_mb(ram.get('totalMb', 0))}"

    lines: list[str] = []

    if is_mac:
        # 3 gauges: GPU (Metal) | CPU | Unified Memory
        g_pct   = mac_gpu if mac_gpu is not None else 0.0
        g_avail = mac_gpu is not None
        g_col   = _C_GPU if g_avail else "dim"
        g_det   = f"{g_pct:.0f}%" if g_avail else "Metal stats unavailable"
        lines.append(
            f"[bold {_C_GPU}]GPU[/bold {_C_GPU}]  [{g_col}]{g_pct:3.0f}%[/{g_col}] "
            f"[{g_col}]{_bar(g_pct if g_avail else 0)}[/{g_col}]  [dim]{g_det}[/dim]"
        )
        lines.append(
            f"[bold {_C_CPU}]CPU[/bold {_C_CPU}]  [{_C_CPU}]{cpu_pct:3.0f}%[/{_C_CPU}] "
            f"[{_C_CPU}]{_bar(cpu_pct)}[/{_C_CPU}]  [dim]{cpu_pct}% across all cores[/dim]"
        )
        lines.append(
            f"[bold {_C_RAM}]MEM[/bold {_C_RAM}]  [{_C_RAM}]{ram_pct:3.0f}%[/{_C_RAM}] "
            f"[{_C_RAM}]{_bar(ram_pct)}[/{_C_RAM}]  [dim]{ram_str}[/dim]"
        )

    else:
        # 4 gauges: GPU per-card | VRAM per-card | CPU | RAM
        if gpu:
            for g in gpu:
                g_pct  = g.get("gpuPercent", 0)
                name   = g.get("name") or ""
                temp   = f" · {g['temperatureC']}°C"                             if g.get("temperatureC") is not None else ""
                power  = f" · {g['powerDrawW']}W/{g['powerLimitW']}W"            if g.get("powerDrawW") and g.get("powerLimitW") else ""
                lines.append(
                    f"[bold {_C_GPU}]GPU[/bold {_C_GPU}]  [{_C_GPU}]{g_pct:3.0f}%[/{_C_GPU}] "
                    f"[{_C_GPU}]{_bar(g_pct)}[/{_C_GPU}]  [dim]{name}{temp}{power}[/dim]"
                )
                v_used  = g.get("memUsedMb", 0)
                v_total = g.get("memTotalMb", 1)
                v_pct   = round((v_used / v_total) * 100) if v_total > 0 else 0
                lines.append(
                    f"[bold {_C_VRAM}]VRAM[/bold {_C_VRAM}] [{_C_VRAM}]{v_pct:3.0f}%[/{_C_VRAM}] "
                    f"[{_C_VRAM}]{_bar(v_pct)}[/{_C_VRAM}]  [dim]{_fmt_mb(v_used)} / {_fmt_mb(v_total)}[/dim]"
                )
        else:
            lines.append(f"[bold {_C_GPU}]GPU[/bold {_C_GPU}]   [dim]N/A  nvidia-smi not found[/dim]")
            lines.append(f"[bold {_C_VRAM}]VRAM[/bold {_C_VRAM}]  [dim]N/A[/dim]")

        lines.append(
            f"[bold {_C_CPU}]CPU[/bold {_C_CPU}]  [{_C_CPU}]{cpu_pct:3.0f}%[/{_C_CPU}] "
            f"[{_C_CPU}]{_bar(cpu_pct)}[/{_C_CPU}]  [dim]{cpu_pct}% across all cores[/dim]"
        )
        lines.append(
            f"[bold {_C_RAM}]RAM[/bold {_C_RAM}]  [{_C_RAM}]{ram_pct:3.0f}%[/{_C_RAM}] "
            f"[{_C_RAM}]{_bar(ram_pct)}[/{_C_RAM}]  [dim]{ram_str}[/dim]"
        )

    return "\n".join(lines)
