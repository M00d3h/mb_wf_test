"""Unified chat transport — mirrors src/renderer/src/lib/transport.ts exactly.

Transport selection:
  1. Probe /v1/models (2s timeout) — if OK, use OpenAICompatTransport
  2. Otherwise fall back to LlamaCppNativeTransport (/completion)

OpenAICompatTransport sends:
  stream_options: {include_usage: true, continuous_usage_stats: true}
  chat_template_kwargs: {enable_thinking: false}  — when no_thinking=True
  Reasoning tokens are wrapped in <think>...</think> markers in the token stream,
  matching exactly what the GUI transport.ts yields.

StreamChunk.token carries raw text (may be "<think>", "</think>", or content).
StreamChunk.prompt_tokens / completion_tokens are set on usage chunks (no token).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any


@dataclass
class StreamChunk:
    token: str = ""
    done: bool = False
    error: str = ""
    # Set on usage chunks emitted by OpenAI-compat servers (token is empty)
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass
class ChatMessage:
    role: str
    content: str
    think_state: str = ""    # "💭 Thought for X.Xs" — set after generation, shown in history
    think_content: str = ""  # raw thinking text — kept in-memory, enables expand/collapse


# Module-level transport cache: key = "host:port" → {transport, api_key}
_transport_cache: dict[str, dict[str, Any]] = {}


def _conn_host(host: str) -> str:
    """Map 0.0.0.0 / empty → 127.0.0.1 for connection (same as GUI transport)."""
    return "127.0.0.1" if not host or host == "0.0.0.0" else host


def _clean_model_name(model_id: str) -> str:
    """Strip path separators and file extension from a model ID.

    llama.cpp sets the model `id` to the full file path when no --alias is given.
    vLLM and aliased llama.cpp servers return a plain name, which is kept as-is.
    """
    if "/" in model_id or "\\" in model_id:
        from pathlib import Path
        return Path(model_id).stem
    return model_id


# ── OpenAI-compatible transport ───────────────────────────────────────────────

class OpenAICompatTransport:
    def __init__(self, host: str, port: int, api_key: str | None = None, model: str = "local", context_window: int = 0) -> None:
        self._host = host
        self._port = port
        self._api_key = api_key
        self._model = model
        self._context_window = context_window

    @property
    def model_name(self) -> str:
        return _clean_model_name(self._model)

    @property
    def context_window(self) -> int:
        return self._context_window

    @property
    def base_url(self) -> str:
        return f"http://{self._host}:{self._port}"

    async def stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = None,
        top_p: float | None = None,
        no_thinking: bool = False,
    ) -> AsyncIterator[StreamChunk]:
        async for chunk in self._chat_loop(messages, temperature=temperature, top_p=top_p, no_thinking=no_thinking):
            yield chunk

    async def _chat_loop(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None,
        top_p: float | None,
        no_thinking: bool,
    ) -> AsyncIterator[StreamChunk]:
        try:
            import httpx
        except ImportError:
            yield StreamChunk(error="httpx not installed — run: pip install httpx")
            return

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "stream_options": {"include_usage": True, "continuous_usage_stats": True},
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if top_p is not None:
            payload["top_p"] = top_p
        if no_thinking:
            payload["chat_template_kwargs"] = {"enable_thinking": False}

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        reasoning_started = False
        reasoning_ended = False

        # connect/write: 30 s so a non-responding server unblocks quickly.
        # read: 180 s — generous for large models with slow first-token latency;
        # None would hang _streaming=True forever if the server stops responding.
        _timeout = httpx.Timeout(connect=30.0, read=180.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=_timeout) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        yield StreamChunk(error=f"HTTP {resp.status_code}: {body.decode()[:200]}")
                        return

                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            yield StreamChunk(done=True)
                            return
                        try:
                            parsed = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        delta = (parsed.get("choices") or [{}])[0].get("delta", {})
                        reasoning: str = (
                            delta.get("reasoning_content")
                            or delta.get("reasoning")
                            or ""
                        )
                        content: str = delta.get("content") or ""

                        # Synthesize <think>...</think> markers from reasoning_content,
                        # exactly as the GUI transport.ts does.
                        if reasoning and not reasoning_ended:
                            if not reasoning_started:
                                yield StreamChunk(token="<think>")
                                reasoning_started = True
                            yield StreamChunk(token=reasoning)

                        if content:
                            if reasoning_started and not reasoning_ended:
                                yield StreamChunk(token="</think>")
                                reasoning_ended = True
                            yield StreamChunk(token=content)

                        # Usage stats — emitted per chunk with continuous_usage_stats
                        usage = parsed.get("usage")
                        if usage:
                            yield StreamChunk(
                                prompt_tokens=usage.get("prompt_tokens"),
                                completion_tokens=usage.get("completion_tokens"),
                            )

            except httpx.ConnectError:
                yield StreamChunk(
                    error=f"Cannot connect to {self._host}:{self._port} — is the server running?"
                )
            except httpx.ReadTimeout:
                yield StreamChunk(error="Request timed out.")
            except Exception as exc:
                yield StreamChunk(error=f"Stream error: {exc}")

        if reasoning_started and not reasoning_ended:
            yield StreamChunk(token="</think>")


# ── llama.cpp native transport ────────────────────────────────────────────────

class LlamaCppNativeTransport:
    def __init__(self, host: str, port: int, api_key: str | None = None) -> None:
        self._host = host
        self._port = port
        self._api_key = api_key

    @property
    def model_name(self) -> str:
        return "local"

    @property
    def context_window(self) -> int:
        return 0

    @property
    def base_url(self) -> str:
        return f"http://{self._host}:{self._port}"

    async def stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = None,
        top_p: float | None = None,
        no_thinking: bool = False,
    ) -> AsyncIterator[StreamChunk]:
        try:
            import httpx
        except ImportError:
            yield StreamChunk(error="httpx not installed — run: pip install httpx")
            return

        # Convert messages to prompt string (mirrors flattenContent + prompt build in transport.ts)
        parts: list[str] = []
        for m in messages:
            if m.role == "system":
                parts.append(f"System: {m.content}")
            elif m.role == "user":
                parts.append(f"User: {m.content}")
            else:
                parts.append(f"Assistant: {m.content}")
        prompt = "\n".join(parts) + "\nAssistant: "

        payload: dict[str, Any] = {
            "prompt": prompt,
            "stream": True,
            "n_predict": 2048,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if top_p is not None:
            payload["top_p"] = top_p

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/completion",
                    json=payload,
                    headers=headers,
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        yield StreamChunk(error=f"HTTP {resp.status_code}: {body.decode()[:200]}")
                        return

                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        try:
                            parsed = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        if parsed.get("content"):
                            yield StreamChunk(token=parsed["content"])
                        if parsed.get("stop"):
                            yield StreamChunk(done=True)
                            return

            except httpx.ConnectError:
                yield StreamChunk(
                    error=f"Cannot connect to {self._host}:{self._port} — is the server running?"
                )
            except httpx.ReadTimeout:
                yield StreamChunk(error="Request timed out.")
            except Exception as exc:
                yield StreamChunk(error=f"Stream error: {exc}")


# ── Transport resolution ──────────────────────────────────────────────────────

async def resolve_transport(
    host: str,
    port: int,
    api_key: str | None = None,
) -> OpenAICompatTransport | LlamaCppNativeTransport:
    """Probe /v1/models; cache and return the appropriate transport.

    Mirrors resolveTransport() in transport.ts:
    - Reads model ID from /v1/models response
    - Caches per host:port (invalidates on api_key mismatch)
    """
    try:
        import httpx
    except ImportError:
        return LlamaCppNativeTransport(_conn_host(host), port, api_key)

    h = _conn_host(host)
    key = f"{h}:{port}"

    cached = _transport_cache.get(key)
    if cached and cached.get("api_key") == api_key:
        t_cached = cached["transport"]
        # Only serve from cache if it's a fully-resolved OpenAI-compat transport.
        # LlamaCppNativeTransport is never returned from cache — always re-probe so
        # we upgrade as soon as the server is ready (avoids permanent "local" name).
        # OpenAICompatTransport with ctx_win==0 is also re-probed to fill in context.
        if isinstance(t_cached, OpenAICompatTransport) and t_cached._context_window != 0:
            return t_cached

    probe_headers: dict[str, str] = {}
    if api_key:
        probe_headers["Authorization"] = f"Bearer {api_key}"

    try:
        # 10 s timeout mirrors the patience of the GUI health poller; the previous
        # 2 s value caused consistent fallback to LlamaCppNativeTransport for large
        # models where the server is still warm after a long load.
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(f"http://{h}:{port}/v1/models", headers=probe_headers)
            if res.status_code == 200:
                model_id = "local"
                ctx_win  = 0
                try:
                    data = res.json()
                    first = (data.get("data") or [{}])[0]
                    if first.get("id"):
                        model_id = first["id"]
                    # vLLM exposes max_model_len; other servers use context_length
                    ctx_win = int(
                        first.get("context_length")
                        or first.get("max_model_len")
                        or first.get("max_context_length")
                        or (first.get("meta") or {}).get("n_ctx_train")
                        or 0
                    )
                except Exception:
                    pass

                # llama.cpp: /props exposes the actual running n_ctx (preferred over training ctx)
                if ctx_win == 0:
                    try:
                        props = await client.get(f"http://{h}:{port}/props", headers=probe_headers)
                        if props.status_code == 200:
                            pdata = props.json()
                            gen = pdata.get("default_generation_settings") or {}
                            for src in (gen, pdata):
                                for field in ("n_ctx", "n_ctx_train"):
                                    val = src.get(field)
                                    if val:
                                        ctx_win = int(val)
                                        break
                                if ctx_win:
                                    break
                    except Exception:
                        pass

                t: OpenAICompatTransport | LlamaCppNativeTransport = OpenAICompatTransport(
                    h, port, api_key, model_id, ctx_win
                )
                _transport_cache[key] = {"transport": t, "api_key": api_key}
                return t
    except Exception:
        pass

    # Do NOT cache the native fallback — leave the slot empty so the next call
    # re-probes and upgrades to OpenAICompatTransport once the server is ready.
    _transport_cache.pop(key, None)
    return LlamaCppNativeTransport(h, port, api_key)


def clear_transport_cache(host: str, port: int) -> None:
    _transport_cache.pop(f"{_conn_host(host)}:{port}", None)
