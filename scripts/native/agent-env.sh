#!/bin/bash
# Environment for the meeting agent service (native mode).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/.run/scripts/env.sh"
source "$ROOT/scripts/native/pg-env.sh"
set -a; [ -f "$ROOT/.env" ] && source "$ROOT/.env"; set +a
export MRA_ROOT="$ROOT"
export AGENT_CWD="$ROOT/apps/agent"
