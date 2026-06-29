# Backup and Retention Strategy

## Purpose
This document specifies the operational policies, configurations, and architecture for database backups, Point-in-Time Recovery (PITR), multi-region replication, and data retention policies for the NewsOps Cloud digital publishing platform. It defines how data assets (articles, configurations, logs) are secured and retained to ensure disaster recovery resilience and compliance with regulatory frameworks.

## Executive Summary
To protect the publishing platform against data loss from hardware failures, cyber threats, or accidental user errors, NewsOps Cloud implements a tiered backup framework. 
1. **Continuous Point-in-Time Recovery (PITR)**: Captures continuous changes by streaming Write-Ahead Logs (WAL) directly to Amazon S3, allowing recovery to any microsecond within a 30-day window.
2. **Daily Logical Snapshots**: Fully consolidated backups generated daily, compressed, encrypted, and replicated across geographical AWS regions.
3. **Data Retention & Archiving**: Automatically purges telemetry and personal logs according to strict business schedules, archiving aggregated records to cost-effective glacier storage while permanently deleting raw data to comply with GDPR/CCPA.

## Vision
To guarantee high-resiliency data persistence where database failures or cloud outages can be mitigated with near-zero data loss (RPO < 5 minutes) and rapid service restoration (RTO < 1 hour) globally.

## Scope
- Database engines covered: PostgreSQL (Primary transactional engine).
- Storage destinations: AWS S3 (Standard, Glacier Deep Archive).
- WAL streaming configurations (`pg_backrest` or native AWS RDS configurations).
- Automated retention cleanup worker scripts.
- Cross-region replication configurations and verification checks.

## Goals
- **RPO (Recovery Point Objective)**: Less than 5 minutes (maximum acceptable data loss).
- **RTO (Recovery Time Objective)**: Less than 60 minutes for regional database failovers.
- **Security Compliance**: 100% of backups encrypted at rest and in transit.
- **Automation**: Zero manual intervention required for daily runs, archiving, and deletion policies.

## Functional Requirements
- **Continuous Archive Streaming**: The database cluster must stream WAL chunks as they fill directly to a remote storage bucket.
- **Automated Retention Cleaning**: Data purging jobs must execute automatically on a daily cron schedule.
- **Restore Validation Checks**: The system must run a automated "dry-run" restore check weekly in a isolated sandbox environment.
- **Cross-Region Replication**: All backup archives must be automatically replicated to a secondary geographical region (e.g., `us-west-2` to `us-east-1`).

## Non-Functional Requirements
- **Data Encryption**: All backup files must be encrypted using AES-256 with keys managed via AWS KMS.
- **Storage Durability**: Backup locations must target storage providers offering at least 99.999999999% (11 9s) durability.
- **Impact Minimization**: Logical dump generation must not consume more than 20% of database CPU, keeping system resources available for editorial operations.

## Business Rules
- **Article Retainability**: Content in the `articles` table must be retained indefinitely (never deleted unless manually initiated by legal request).
- **User Log Expiry**: raw IP addresses and user tracking logs in the `analytics_logs` table must be purged after 90 days.
- **Storage Tier Transition**: Backup snapshots must reside in S3 Standard for 14 days, transition to S3 Standard-IA for the next 16 days, and then be deleted (total 30-day snapshot lifetime).
- **Tax Archive**: Financial and subscription audit transaction data must be archived for 7 years in immutable WORM (Write Once, Read Many) storage.

## Actors
- **DevOps Engineer**: Configures backup pipelines, handles restores during failures, and maintains configurations.
- **Compliance Officer**: Reviews retention policies and audits deletion executions.
- **Security Auditor**: Inspects KMS encryption keys and access logs to ensure data privacy.

## User Stories
1. **As a DevOps Engineer**, I want to recover the database state to exactly 14:02:10 UTC yesterday to rollback a faulty software patch that corrupted configuration data.
2. **As a Compliance Officer**, I want raw user-activity telemetry logs older than 90 days to be automatically deleted from active databases, so that the company remains compliant with GDPR policies.
3. **As a Database Administrator**, I want backups to be automatically copied to a secondary region, so that if our primary AWS region suffers an outage, we can recover services immediately.

## Acceptance Criteria
- **AC-1**: WAL streaming RPO must be validated. If the gap between the latest transaction and the last archived WAL segment exceeds 5 minutes, an alert must trigger.
- **AC-2**: A test restore execution must complete in less than 45 minutes for a 500GB database snapshot in the staging environment.
- **AC-3**: S3 bucket policies must deny the `s3:DeleteObject` permission to all database roles, except during execution of the compliance lifecycle manager.
- **AC-4**: Weekly automated dry-run restore tests must verify database boot consistency and matching schema state.

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

### Point-in-Time Recovery (PITR) Execution Steps
1. **Determine Incident Target**: Identify the exact timestamp before corruption (e.g., `2026-06-27 15:45:00 UTC`).
2. **Provision Restore Node**: Spin up a new PostgreSQL container/instance in the staging network.
3. **Fetch Base Snapshot**: Pull the latest full logical backup preceding the target timestamp from S3.
4. **Configure Recovery Target**: Write the `recovery.signal` file containing:
   `recovery_target_time = '2026-06-27 15:45:00 UTC'`
5. **Replay WAL Stream**: PostgreSQL boots in recovery mode, fetches WAL files sequentially from S3, and replays modifications up to the target timestamp.
6. **Promote Node**: Once the recovery target is hit, the database terminates recovery mode and opens for read/write queries.

## API Design

### 1. Check Backup Health and PITR Gap
Retrieves metrics regarding the current state of backups.

- **URL**: `/api/v1/admin/database/backups/status`
- **Method**: `GET`
- **Headers**:
  - `Authorization: Bearer <JWT>`
- **Response (200 OK)**:
```json
{
  "status": "HEALTHY",
  "lastFullBackup": {
    "snapshotId": "snap_2026_06_27_020000",
    "completedAt": "2026-06-27T02:45:10Z",
    "sizeBytes": 42949672960,
    "region": "us-west-2"
  },
  "replication": {
    "syncStatus": "IN_SYNC",
    "lastReplicatedAt": "2026-06-27T22:10:00Z",
    "replicaRegion": "us-east-1"
  },
  "pitr": {
    "enabled": true,
    "lastArchivedWal": "00000001000000A30000008F",
    "archivedAt": "2026-06-27T22:15:30Z",
    "currentGapSeconds": 119
  }
}
```

### 2. Trigger Restore Drill (Dry Run)
Initiates a automated backup validation run.

- **URL**: `/api/v1/admin/database/backups/restore-test`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <JWT>`
- **Request Body**:
```json
{
  "snapshotId": "snap_2026_06_27_020000",
  "targetRestoreTime": "2026-06-27T22:00:00Z"
}
```
- **Response (202 Accepted)**:
```json
{
  "drillJobId": "drill_998231",
  "status": "INITIATED",
  "estimatedDurationMinutes": 35,
  "startedAt": "2026-06-27T22:17:29Z"
}
```

## Database Design

### Retention Mapping Schema
Below is the tablespace configuration for archiving metadata.

```sql
-- Schema to track data lifecycle events and archiving history
CREATE TABLE public.retention_audit_log (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- e.g., 'PRUNE_RAW', 'ARCHIVE_COLUMNS'
    cutoff_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    rows_processed INT NOT NULL,
    s3_destination_uri VARCHAR(512),
    executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_retention_audit_log PRIMARY KEY (id)
);

CREATE INDEX idx_retention_audit_table_date 
ON public.retention_audit_log (table_name, executed_at DESC);
```

### Automated Partition Archival and Deletion Script
This script detaches old monthly partitions and cleans up data.

```bash
#!/usr/bin/env bash
# scripts/archive-and-prune-partitions.sh
set -euo pipefail

# DB Connection Configs
export PGCONNECT_TIMEOUT=10
DB_HOST="newsops-prod-db.internal"
DB_NAME="newsops_db"
DB_USER="lifecycle_manager"
RETENTION_DAYS=90
BACKUP_BUCKET="s3://newsops-database-archives/cold-logs"

# Calculate target date boundaries
CUTOFF_DATE=$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d)
TARGET_PARTITION="analytics_logs_y$(date -d "${RETENTION_DAYS} days ago" +%Ym%d)"

echo "Starting partition archiving for target boundary: ${CUTOFF_DATE} (Partition: ${TARGET_PARTITION})"

# 1. Verify partition exists before operating
PARTITION_EXISTS=$(psql -h "${DB_HOST}" -d "${DB_NAME}" -U "${DB_USER}" -t -A -c \
  "SELECT 1 FROM pg_tables WHERE tablename = '${TARGET_PARTITION}';")

if [ "${PARTITION_EXISTS}" != "1" ]; then
  echo "Partition ${TARGET_PARTITION} does not exist. Skipping."
  exit 0
fi

# 2. Dump target partition payload directly to compressed CSV format
echo "Streaming database partition to AWS S3 storage..."
pg_dump -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t "public.${TARGET_PARTITION}" \
  | gzip -c \
  | aws s3 cp - "${BACKUP_BUCKET}/${TARGET_PARTITION}.sql.gz" --sse aws:kms

echo "S3 Upload complete. Verifying size..."
aws s3 ls "${BACKUP_BUCKET}/${TARGET_PARTITION}.sql.gz"

# 3. Safely detach and drop partition inside a single locked transaction
echo "Detaching and dropping partition from main database..."
psql -h "${DB_HOST}" -d "${DB_NAME}" -U "${DB_USER}" -1 -c "
  SET lock_timeout = '5s';
  ALTER TABLE public.analytics_logs DETACH PARTITION public.${TARGET_PARTITION};
  DROP TABLE public.${TARGET_PARTITION};
  
  INSERT INTO public.retention_audit_log (
    table_name, 
    operation_type, 
    cutoff_timestamp, 
    rows_processed, 
    s3_destination_uri
  ) VALUES (
    'analytics_logs', 
    'PARTITION_DROP', 
    '${CUTOFF_DATE} 00:00:00+00'::timestamptz, 
    0, 
    '${BACKUP_BUCKET}/${TARGET_PARTITION}.sql.gz'
  );
"

echo "Pruning workflow completed successfully for: ${TARGET_PARTITION}."
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
- [Database Indexes and Partitioning](./indexes_and_partitioning.md)
- [Database Migration Strategy](./migration_strategy.md)
- [Unified ERD](./unified_erd.md)
