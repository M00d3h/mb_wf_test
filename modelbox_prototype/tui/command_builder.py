"""Build llama-server and vllm serve command lines — mirrors the GUI's commandBuilder.ts
and vllmCommandBuilder.ts exactly, including WSL wrapping on Windows."""

from __future__ import annotations

import json
import os
import re
import shlex
import socket
import sys
from pathlib import Path
from typing import Any

from tui import db as DB


# ─── Port helper ──────────────────────────────────────────────────────────────

def _win_split_command(cmd: str) -> list[str]:
    """Split a Windows command string into argv without consuming backslashes.

    shlex.split in POSIX mode (default) treats \\ as an escape char, turning
    C:\\src\\llama into C:srcllama.  This parser mirrors the Electron GUI's
    parseCommandLine.ts behaviour:
      - unquoted tokens : chars read until whitespace, backslashes are literal
      - double-quoted   : only \\  -> \\ and \\" -> " are decoded inside the quotes
      - single-quoted   : no escaping at all
    """
    tokens: list[str] = []
    i = 0
    n = len(cmd)
    while i < n:
        # skip whitespace
        while i < n and cmd[i] in (' ', '\t', '\r', '\n'):
            i += 1
        if i >= n:
            break
        ch = cmd[i]
        if ch == '"':
            i += 1
            cur = ""
            while i < n:
                c = cmd[i]
                if c == '\\' and i + 1 < n and cmd[i + 1] in ('"', '\\'):
                    cur += cmd[i + 1]
                    i += 2
                elif c == '"':
                    i += 1
                    break
                else:
                    cur += c
                    i += 1
            tokens.append(cur)
        elif ch == "'":
            i += 1
            cur = ""
            while i < n:
                if cmd[i] == "'":
                    i += 1
                    break
                cur += cmd[i]
                i += 1
            tokens.append(cur)
        else:
            cur = ""
            while i < n and cmd[i] not in (' ', '\t', '\r', '\n', '"', "'"):
                cur += cmd[i]
                i += 1
            tokens.append(cur)
    return tokens


def find_free_port(preferred: int = 0) -> int:
    """Return a free TCP port. Tries preferred first, then lets the OS pick."""
    if preferred:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", preferred))
                return preferred
            except OSError:
                pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def resolve_launch_port(
    app: Any,
    kind: str,
    preferred: int,
) -> int:
    """Resolve a launch port — mirrors the GUI's portsBeingStarted + DB instance check.

    Tries *preferred* first, then increments sequentially (8502 → 8503 → …) until
    a port is found that is not:
      1. reserved in app.ports_being_started (concurrent launches this session)
      2. already in use by a running/starting/loading server in app.servers
      3. recorded as running in the DB (from a previous session)

    Falls back to a socket bind test as a last-resort safety net.
    """
    running_states = {"running", "starting", "loading", "vllm-shards", "vllm-compile", "vllm-cudagraph"}

    for _ in range(100):
        # 1. reservation set
        if preferred in getattr(app, "ports_being_started", set()):
            preferred += 1
            continue

        # 2. in-memory servers from this session
        if any(
            s.port == preferred and s.state in running_states
            for s in getattr(app, "servers", {}).values()
        ):
            preferred += 1
            continue

        # 3. DB running instances (may survive app restart)
        db_conn = getattr(app, "db", None)
        if db_conn:
            try:
                instances = DB.get_running_instances(db_conn)
                if any(i["port"] == preferred for i in instances):
                    preferred += 1
                    continue
            except Exception:
                pass

        # 4. socket bind test (catches non-ModelBox processes on the port)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", preferred))
        except OSError:
            preferred += 1
            continue

        return preferred

    # Should never reach here — 100 consecutive occupied ports is implausible
    return preferred


# ─── WSL path helpers (mirrors wslPath.ts) ────────────────────────────────────

def windows_path_to_wsl_mnt(path: str) -> str:
    """Convert C:\\Users\\foo → /mnt/c/Users/foo, or WSL UNC → linux path."""
    t = path.strip()
    if not t:
        return t
    if t.startswith("/"):
        return t
    if t.startswith("\\\\"):
        # \\wsl$\Distro\home\... or \\wsl.localhost\Distro\...
        m = re.match(r"^\\\\wsl[\$\.]localhost\\([^\\]+)\\(.+)$", t, re.IGNORECASE)
        if m:
            rest = m.group(2).replace("\\", "/")
            return f"/{rest.lstrip('/')}"
        return t
    # C:\Users\... or C:/Users/...
    m = re.match(r"^([a-zA-Z]):[/\\](.*)$", t.replace("/", "\\"))
    if m:
        drive = m.group(1).lower()
        rest  = m.group(2).replace("\\", "/")
        return f"/mnt/{drive}/{rest}"
    return t


def wsl_executable() -> str:
    """Path to wsl.exe (prefer absolute)."""
    sysroot = os.environ.get("SystemRoot", "C:\\Windows")
    candidate = os.path.join(sysroot, "System32", "wsl.exe")
    return candidate if os.path.exists(candidate) else "wsl.exe"


def pick_wsl_distro_args(distro: str | None) -> list[str]:
    d = (distro or "").strip()
    return ["-d", d] if d else []


# ─── HF repo-ID extraction (mirrors extractHfRepoId) ─────────────────────────

def extract_hf_repo_id(model_path: str) -> str | None:
    """Extract 'namespace/modelname' from an HF hub cache path, or None."""
    norm = model_path.replace("\\", "/")
    for seg in norm.split("/"):
        if not seg.startswith("models--"):
            continue
        rest = seg[len("models--"):]
        idx  = rest.find("--")
        if idx == -1:
            continue
        ns   = rest[:idx]
        name = rest[idx + 2:]
        if ns and name:
            return f"{ns}/{name}"
    return None


def to_vllm_model_path(model_path: str) -> str:
    """Convert model path for vLLM: WSL /mnt/... on Windows, normalised otherwise."""
    if sys.platform == "win32":
        return windows_path_to_wsl_mnt(model_path)
    return str(Path(model_path).resolve())


# ─── vLLM arg builders ────────────────────────────────────────────────────────

def _escape_bash_single_quoted(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


def _quote_bash_token(t: str) -> str:
    if t.startswith("--"):
        return t
    if re.match(r"^-?\d+(\.\d+)?([eE][+-]?\d+)?$", t):
        return t
    return _escape_bash_single_quoted(t)


def vllm_config_to_args(cfg: dict[str, Any]) -> list[str]:
    """Extra vllm serve argv from a VllmModelConfig dict (mirrors vllmConfigToArgs)."""
    a: list[str] = []
    if cfg.get("maxModelLen") not in (None, 0):
        a += ["--max-model-len", str(int(cfg["maxModelLen"]))]
    rp = (cfg.get("reasoningParser") or "").strip()
    if rp:
        a += ["--reasoning-parser", rp]
    if cfg.get("enableAutoToolChoice"):
        a.append("--enable-auto-tool-choice")
    tcp = (cfg.get("toolCallParser") or "").strip()
    if tcp:
        a += ["--tool-call-parser", tcp]
    smn = (cfg.get("servedModelName") or "").strip()
    if smn:
        a += ["--served-model-name", smn]
    if cfg.get("maxNumSeqs") not in (None, 0):
        a += ["--max-num-seqs", str(int(cfg["maxNumSeqs"]))]
    if cfg.get("gpuMemoryUtilization") not in (None, 0):
        a += ["--gpu-memory-utilization", str(cfg["gpuMemoryUtilization"])]
    kvd = (cfg.get("kvCacheDtype") or "").strip()
    if kvd:
        a += ["--kv-cache-dtype", kvd]
    sc = (cfg.get("speculativeConfig") or "").strip()
    if sc:
        a += ["--speculative-config", sc]
    # Sampling overrides → JSON blob
    sampling: dict[str, Any] = {}
    for py_key, vllm_key in [
        ("temperature",       "temperature"),
        ("topP",              "top_p"),
        ("topK",              "top_k"),
        ("minP",              "min_p"),
        ("repetitionPenalty", "repetition_penalty"),
        ("presencePenalty",   "presence_penalty"),
        ("frequencyPenalty",  "frequency_penalty"),
    ]:
        v = cfg.get(py_key)
        if v is not None:
            sampling[vllm_key] = v
    if sampling:
        a += ["--override-generation-config", json.dumps(sampling)]
    return a


def _build_vllm_serve_invocation(
    model_arg: str,
    host: str,
    port: int,
    cfg: dict[str, Any],
    vllm_exe: str = "vllm",
) -> str:
    """Full bash-safe `vllm serve MODEL --host HOST --port PORT ...` string."""
    tail_parts = [
        _escape_bash_single_quoted(model_arg),
        "--host", _escape_bash_single_quoted(host),
        "--port", str(port),
        *[_quote_bash_token(a) for a in vllm_config_to_args(cfg)],
    ]
    return f"{vllm_exe} serve {' '.join(tail_parts)}"


def _build_conda_run_invocation(rt: dict[str, Any], cmd: str) -> str:
    """Wrap cmd in `conda run --no-capture-output -n ENV CMD` with conda init."""
    sh  = (rt.get("condaShPath") or "").strip()
    env = (rt.get("condaEnvName") or "vllm").strip() or "vllm"
    run = f"conda run --no-capture-output -n {_escape_bash_single_quoted(env)} {cmd}"
    if sh:
        return f"source {_escape_bash_single_quoted(sh)} && {run}"
    find_conda = (
        "for _cc in ~/miniconda3/etc/profile.d/conda.sh "
        "~/miniforge3/etc/profile.d/conda.sh "
        "~/anaconda3/etc/profile.d/conda.sh "
        "/opt/conda/etc/profile.d/conda.sh; "
        "do [ -f \"$_cc\" ] && { . \"$_cc\"; break; }; done"
    )
    return f"{find_conda}; {run}"


def _normalize_vllm_runtime(rt: Any) -> dict[str, Any]:
    """Coerce missing/invalid envKind — mirrors normalizeVllmRuntime."""
    if not isinstance(rt, dict):
        return {"envKind": "conda"}
    kind = rt.get("envKind")
    if kind not in ("conda", "venv", "docker"):
        rt = dict(rt)
        rt["envKind"] = "conda"
    return rt


# ─── Main vLLM command plan ───────────────────────────────────────────────────

def build_vllm_command_plan(
    model: dict[str, Any],
    cfg: dict[str, Any],
    settings: dict[str, Any],
    port: int,
) -> dict[str, Any]:
    """
    Return {"executable": str, "args": list[str], "env": dict}.
    Mirrors buildVllmCommandPlan from vllmCommandBuilder.ts.
    """
    rt       = _normalize_vllm_runtime(settings.get("vllmRuntime") or {})
    env_kind = rt["envKind"]
    host     = (cfg.get("host") or settings.get("vllmDefaultHost") or "127.0.0.1").strip() or "127.0.0.1"

    wsl_model  = to_vllm_model_path(model.get("path", ""))
    model_arg  = extract_hf_repo_id(model.get("path", "")) or wsl_model

    # Custom launch command
    if cfg.get("launchMode") == "custom" and (cfg.get("customCommandLine") or "").strip():
        return _build_custom_vllm_plan(cfg["customCommandLine"].strip(), rt, port)

    # Docker
    if env_kind == "docker":
        return _build_docker_plan(model.get("path", ""), wsl_model, host, port, rt, cfg)

    # Windows always goes through WSL
    if sys.platform == "win32" and env_kind in ("conda", "venv"):
        return _build_win_wsl_plan(model_arg, host, port, rt, cfg)

    # Linux/Mac conda
    if env_kind == "conda":
        inner = _build_conda_run_invocation(
            rt, _build_vllm_serve_invocation(model_arg, host, port, cfg)
        )
        return {"executable": "bash", "args": ["-ic", inner], "env": dict(os.environ)}

    # Linux/Mac venv
    if env_kind == "venv":
        venv = (rt.get("venvPath") or "").strip()
        if venv:
            vllm_bin = os.path.join(venv, "bin", "vllm")
            vllm_exe = vllm_bin if os.path.exists(vllm_bin) else "vllm"
            inner    = f"source {venv}/bin/activate && {_build_vllm_serve_invocation(model_arg, host, port, cfg, vllm_exe)}"
            return {"executable": "bash", "args": ["-ic", inner], "env": dict(os.environ)}

    # Bare vllm (Linux only — never on Windows)
    if sys.platform == "win32":
        return _build_win_wsl_plan(model_arg, host, port, rt, cfg)

    return {
        "executable": "vllm",
        "args": ["serve", model_arg, "--host", host, "--port", str(port)] + vllm_config_to_args(cfg),
        "env": dict(os.environ),
    }


def _build_win_wsl_plan(
    model_arg: str,
    host: str,
    port: int,
    rt: dict[str, Any],
    cfg: dict[str, Any],
) -> dict[str, Any]:
    env_kind = rt["envKind"]
    if env_kind == "conda":
        inner = _build_conda_run_invocation(
            rt, _build_vllm_serve_invocation(model_arg, host, port, cfg)
        )
    else:
        raw_venv = (rt.get("venvPath") or "").strip()
        venv_wsl = to_vllm_model_path(raw_venv) if raw_venv else "/opt/venv"
        vllm_bin = f"{venv_wsl}/bin/vllm"
        inner    = f"source {venv_wsl}/bin/activate && {_build_vllm_serve_invocation(model_arg, host, port, cfg, vllm_bin)}"

    return {
        "executable": wsl_executable(),
        "args": [*pick_wsl_distro_args(rt.get("wslDistro")), "bash", "-ic", inner],
        "env": dict(os.environ),
    }


def _build_docker_plan(
    local_path: str,
    wsl_model: str,
    host: str,
    port: int,
    rt: dict[str, Any],
    cfg: dict[str, Any],
) -> dict[str, Any]:
    import posixpath
    image     = (rt.get("dockerImage") or "vllm/vllm-openai:latest").strip()
    extra_raw = (rt.get("dockerExtraArgs") or "").strip()
    extra     = shlex.split(extra_raw) if extra_raw else []
    m_base    = os.path.basename(local_path)

    if sys.platform == "win32":
        model_dir    = os.path.dirname(local_path)
        in_container = f"/models/{m_base}".replace("\\", "/")
        args = [
            "run", "--rm", "-p", f"{port}:{port}",
            "--gpus", "all", "-v", f"{model_dir}:/models",
            *extra,
            image, "vllm", "serve", in_container,
            "--host", host, "--port", str(port),
            *vllm_config_to_args(cfg),
        ]
    else:
        c_dir  = posixpath.dirname(wsl_model) if wsl_model.startswith("/") else os.path.dirname(local_path)
        c_base = posixpath.basename(wsl_model) if wsl_model.startswith("/") else os.path.basename(local_path)
        c_path = f"/models/{c_base}"
        args   = [
            "run", "--rm", "-p", f"{port}:{port}",
            "--gpus", "all", "-v", f"{c_dir}:/models",
            *extra,
            image, "vllm", "serve", c_path,
            "--host", host, "--port", str(port),
            *vllm_config_to_args(cfg),
        ]
    return {"executable": "docker", "args": args, "env": dict(os.environ)}


def _patch_port_in_script(script: str, port: int) -> str:
    patched = re.sub(r"--port=\S+", f"--port={port}", script)
    patched = re.sub(r"--port +\S+", f"--port {port}", patched)
    if "--port" not in patched:
        patched = f"{patched} --port {port}"
    return patched


def _build_custom_vllm_plan(
    line: str,
    rt: dict[str, Any],
    port: int,
) -> dict[str, Any]:
    try:
        parts    = _win_split_command(line) if sys.platform == "win32" else shlex.split(line)
        exe      = parts[0] if parts else line
        exe_base = os.path.basename(exe).lower().replace(".exe", "")
    except ValueError:
        exe_base = ""
        parts    = [line]

    env = dict(os.environ)

    if sys.platform == "win32" and exe_base not in ("docker",):
        # wsl.exe passthrough
        if exe_base == "wsl":
            try:
                ic_idx = next(i for i, a in enumerate(parts[1:], 1) if a in ("-ic", "-lc", "-c"))
                if ic_idx < len(parts) - 1:
                    patched  = _patch_port_in_script(parts[ic_idx + 1], port)
                    new_args = parts[1:ic_idx + 1] + [patched]
                    return {"executable": exe, "args": new_args, "env": env}
            except StopIteration:
                pass
            return {"executable": exe, "args": parts[1:], "env": env}

        # bash/sh -ic "..." — unwrap and rewrap in WSL
        if exe_base in ("bash", "sh"):
            try:
                ic_idx = next(i for i, a in enumerate(parts[1:], 1) if a in ("-ic", "-lc", "-c"))
                if ic_idx < len(parts) - 1:
                    real   = _patch_port_in_script(parts[ic_idx + 1], port)
                    inner  = _build_conda_run_invocation(rt, real) if rt["envKind"] == "conda" and "conda" not in real else real
                    return {
                        "executable": wsl_executable(),
                        "args": [*pick_wsl_distro_args(rt.get("wslDistro")), "bash", "-ic", inner],
                        "env": env,
                    }
            except StopIteration:
                pass

        # Generic command → wrap in WSL
        new_args = _apply_port_to_args(parts[1:], port)
        raw_inner = " ".join(_quote_bash_token(a) for a in [exe, *new_args])
        needs_conda = rt["envKind"] == "conda" and "conda" not in raw_inner
        inner = _build_conda_run_invocation(rt, raw_inner) if needs_conda else raw_inner
        return {
            "executable": wsl_executable(),
            "args": [*pick_wsl_distro_args(rt.get("wslDistro")), "bash", "-ic", inner],
            "env": env,
        }

    new_args = _apply_port_to_args(parts[1:], port)
    return {"executable": exe, "args": new_args, "env": env}


def _apply_port_to_args(args: list[str], port: int) -> list[str]:
    result = []
    i = 0
    while i < len(args):
        tok = args[i]
        if tok == "--port":
            i += 2
            continue
        if tok.startswith("--port="):
            i += 1
            continue
        result.append(tok)
        i += 1
    result += ["--port", str(port)]
    return result


# ─── llama.cpp command builder ────────────────────────────────────────────────

def build_llama_command(
    gguf_path: str,
    config: dict[str, Any],
    server_path: str,
    host: str = "127.0.0.1",
    port: int = 8080,
) -> list[str]:
    """Return argv list for llama-server. Mirrors commandBuilder.ts buildCommand()."""
    if config.get("launchMode") == "custom" and (config.get("customCommandLine") or "").strip():
        cmd = config["customCommandLine"].strip()
        return _win_split_command(cmd) if sys.platform == "win32" else shlex.split(cmd)

    args: list[str] = [server_path, "-m", gguf_path]

    def _add(flag: str, key: str) -> None:
        if config.get(key) is not None:
            args.extend([flag, str(config[key])])

    if config.get("alias"):
        args += ["-a", str(config["alias"])]
    if config.get("mmproj") and not config.get("mmprojDisabled"):
        args += ["--mmproj", str(config["mmproj"])]
    if config.get("embeddings"):
        args.append("--embeddings")
    _add("-c",               "contextSize")
    _add("-ngl",             "gpuLayers")
    _add("--n-cpu-moe",      "nCpuMoe")
    if config.get("flashAttn"):
        args += ["-fa", str(config["flashAttn"])]
    if config.get("fit"):
        args += ["--fit", str(config["fit"])]
    if config.get("backendSampling"):
        args.append("--backend-sampling")
    _add("--parallel",       "parallel")
    _add("-ctk",             "kvCacheTypeK")
    _add("-ctv",             "kvCacheTypeV")
    _add("--temp",           "temp")
    _add("--top-p",          "topP")
    _add("--min-p",          "minP")
    _add("--top-k",          "topK")
    _add("--repeat-penalty", "repeatPenalty")
    _add("--presence-penalty","presencePenalty")
    _add("--spec-type",      "specType")

    final_host = config.get("host") or host
    final_port = config.get("port") or port
    args += ["--host", str(final_host), "--port", str(final_port)]
    return args


def build_llama_env(config: dict[str, Any], cuda_bin_path: str | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env.update(config.get("env") or {})
    if config.get("prependCudaToPath") and cuda_bin_path:
        sep      = ";" if os.name == "nt" else ":"
        path_key = next((k for k in env if k.lower() == "path"), "PATH")
        env[path_key] = f"{cuda_bin_path}{sep}{env.get(path_key, '')}"
    return env


def resolve_launch_config(
    app: Any,
    model: dict,
    kind: str,
    profile: dict,
    settings: dict,
) -> tuple[list[str], dict, int, str]:
    """
    Resolve the final port, argv, env, and display string for a server launch.
    Mirrors the logic previously in ServerLaunchModal._build_preview.
    """
    config = profile.get("config", {})
    display = ""
    argv = []
    env = {}
    port = 0

    if kind == "llama":
        server_path = settings.get("llamaServerPath") or ""
        if not server_path or not os.path.exists(server_path):
            server_path = str(get_llama_server_default())
        preferred = int(config.get("port") or 8080)
        port = resolve_launch_port(app, kind, preferred)
        cfg_no_port = {k: v for k, v in config.items() if k != "port"}
        argv = build_llama_command(
            model.get("gguf_path", ""),
            cfg_no_port,
            server_path,
            port=port,
        )
        env = build_llama_env(config, cuda_bin_path=settings.get("cudaBinPath") or None)
        display = format_command_display(argv)
    else:
        preferred = int(config.get("port") or 8000)
        port = resolve_launch_port(app, kind, preferred)
        plan = build_vllm_command_plan(model, config, settings, port)
        env = plan.get("env", dict(os.environ))
        argv = [plan["executable"]] + plan["args"]
        display = build_vllm_display_command(model, config, settings, port)

    return argv, env, port, display

def format_command_display(argv: list[str]) -> str:
    """Human-readable, word-wrapped-friendly command string."""
    parts = []
    for a in argv:
        if " " in a or not a:
            parts.append(f'"{a}"')
        else:
            parts.append(a)
    return " ".join(parts)


def build_vllm_display_command(
    model: dict[str, Any],
    cfg: dict[str, Any],
    settings: dict[str, Any],
    port: int,
) -> str:
    """Clean 'vllm serve ...' string for display — strips WSL/conda/venv wrapper."""
    if cfg.get("launchMode") == "custom" and (cfg.get("customCommandLine") or "").strip():
        return cfg["customCommandLine"].strip()
    host = (cfg.get("host") or settings.get("vllmDefaultHost") or "0.0.0.0").strip() or "0.0.0.0"
    model_path = model.get("path", "")
    model_arg  = extract_hf_repo_id(model_path) or to_vllm_model_path(model_path)
    parts = (
        ["vllm", "serve", model_arg, "--host", host, "--port", str(port)]
        + vllm_config_to_args(cfg)
    )
    return format_command_display(parts)


# ─── Parameter metadata for the GUI-style editor ─────────────────────────────

LLAMA_PARAMS: list[dict[str, Any]] = [
    {"key": "contextSize",      "label": "context-length",    "type": "int",    "hint": "tokens"},
    {"key": "gpuLayers",        "label": "gpu-layers",        "type": "int",    "hint": "-1 = all"},
    {"key": "parallel",         "label": "parallel-slots",    "type": "int",    "hint": "concurrent requests"},
    {"key": "flashAttn",        "label": "flash-attention",   "type": "choice", "choices": ["on", "off"]},
    {"key": "temp",             "label": "temperature",       "type": "float",  "hint": "0.0–2.0"},
    {"key": "topP",             "label": "top-p",             "type": "float",  "hint": "0.0–1.0"},
    {"key": "minP",             "label": "min-p",             "type": "float",  "hint": "0.0–1.0"},
    {"key": "topK",             "label": "top-k",             "type": "int",    "hint": "0 = disabled"},
    {"key": "repeatPenalty",    "label": "repeat-penalty",    "type": "float",  "hint": "1.0 = disabled"},
    {"key": "presencePenalty",  "label": "presence-penalty",  "type": "float"},
    {"key": "kvCacheTypeK",     "label": "kv-cache-type-k",   "type": "choice", "choices": ["f16", "q8_0", "q4_0", "auto"]},
    {"key": "kvCacheTypeV",     "label": "kv-cache-type-v",   "type": "choice", "choices": ["f16", "q8_0", "q4_0", "auto"]},
    {"key": "nCpuMoe",          "label": "cpu-moe-layers",    "type": "int"},
    {"key": "backendSampling",  "label": "backend-sampling",  "type": "bool"},
    {"key": "embeddings",       "label": "embeddings-mode",   "type": "bool"},
    {"key": "host",             "label": "host",              "type": "str",    "hint": "127.0.0.1"},
    {"key": "port",             "label": "port",              "type": "int",    "hint": "8080"},
]

VLLM_PARAMS: list[dict[str, Any]] = [
    {"key": "maxModelLen",          "label": "max-model-len",         "type": "int"},
    {"key": "maxNumSeqs",           "label": "max-num-seqs",          "type": "int"},
    {"key": "gpuMemoryUtilization", "label": "gpu-memory-util",       "type": "float", "hint": "0.0–1.0"},
    {"key": "kvCacheDtype",         "label": "kv-cache-dtype",        "type": "choice", "choices": ["auto", "fp8", "fp8_e5m2", "fp8_e4m3"]},
    {"key": "servedModelName",      "label": "served-model-name",     "type": "str"},
    {"key": "enableAutoToolChoice", "label": "auto-tool-choice",      "type": "bool"},
    {"key": "toolCallParser",       "label": "tool-call-parser",      "type": "str"},
    {"key": "reasoningParser",      "label": "reasoning-parser",      "type": "str"},
    {"key": "speculativeConfig",    "label": "speculative-config",    "type": "str",   "hint": "JSON"},
    {"key": "temperature",          "label": "temperature",           "type": "float"},
    {"key": "topP",                 "label": "top-p",                 "type": "float"},
    {"key": "topK",                 "label": "top-k",                 "type": "int"},
    {"key": "minP",                 "label": "min-p",                 "type": "float"},
    {"key": "repetitionPenalty",    "label": "repetition-penalty",    "type": "float"},
    {"key": "host",                 "label": "host",                  "type": "str",   "hint": "0.0.0.0"},
    {"key": "port",                 "label": "port",                  "type": "int",   "hint": "8000"},
]
