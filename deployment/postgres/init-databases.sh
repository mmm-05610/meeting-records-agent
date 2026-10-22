#!/bin/bash
# Creates the two product databases and their login roles with the passwords from
# the compose environment. Runs once on an empty PostgreSQL data volume.
set -euo pipefail

: "${RAG_DB_PASSWORD:?set RAG_DB_PASSWORD}"
: "${AGENT_DB_PASSWORD:?set AGENT_DB_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rag_app') THEN
    CREATE ROLE rag_app LOGIN PASSWORD '${RAG_DB_PASSWORD}';
  ELSE
    ALTER ROLE rag_app WITH LOGIN PASSWORD '${RAG_DB_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_app') THEN
    CREATE ROLE agent_app LOGIN PASSWORD '${AGENT_DB_PASSWORD}';
  ELSE
    ALTER ROLE agent_app WITH LOGIN PASSWORD '${AGENT_DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
SELECT 'CREATE DATABASE rag_db OWNER rag_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rag_db')\gexec
SELECT 'CREATE DATABASE agent_db OWNER agent_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_db')\gexec
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rag_db <<-SQL
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO rag_app;
GRANT ALL ON SCHEMA public TO rag_app;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname agent_db <<-SQL
ALTER SCHEMA public OWNER TO agent_app;
GRANT ALL ON SCHEMA public TO agent_app;
SQL
