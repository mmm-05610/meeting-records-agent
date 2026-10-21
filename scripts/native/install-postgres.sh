#!/bin/bash
# Installs PostgreSQL 18 + pgvector into .local/ without root, using Ubuntu packages
# extracted with dpkg -x plus a source build of pgvector.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/.local/src"; DEST="$ROOT/.local/pg18"
mkdir -p "$SRC" "$DEST"
cd "$SRC"
if [ ! -x "$DEST/usr/lib/postgresql/18/bin/postgres" ]; then
  apt-get download postgresql-18 postgresql-client-18 postgresql-server-dev-18 libpq5
  for f in postgresql-18_*.deb postgresql-client-18_*.deb postgresql-server-dev-18_*.deb libpq5_*.deb; do dpkg -x "$f" "$DEST"; done
fi
PG_CONFIG="$DEST/usr/lib/postgresql/18/bin/pg_config"
if [ ! -f "$DEST/usr/lib/postgresql/18/lib/vector.so" ] && [ ! -f "$DEST/usr/lib/postgresql/18/lib/postgresql/vector.so" ]; then
  [ -f pgvector-0.8.1.tar.gz ] || curl -sSL --retry 5 --retry-all-errors -o pgvector-0.8.1.tar.gz https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.1.tar.gz
  [ -d pgvector-0.8.1 ] || tar xf pgvector-0.8.1.tar.gz
  cd pgvector-0.8.1
  make PG_CONFIG="$PG_CONFIG" with_llvm=no -j8
  make PG_CONFIG="$PG_CONFIG" with_llvm=no install
fi
"$DEST/usr/lib/postgresql/18/bin/postgres" --version
find "$DEST" -name 'vector.so' -o -name 'vector.control' | head
