# Backup Scripts and Disaster Recovery Procedures

## Purpose
This document establishes the operational shell scripting blueprints, automation schedules, and recovery methodologies for the NewsOps Cloud digital publishing platform. It ensures that transactional databases, fast-access key-value caches, and distributed static media assets are backed up continuously, encrypted, replicated across geographical regions, and restorable under defined Service Level Agreements (SLAs).

## Executive Summary
To protect publishing workflows against infrastructure failures, data corruption, ransomware, or regional cloud outages, NewsOps Cloud relies on three primary backup pillars:
1. **Relational Database (PostgreSQL)**: Captured through daily compressed logical dumps and continuous streaming of Write-Ahead Logs (WAL) for Point-in-Time Recovery (PITR).
2. **In-Memory Cache & Session Store (Redis)**: Captured through automated disk snapshot exports (`dump.rdb`) executed during off-peak hours.
3. **Asset Storage (S3 Media Buckets)**: Replicated in real-time using AWS S3 Cross-Region Replication (CRR) and synchronized via automated fallback scripts.
This document details the exact shell scripts, CLI invocations, restoration runbooks, and disaster recovery architectures required to achieve an RPO of less than 5 minutes and an RTO of less than 30 minutes.

## Vision
To establish an automated, zero-trust backup infrastructure where human error, ransomware, and infrastructure failures have zero permanent impact on the integrity and availability of news production data.

## Scope
- Scripting for PostgreSQL backup (`pg_dump` with custom gzip/zstd compression) and recovery.
- Scripting for Redis snapshot generation (`BGSAVE`) and extraction.
- Scripting for S3 media folder synchronization across distinct buckets.
- Automation configuration via Systemd Timers and Cron.
- Step-by-step restoration procedures for all three layers.
- Storage retention, KMS encryption, and multi-region replication architectures.

## Goals
- **Recovery Point Objective (RPO)**: Under 5 minutes for PostgreSQL (WAL-backed), under 24 hours for Redis caching, and under 1 minute for user media assets.
- **Recovery Time Objective (RTO)**: Under 30 minutes for complete restoration of active databases and caching states.
- **Security Compliance**: 100% of backups encrypted at-rest using AES-256 (AWS KMS-Managed keys) and in-transit (TLS 1.3).
- **Self-Healing and Alerts**: Instant escalation via Webhooks to PagerDuty/Slack on any backup failure.

## Functional Requirements
- **Logical pg_dump backups**: System must generate compressed database dumps daily at 01:00 UTC.
- **Redis BGSAVE tracking**: Scripts must trigger Redis snapshots, wait for the background save process to complete, and safely copy files to S3.
- **Bi-directional S3 Sync**: Provide scripts to sync main assets to backup folders in secondary regions for disaster situations.
- **KMS Key integration**: Encrypt every output file using a customer-managed key (CMK) through the AWS CLI.
- **Pruning / Lifecycles**: Automatic cleanup of old local snapshots to prevent local disk exhaustion.

## Non-Functional Requirements
- **Compression Efficiency**: Database backups must achieve at least a 5:1 compression ratio using `gzip -9` or `zstd`.
- **Low CPU footprint**: Backup execution must be throttled to prevent resource starvation for active publishing API instances.
- **Idempotency**: All scripts must be fully idempotent; running them twice concurrently must not result in corrupted targets.

## Business Rules
- **Snapshot Retention**: Daily snapshots must be stored in S3 Standard for 14 days, transitioned to S3 Glacier Flexible Instant Retrieval for 76 days, and then permanently deleted (90-day retention).
- **Integrity Validation**: A weekly automated dry-run restore check must run in the staging environment.
- **Audit Logging**: Every backup operation must write an audit record to the centralized security logging database.

## Actors
- **DevOps Engineer**: Creates, edits, and monitors the backup pipelines.
- **Site Reliability Engineer (SRE)**: Manages alerts and executes recovery runs during an outage.
- **Compliance Officer**: Reviews retention policies and confirms that personal data deletion schedules are met within backups.

## User Stories
1. **As a DevOps Engineer**, I want PostgreSQL logical dumps to execute automatically every night and stream to S3, so that I have a reliable rollback point if a database migration corrupts data.
2. **As an SRE**, I want a clear, executable shell script for restoring Redis from a cached S3 `dump.rdb` file, so that I can quickly restore system sessions after a node crash.
3. **As a Compliance Officer**, I want all backup archives to be encrypted using KMS and automatically deleted after 90 days, so that our archival systems comply with GDPR data lifecycle regulations.

## Acceptance Criteria
- **AC-1**: The PostgreSQL logical dump script must compress outputs on-the-fly and verify that the file size on S3 matches the source data structure within a 2% margin.
- **AC-2**: The Redis backup script must block until `lastsave` time updates, verifying that a fresh dump has been written before copying.
- **AC-3**: Backup processes must terminate immediately and log a structured JSON error payload if local disk space drops below 15%.
- **AC-4**: Restore procedures must result in a fully functioning, consistent schema instance inside the staging sandbox in less than 20 minutes.

## Workflows
### Backup Storage & Cross-Region Replication Workflow
```
[PostgreSQL Primary Engine]
          |
          |-- (Streams WAL Segments continuously) ----> [Primary Region S3 Bucket]
          |                                                    |
          |-- (Executes Daily pg_dump at 02:00 UTC)             |-- (AWS S3 Cross-Region Replication)
          |                                                    v
          +---------------------------------------------> [Secondary Region S3 Bucket]
                                                               |
                                                               v
                                                      [AWS KMS Encryption (AES-256)]
```

### PostgreSQL Backup Sequence
1. The cron schedule triggers `postgres_backup.sh` at 01:00 UTC.
2. The script checks local disk capacity to ensure a safe workspace.
3. A connection check is performed against the primary database instance.
4. `pg_dump` is invoked, piping output through a zstd compressor directly into the AWS S3 client stream.
5. The script checks the upload exit code. If successful, it writes to the audit database and sends a status ping. If failed, it triggers a PagerDuty incident.

## API Design

The following endpoints manage, monitor, and trigger backup operations through the admin gateway.

### 1. Retrieve Backup Job History
Lists the execution history, statuses, and file locations of previous backup operations.
- **Endpoint**: `GET /api/v1/ops/backups`
- **Headers**:
  - `Authorization: Bearer <token>`
- **Query Parameters**:
  - `limit`: Number of logs to retrieve (default: 50)
  - `status`: Filter by `SUCCESS`, `FAILED`, or `RUNNING`
- **Response Payload (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "job_id": "job_pg_20260627_010000",
      "backup_type": "POSTGRES_LOGICAL",
      "status": "SUCCESS",
      "started_at": "2026-06-27T01:00:00Z",
      "completed_at": "2026-06-27T01:12:45Z",
      "file_path": "s3://newsops-prod-backups-us-east-1/db/logical/newsops_prod_20260627.sql.zstd",
      "size_bytes": 12884901888,
      "checksum": "sha256:7f83b1657ff1fc53b92c48d28cf3b3a2a129ef318182b8a09cf31828f7318ff2"
    },
    {
      "job_id": "job_redis_20260627_013000",
      "backup_type": "REDIS_SNAPSHOT",
      "status": "SUCCESS",
      "started_at": "2026-06-27T01:30:00Z",
      "completed_at": "2026-06-27T01:31:12Z",
      "file_path": "s3://newsops-prod-backups-us-east-1/redis/redis_dump_20260627.rdb.gz",
      "size_bytes": 452984832,
      "checksum": "sha256:bc3188ffab32a10129cfba839e928cf892301988fac12bc1298ffca812bc8ff2"
    }
  ]
}
```

### 2. Trigger Manual Backup Job
Allows administrators to force a manual backup before system maintenance.
- **Endpoint**: `POST /api/v1/ops/backups/trigger`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`
- **Request Payload**:
```json
{
  "backup_type": "POSTGRES_LOGICAL",
  "compression": "zstd",
  "description": "Manual pre-deployment backup for Release v4.2.0"
}
```
- **Response Payload (202 Accepted)**:
```json
{
  "success": true,
  "message": "Backup job successfully queued.",
  "data": {
    "job_id": "job_pg_manual_20260627_224500",
    "backup_type": "POSTGRES_LOGICAL",
    "status": "QUEUED",
    "queued_at": "2026-06-27T22:45:00Z"
  }
}
```

## Database Design
To support backup auditing and tracing, the administration DB contains the `backup_execution_logs` table.

```sql
CREATE TABLE public.backup_execution_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    job_id VARCHAR(100) NOT NULL,
    backup_type VARCHAR(50) NOT NULL, -- 'POSTGRES_LOGICAL', 'REDIS_SNAPSHOT', 'S3_MEDIA_SYNC'
    status VARCHAR(20) NOT NULL, -- 'QUEUED', 'RUNNING', 'SUCCESS', 'FAILED'
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    target_s3_uri VARCHAR(512),
    file_size_bytes BIGINT,
    sha256_checksum VARCHAR(64),
    error_message TEXT,
    triggered_by VARCHAR(100) DEFAULT 'SYSTEM_CRON',
    CONSTRAINT pk_backup_execution_logs PRIMARY KEY (id)
);

-- Index for operational queries looking up recent statuses
CREATE INDEX idx_backup_logs_type_status ON public.backup_execution_logs (backup_type, status, started_at DESC);
```

### PostgreSQL Logical Backup Script (`postgres_backup.sh`)
This script executes logical dumps, compresses them using `zstd`, encrypts them using KMS, and streams them to S3.

```bash
#!/usr/bin/env bash
# ==============================================================================
# File: postgres_backup.sh
# Path: /usr/local/bin/postgres_backup.sh
# Purpose: Logical PostgreSQL Database Backup with Streaming Compression & Upload
# ==============================================================================

set -euo pipefail

# Configuration
DB_HOST=${DB_HOST:-"newsops-prod-db-primary.internal"}
DB_PORT=${DB_PORT:-"5432"}
DB_NAME=${DB_NAME:-"newsops_production"}
DB_USER=${DB_USER:-"backup_agent"}
S3_BUCKET=${S3_BUCKET:-"newsops-prod-backups-us-east-1"}
KMS_KEY_ARN=${KMS_KEY_ARN:-"arn:aws:kms:us-east-1:112233445566:key/backup-key-uuid"}
PGPASSWORD_FILE="/opt/backup/.pgpass"
MIN_FREE_SPACE_PERCENT=15

# Export PGPASSWORD safely
if [[ -f "${PGPASSWORD_FILE}" ]]; then
    export PGPASSFILE="${PGPASSWORD_FILE}"
else
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"ERROR\",\"message\":\"PGPASSFILE not found at ${PGPASSWORD_FILE}\"}"
    exit 1
fi

log_info() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"INFO\",\"message\":\"$1\"}"
}

log_error() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"ERROR\",\"message\":\"$1\"}" >&2
}

# 1. Disk Space Verification
FREE_SPACE_PERCENT=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if (( 100 - FREE_SPACE_PERCENT < MIN_FREE_SPACE_PERCENT )); then
    log_error "Workspace disk space is critically low (${FREE_SPACE_PERCENT}% used). Aborting."
    exit 1
fi

log_info "Starting PostgreSQL logical dump for database: ${DB_NAME} on ${DB_HOST}..."

# Define Output Target
BACKUP_DATE=$(date -u +%Y%m%d_%H%M%S)
BACKUP_FILENAME="${DB_NAME}_${BACKUP_DATE}.sql.zstd"
S3_URI="s3://${S3_BUCKET}/db/logical/${BACKUP_FILENAME}"

# Execute pg_dump, zstd compress, and AWS S3 upload via pipe streaming
# This avoids writing massive uncompressed dumps directly to the local disk
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -Fp --no-owner --no-privileges \
    | zstd -9 --threads=0 \
    | aws s3 cp - "${S3_URI}" \
        --sse aws:kms \
        --sse-kms-key-id "${KMS_KEY_ARN}" \
        --metadata "backup_type=logical,database=${DB_NAME}"

# Verify transaction
if [[ $? -eq 0 ]]; then
    log_info "Backup successfully uploaded to S3: ${S3_URI}"
else
    log_error "pg_dump stream upload failed."
    exit 2
fi
```

### Redis Snapshot Export Script (`redis_backup.sh`)
This script forces a background snapshot execution on Redis, monitors its execution status, and uploads the verified `dump.rdb` file.

```bash
#!/usr/bin/env bash
# ==============================================================================
# File: redis_backup.sh
# Path: /usr/local/bin/redis_backup.sh
# Purpose: Triggers Redis background snapshot and uploads the dump to S3
# ==============================================================================

set -euo pipefail

REDIS_HOST=${REDIS_HOST:-"127.0.0.1"}
REDIS_PORT=${REDIS_PORT:-"6379"}
REDIS_CLI="/usr/bin/redis-cli"
REDIS_DIR="/var/lib/redis"
S3_BUCKET=${S3_BUCKET:-"newsops-prod-backups-us-east-1"}

log_info() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"INFO\",\"message\":\"$1\"}"
}

log_error() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"ERROR\",\"message\":\"$1\"}" >&2
}

# Ensure Redis is running
if ! "${REDIS_CLI}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" PING | grep -q "PONG"; then
    log_error "Redis instance at ${REDIS_HOST}:${REDIS_PORT} is unreachable."
    exit 1
fi

# Fetch current lastsave timestamp
LAST_SAVE=$("${REDIS_CLI}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" lastsave)

log_info "Triggering Redis BGSAVE..."
"${REDIS_CLI}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" BGSAVE

# Wait for BGSAVE execution completion
TIMEOUT_SECONDS=600
ELAPSED=0
while true; do
    CURRENT_SAVE=$("${REDIS_CLI}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" lastsave)
    if [[ "${CURRENT_SAVE}" -gt "${LAST_SAVE}" ]]; then
        log_info "BGSAVE completed successfully."
        break
    fi
    
    # Check if BGSAVE failed in background status info
    BGSAVE_STATUS=$("${REDIS_CLI}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" info Persistence | grep rdb_last_bgsave_status | cut -d: -f2 | tr -d '\r')
    if [[ "${BGSAVE_STATUS}" == "err" ]]; then
        log_error "Redis BGSAVE status returned error."
        exit 2
    fi

    if [[ "${ELAPSED}" -ge "${TIMEOUT_SECONDS}" ]]; then
        log_error "BGSAVE timed out after ${TIMEOUT_SECONDS} seconds."
        exit 3
    fi

    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

# Upload snapshot
BACKUP_DATE=$(date -u +%Y%m%d_%H%M%S)
BACKUP_FILENAME="redis_dump_${BACKUP_DATE}.rdb.gz"
S3_URI="s3://${S3_BUCKET}/redis/${BACKUP_FILENAME}"

log_info "Compressing and copying snapshot to ${S3_URI}..."
gzip -c "${REDIS_DIR}/dump.rdb" | aws s3 cp - "${S3_URI}" --sse aws:kms

log_info "Redis backup successfully archived."
```

### S3 Media Directories Synchronization Script (`s3_media_sync.sh`)
This script performs cross-bucket media directory syncs for user asset safety.

```bash
#!/usr/bin/env bash
# ==============================================================================
# File: s3_media_sync.sh
# Path: /usr/local/bin/s3_media_sync.sh
# Purpose: Syncs main media bucket objects to secondary disaster recovery region
# ==============================================================================

set -euo pipefail

PRIMARY_BUCKET=${PRIMARY_BUCKET:-"newsops-prod-media-primary"}
BACKUP_BUCKET=${BACKUP_BUCKET:-"newsops-prod-media-backup-dr"}
BANDWIDTH_LIMIT="100MB/s"

log_info() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"INFO\",\"message\":\"$1\"}"
}

log_error() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"ERROR\",\"message\":\"$1\"}" >&2
}

log_info "Starting media directory sync from ${PRIMARY_BUCKET} to ${BACKUP_BUCKET}..."

# Synchronize buckets directly. Objects are copied on the AWS backbone.
aws s3 sync "s3://${PRIMARY_BUCKET}" "s3://${BACKUP_BUCKET}" \
    --bandwidth-limit "${BANDWIDTH_LIMIT}" \
    --size-only \
    --no-progress

if [[ $? -eq 0 ]]; then
    log_info "Media synchronization completed successfully."
else
    log_error "Media synchronization failed."
    exit 1
fi
```

### PostgreSQL Recovery Execution Script
This script automates database loading from stored logical S3 zstd dumps.

```bash
#!/usr/bin/env bash
# ==============================================================================
# File: postgres_restore.sh
# Path: /usr/local/bin/postgres_restore.sh
# Purpose: Pulls compressed logical dump, decompresses, and loads into target DB
# ==============================================================================

set -euo pipefail

TARGET_DB_HOST=${TARGET_DB_HOST:-"localhost"}
TARGET_DB_PORT=${TARGET_DB_PORT:-"5432"}
TARGET_DB_NAME=${TARGET_DB_NAME:-"newsops_production"}
TARGET_DB_USER=${TARGET_DB_USER:-"postgres"}
S3_SNAPSHOT_URI=$1

log_info() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"INFO\",\"message\":\"$1\"}"
}

log_error() {
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"ERROR\",\"message\":\"$1\"}" >&2
}

if [[ -z "${S3_SNAPSHOT_URI}" ]]; then
    log_error "No target S3 snapshot URI provided. Usage: $0 s3://bucket/path/to/dump.sql.zstd"
    exit 1
fi

log_info "Retrieving logical snapshot ${S3_SNAPSHOT_URI}..."
aws s3 cp "${S3_SNAPSHOT_URI}" /tmp/recovery_db.sql.zstd

log_info "Decompressing and loading snapshot into target database ${TARGET_DB_NAME}..."
zstd -d /tmp/recovery_db.sql.zstd -o /tmp/recovery_db.sql

psql -h "${TARGET_DB_HOST}" -p "${TARGET_DB_PORT}" -U "${TARGET_DB_USER}" -d "${TARGET_DB_NAME}" -f /tmp/recovery_db.sql

log_info "PostgreSQL Logical Recovery successfully finalized."
rm -f /tmp/recovery_db.sql /tmp/recovery_db.sql.zstd
```

## UI Design
Operations Dashboard provides backup control:
- **Disaster Recovery Panel**: Displays RPO metrics, time since last WAL backup, PITR timeline slider to select recovery target.
- **Sync Visualizer**: Map showing primary region bucket and secondary backup bucket, with bandwidth charts and replication statuses.
- **Logs Grid**: Listing output logs of the `archive-and-prune-partitions` script runs.

## Permissions
- `backups:read`: View status metrics, restore jobs, and S3 metadata.
- `backups:write`: Trigger backup runs manually or edit retention configuration tables.
- `backups:restore`: Execute DB restoration actions (highly protected role).

## Security
- **WORM Configurations**: Backup storage buckets enforce Object Lock in compliance mode, preventing any deletion or overwriting of files within 30 days.
- **KMS Multi-region Keys**: KMS policies restrict decrypt actions only to recovery runner roles.
- **Network Isolation**: Direct backup streaming travels over dedicated AWS PrivateLink VPC endpoints, avoiding open Internet exposures.

## Performance
- **Write-Ahead Log Frequency**: WAL segments are finalized and pushed to S3 every 16MB or 5 minutes (max threshold).
- **Logical Dump CPU Cap**: Dumps are executed using nice parameters (`nice -n 19 ionice -c 3 pg_dump...`) to prevent blocking high-frequency editor traffic.

## Monitoring
- **Prometheus Metrics**:
  - `newsops_backup_age_seconds`: Age of the most recent snapshot.
  - `newsops_backup_s3_size_bytes`: Storage consumption of the backup buckets.
  - `newsops_backup_failure_count`: Total failure metrics for cron execution scripts.
  - `newsops_pitr_gap_seconds`: Time gap between database state and S3-archived WAL.
- **Alert Triggers**:
  - `BackupStaleAlert`: If `newsops_backup_age_seconds > 90000` (25 hours). Trigger: High critical alert.
  - `PitrGapAlert`: If `newsops_pitr_gap_seconds > 600`. Action: Alert on call engineer.

## Logging
Script output log formatting guidelines:

```json
{
  "timestamp": "2026-06-27T22:17:29.898Z",
  "level": "INFO",
  "logger": "db.backup.manager",
  "message": "Continuous WAL segment uploaded successfully",
  "context": {
    "wal_segment": "00000001000000A30000008F",
    "size_bytes": 16777216,
    "destination": "s3://newsops-backups-us-west-2/wal/00000001000000A30000008F",
    "duration_ms": 341
  }
}
```

```json
{
  "timestamp": "2026-06-27T22:17:35.012Z",
  "level": "ERROR",
  "logger": "db.backup.replicator",
  "message": "Cross-region replication failed",
  "context": {
    "source_bucket": "newsops-backups-us-west-2",
    "target_bucket": "newsops-backups-us-east-1",
    "object_key": "logical/snap_2026_06_27_020000.sql.gz",
    "error_message": "AccessDenied: KMS Key not found in secondary region"
  }
}
```

## Error Handling
| DB Error Code / AWS Exception | HTTP Status | Customer-Facing Message | Internal Description |
|---|---|---|---|
| `AmazonS3Exception: AccessDenied` | 500 | "Internal storage connection error." | KMS Key permissions or IAM bucket policy violation. |
| `ERR_DISK_FULL` | 507 | "Storage capacity exceeded. Please contact DBA." | Local server volume full during temporary dump file generation. |
| `ERR_RECOVERY_TARGET_EXCEEDED` | 400 | "Requested restore timestamp is outside recovery window." | Target date is older than the oldest stored WAL file (30 days). |

## Edge Cases
- **Missing WAL Segments**: If a WAL segment gets corrupted or goes missing in S3, PITR restoration halts. Prevent this by enforcing S3 bucket versioning and replication verification checks.
- **Lock Contention During Partition Detach**: If an editor has an open transaction writing to the target partition, the detach operation will block. The shell script sets `lock_timeout` to fail fast, allowing it to exit safely and retry during the next run cycle rather than locking the database.

## Future Improvements
- **Immutable Ransomware Safeguard**: Implement AWS S3 Object Lock configuration to prevent backups from being deleted even by root compromised accounts.
- **Restore Automation Drills**: Build an automatic provisioning pipeline that boots a new DB container from S3 snapshots every Sunday night, validates the schema structure, and tears it down automatically.

## Mermaid Diagrams

### Backup Replication & Restore Validation Flow

```mermaid
flowchart TD
    A["PostgreSQL Primary Instance"] -->|1. Write-Ahead Logs| B["Primary S3 Bucket (us-west-2)"]
    A -->|2. Daily logical dump| B
    B -->|3. S3 Cross-Region Replication| C["Secondary S3 Bucket (us-east-1)"]
    
    subgraph Restore Drill (Weekly)
        D["Automated Restoration Script"] -->|4. Pull Snapshot| C
        D -->|5. Provision Temp Instance| E["Isolated Sandbox DB"]
        E -->|6. Replay WAL Stream| F["Restored Consistent State"]
        F -->|7. Integrity Check| G{"Drill Successful?"}
        G -- "Yes" --> H["Log Success Metric"]
        G -- "No" --> I["Trigger PagerDuty Alert"]
    end
```

## References
- [Database Backup and Retention Strategy](../03-database/backup_and_retention.md)
- [Disaster Recovery System Architecture](../02-architecture/disaster_recovery.md)
- [Environment Variables Inventory](./environment_variables.md)
