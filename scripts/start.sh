#!/bin/bash
SCRIPT="$0"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

JEUMAPPA_HOME="${JEUMAPPA_HOME:-$DIR}"
JEUMAPPA_DATA="${JEUMAPPA_DATA:-${JEUMAPPA_HOME}/data}"
JEUMAPPA_LOG_DIR="${JEUMAPPA_LOG_DIR:-${JEUMAPPA_DATA}/logs}"
JEUMAPPA_PID_DIR="${JEUMAPPA_PID_DIR:-${JEUMAPPA_DATA}/run}"
JEUMAPPA_BACKUP_DIR="${JEUMAPPA_BACKUP_DIR:-${JEUMAPPA_DATA}/backups}"

mkdir -p "$JEUMAPPA_DATA" "$JEUMAPPA_LOG_DIR" "$JEUMAPPA_PID_DIR" "$JEUMAPPA_BACKUP_DIR"

logfile="${JEUMAPPA_LOG_DIR}/jeumpa.log"
tunnel_logfile="${JEUMAPPA_LOG_DIR}/cloudflared.log"
pidfile="${JEUMAPPA_PID_DIR}/jeumpa.pid"
tunnel_pidfile="${JEUMAPPA_PID_DIR}/cloudflared.pid"

export JEUMAPPA_HOME JEUMAPPA_DATA JEUMAPPA_LOG_DIR JEUMAPPA_PID_DIR JEUMAPPA_BACKUP_DIR

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$logfile"
}

load_env() {
  local env_files=()
  [ -n "$JEUMAPPA_ENV_FILE" ] && env_files+=("$JEUMAPPA_ENV_FILE")
  env_files+=("${JEUMAPPA_HOME}/.env" "$HOME/.env" "${HOME}/.jeumpallm/.env")
  [ -d /sdcard/dhaherlabs ] && env_files+=("/sdcard/dhaherlabs/.env")
  for envf in "${env_files[@]}"; do
    [ -f "$envf" ] && set -a && source "$envf" 2>/dev/null && set +a && log "Loaded env: $envf" && return 0
  done
  log "No .env found (checked: ${env_files[*]})"
}

get_public_url() {
  local url="${JEUMAPPA_PUBLIC_URL:-$PUBLIC_URL}"
  if [ -z "$url" ] && command -v cloudflared &>/dev/null; then
    local info
    info=$(cloudflared tunnel info --output json 2>/dev/null)
    if [ -n "$info" ]; then
      url=$(echo "$info" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cname','') or next((c.get('origin_url','') for c in d.get('connections',[]) if c.get('origin_url')), ''))" 2>/dev/null)
    fi
  fi
  [ -n "$url" ] && export JEUMAPPA_PUBLIC_URL="$url" && echo "$url"
}

start_tunnel() {
  local cfg="${JEUMAPPA_TUNNEL_CONFIG:-$HOME/.cloudflared/config.yaml}"
  local tunnel_name="${JEUMAPPA_TUNNEL_NAME:-jeumpa-tunnel}"

  if [ -f "$cfg" ]; then
    if [ -f "$tunnel_pidfile" ] && kill -0 $(cat "$tunnel_pidfile") 2>/dev/null; then
      log "Tunnel already running (PID: $(cat $tunnel_pidfile))"
    else
      log "Starting Cloudflare tunnel ($tunnel_name)..."
      nohup cloudflared tunnel run "$tunnel_name" > "$tunnel_logfile" 2>&1 &
      echo $! > "$tunnel_pidfile"
      sleep 3
      if kill -0 $(cat "$tunnel_pidfile") 2>/dev/null; then
        log "Tunnel started (PID: $(cat $tunnel_pidfile))"
        get_public_url > /dev/null
        [ -n "$JEUMAPPA_PUBLIC_URL" ] && log "Public URL: ${JEUMAPPA_PUBLIC_URL}"
      else
        log "Tunnel failed - check $tunnel_logfile"
      fi
    fi
  elif command -v cloudflared &>/dev/null; then
    log "Starting quick tunnel..."
    nohup cloudflared tunnel --url "http://127.0.0.1:${PORT:-3456}" > "$tunnel_logfile" 2>&1 &
    echo $! > "$tunnel_pidfile"
    sleep 4
    local qurl=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$tunnel_logfile" 2>/dev/null | head -1)
    if [ -n "$qurl" ]; then
      export JEUMAPPA_PUBLIC_URL="$qurl"
      log "Quick tunnel: $qurl"
    fi
  else
    log "cloudflared not installed - tunnel skipped"
  fi
}

stop_tunnel() {
  if [ -f "$tunnel_pidfile" ]; then
    local pid=$(cat "$tunnel_pidfile")
    log "Stopping tunnel (PID: $pid)..."
    kill "$pid" 2>/dev/null
    for i in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null
    rm -f "$tunnel_pidfile"
    log "Tunnel stopped"
  fi
}

load_env

case "${1:-start}" in
  start)
    log "Starting JeumpaLLM..."
    log "  Home: $JEUMAPPA_HOME"
    log "  Data: $JEUMAPPA_DATA"
    log "  Logs: $JEUMAPPA_LOG_DIR"
    log "  PID:  $JEUMAPPA_PID_DIR"
    export PORT="${PORT:-3456}"
    nohup python3 "$DIR/jeumpa.py" > "$logfile" 2>&1 &
    echo $! > "$pidfile"
    log "Server PID: $(cat $pidfile)"

    start_tunnel

    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if curl -sf "http://127.0.0.1:${PORT}/v1/health" > /dev/null 2>&1; then
        log "✅ JeumpaLLM ONLINE"
        local pub=$(get_public_url)
        [ -n "$pub" ] && log "🌐 Public: ${pub}/v1"
        break
      fi
      sleep 2
      [ $i -eq 12 ] && log "⚠️  Server not responding after 24s - check $logfile"
    done
    ;;
  stop)
    log "Stopping JeumpaLLM..."
    stop_tunnel
    if [ -f "$pidfile" ]; then
      local pid=$(cat "$pidfile")
      kill "$pid" 2>/dev/null
      for i in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -9 "$pid" 2>/dev/null
      rm -f "$pidfile"
      log "Server stopped"
    else
      log "Not running"
    fi
    log "Running backup..."
    bash "$DIR/scripts/backup.sh"
    ;;
  restart)
    bash "$SCRIPT" stop && sleep 2 && bash "$SCRIPT" start
    ;;
  status)
    echo "=== JeumpaLLM Status ==="
    echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Paths:"
    echo "  HOME: $JEUMAPPA_HOME"
    echo "  DATA: $JEUMAPPA_DATA"
    echo "  LOGS: $JEUMAPPA_LOG_DIR"
    echo "  BACKUP: $JEUMAPPA_BACKUP_DIR"
    echo ""
    if [ -f "$pidfile" ] && kill -0 $(cat "$pidfile") 2>/dev/null; then
      local pid=$(cat "$pidfile")
      local uptime_sec=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
      echo "Server: RUNNING (PID: $pid)"
      [ -n "$uptime_sec" ] && printf "Uptime: %d days, %02d:%02d:%02d\n" $((uptime_sec/86400)) $(( (uptime_sec%86400)/3600 )) $(( (uptime_sec%3600)/60 )) $((uptime_sec%60))
      echo "Health:"
      curl -sf "http://127.0.0.1:${PORT:-3456}/v1/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  ERROR (unreachable)"
      echo ""
      echo "--- Tunnel ---"
      local pub="${JEUMAPPA_PUBLIC_URL}"
      if [ -n "$pub" ]; then
        echo "Public URL: $pub"
        echo "API:        ${pub}/v1"
      fi
      if [ -f "$tunnel_pidfile" ] && kill -0 $(cat "$tunnel_pidfile") 2>/dev/null; then
        local tpid=$(cat "$tunnel_pidfile")
        echo "Tunnel: RUNNING (PID: $tpid)"
        local tsize=$(stat -c%s "$tunnel_logfile" 2>/dev/null || echo 0)
        echo "Log: $((tsize / 1024)) KB"
      else
        echo "Tunnel: STOPPED"
      fi
    else
      echo "Server: STOPPED"
    fi
    echo ""
    echo "--- Resources ---"
    echo "Disk: $(df -h / | awk 'NR==2{print $4}') free"
    echo "Memory: $(free -h | awk '/Mem/{print $4}') available"
    echo "Python: $(python3 --version 2>/dev/null || echo 'N/A')"
    echo ""
    echo "--- Recent Logs ($logfile) ---"
    [ -f "$logfile" ] && tail -5 "$logfile" || echo "No log file"
    ;;
  logs)
    tail -f "$logfile"
    ;;
  tunnel)
    echo "Public URL: ${JEUMAPPA_PUBLIC_URL:-not detected}"
    echo "API Base:   ${JEUMAPPA_PUBLIC_URL:-http://127.0.0.1:${PORT:-3456}}/v1"
    echo "Tunnel config: ${JEUMAPPA_TUNNEL_CONFIG:-$HOME/.cloudflared/config.yaml}"
    get_public_url
    [ -n "$JEUMAPPA_PUBLIC_URL" ] && echo "✓ Detected: $JEUMAPPA_PUBLIC_URL" || echo "✗ No tunnel detected"
    ;;
  backup)
    bash "$DIR/scripts/backup.sh"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|tunnel|backup}"
    echo ""
    echo "Env overrides:"
    echo "  JEUMAPPA_HOME       Current: $JEUMAPPA_HOME"
    echo "  JEUMAPPA_DATA       Current: $JEUMAPPA_DATA"
    echo "  JEUMAPPA_LOG_DIR    Current: $JEUMAPPA_LOG_DIR"
    echo "  JEUMAPPA_PUBLIC_URL Current: ${JEUMAPPA_PUBLIC_URL:-not set}"
    echo "  JEUMAPPA_TUNNEL_NAME Current: ${JEUMAPPA_TUNNEL_NAME:-jeumpa-tunnel}"
    echo "  PORT                Current: ${PORT:-3456}"
    ;;
esac
