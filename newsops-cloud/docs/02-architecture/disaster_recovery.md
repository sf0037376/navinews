# Disaster Recovery
## Purpose
This document establishes the Disaster Recovery (DR) Plan for the NewsOps Cloud digital publishing platform. It defines the Recovery Time Objective (RTO) and Recovery Point Objective (RPO) metrics, multi-region database replication protocols, cold storage backup schedules, dynamic DNS failover strategies, and the operational procedures for validation and simulation drills.

## Executive Summary
NewsOps Cloud employs a multi-region active-passive disaster recovery model to guarantee business continuity in the face of catastrophic infrastructure failures. The primary region (AWS `us-east-1`) continuously streams database transactions to a passive standby region (AWS `us-west-2`). Media assets stored in S3 are mirrored cross-region. Dynamic DNS routing uses automated health checks to reroute client traffic to the standby region during regional blackouts. Daily cold backups are generated, encrypted, and written to immutable storage vaults to protect against data corruption and security incidents.

## Vision
The vision is to establish an automated, bulletproof recovery infrastructure that protects editorial content, user directories, and system history. The platform must survive a total outage of its primary cloud provider region with zero manual database reconciliation, minimal data loss, and a fully restored client publishing interface in under 4 hours.

## Scope
The scope of this disaster recovery design covers:
1. **RTO & RPO Definitions**: Acceptable data loss and downtime metrics.
2. **Multi-Region Database Replication**: Cross-region PostgreSQL WAL streaming.
3. **Storage Mirroring**: Cross-Region S3 Bucket Replication (CRR).
4. **DNS Failover Protocols**: Failover routes and health check rules.
5. **Cold Backups & Immutability**: Generation, KMS encryption, and S3 Glacier Vault Lock rules.
6. **Recovery Validation & Drills**: Verification scripts and quarterly simulation schedules.

## Goals
- **Minimize Downtime (RTO)**: Restore core reading access in <= 15 minutes and editing/publishing systems in <= 4 hours.
- **Limit Data Loss (RPO)**: Keep transactional database data loss at <= 5 minutes and media asset loss at <= 15 minutes.
- **Secure Immutable Backups**: Protect cold storage archives using Write-Once-Read-Many (WORM) models to prevent ransomware tampering.
- **Validate Restoration**: Run daily automated backup integrity verifications to ensure 100% of archived datasets can be decrypted and restored.

## Functional Requirements
- **Cross-Region Database Streaming**: Maintain an active-standby database server in the secondary region receiving streaming updates from the primary master.
- **Dynamic DNS Route Control**: The DNS provider must perform automated ping tests to the primary region's ingress gateway and dynamically shift DNS records to the secondary region if the primary goes offline.
- **Automated Backup Operations**: The system must run daily backup jobs that dump database schemas, compress files, and store them securely.
- **Multi-Region Object Replication**: The primary S3 buckets must automatically copy incoming media files to the secondary region buckets asynchronously.
- **Outage Communication Page**: Provide an independent, externally hosted status page (e.g. status.newsops.cloud) to notify users of system outages.

## Non-Functional Requirements
- **Data Encryption**: Encrypt all backup archives using AES-256 via customer-managed keys in AWS KMS.
- **Write-Once-Read-Many (WORM)**: Apply compliance-mode Glacier Vault locks on cold backups, preventing deletion of archives for 90 days.
- **Bandwidth Replication Limit**: Database replication must be allocated dedicated network tunnels with throughput constraints of 150 Mbps to avoid starving web service bandwidth.
- **MFA Delete Enforcement**: Enforce Multi-Factor Authentication (MFA) on storage buckets to prevent malicious deletion of files by compromised admin accounts.

## Business Rules
- **Backup Retention Policy**: Retain daily backups for 30 days, weekly backups for 12 weeks, monthly backups for 12 months, and yearly backups for 7 years.
- **Manual Failover Execution**: Region failovers (promoting the secondary standby region to active) must require dual-authorization by two certified Systems Engineers to prevent false-alarm triggering.
- **Drill Timing Constraints**: System recovery simulation drills must be conducted outside business hours (specifically between Sunday 01:00 and 03:00 UTC) to minimize potential reader disruption.

## Actors
- **Site Reliability Engineer (SRE)**: Coordinates the disaster recovery process and initiates manual failovers.
- **Database Administrator (DBA)**: Verifies replication health and validates restored databases.
- **DNS Resolver**: Routes incoming readers to the active primary region or backup standby IP pool.
- **KMS Key Custodian**: Manages the master keys required to encrypt and decrypt database backups.
- **Statuspage Updater**: Service that publishes automated or manual outage updates to customers.

## User Stories
- **Story 1 - Regional Outage**: As a Reader, I want the news portal to remain readable even if the primary AWS region suffers a total blackout, because the system redirects my web requests to the standby region automatically.
- **Story 2 - Ransomware Protection**: As a Chief Information Officer, I want to ensure that our database backups are stored in an immutable, read-only S3 vault, so that if a hacker compromises our live database, they cannot delete our backup history.
- **Story 3 - Disaster Recovery Validation**: As a Site Reliability Engineer, I want the system to perform a test database restoration in the background every night, so that I am confident our backups are uncorrupted and ready to use in a real crisis.

## Acceptance Criteria
- **AC-1 (Failover Speed)**: During a regional simulation, DNS failover routing must successfully switch public reader traffic from the primary region to the secondary region in <= 8 minutes of initiating failover.
- **AC-2 (Database Replication Lag)**: The cross-region database replication stream lag must remain below 10 seconds under standard operating loads, guaranteeing an RPO of <= 10 seconds.
- **AC-3 (Immutability Lock)**: Cold backup archives written to the S3 compliance vault must fail to delete when targeted by an AWS Root account request, returning an `AccessDenied` error during the lock retention period.
- **AC-4 (Test Restores)**: The nightly backup validation worker must successfully decrypt, spin up, and restore the daily database dump in a isolated testing environment within 60 minutes.

## Workflows
### Step-by-Step Regional Failover Execution Workflow
1. **Identify Regional Outage**: AWS CloudWatch alarms trigger alerts indicating that the primary region (`us-east-1`) API gateway and health check routes have been timing out for 5 minutes.
2. **Verify Failure**: SREs receive PagerDuty notifications and verify that the outage is a total regional failure.
3. **Execute Failover Script**:
   - Two authorized SREs log into the secondary operations dashboard and click "Execute Failover Command".
   - The automation pauses database replication and promotes the passive standby PostgreSQL node in `us-west-2` to become the active primary node (`pg_ctl promote`).
4. **Update Service Discovery**: The internal routing services update discovery endpoints, redirecting traffic to the new primary database node IP.
5. **Scale Standby Containers**: The secondary Kubernetes cluster triggers replica scale-ups, moving the passive pod count from 1 standby pod to the baseline production count (e.g. 10 pods per microservice).
6. **DNS Update**:
   - The DNS controller updates the Cloudflare DNS record values, pointing `newsops.cloud` to the IP addresses of the load balancer in `us-west-2`.
   - DNS propagation begins across edge nodes.
7. **Verify Systems**: Automated integration tests execute against the secondary region URLs, validating write capabilities, session validation, and media asset retrieval.
8. **Communication updates**: The system updates the Statuspage to inform tenants that the system is operating in secondary backup mode.

### Step-by-Step Daily Cold Backup and Verification Workflow
1. **Trigger Backup Job**: A cron task runs daily at 02:00 UTC inside the primary database subnet.
2. **Execute Database Dump**: The task executes `pg_dumpall` using connection compression.
3. **Encrypt File**: The dump file is encrypted locally using the AWS KMS key: `arn:aws:kms:us-east-1:111122223333:key/backup-key`.
4. **Upload to S3 Vault**:
   - The encrypted backup file is uploaded to the primary region S3 backup bucket: `s3://newsops-backups-primary/daily/`.
   - The object is assigned a compliance retention lock of 30 days.
5. **Cross-Region Replication (CRR)**: S3 automatically replicates the uploaded file to the secondary region backup bucket: `s3://newsops-backups-secondary/daily/` via S3 replication rules.
6. **Trigger Verification Worker**:
   - Upon receipt of the file, the secondary S3 bucket triggers a lambda function.
   - The lambda spins up an isolated, temporary PostgreSQL Docker container.
7. **Restore and Validate**:
   - The worker downloads the daily backup file from `s3://newsops-backups-secondary/daily/` and decrypts it using the secondary region's replicated KMS key.
   - It restores the schema and tables into the temporary database.
   - It runs a series of sanity checks (e.g., counting rows in `users`, checking integrity constraints).
8. **Log Result**: The worker saves the verification outcome into the database logs and terminates the test container.

```mermaid
graph TD
    subgraph Client_Layer [Client & Routing Layer]
        User([User Browser]) -->|Request newsops.cloud| DNS{Cloudflare DNS}
    end

    subgraph Primary_Region [Primary AWS Region - us-east-1 (ACTIVE)]
        DNS -->|Route Primary (Normal)| LB1[Load Balancer]
        LB1 --> Pods1[K8s App Pods]
        Pods1 --> DB1[(Postgres Primary DB)]
        Pods1 --> S3_1[(S3 Media Bucket - Primary)]
    end

    subgraph Secondary_Region [Secondary AWS Region - us-west-2 (STANDBY)]
        DNS -.->|Failover Route (Outage)| LB2[Load Balancer]
        LB2 --> Pods2[K8s Standby Pods (Scaled Down)]
        Pods2 --> DB2[(Postgres Replica Standby)]
        Pods2 --> S3_2[(S3 Media Bucket - Secondary)]
        BackupRestore[Validation Container] -.->|Test Restore| DB2
    end

    DB1 -->|WAL Streaming Replication| DB2
    S3_1 -->|S3 Cross-Region Replication| S3_2
    
    subgraph Backup_Vault [Immutable Backup Storage]
        DB1 -->|Daily pg_dump| Encrypt[KMS Encryption]
        Encrypt --> S3_Backup[S3 Backup Vault - Glacier Lock]
        S3_Backup -->|Replicated| S3_Backup_Sec[S3 Backup Vault Secondary]
        S3_Backup_Sec -->|Trigger Nightly Validation| BackupRestore
    end
```

## API Design
### 1. Retrieve Disaster Recovery Replication Status
- **Endpoint**: `GET /api/v1/dr/status`
- **Method**: `GET`
- **Headers**:
  - `Authorization: Bearer <admin_jwt>`
- **Response Payload (Success)**:
  ```json
  {
    "status": "active",
    "primary_region": "us-east-1",
    "secondary_region": "us-west-2",
    "database_replication": {
      "status": "streaming",
      "replication_lag_seconds": 1.4,
      "byte_lag": 249018,
      "last_sync_time": "2026-06-27T22:18:10Z"
    },
    "storage_replication": {
      "status": "synchronized",
      "pending_replication_files": 0,
      "last_sync_time": "2026-06-27T22:15:00Z"
    },
    "backups": {
      "last_backup_created": "2026-06-27T02:00:00Z",
      "last_backup_validation": "SUCCESS",
      "last_backup_validation_time": "2026-06-27T02:45:00Z"
    }
  }
  ```

### 2. Trigger Manual Regional Failover
- **Endpoint**: `POST /api/v1/dr/failover`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <admin_jwt>`
- **Request Payload**:
  ```json
  {
    "action": "PROMOTE_SECONDARY",
    "target_region": "us-west-2",
    "authorization_token_engineer_1": "mfa_code_982371",
    "authorization_token_engineer_2": "mfa_code_098234",
    "reason": "Total loss of primary region us-east-1 connectivity"
  }
  ```
- **Response Payload (Success)**:
  ```json
  {
    "status": "initiated",
    "transaction_id": "dr_failover_88293710",
    "action": "PROMOTE_SECONDARY",
    "target_region": "us-west-2",
    "started_at": "2026-06-27T22:20:00Z",
    "steps": {
      "step_1_promote_db": "in_progress",
      "step_2_scale_pods": "pending",
      "step_3_update_dns": "pending"
    }
  }
  ```

## Database Design
Tracking table configuration for disaster logs, backup logs, and drill execution records:

```sql
-- Backup Logs and Integrity Checks Table
CREATE TABLE public.backup_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_file_name VARCHAR(255) NOT NULL,
    backup_size_bytes BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    primary_s3_path VARCHAR(512) NOT NULL,
    secondary_s3_path VARCHAR(512) NOT NULL,
    is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
    validation_status VARCHAR(20) NOT NULL, -- 'PENDING', 'SUCCESS', 'FAILED'
    validation_output TEXT,
    validated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_backup_logs_status ON public.backup_logs(validation_status);
CREATE INDEX idx_backup_logs_created ON public.backup_logs(created_at DESC);

-- DR Failover and Drill Execution Log
CREATE TABLE public.dr_failover_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_type VARCHAR(20) NOT NULL,   -- 'DRILL', 'ACTUAL_DISASTER'
    triggered_by_user_1 UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    triggered_by_user_2 UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    source_region VARCHAR(30) NOT NULL,
    target_region VARCHAR(30) NOT NULL,
    duration_seconds INT,
    status VARCHAR(20) NOT NULL,          -- 'STARTED', 'IN_PROGRESS', 'SUCCESS', 'FAILED'
    failure_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_dr_failover_created ON public.dr_failover_logs(created_at DESC);
```

## UI Design
The disaster control interface is accessed via the **SRE Disaster Recovery Command Center**.
1. **Component Layout**:
   - **Health Monitor Ribbon**: Renders green/red status blocks for Active Region, Replication Link, and Backup Status.
   - **Replication Metrics Display**: Charts rendering database replication lag and S3 queue depths.
   - **Backup Validation Log**: Grid list displaying history of daily test restores with status icons (Green check = pass, Red cross = fail).
   - **Disaster Operations Box**:
     - Red background box labeled "Danger Zone: Region Failover Control".
     - Select menu targeting region for promotion.
     - Two distinct authentication verification input boxes (for Engineer 1 and Engineer 2 credentials).
     - "Trigger Failover Execution" button.

2. **Actions**:
   - Clicking "Trigger Failover" prompts a confirmation window requesting re-entry of the target region name. Confirming launches step-by-step progress tracking inside the dashboard.

3. **States**:
   - **Failover Mode State**: The UI switches to full-screen warning status, rendering progress bars for: *"Promoting Postgres standby..."*, *"Updating DNS route patterns..."*, and *"Spinning up container tasks..."*.

## Permissions
- `dr:read_status`: View DR monitoring, replication metrics, and backup logs.
- `dr:failover`: Authorize and execute region failovers or start simulation drills.
- `backups:restore_test`: Manually initiate background backup verification jobs.
- `backups:edit_policy`: Configure retention policies, storage paths, and KMS settings.

## Security
- **Glacier WORM Locks**: Enforce compliance-mode object retention on backups. Once applied, policies cannot be modified or deleted by anyone, including the AWS account administrator.
- **KMS Key Isolation**: Backup encryption keys must reside in AWS KMS, with access control restricted to backup worker nodes and SRE recovery administrators.
- **Multi-Party Authorization**: Critical actions like region failover require credentials from two distinct accounts with different security groups to prevent insider threats.
- **Encrypted Data in Transit**: Enforce TLS 1.3 connectivity on database replication streams using VPN tunnels or TLS-enabled database connection wrappers.

## Performance
- **Target Metrics**:
  - Max Database replication lag: <= 10 seconds.
  - S3 Object copy delay: <= 15 minutes.
  - Failover pipeline run duration: <= 5 minutes.
- **Restoration Performance**:
  - Target DB restore speed of daily snapshot: >= 50 GB/hour.
  - Daily database dump size target: <= 100 GB (compressed).

## Monitoring
System state monitored via Prometheus metrics:
- `newsops_dr_db_replication_lag_bytes`: Total replication data difference.
- `newsops_dr_dns_failover_active`: Boolean tracking whether active traffic has shifted to the standby region.
- `newsops_dr_backup_size_bytes`: Monitor volume size of backup archive assets.
- `newsops_dr_validation_failures_total`: Counter tracking test restore failures.

*Alert Trigger Rules*:
- **Trigger**: `newsops_dr_db_replication_lag_bytes > 50000000` for 10 minutes.
  - *Action*: Alert critical: Database replication stream lag exceeds 50MB.
- **Trigger**: `newsops_dr_validation_failures_total > 0`
  - *Action*: Alert critical: Nightly database backup verification failed.

## Logging
Structured JSON logging formats:
- **Info Level Log (Backup Upload)**:
  ```json
  {"timestamp":"2026-06-27T02:05:00Z","level":"info","logger":"backup_service","message":"Database backup file uploaded to primary S3","file_name":"db_dump_20260627.sql.gz.enc","size_bytes":1248923091}
  ```
- **Info Level Log (Validation Pass)**:
  ```json
  {"timestamp":"2026-06-27T02:45:00Z","level":"info","logger":"backup_validator","message":"Nightly database restore validation passed","file_name":"db_dump_20260627.sql.gz.enc","tables_checked":145,"duration_seconds":2400}
  ```
- **Error Level Log (Replication Failure)**:
  ```json
  {"timestamp":"2026-06-27T22:15:00Z","level":"error","logger":"replication_monitor","message":"Cross-region database replication connection lost","error":"Connection refused by target standby IP 10.0.5.4","lag_seconds":180}
  ```

## Error Handling
| Internal Error Code | Triggering Scenario | HTTP Status | Customer-Facing Message |
|:---|:---|:---|:---|
| `DR_REPLICATION_HALT` | Database replication stream breaks permanently | 500 Internal Error | "Secondary recovery node is out of sync. SREs have been notified." |
| `DR_FAILOVER_ABORT` | Target region fails validation checks during promotion | 500 Internal Error | "Failover sequence aborted due to secondary cluster errors. Reviewing node state." |
| `BACKUP_DECRYPT_FAIL` | Validator fails to decrypt backup file via KMS | 500 Internal Error | "Backup verification job failed: Encryption key mismatch." |
| `DNS_API_TIMEOUT` | Cloudflare DNS API timeouts during route adjustment | 502 Bad Gateway | "DNS routing failover timed out. Attempting fallback routes." |

## Edge Cases
- **Key Corruption in Primary Region**: If primary region KMS keys are deleted or corrupted, backups cannot be restored. *Mitigation*: Configure backup files with multi-region KMS keys, allowing the secondary region key to decrypt the payload without referencing primary keys.
- **Out of Capacity in Standby Region**: During a disaster failover, scaling up standby pods in the secondary region fails because AWS has reached physical host capacity in that region. *Mitigation*: Purchase EC2 Capacity Reservations (ODCRs) for the minimum required pods, ensuring that AWS guarantees hardware availability during disasters.
- **Split-Brain DNS Routing**: Both regions believe they are active and route separate clients to separate database nodes. *Mitigation*: Enforce database routing checks. If DNS is split, ensure the secondary database checks external status feeds (e.g. independently hosted health URLs) before accepting writes, reverting to read-only if it cannot establish isolated master status.

## Future Improvements
- **Multi-Master Active-Active Routing**: Transition database layers to multi-master engines (e.g., CockroachDB or Aurora Global Multi-Master) to eliminate region failover lag, making disaster recovery completely transparent to users.
- **Serverless Infrastructure Provisioning**: Store deployment topology code (Terraform manifests) in immutable repositories. In disaster drills, dynamically rebuild the entire infrastructure from scratch in a third region, validating dynamic multi-region capabilities.

## Mermaid Diagrams
(See the architecture diagram in the **Workflows** section above for details on the multi-region topology.)

## References
- [Scaling and Infrastructure High Availability](../02-architecture/scaling_and_ha.md)
- [Database Schema Definitions](../03-database/schemas.md)
- [DevOps Infrastructure Configurations](../11-devops/deployment_blueprints.md)
