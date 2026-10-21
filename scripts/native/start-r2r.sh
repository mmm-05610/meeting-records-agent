#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/native/uv-env.sh"
source "$ROOT/scripts/native/pg-env.sh"
set -a; [ -f "$ROOT/.env" ] && source "$ROOT/.env"; set +a
export R2R_HOST=127.0.0.1
export R2R_PORT="${R2R_PORT:-7272}"
# Render the config template so local credentials never live in the repository.
mkdir -p "$ROOT/.run/r2r"
export R2R_CONFIG_PATH="$ROOT/.run/r2r/meeting_records.toml"
envsubst < "$ROOT/deployment/r2r/meeting_records.toml.template" > "$R2R_CONFIG_PATH"
cd "$ROOT/apps/rag/py"
exec .venv/bin/r2r-serve --host 127.0.0.1 --port "$R2R_PORT"
