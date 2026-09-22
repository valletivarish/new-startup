#!/usr/bin/env bash
# Restore a backup created by scripts/backup.sh.
# WARNING: replaces the platform database. Storage restore is best-effort merge.
# Usage:
#   ./scripts/restore.sh .backups/20260917T000000Z
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
if [[ -z "$SRC" || ! -f "$SRC/platform.dump" ]]; then
  echo "Usage: $0 <backup-dir-with-platform.dump>" >&2
  exit 1
fi

echo "Restoring DB from $SRC/platform.dump"
docker exec -i platform-postgres pg_restore -U postgres -d platform --clean --if-exists \
  < "$SRC/platform.dump"

if [[ -f "$SRC/storage.tgz" ]]; then
  echo "Restoring .storage from $SRC/storage.tgz"
  tar -C "$ROOT" -xzf "$SRC/storage.tgz"
fi

echo "OK: restore complete. Restart API/worker if they were running."
