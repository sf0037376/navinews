# Infrastructure as Code Architecture

## Purpose
This document provides the architectural specification, deployment blueprints, and structural standards for the Infrastructure as Code (IaC) layer of the NewsOps Cloud digital publishing platform. It details how the platform's multi-cloud environments (AWS and GCP) are defined, provisioned, updated, and secured using Terraform configurations, establishing repeatable patterns for compute, database, network, and storage elements.

## Executive Summary
To achieve consistent environments and prevent manual configuration drift, NewsOps Cloud manages its infrastructure through code. Utilizing HashiCorp Terraform, the architecture defines a multi-cloud network spanning AWS (primary hosting region) and GCP (analytics and secondary backup).
This configuration establishes a secure Virtual Private Cloud (VPC) with isolated subnets, provisions managed database backends (AWS RDS PostgreSQL) with automatic storage scaling and multi-region replication, and deploys encrypted storage buckets (S3) configured with object locks and lifecycle rules. Terraform state is managed in a secure remote backend using AWS S3 and DynamoDB for state locking, protecting deployment state files from corruption.

## Vision
To establish an automated, fully declared, self-healing cloud platform where environments can be provisioned, updated, or torn down safely within minutes using GitOps workflows.

## Scope
- Terraform providers configuration for AWS and GCP resources.
- VPC network setup (public, private app, private database subnets, NAT gateways).
- Relational Database Service (RDS) PostgreSQL database clusters configuration.
- S3 media storage bucket access policies, lifecycle rules, and KMS encryption.
- Remote state management, locking schemes, and security guidelines.

## Goals
- **Zero Drift**: 100% of infrastructure components managed through code.
- **Fast Environment Spin-up**: Provision a clean, complete staging cluster in under 15 minutes.
- **High Network Isolation**: Place all database and core caching resources in subnets with zero internet routes.
- **Resilient State Management**: Implement automated backups of Terraform state history with lock protections.

## Functional Requirements
- **Multi-Cloud Support**: Initialize provider APIs for AWS and GCP environments inside unified modules.
- **VPC Subnet Separation**: Configure public entry points (load balancers) separated from private workloads.
- **Database Storage Autoscaling**: Declare database storage classes that expand dynamically when utilization exceeds thresholds.
- **Storage Encryption**: Enforce AES-256 server-side encryption via AWS KMS customer-managed keys (CMK) for all data buckets.
- **WORM Lifecycles**: Declare bucket replication pipelines and object expiration structures.

## Non-Functional Requirements
- **State Validation Speed**: Pre-deployment dry runs (`terraform plan`) must complete and check configurations in under 3 minutes.
- **Uptime Targets**: Multi-NAT configuration to guarantee VPC NAT Gateway path availability above 99.99%.
- **Terraform Compatibility**: Standardize files to use Terraform version `>= 1.8.0`.

## Business Rules
- **State File Isolation**: State files for distinct environments (dev, staging, prod) must reside in isolated bucket paths.
- **Cost Allocation Tags**: All provisioned cloud objects must carry mandatory tagging keys: `Environment`, `Project`, and `Owner`.
- **Destruction Guardrails**: Critical resources (databases, main storage buckets) must be defined with `prevent_destroy = true` lifecycles.

## Actors
- **Platform DevOps Engineer**: Authors and maintains the Terraform modules and runs change plans.
- **Security Auditor**: Reviews network access paths and IAM role configurations for compliance.
- **Billing Manager**: Inspects resource tagging to trace expenditures and analyze cost metrics.

## User Stories
1. **As a DevOps Engineer**, I want to deploy a copy of the networking infrastructure in a new AWS region using variables, so that I can establish a regional failover site.
2. **As a Security Auditor**, I want all database instances configured without public IP endpoints, so that the storage network is protected from internet attacks.
3. **As a Billing Manager**, I want all provisioned resources tagged with their respective environments, so that I can audit cloud spend.

## Acceptance Criteria
- **AC-1**: Terraform configurations must pass static analysis tests (`tflint` and `tfsec`) with zero warnings before merging.
- **AC-2**: VPC subnet design must provide at least 254 IP addresses per availability zone for application pods.
- **AC-3**: S3 bucket policies must deny unencrypted transport payloads (`aws:SecureTransport = false`).
- **AC-4**: Database configurations must enable storage auto-scaling with a maximum storage capacity allocation limit.

## Workflows
### Infrastructure Deployment Sequence (GitOps)
```
[Develop Terraform Modules] ---> [Push Branch] ---> [Run CI Check: Lint & tfsec]
                                                          |
                                                          v
[Deploy changes to Cloud] <--- [Approve Plan] <--- [Run: terraform plan]
```

### Deployment Execution Steps
1. The DevOps engineer edits Terraform files (e.g., updating the DB instance size parameter).
2. The changes are pushed to GitHub. The CI pipeline runs `terraform validate`, `tflint`, and `tfsec` security audits.
3. The pipeline runs `terraform plan` against the target environment, outputting a plan file and posting it to the pull request.
4. Two team members review the plan to verify cost impact and structural correctness.
5. The pull request is merged into `main`.
6. The CD system runs `terraform apply`, fetching remote state locks from DynamoDB to execute resource modifications.
7. Terraform releases the lock and saves the updated state file to the primary backend storage bucket.

## API Design
Cloud components do not directly expose application APIs, but the platform control center interacts with Terraform Cloud run APIs to monitor state deployments.

### Retrieve Terraform Workspace Runs
Retrieves the execution history of deployments.
- **Endpoint**: `GET /api/v1/ops/terraform/runs`
- **Headers**:
  - `Authorization: Bearer <token>`
- **Response Payload (200 OK)**:
```json
{
  "workspace": "newsops-prod-infra",
  "runs": [
    {
      "run_id": "run-f8a91b2c3d",
      "status": "applied",
      "triggered_by": "GitOps CI",
      "created_at": "2026-06-27T21:00:00Z",
      "resources_added": 2,
      "resources_changed": 1,
      "resources_destroyed": 0
    }
  ]
}
```

## Database Design
To maintain state consistency, Terraform utilizes AWS DynamoDB for locking concurrent operations.

### State Locking Table Schema
```sql
-- Conceptual DynamoDB Table Structure
-- Table Name: terraform-state-lock
-- Primary Key: LockID (String)
{
  "LockID": "newsops-prod-infra-state/terraform.tfstate",
  "Info": "{\"ID\":\"uuid-string\",\"Operation\":\"OperationType\",\"Info\":\"UserDetails\",\"Created\":\"Timestamp\"}"
}
```

### 1. Provider and Backend Configuration (`providers.tf`)

```hcl
# ==============================================================================
# File: providers.tf
# Purpose: Defines Terraform settings, required providers, and remote state
# ==============================================================================

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "newsops-tf-state-prod"
    key            = "global/s3/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Environment = var.environment
      Project     = "NewsOps-Cloud"
      ManagedBy   = "Terraform"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
```

### 2. VPC Network Infrastructure Configuration (`vpc.tf`)

```hcl
# ==============================================================================
# File: vpc.tf
# Purpose: Sets up the VPC, subnets, route tables, and internet gateways
# ==============================================================================

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.environment}-vpc"
  }
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name = "${var.environment}-igw"
  }
}

# Public Subnets (For load balancers)
resource "aws_subnet" "public_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
  tags = {
    Name = "${var.environment}-public-subnet-1"
  }
}

resource "aws_subnet" "public_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"
  tags = {
    Name = "${var.environment}-public-subnet-2"
  }
}

# Private App Subnets (For APIs and background tasks)
resource "aws_subnet" "private_app_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "${var.aws_region}a"
  tags = {
    Name = "${var.environment}-private-app-subnet-1"
  }
}

resource "aws_subnet" "private_app_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "${var.aws_region}b"
  tags = {
    Name = "${var.environment}-private-app-subnet-2"
  }
}

# Private DB Subnets (For database databases)
resource "aws_subnet" "private_db_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.20.0/24"
  availability_zone = "${var.aws_region}a"
  tags = {
    Name = "${var.environment}-private-db-subnet-1"
  }
}

resource "aws_subnet" "private_db_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.21.0/24"
  availability_zone = "${var.aws_region}b"
  tags = {
    Name = "${var.environment}-private-db-subnet-2"
  }
}
```

### 3. RDS PostgreSQL Database Configuration (`rds.tf`)

```hcl
# ==============================================================================
# File: rds.tf
# Purpose: Configures the RDS PostgreSQL instance, parameter groups, and security
# ==============================================================================

resource "aws_db_subnet_group" "db_subnets" {
  name       = "${var.environment}-db-subnet-group"
  subnet_ids = [aws_subnet.private_db_1.id, aws_subnet.private_db_2.id]
  tags = {
    Name = "Database Subnet Group"
  }
}

resource "aws_security_group" "db_sg" {
  name        = "${var.environment}-db-security-group"
  description = "Controls database access from private applications"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Allow Postgres access from application servers"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_subnet.private_app_1.cidr_block, aws_subnet.private_app_2.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.environment}-postgres"
  engine                 = "postgres"
  engine_version         = "16.2"
  instance_class         = var.db_instance_class
  allocated_storage      = 100
  max_allocated_storage  = 1000 # Enables automatic storage scaling
  storage_type           = "gp3"
  db_name                = var.db_name
  username               = "newsops_admin"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.db_subnets.name
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.environment}-postgres-final-snapshot"
  deletion_protection    = true
  multi_az               = true

  backup_retention_period = 30
  backup_window           = "02:00-03:00"

  lifecycle {
    prevent_destroy = true
  }
}
```

### 4. S3 Bucket Storage Policies Configuration (`s3.tf`)

```hcl
# ==============================================================================
# File: s3.tf
# Purpose: Sets up the S3 storage bucket, encryption, and bucket access policies
# ==============================================================================

resource "aws_s3_bucket" "media" {
  bucket        = "newsops-${var.environment}-media-storage"
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "media_versioning" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media_encryption" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "block_public" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "media_policy" {
  bucket = aws_s3_bucket.media.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceHTTPSOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.media.arn,
          "${aws_s3_bucket.media.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
```

## UI Design
The internal infrastructure control center features a clean UI dashboard:
- **Topology Visualizer**: Renders an interactive map of subnets, database nodes, and storage endpoints.
- **State Lock Panel**: Displays active locks, preventing deployment conflicts.
- **Tag auditor**: Identifies untagged or incorrectly tagged resources that violate deployment policies.

## Permissions
Access to infrastructure variables and state operations relies on these RBAC mappings:
- `infra:plan:read`: View terraform plan results and run logs.
- `infra:apply:write`: Execute terraform applies to edit resources.
- `infra:state:admin`: Manage remote state files and force unlock operations.

## Security
- **Backend Isolation**: State files are encrypted at rest inside S3 using AWS-KMS, and public access is blocked.
- **Secrets Management**: Secrets (e.g., database passwords) are injected into Terraform via environment variables (`TF_VAR_db_password`) fetched from AWS Secrets Manager, keeping credentials out of configuration files.
- **Network Gating**: Network Security Groups restrict traffic flows so that database subnets only accept connections from backend application subnets on port 5432.

## Performance
- **NAT Gateways**: Deploy independent NAT Gateways in each availability zone to avoid cross-AZ latency and data transfer costs.
- **State Storage Speed**: DynamoDB handles locking with single-digit millisecond latency to ensure run synchronization.

## Monitoring
- **Prometheus Metrics**:
  - `newsops_terraform_drift_detected`: Binary indicator of configuration drift.
  - `newsops_vpc_nat_gateway_bytes`: Network throughput metrics.
- **Alert Rules**:
  - **NatGatewayHighTraffic**: Alert if NAT Gateway throughput exceeds 80% capacity. Action: Notify the network engineering team.

## Logging
Terraform pipeline execution records details of each run phase.

```json
{
  "timestamp": "2026-06-27T22:55:00.005Z",
  "level": "INFO",
  "task": "terraform_apply",
  "message": "Resource modification completed successfully",
  "details": {
    "duration_seconds": 182,
    "actions": {
      "added": 3,
      "modified": 1,
      "destroyed": 0
    },
    "state_hash": "2a83b1657ff1fc53b92c48d28cf3b3a2a129ef318182b8a09cf31828f7318ff2"
  }
}
```

## Error Handling
| Terraform Error | Pipeline Status | Root Cause | Resolution |
|---|---|---|---|
| `StateLockedException` | Blocked execution | Another deployment is running or did not release its lock. | Verify active runs; force unlock if a past execution failed. |
| `ProviderAuthError` | Failed run | Outdated API tokens or expired credentials. | Check AWS/GCP IAM roles and access tokens. |
| `ResourceDependencyError`| Failed run | Circular dependency or resource order conflict. | Review dependency paths and use `depends_on` rules. |

## Edge Cases
- **Stale State Locks**: If a deployment agent crashes mid-run, the lock remains in DynamoDB, blocking future runs. Engineers resolve this by using `terraform force-unlock <lock-id>` after verifying the deployment runner is inactive.
- **Provider Outages**: If a cloud provider's API goes down, Terraform runs will fail. The pipeline handles this by caching the current system state, allowing it to skip API calls and keep local services running.

## Future Improvements
- **Automated Drift Correction**: Configure a daily cron task that checks active infrastructure against Terraform configurations, alerting the team to any manual changes.

## Mermaid Diagrams

### Multi-Region Multi-Cloud Network Topology

```mermaid
flowchart TD
    subgraph AWS Primary Region (us-east-1)
        subgraph VPC Network
            subgraph Public Subnets
                LB["Application Load Balancer"]
            end
            
            subgraph Private Application Subnets
                API["Kubernetes Web Nodes"]
            end
            
            subgraph Private Database Subnets
                DB["AWS RDS PostgreSQL (Primary)"]
            end
        end
    end
    
    subgraph GCP Cloud (us-central1)
        subgraph GCP VPC
            BigQuery["Google BigQuery Analytics"]
        end
    end

    LB -->|Routes requests| API
    API -->|Connects to DB| DB
    API -->|Syncs logs| BigQuery
```

## References
- [System Architecture Overview](../02-architecture/system_architecture.md)
- [Tenant isolation database model](../03-database/tenant_isolation_database.md)
- [Environment Variables Inventory](./environment_variables.md)
- [Git Workflow and Deployment Policies](./git_workflow.md)
