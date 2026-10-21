-- One PostgreSQL instance, two databases and two roles (N02).
-- Passwords are injected by docker compose via psql variables would require shell
-- interpolation; the compose file creates roles through this SQL with the
-- passwords supplied as environment variables in deployment/env/local.env.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rag_app') THEN
    CREATE ROLE rag_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_app') THEN
    CREATE ROLE agent_app LOGIN;
  END IF;
END
$$;

SELECT 'CREATE DATABASE rag_db OWNER rag_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rag_db')\gexec
SELECT 'CREATE DATABASE agent_db OWNER agent_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_db')\gexec

\connect rag_db
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO rag_app;
GRANT ALL ON SCHEMA public TO rag_app;

\connect agent_db
ALTER SCHEMA public OWNER TO agent_app;
GRANT ALL ON SCHEMA public TO agent_app;
