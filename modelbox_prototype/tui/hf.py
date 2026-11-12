"""Hugging Face search/download helpers for the TUI."""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import quote

import httpx

HF_API = "https://huggingface.co/api"
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "ModelBox/1.0 (TUI; https://huggingface.co)",
}


def _headers() -> dict[str, str]:
    token = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or "").strip()
    if token:
        return {**HEADERS, "Authorization": f"Bearer {token}"}
    return dict(HEADERS)


@dataclass
class HubModel:
    id: str
    downloads: int | None = None
    likes: int | None = None


@dataclass
class HubFile:
    path: str
    size: int = 0


def _enc_path(path: str) -> str:
    return "/".join(quote(p, safe="") for p in path.split("/") if p)


def _assert_repo_id(repo_id: str) -> None:
    if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo_id or ""):
        raise ValueError("Invalid model id")


def _safe_seg(seg: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", seg).rstrip(".").strip()
    if not name or name in (".", ".."):
        raise ValueError("Invalid repository folder segment")
    return name


def repo_segments(repo_id: str) -> tuple[str, str]:
    _assert_repo_id(repo_id)
    ns, repo = repo_id.split("/", 1)
    return _safe_seg(ns), _safe_seg(repo)


def search_models(query: str, library: str, limit: int = 25) -> list[HubModel]:
    params = {
        "search": query,
        "limit": str(limit),
        "sort": "likes7d",
        "direction": "-1",
        "full": "true",
    }
    if library == "llama":
        params["filter"] = "gguf"
    with httpx.Client(timeout=30, follow_redirects=True, headers=_headers()) as client:
        res = client.get(f"{HF_API}/models", params=params)
        res.raise_for_status()
        rows = res.json()
    out: list[HubModel] = []
    for row in rows if isinstance(rows, list) else []:
        rid = row.get("id") or row.get("modelId")
        if not isinstance(rid, str) or "/" not in rid:
            continue
        tags = [str(t).lower() for t in row.get("tags", []) if isinstance(t, str)]
        lib = str(row.get("library_name") or "").lower()
        if library == "vllm" and ("gguf" in tags or lib == "gguf" or lib.startswith("mlx") or "mlx" in rid.lower()):
            continue
        out.append(HubModel(rid, row.get("downloads"), row.get("likes")))
    return out


def list_repo_files(repo_id: str) -> list[HubFile]:
    _assert_repo_id(repo_id)
    base = _enc_path(repo_id)
    with httpx.Client(timeout=60, follow_redirects=True, headers=_headers()) as client:
        info = client.get(f"{HF_API}/models/{base}")
        info.raise_for_status()
        sha = (info.json() or {}).get("sha")
        refs = ["main"] + ([sha] if isinstance(sha, str) and re.match(r"^[0-9a-f]{7,40}$", sha) else []) + ["master"]
        last_exc: Exception | None = None
        for ref in refs:
            try:
                rows: list[dict] = []
                url = f"{HF_API}/models/{base}/tree/{quote(str(ref), safe='')}?recursive=1"
                while url:
                    res = client.get(url)
                    res.raise_for_status()
                    data = res.json()
                    if isinstance(data, list):
                        rows.extend(data)
                    link = res.headers.get("link", "")
                    m = re.search(r'<([^>]+)>;\s*rel="next"', link)
                    url = m.group(1) if m else ""
                out: list[HubFile] = []
                seen: set[str] = set()
                for e in rows:
                    if e.get("type") not in (None, "file"):
                        continue
                    p = e.get("path")
                    if not isinstance(p, str) or "\\" in p or p in seen:
                        continue
                    seen.add(p)
                    out.append(HubFile(p, int(e.get("size") or 0)))
                return sorted(out, key=lambda f: f.path)
            except Exception as exc:
                last_exc = exc
        if last_exc:
            raise last_exc
    return []


def llama_choices(files: list[HubFile]) -> list[tuple[str, list[HubFile]]]:
    ggufs = [f for f in files if f.path.lower().endswith(".gguf")]
    groups: dict[str, list[HubFile]] = {}
    singles: list[HubFile] = []
    for f in ggufs:
        base = Path(f.path).name
        m = re.match(r"^(.+)-(\d+)-of-(\d+)\.gguf$", base, re.I)
        if not m:
            singles.append(f)
            continue
        key = f"{Path(f.path).parent.as_posix()}::{m.group(1)}::{m.group(3)}"
        groups.setdefault(key, []).append(f)
    choices: list[tuple[str, list[HubFile]]] = []
    for parts in groups.values():
        parts.sort(key=lambda x: x.path)
        total = sum(p.size for p in parts)
        stem = re.sub(r"-\d+-of-\d+\.gguf$", ".gguf", Path(parts[0].path).name, flags=re.I)
        choices.append((f"{stem} ({len(parts)} shards, {_fmt_bytes(total)})", parts))
    for f in singles:
        choices.append((f"{f.path} ({_fmt_bytes(f.size)})", [f]))
    return choices


def vllm_choice(files: list[HubFile]) -> tuple[str, list[HubFile]] | None:
    wanted = []
    for f in files:
        name = Path(f.path).name.lower()
        if name.endswith(".safetensors") or name == "config.json" or ("tokenizer" in name and (name.endswith(".json") or name.endswith(".model"))):
            wanted.append(f)
    if not any(f.path.lower().endswith(".safetensors") for f in wanted):
        return None
    return (f"All vLLM files ({len(wanted)} files, {_fmt_bytes(sum(f.size for f in wanted))})", wanted)


def _weight_folder_stem(stem: str) -> str:
    if not re.search("mmproj", stem, re.I):
        return stem or "model"
    m = re.search(r"[-_]mmproj", stem, re.I)
    return stem[:m.start()].rstrip("-_") if m and m.start() > 0 else stem


def derive_folder_name(paths: list[str], repo_id: str) -> str:
    first = Path(paths[0] if paths else "unknown").name
    repo_name = repo_segments(repo_id)[1]
    m = re.match(r"^(.+)-\d+-of-\d+\.gguf$", first, re.I)
    if m:
        return f"{repo_name}/{_weight_folder_stem(m.group(1).strip())}"
    stem = re.sub(r"\.gguf$", "", first, flags=re.I).strip()
    if re.search("mmproj", first, re.I):
        return repo_name
    return f"{repo_name}/{_weight_folder_stem(stem)}"


def _write_meta(model_dir: Path, meta: dict) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / ".hf-meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def download_files(
    *,
    repo_id: str,
    files: list[HubFile],
    models_dir: str,
    vllm_target: bool,
    progress: Callable[[str], None],
) -> tuple[Path, list[Path]]:
    ns, repo = repo_segments(repo_id)
    names = [f.path for f in files]
    sizes = [f.size for f in files]
    dest_folder = repo if vllm_target else derive_folder_name(names, repo_id)
    model_dir = Path(models_dir) / ns / dest_folder
    meta = {
        "repoId": repo_id,
        "filenames": names,
        "fileSizes": sizes,
        "modelsDir": models_dir,
        "destFolder": dest_folder,
        "complete": False,
        "vllmTarget": True if vllm_target else None,
    }
    _write_meta(model_dir, meta)
    saved: list[Path] = []
    total = sum(sizes)
    done = 0
    with httpx.Client(timeout=None, follow_redirects=True, headers=_headers()) as client:
        for i, f in enumerate(files, start=1):
            dest = Path(models_dir) / ns / dest_folder / Path(f.path).name
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + ".partial")
            if dest.exists():
                done += f.size
                saved.append(dest)
                continue
            url = f"https://huggingface.co/{_enc_path(repo_id)}/resolve/main/{_enc_path(f.path)}"
            progress(f"{i}/{len(files)} {f.path}")
            with client.stream("GET", url) as res:
                if res.status_code in (401, 403):
                    raise RuntimeError("Unauthorized - set HF_TOKEN/HUGGINGFACE_HUB_TOKEN for gated models")
                res.raise_for_status()
                with tmp.open("wb") as out:
                    received = 0
                    for chunk in res.iter_bytes():
                        out.write(chunk)
                        received += len(chunk)
                        if received % (8 * 1024 * 1024) < len(chunk):
                            progress(f"{i}/{len(files)} {Path(f.path).name}  {_fmt_bytes(done + received)}/{_fmt_bytes(total)}")
            if dest.exists():
                dest.unlink()
            tmp.replace(dest)
            done += f.size
            saved.append(dest)
    _write_meta(model_dir, {**meta, "complete": True})
    return model_dir, saved


def register_download(conn, *, library: str, repo_id: str, model_dir: Path, saved: list[Path], settings: dict) -> str:
    from tui import db as DB

    if library == "vllm":
        dtype = None
        cfg = model_dir / "config.json"
        if cfg.exists():
            try:
                raw = json.loads(cfg.read_text(encoding="utf-8"))
                dtype = raw.get("torch_dtype") or raw.get("dtype")
            except Exception:
                dtype = None
        return DB.upsert_vllm_model(conn, path=str(model_dir), display_name=repo_id, dtype=dtype)

    ggufs = [p for p in saved if p.suffix.lower() == ".gguf"]
    weights = [p for p in ggufs if "mmproj" not in p.name.lower()]
    main = sorted(weights, key=lambda p: p.name)[0] if weights else sorted(ggufs, key=lambda p: p.name)[0]
    quant = None
    m = re.search(r"-(Q[0-9A-Z_]+|IQ[0-9A-Z_]+)\.gguf$", main.name, re.I)
    if m:
        quant = m.group(1)
    return DB.upsert_llama_model(
        conn,
        model_id=str(uuid.uuid4()),
        name=model_dir.name,
        gguf_path=str(main),
        model_dir=str(model_dir),
        detected_files=[str(p) for p in saved],
        quant_label=quant,
        is_multimodal=any("mmproj" in p.name.lower() for p in ggufs),
    )


def _fmt_bytes(n: int | None) -> str:
    if not n:
        return "unknown"
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TB"


def format_bytes(n: int | None) -> str:
    return _fmt_bytes(n)
