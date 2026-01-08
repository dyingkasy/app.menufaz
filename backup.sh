#!/bin/bash
  set -e

  BACKUP_DIR="/opt/menufaz/backups"
  TS=$(date +"%Y%m%d_%H%M%S")
  FILE="${BACKUP_DIR}/menufaz_${TS}.sql.gz"

  docker compose exec -T postgres pg_dump -U menufaz menufaz | gzip > "$FILE"

  # Mantem apenas os ultimos 7 backups
  ls -1t ${BACKUP_DIR}/menufaz_*.sql.gz | tail -n +8 | xargs -r rm --
