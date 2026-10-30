#!/bin/sh
# Called daily by the "backup" service. Restore steps are in DEPLOY.md.
set -eu
stamp=$(date +%Y-%m-%d-%H%M)
pg_dump -h db -U tracknest -d tracknest -Fc -f "/backups/db-$stamp.dump"
tar -czf "/backups/uploads-$stamp.tar.gz" -C /uploads .
find /backups -type f -mtime +"$BACKUP_KEEP_DAYS" -delete
echo "backup $stamp done"
