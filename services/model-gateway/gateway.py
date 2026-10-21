"""Local model gateway: OpenAI-compatible embeddings (local ONNX model) and
chat-completions proxy for the opencode-go endpoint.

Product code talks to this gateway only; provider keys stay server-side.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

GATEWAY_PORT = int(os.getenv("GATEWAY_PORT", "8081"))
EMBEDDING_MODEL = os.getenv("GATEWAY_EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5")
EMBEDDING_DIM = int(os.getenv("GATEWAY_EMBEDDING_DIM", "512"))
UPSTREAM_BASE = os.getenv("GATEWAY_UPSTREAM_BASE", "https://opencode.ai/zen/go/v1").rstrip("/")
UPSTREAM_KEY = os.getenv("GATEWAY_UPSTREAM_KEY") or os.getenv("OPENCODE_GO_API_KEY", "")
UPSTREAM_SESSION = os.getenv("GATEWAY_UPSTREAM_SESSION", f"mra-{uuid.uuid4().hex[:16]}")
USAGE_LOG = Path(os.getenv("GATEWAY_USAGE_LOG", "data/model-gateway/usage.jsonl"))

app = FastAPI(title="meeting-records-agent model gateway")
_embedder = None
_usage_lock = None


def _embedder_instance():
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding

        _embedder = TextEmbedding(model_name=EMBEDDING_MODEL)
    return _embedder


def _log_usage(record: dict[str, Any]) -> None:
    USAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    record["ts"] = time.time()
    with USAGE_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": EMBEDDING_DIM,
        "upstream": UPSTREAM_BASE,
    }


@app.get("/v1/models")
def models() -> dict[str, Any]:
    data = [{"id": EMBEDDING_MODEL, "object": "model", "owned_by": "local"}]
    try:
        resp = httpx.get(
            f"{UPSTREAM_BASE}/models",
            trust_env=False,
            headers={"Authorization": f"Bearer {UPSTREAM_KEY}"},
            timeout=20.0,
        )
        if resp.status_code == 200:
            for item in resp.json().get("data", []):
                data.append({"id": item["id"], "object": "model", "owned_by": item.get("owned_by", "upstream")})
    except Exception as exc:  # noqa: BLE001 - upstream listing is best effort
        data.append({"id": "upstream-unavailable", "object": "model", "owned_by": str(exc)[:80]})
    return {"object": "list", "data": data}


@app.post("/v1/embeddings")
async def embeddings(request: Request) -> JSONResponse:
    body = await request.json()
    raw_input = body.get("input", [])
    texts = [raw_input] if isinstance(raw_input, str) else list(raw_input)
    started = time.time()
    vectors = [list(map(float, vec)) for vec in _embedder_instance().embed(texts)]
    if vectors and len(vectors[0]) != EMBEDDING_DIM:
        raise ValueError(f"embedding dimension mismatch: {len(vectors[0])} != {EMBEDDING_DIM}")
    _log_usage(
        {
            "kind": "embeddings",
            "model": body.get("model", EMBEDDING_MODEL),
            "inputs": len(texts),
            "chars": sum(len(t) for t in texts),
            "latency_ms": round((time.time() - started) * 1000, 1),
        }
    )
    return JSONResponse(
        {
            "object": "list",
            "data": [
                {"object": "embedding", "index": idx, "embedding": vec}
                for idx, vec in enumerate(vectors)
            ],
            "model": body.get("model", EMBEDDING_MODEL),
            "usage": {"prompt_tokens": sum(len(t) for t in texts), "total_tokens": sum(len(t) for t in texts)},
        }
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    stream = bool(body.get("stream"))
    headers = {
        "Authorization": f"Bearer {UPSTREAM_KEY}",
        "x-opencode-session": UPSTREAM_SESSION,
        "Content-Type": "application/json",
    }
    started = time.time()
    if stream:
        async def generator():
            async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
                async with client.stream(
                    "POST", f"{UPSTREAM_BASE}/chat/completions", json=body, headers=headers
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
            _log_usage({"kind": "chat", "model": body.get("model"), "stream": True,
                        "latency_ms": round((time.time() - started) * 1000, 1)})

        return StreamingResponse(generator(), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
        resp = await client.post(f"{UPSTREAM_BASE}/chat/completions", json=body, headers=headers)
    payload = resp.json()
    usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
    _log_usage(
        {
            "kind": "chat",
            "model": body.get("model"),
            "stream": False,
            "status": resp.status_code,
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "total_tokens": usage.get("total_tokens"),
            "latency_ms": round((time.time() - started) * 1000, 1),
        }
    )
    return JSONResponse(payload, status_code=resp.status_code)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=GATEWAY_PORT, log_level="info")
