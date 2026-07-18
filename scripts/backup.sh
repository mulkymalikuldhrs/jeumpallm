#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE=$(date '+%Y%m%d_%H%M%S')

JEUMAPPA_HOME="${JEUMAPPA_HOME:-$DIR}"
JEUMAPPA_DATA="${JEUMAPPA_DATA:-${JEUMAPPA_HOME}/data}"
JEUMAPPA_BACKUP_DIR="${JEUMAPPA_BACKUP_DIR:-${JEUMAPPA_DATA}/backups}"

mkdir -p "$JEUMAPPA_BACKUP_DIR"

backup_file() {
  local src="$1"
  local name="$2"
  if [ -f "$src" ]; then
    cp "$src" "${JEUMAPPA_BACKUP_DIR}/${name}-${DATE}.bak"
    echo "  ✓ $name"
  else
    echo "  - $name (not found)"
  fi
}

echo "=== JeumpaLLM Backup ==="
echo "Date: $DATE"
echo "From: $JEUMAPPA_DATA"
echo "To:   $JEUMAPPA_BACKUP_DIR"
echo ""

backup_file "$JEUMAPPA_DATA/jeumpa.db" "jeumpa-db"
backup_file "$JEUMAPPA_DATA/rag.db" "rag-db"
backup_file "$JEUMAPPA_HOME/config.yaml" "config"
backup_file "${JEUMAPPA_ENV_FILE:-$JEUMAPPA_HOME/.env}" "env"

echo ""
echo "Cleaning backups older than 30 days..."
find "$JEUMAPPA_BACKUP_DIR" -name "*.bak" -mtime +30 -delete 2>/dev/null
echo "Done."

echo "" >> "$JEUMAPPA_BACKUP_DIR/backup.log"
echo "[$DATE] Backup complete" >> "$JEUMAPPA_BACKUP_DIR/backup.log"
