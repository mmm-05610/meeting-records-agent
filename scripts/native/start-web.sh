#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/native/pg-env.sh"
export COPILOTKIT_TELEMETRY_DISABLED=true
cd "$ROOT/apps/web"
exec node_modules/.bin/next start -H 127.0.0.1 -p "${WEB_PORT:-3000}"
