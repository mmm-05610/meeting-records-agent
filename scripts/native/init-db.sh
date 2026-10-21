#!/bin/bash
# Initialises the local PostgreSQL cluster and the two product databases.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pg-env.sh"
AGENT_DB_PASSWORD="${AGENT_DB_PASSWORD:-agent_local_pw}"
RAG_DB_PASSWORD="${RAG_DB_PASSWORD:-rag_local_pw}"
mkdir -p "$PGSOCK" "$(dirname "$PGDATA")"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8
fi
if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -l "$MRA_ROOT/logs/postgres.log" \
    -o "-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1 -c max_connections=200" start
  sleep 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='agent_app') THEN
    CREATE ROLE agent_app LOGIN PASSWORD '$AGENT_DB_PASSWORD';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rag_app') THEN
    CREATE ROLE rag_app LOGIN PASSWORD '$RAG_DB_PASSWORD';
  END IF;
END \$\$;
SELECT 'roles ready';
SQL
for db in agent_db rag_db; do
  owner=agent_app; [ "$db" = "rag_db" ] && owner=rag_app
  if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    createdb -h "$PGHOST" -p "$PGPORT" -U postgres -O "$owner" "$db"
  fi
done
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d rag_db -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d rag_db -c "ALTER SCHEMA public OWNER TO rag_app; GRANT ALL ON SCHEMA public TO rag_app;"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d agent_db -c "ALTER SCHEMA public OWNER TO agent_app; GRANT ALL ON SCHEMA public TO agent_app;"
echo "INIT_DB_DONE"
