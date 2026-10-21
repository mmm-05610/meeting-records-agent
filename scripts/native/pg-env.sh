#!/bin/bash
# Shared native-mode (no Docker) environment for PostgreSQL 18 + pgvector.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export MRA_ROOT="$ROOT"
export PGHOME="$ROOT/.local/pg18/usr/lib/postgresql/18"
export PATH="$PGHOME/bin:$PATH"
export PGDATA="${PGDATA:-$ROOT/data/pg}"
export PGSOCK="${PGSOCK:-$ROOT/data/pg-sock}"
export PGPORT="${PGPORT:-55432}"
export PGHOST=127.0.0.1
export LD_LIBRARY_PATH="$ROOT/.local/pg18/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
# httpx rejects socks:// proxy URLs and the bracketed [::1] NO_PROXY entry;
# direct egress works from this host, so normalise the proxy environment.
unset ALL_PROXY all_proxy
export NO_PROXY="localhost,127.0.0.1"
export no_proxy="$NO_PROXY"
