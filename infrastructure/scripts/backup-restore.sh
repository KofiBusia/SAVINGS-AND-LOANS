#!/bin/bash
# Ghana Savings & Loans - Encrypted Backup Script
# Backs up PostgreSQL database with AES-256 encryption
# Stores backup in secondary Ghana location

set -euo pipefail

BACKUP_DIR="/var/backups/savings-loans"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/db_backup_${DATE}.sql"
ENCRYPTED_FILE="${BACKUP_FILE}.enc"
S3_BUCKET="${BACKUP_S3_BUCKET:-ghana-sl-backups}"
S3_REGION="${BACKUP_S3_REGION:-af-south-1}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

if [ -z "$ENCRYPTION_KEY" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_KEY must be set"
  exit 1
fi

command=$1

backup() {
  echo "[$(date)] Starting encrypted backup..."
  mkdir -p "$BACKUP_DIR"

  # Dump PostgreSQL database
  pg_dump "$DATABASE_URL" \
    --no-password \
    --format=custom \
    --compress=9 \
    > "$BACKUP_FILE"

  echo "[$(date)] Database dumped: $(du -sh $BACKUP_FILE | cut -f1)"

  # Encrypt with AES-256 (Data Protection Act 843 - encrypted backups required)
  openssl enc -aes-256-cbc \
    -pbkdf2 \
    -iter 100000 \
    -in "$BACKUP_FILE" \
    -out "$ENCRYPTED_FILE" \
    -pass "pass:${ENCRYPTION_KEY}"

  rm -f "$BACKUP_FILE"

  # Upload to secondary Ghana location
  aws s3 cp "$ENCRYPTED_FILE" \
    "s3://${S3_BUCKET}/backups/$(date +%Y/%m/%d)/$(basename $ENCRYPTED_FILE)" \
    --region "$S3_REGION" \
    --sse AES256

  # Verify upload
  aws s3 ls "s3://${S3_BUCKET}/backups/$(date +%Y/%m/%d)/" --region "$S3_REGION"

  # Clean up local encrypted file
  rm -f "$ENCRYPTED_FILE"

  echo "[$(date)] Backup complete and uploaded to s3://${S3_BUCKET}"
}

restore() {
  echo "[$(date)] Starting restore from latest backup..."
  LATEST=$(aws s3 ls "s3://${S3_BUCKET}/backups/" --region "$S3_REGION" --recursive | sort | tail -1 | awk '\''{print $4}'\'')

  if [ -z "$LATEST" ]; then
    echo "ERROR: No backups found in s3://${S3_BUCKET}"
    exit 1
  fi

  echo "Restoring from: $LATEST"
  DOWNLOAD_FILE="${BACKUP_DIR}/restore_$(date +%Y%m%d_%H%M%S).enc"

  aws s3 cp "s3://${S3_BUCKET}/${LATEST}" "$DOWNLOAD_FILE" --region "$S3_REGION"

  # Decrypt
  DECRYPTED="${DOWNLOAD_FILE%.enc}.sql"
  openssl enc -aes-256-cbc -d \
    -pbkdf2 \
    -iter 100000 \
    -in "$DOWNLOAD_FILE" \
    -out "$DECRYPTED" \
    -pass "pass:${ENCRYPTION_KEY}"

  # Restore
  pg_restore "$DATABASE_URL" --no-password --clean --if-exists "$DECRYPTED"

  rm -f "$DOWNLOAD_FILE" "$DECRYPTED"
  echo "[$(date)] Restore complete"
}

case "$command" in
  backup)  backup ;;
  restore) restore ;;
  *) echo "Usage: $0 {backup|restore}"; exit 1 ;;
esac
