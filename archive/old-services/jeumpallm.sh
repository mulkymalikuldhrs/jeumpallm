#!/bin/bash
WORKSPACE="/sdcard/dhaherlabs"
JEUM_PATH="/root/bh-ecosystem/JeumpaLLM"
PORT=${JEUMPA_LLM_PORT:-3456}
LOG="$WORKSPACE/logs/jeumpallm.log"
PIDFILE="/tmp/jeumpa.pid"

start() {
  [ -f "$PIDFILE" ] && kill $(cat "$PIDFILE") 2>/dev/null; sleep 1
  if [ ! -f "$JEUM_PATH/index.js" ]; then
    echo "[JeumpaLLM] ERROR: $JEUM_PATH/index.js not found"; exit 1
  fi
  cd "$JEUM_PATH"
  export OPENCODE_ZEN_API_KEY="${OPENCODE_ZEN_API_KEY:-sk-AmcUJKfcndoXVrUcTqvo3swHFFODOosMQcuQRDqCyeZ5HyU9Wt3PqQUVLYYEm7N3}"
  nohup node index.js >> "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 2
  if kill -0 $(cat "$PIDFILE") 2>/dev/null; then
    echo "[JeumpaLLM] Started (PID $(cat $PIDFILE), port $PORT)"
  else
    echo "[JeumpaLLM] Failed to start"; exit 1
  fi
}

stop() {
  [ -f "$PIDFILE" ] && { kill $(cat "$PIDFILE") 2>/dev/null; rm -f "$PIDFILE"; }
  echo "[JeumpaLLM] Stopped"
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
    echo "[✓] JeumpaLLM: RUNNING (PID $(cat $PIDFILE), Port $PORT)"
  else
    echo "[✗] JeumpaLLM: STOPPED"
  fi
}

case "${1:-status}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *)       echo "Usage: $0 {start|stop|restart|status}" ;;
esac
