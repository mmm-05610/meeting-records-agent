#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/.run/scripts/env.sh"
source "$ROOT/scripts/native/pg-env.sh"
set -a; [ -f "$ROOT/.env" ] && source "$ROOT/.env"; set +a
export GATEWAY_USAGE_LOG="$ROOT/data/model-gateway/usage.jsonl"
cd "$ROOT/services/model-gateway"
exec .venv/bin/python gateway.py
