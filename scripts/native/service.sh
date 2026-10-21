#!/bin/bash
# Small helper to start/stop native services with pid files.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDDIR="$ROOT/.run/pids"
mkdir -p "$PIDDIR"

start() {
  local name="$1"; shift
  if [ -f "$PIDDIR/$name.pid" ] && kill -0 "$(cat "$PIDDIR/$name.pid")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$PIDDIR/$name.pid"))"; return 0
  fi
  nohup "$@" > "$ROOT/logs/$name.log" 2>&1 &
  echo $! > "$PIDDIR/$name.pid"
  echo "started $name (pid $!)"
}

stop() {
  local name="$1"
  if [ -f "$PIDDIR/$name.pid" ]; then
    local pid; pid="$(cat "$PIDDIR/$name.pid")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; sleep 2; fi
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null; fi
    rm -f "$PIDDIR/$name.pid"
    echo "stopped $name"
  else
    echo "$name not tracked"
  fi
}

status() {
  for f in "$PIDDIR"/*.pid; do
    [ -e "$f" ] || continue
    local name pid; name="$(basename "$f" .pid)"; pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then echo "$name RUNNING pid=$pid"; else echo "$name DEAD pid=$pid"; fi
  done
}

case "${1:-}" in
  start) shift; start "$@" ;;
  stop) stop "$2" ;;
  status) status ;;
  *) echo "usage: service.sh start <name> <cmd...> | stop <name> | status"; exit 1 ;;
esac
