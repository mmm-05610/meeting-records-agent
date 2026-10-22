#!/bin/bash
# Fresh-install verification (A18): clone HEAD into a clean directory, install with the
# documented commands, import demo data, and run real API checks on isolated ports.
#
# Usage: bash scripts/verify/clean-install.sh [/path/to/target]
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-/home/maoqh/mra-clean-install}"
export PGPORT=55433
export PGSOCK="$TARGET/data/pg-sock"
export R2R_PORT=7282
export GATEWAY_PORT=8091
export PORT=8090
export WEB_PORT=3001

echo "== 0. stop leftovers from an earlier attempt =="
if [ -d "$TARGET/apps/agent/.venv" ]; then
  (cd "$TARGET" && for svc in web agent r2r gateway; do bash scripts/native/service.sh stop "$svc" >/dev/null 2>&1 || true; done)
fi
if [ -d "$TARGET/data/pg" ]; then
  (source "$TARGET/scripts/native/pg-env.sh" && pg_ctl -D "$PGDATA" stop >/dev/null 2>&1 || true)
fi

echo "== 1. clean clone from $SOURCE =="
rm -rf "$TARGET"
git clone -q "$SOURCE" "$TARGET"
cd "$TARGET"
export ROOT="$TARGET"
# Normalise the proxy environment (httpx rejects socks:// URLs from ALL_PROXY).
unset ALL_PROXY all_proxy
export NO_PROXY="localhost,127.0.0.1"
export no_proxy="$NO_PROXY"
echo "commit: $(git rev-parse --short HEAD)"

echo "== 2. configuration from .env.example (generated local secrets) =="
SOURCE_KEY=$(awk -F= '/^OPENCODE_GO_API_KEY=/{print $2}' "$SOURCE/.env")
gen() { python3 -c 'import secrets,sys;print(secrets.token_urlsafe(int(sys.argv[1])))' "$1"; }
R2R_SECRET=$(gen 16)
R2R_ADMIN_PW=$(gen 12)
RAG_PW=$(gen 12)
AGENT_PW=$(gen 12)
SESSION_SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
cat > .env <<ENV
OPENCODE_GO_API_KEY=$SOURCE_KEY
GATEWAY_PORT=8091
GATEWAY_UPSTREAM_BASE=https://opencode.ai/zen/go/v1
GATEWAY_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
GATEWAY_EMBEDDING_DIM=512
R2R_PORT=7282
R2R_HOST=127.0.0.1
R2R_PROJECT_NAME=meeting_records_agent
R2R_CONFIG_PATH=$TARGET/.run/r2r/meeting_records.toml
R2R_USER_TOOLS_PATH=$TARGET/deployment/r2r/user_tools
R2R_SECRET_KEY=$R2R_SECRET
R2R_ADMIN_EMAIL=owner@meeting-records.local
R2R_ADMIN_PASSWORD=$R2R_ADMIN_PW
R2R_POSTGRES_USER=rag_app
R2R_POSTGRES_PASSWORD=$RAG_PW
R2R_POSTGRES_HOST=127.0.0.1
R2R_POSTGRES_PORT=55433
R2R_POSTGRES_DBNAME=rag_db
OPENAI_API_KEY=local-gateway
OPENAI_API_BASE=http://127.0.0.1:8091/v1
LITELLM_DROP_PARAMS=True
DEFAULT_MODEL=openai-compatible
COMPATIBLE_BASE_URL=http://127.0.0.1:8091/v1
COMPATIBLE_API_KEY=local-gateway
COMPATIBLE_MODEL=deepseek-v4.1-flash
DATABASE_TYPE=postgres
POSTGRES_USER=agent_app
POSTGRES_PASSWORD=$AGENT_PW
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=55433
POSTGRES_DB=agent_db
R2R_BASE_URL=http://127.0.0.1:7282
R2R_SERVICE_EMAIL=owner@meeting-records.local
R2R_SERVICE_PASSWORD=$R2R_ADMIN_PW
MEETING_MODEL_LABEL=gateway/deepseek-v4.1-flash
MEETING_RERANK_BACKEND=fastembed
MEETING_RERANK_MODEL=BAAI/bge-reranker-base
MEETING_RERANK_CACHE_DIR=$TARGET/data/flashrank
HOST=127.0.0.1
PORT=8090
LOG_LEVEL=INFO
ENV
mkdir -p "$TARGET/.run/r2r" "$TARGET/data" "$TARGET/logs"
set -a; source .env; set +a
echo "admin: owner@meeting-records.local (password stored in $TARGET/.env)"

echo "== 3. install PostgreSQL 18 + pgvector (no root) =="
bash scripts/native/install-postgres.sh
echo "== 4. init databases =="
AGENT_DB_PASSWORD="$AGENT_PW" RAG_DB_PASSWORD="$RAG_PW" bash scripts/native/init-db.sh

echo "== 5. python/node dependencies =="
source scripts/native/uv-env.sh
(cd apps/rag/py && uv venv --python 3.12 .venv >/dev/null 2>&1 && uv pip install --python .venv/bin/python -e ".[core]" >/dev/null)
(cd apps/agent && uv sync --frozen --python 3.12 >/dev/null)
(cd services/model-gateway && uv venv --python 3.12 .venv >/dev/null 2>&1 && uv pip install --python .venv/bin/python -r requirements.txt >/dev/null)
(cd apps/web && pnpm install --no-frozen-lockfile >/dev/null)

echo "== 6. start services =="
cat > apps/web/.env.local <<WEBEOF
R2R_API_URL=http://127.0.0.1:7282
AGENT_API_URL=http://127.0.0.1:8090
R2R_ADMIN_EMAIL=owner@meeting-records.local
R2R_ADMIN_PASSWORD=$R2R_ADMIN_PW
MRA_SESSION_SECRET=$SESSION_SECRET
WEBEOF
bash scripts/native/service.sh start gateway bash scripts/native/start-gateway.sh
sleep 8
bash scripts/native/service.sh start r2r bash scripts/native/start-r2r.sh
sleep 35
bash scripts/native/service.sh start agent bash scripts/native/start-agent.sh
sleep 12
(cd apps/web && node_modules/.bin/next build > "$ROOT/logs/web-build.log" 2>&1)
bash scripts/native/service.sh start web bash scripts/native/start-web.sh
sleep 8

echo "== 7. import demo meetings =="
set -a; source .env; set +a
apps/agent/.venv/bin/python scripts/demo/import_dataset.py \
  --dir evals/datasets/sim-project-a --collection-name "模拟项目A：星河笔记" \
  --output data/imports/sim-project-a.json

echo "== 8. real API checks =="
apps/agent/.venv/bin/python scripts/verify/clean_install_check.py \
  --web "http://127.0.0.1:3001" --agent "http://127.0.0.1:8090" \
  --email "owner@meeting-records.local" --password "$R2R_ADMIN_PW" \
  --out "$ROOT/docs/evidence/clean-install.json"

echo "== 9. backup / restore drill =="
mkdir -p backups
source scripts/native/pg-env.sh
pg_dump -h 127.0.0.1 -p 55433 -U postgres -d rag_db -Fc -f backups/rag_db.dump
pg_dump -h 127.0.0.1 -p 55433 -U postgres -d agent_db -Fc -f backups/agent_db.dump
createdb -h 127.0.0.1 -p 55433 -U postgres rag_restore
pg_restore -h 127.0.0.1 -p 55433 -U postgres -d rag_restore backups/rag_db.dump
DOC_COUNT=$(psql -h 127.0.0.1 -p 55433 -U postgres -d rag_restore -tAc "select count(*) from meeting_records_agent.documents")
CHUNK_COUNT=$(psql -h 127.0.0.1 -p 55433 -U postgres -d rag_restore -tAc "select count(*) from meeting_records_agent.chunks")
dropdb -h 127.0.0.1 -p 55433 -U postgres rag_restore
echo "restore drill: documents=$DOC_COUNT chunks=$CHUNK_COUNT" | tee backups/restore-drill.txt

echo "== 10. stop services (data kept) =="
bash scripts/native/service.sh stop web || true
bash scripts/native/service.sh stop agent || true
bash scripts/native/service.sh stop r2r || true
bash scripts/native/service.sh stop gateway || true
pg_ctl -D "$PGDATA" stop >/dev/null 2>&1 || true
echo "CLEAN_INSTALL_DONE dir=$TARGET"
