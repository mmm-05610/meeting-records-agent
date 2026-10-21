#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/native/agent-env.sh"
cd "$ROOT/apps/agent"
export PYTHONPATH="$ROOT/apps/agent/src"
exec .venv/bin/uvicorn service.service:app --host 127.0.0.1 --port "${PORT:-8080}" --log-level info
