#!/usr/bin/env bash
# Backup Postgres + local object storage for the hiring desk (ADR-006).
# Usage (from repo root, with compose Postgres up):
#   ./scripts/backup.sh [backup-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$ROOT/.backups/$STAMP}"
mkdir -p "$OUT"

echo "Backing up to $OUT"

docker exec platform-postgres pg_dump -U postgres -d platform -Fc \
  > "$OUT/platform.dump"

if [[ -d "$ROOT/.storage" ]]; then
  tar -C "$ROOT" -czf "$OUT/storage.tgz" .storage
else
  echo "(no .storage directory — skipped)"
fi

cat > "$OUT/MANIFEST.txt" <<EOF
created_at_utc=$STAMP
postgres=platform.dump (custom format)
storage=storage.tgz (optional)
restore=./scripts/restore.sh $OUT
EOF

echo "OK: $OUT"
ls -la "$OUT"
