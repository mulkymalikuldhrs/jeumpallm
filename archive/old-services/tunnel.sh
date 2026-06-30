#!/data/data/com.termux/files/usr/bin/bash
# Dhaher Labs — Global SSH Tunnel (Serveo)
# Auto-reconnect, Telegram notify, subdomain auto-detect

WORKSPACE="/sdcard/dhaherlabs"
LOG="$WORKSPACE/logs/tunnel.log"
LINK_FILE="$WORKSPACE/data/tunnel-link.txt"
CONFIG_FILE="$WORKSPACE/configs/ssh-client-config.txt"
PIDFILE="/tmp/dhaher-tunnel.pid"

# Telegram — baca dari credentials.md
BOT_TOKEN=$(grep -A1 'dhaherautobot' /sdcard/dhaherlabs/credentials.md 2>/dev/null | grep -oE '[0-9]+:[A-Za-z0-9_-]+' | head -1)
CHAT_ID="1474659350"

mkdir -p "$WORKSPACE/logs" "$WORKSPACE/data" "$WORKSPACE/configs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

notify_telegram() {
    [ -z "$BOT_TOKEN" ] && return
    curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
        -d chat_id="$CHAT_ID" -d parse_mode="Markdown" -d text="$1" >/dev/null 2>&1
}

trap "log 'Shutting down...'; rm -f $PIDFILE; exit 0" SIGINT SIGTERM

update_client_config() {
    local domain="$1"
    cat > "$CONFIG_FILE" <<EOF
==================================================================
 SSH CLIENT CONFIG — Copy ke ~/.ssh/config di perangkat LAIN
==================================================================
Tambahkan blok ini:

Host dhaher
    HostName localhost
    Port 8022
    User root
    ProxyCommand ssh -W localhost:80 $domain
    ServerAliveInterval 30
    ServerAliveCountMax 3
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null

Login: ssh dhaher
Password: root

ATAU (tanpa ProxyCommand, langsung):
Host dhaher-direct
    HostName dhaher.serveousercontent.com
    Port 8022
    User root
    ServerAliveInterval 30
    ServerAliveCountMax 3
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
Login: ssh dhaher-direct
Password: root
==================================================================
EOF
}

start_tunnel() {
    log "Starting tunnel..."
    
    if [ ! -f /root/.ssh/id_ed25519 ]; then
        mkdir -p /root/.ssh
        ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -q
    fi
    
    # Subdomain: dhaher.serveousercontent.com (registered)
    local FORWARD="dhaher:80"
    local SUBDOMAIN="dhaher.serveousercontent.com"
    
    local PREV_URL=""
    
    while true; do
        OUTPUT=$(timeout 600 ssh -o StrictHostKeyChecking=no \
                     -o ServerAliveInterval=30 \
                     -o ServerAliveCountMax=3 \
                     -o ExitOnForwardFailure=yes \
                     -o ConnectTimeout=15 \
                     -R "${FORWARD}:localhost:8022" \
                     serveo.net 2>&1)
        
        URL=$(echo "$OUTPUT" | grep -oE 'https?://[^ ]+' | grep -v 'console.serveo.net' | head -1 | tr -d '\r')
        
        # Fallback: if no URL extracted, use subdomain
        if [ -z "$URL" ]; then
            URL="https://${SUBDOMAIN}"
        fi
        
        if [ -n "$URL" ]; then
            echo "$URL" > "$LINK_FILE"
            update_client_config "$SUBDOMAIN"
            log "TUNNEL ACTIVE: $URL"
            
            if [ "$URL" != "$PREV_URL" ] || [ ! -f /tmp/tunnel-notified ]; then
                PREV_URL="$URL"
                touch /tmp/tunnel-notified
                LOCAL_IP=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $2}' | cut -d/ -f1 | head -1)
                MSG="🔗 *Dhaher Labs — SSH TUNNEL AKTIF*
Domain: \`$SUBDOMAIN\`
Tunnel: \`$URL\`

🌐 *LAN (jamin work)*:
\`\`\`
ssh -p 8022 root@$LOCAL_IP
\`\`\`

🌍 *GLOBAL*:
\`\`\`
ssh -J $SUBDOMAIN -p 8022 root@localhost
\`\`\`
Password: \`root\`"
                notify_telegram "$MSG"
                log "Telegram notification sent"
            fi
        else
            log "Tunnel failed, retry in 10s..."
        fi
        
        sleep 10
    done
}

show_status() {
    LOCAL_IP=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $2}' | cut -d/ -f1 | head -1)
    SUBDOMAIN="dhaher.serveousercontent.com"
    
    echo "╔══════════════════════════════════════╗"
    echo "║        DHAHER LABS — SSH ✅          ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo "🌐 Domain: $SUBDOMAIN"
    echo "   Tunnel: $(cat $LINK_FILE 2>/dev/null || echo 'connecting...')"
    echo ""
    echo "🔗 LAN (jamin work!):"
    echo "   ssh -p 8022 root@$LOCAL_IP"
    echo ""
    echo "🌍 GLOBAL:"
    echo "   ssh -J $SUBDOMAIN -p 8022 root@localhost"
    echo ""
    echo "   Password: root"
}

case "${1:-status}" in
    start)
        echo "$$" > "$PIDFILE"
        start_tunnel
        ;;
    stop)
        pkill -f "serveo.net" 2>/dev/null
        rm -f "$PIDFILE"
        log "Stopped"
        notify_telegram "🛑 *Dhaher Labs — SSH TUNNEL MATI*
Jalankan: \`tunnel.sh start\` dari opencode"
        ;;
    restart)
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        if pgrep -f "serveo.net" >/dev/null 2>&1; then
            echo "PID: $(pgrep -f 'serveo.net' | head -1)"
            show_status
        else
            echo "Tunnel: STOPPED"
        fi
        ;;
    link)
        cat "$LINK_FILE" 2>/dev/null || echo "No link yet"
        ;;
    config)
        cat "$CONFIG_FILE" 2>/dev/null || echo "No config yet"
        ;;
    key)
        echo "=== PUBLIC KEY — Daftarkan di https://console.serveo.net ==="
        cat /root/.ssh/id_ed25519.pub
        echo ""
        echo "Setelah register, tunnel otomatis pakai subdomain: dhaher.serveo.net"
        echo "URL menjadi TETAP dan tidak berubah."
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|link|config|key}"
        ;;
esac
