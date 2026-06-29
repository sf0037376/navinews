# Environment Variables Inventory

## Purpose
This document provides a comprehensive, centralized registry of all environment variables, runtime configurations, api keys, and security secrets utilized by the NewsOps Cloud digital publishing platform. It serves as the single source of truth for deployment configurations across Local Development, Staging, and Production environments, defining variable naming standards, default values, validation constraints, and rotation policies.

## Executive Summary
Configuring cloud-native architectures requires robust runtime configuration management. NewsOps Cloud employs a "12-Factor App" configuration paradigm, injecting database connection strings, authentication credentials, third-party API integration keys, and cloud storage targets directly through environment variables. 
To ensure security, all environment variables containing secrets are stored in high-security key-management stores (e.g., AWS Secrets Manager, HashiCorp Vault) and injected into workloads at runtime, while non-sensitive properties are managed in config maps. This inventory categorizes these variables, details their validation patterns, and provides secure recovery configurations.

## Vision
To achieve a completely zero-trust, automated environment provisioning configuration where secrets are never committed to code repositories, are rotated automatically without downtime, and are audited at every access point.

## Scope
- Runtime connection parameters for relational and key-value databases.
- Encryption keys, JWT signature parameters, and application salts.
- Third-party SaaS API keys (Stripe, SendGrid, OpenAI, PagerDuty, etc.).
- Webhook signature validation keys.
- Media storage directories and content delivery network (CDN) host URLs.
- Secure environment injection workflows and environment validation logic.

## Goals
- **100% Secret Protection**: Zero plaintext keys stored in version control systems.
- **Fast Startup Validation**: Under 200ms startup verification step to fail fast if any mandatory variables are missing or malformed.
- **Automated Rotation Compliance**: Support database credential and API token rotation protocols.

## Functional Requirements
- **Runtime Environment Parsing**: Microservices must parse incoming environmental variables on container bootstrap.
- **Strong Typing Validation**: Parse string environment variables into correct data types (e.g., ports as integers, flags as booleans).
- **Environment Parity**: Maintain identical environment keys across development, staging, and production, varying only the values.
- **Secret Separation**: Distinguish non-sensitive parameters from sensitive tokens to prevent accidental exposure in application logs.

## Non-Functional Requirements
- **Verification Overhead**: The parsing and validation framework must execute in less than 5ms during runtime initialization.
- **Zero Disk Writing**: Keys must exist only in-memory (RAM) and must never write to transient system swap files or local system logs.

## Business Rules
- **Access Least Privilege**: No developer machine may contain active production secrets.
- **Mandatory Secrets Rotation**: Critical variables (e.g., database user passwords, vendor API tokens) must be rotated every 90 days.
- **Telemetry Anonymization**: Logs must automatically redact fields matching sensitive key prefixes (e.g., `_SECRET`, `_KEY`, `_TOKEN`).

## Actors
- **Application Developer**: Refers to this registry when introducing new runtime flags or configurations.
- **Platform DevOps Engineer**: Configures AWS Secrets Manager mappings and Helm config maps using these key names.
- **Security Administrator**: Performs automated checks to confirm key rotation schedules and audit credential usage.

## User Stories
1. **As an Application Developer**, I want to look up the exact env key for the OpenAI API endpoint so that my content-generation module can interact with the correct model configuration.
2. **As a Platform DevOps Engineer**, I want a structured template of all variables with validation regexes, so that I can validate deployment configurations automatically before they go live in Kubernetes.
3. **As a Security Administrator**, I want to ensure that no developer can access production credentials directly, using IAM token exchange pathways instead.

## Acceptance Criteria
- **AC-1**: Every environment variable must have a designated validation pattern (e.g., regex, range, or enum list).
- **AC-2**: The container entrypoint must crash immediately with a non-zero code if any variable marked as `Required` is missing.
- **AC-3**: Webhook endpoint configurations must include signature keys to prevent unauthenticated callbacks from external payment engines.

## Workflows
### Secret Injection Pipeline at Workload Startup
```
[AWS Secrets Manager / Vault]
            |
            | (Secure Fetch on Startup)
            v
[External Secret Operator] ---> [K8s Secret Resource] ---> [Pod Environmental Injection] ---> [App Validation Parse]
                                                                                                      |
                                                                                                      +-- (Valid) --> [Launch App]
                                                                                                      |
                                                                                                      +-- (Invalid) -> [Crash Pod]
```

### Injection Sequence Steps
1. The Kubernetes Pod is scheduled on a worker node.
2. The External Secrets Operator retrieves secrets from AWS Secrets Manager using IAM Roles for Service Accounts (IRSA).
3. The secrets are mapped to a native Kubernetes `Secret` resource.
4. The deployment manifest references the secret keys, injecting them into the target container container env list.
5. The application binary executes its entrypoint parser (`config.go` or `config.ts`), parsing every variable.
6. If parsing validation fails, the process prints a detailed validation failure payload (omitting values) and exits with code `78` (Configuration Error).

## API Design

The platform operations gateway exposes an endpoint to check that all environment variables are correctly injected and valid, without exposing sensitive values.

### Validate System Configurations
Provides a summary validation check for system environment variables.
- **Endpoint**: `POST /api/v1/ops/config/validate`
- **Headers**:
  - `Authorization: Bearer <token>`
- **Response Payload (200 OK)**:
```json
{
  "status": "VALID",
  "checked_variables_count": 34,
  "validation_timestamp": "2026-06-27T22:45:00Z",
  "checks": [
    {
      "category": "DATABASE",
      "status": "PASS",
      "details": "All database URL formats and connection bounds are correct."
    },
    {
      "category": "SECRETS_KEYS",
      "status": "PASS",
      "details": "JWT signatures and cookies keys conform to length requirements."
    },
    {
      "category": "SERVICE_PROVIDER_APIS",
      "status": "PASS",
      "details": "Stripe, SendGrid, and OpenAI connection tests succeeded."
    }
  ]
}
```

## Database Design
While environment variables exist primarily at the operating system container layer, the administration DB contains the `config_audit_logs` table.

```sql
CREATE TABLE public.config_audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    environment_name VARCHAR(50) NOT NULL, -- 'production', 'staging', 'development'
    variable_key VARCHAR(255) NOT NULL,
    value_hash VARCHAR(64) NOT NULL, -- SHA256 of the value to check for changes without storing plaintext
    is_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    operator_identity VARCHAR(150) NOT NULL,
    CONSTRAINT pk_config_audit_logs PRIMARY KEY (id)
);

CREATE INDEX idx_config_audit_lookup ON public.config_audit_logs (environment_name, variable_key, checked_at DESC);
```

### Technical Inventory: Environment Variables Registry

#### 1. Database and Cache Connection Settings

| Env Variable Name | Type | Required | Default Value | Validation Rule / Regex / Format | Description |
|---|---|---|---|---|---|
| `DATABASE_URL` | String | Yes | *None* | `^postgresql://[a-zA-Z0-9_\-\%\+]+:[a-zA-Z0-9_\-\%\+\*]+@[a-zA-Z0-9\-\.]+:[0-9]+/?[a-zA-Z0-9_\-]+(\?.*)?$` | Main transactional PostgreSQL connection URL. Must use percent encoding. |
| `DATABASE_MAX_CONNECTIONS` | Integer | No | `50` | `^[0-9]+$` (Min: 5, Max: 500) | Maximum connections allowed in the PostgreSQL pool. |
| `REDIS_URL` | String | Yes | *None* | `^redis://:[a-zA-Z0-9_\-\%]+@[a-zA-Z0-9\-\.]+:[0-9]+/[0-9]+$` | Primary Redis cluster cache and session connection URL. |
| `ELASTICSEARCH_URL` | String | Yes | *None* | `^https?://[a-zA-Z0-9\-\.]+:[0-9]+$` | Elasticsearch search engine and log storage connection URL. |
| `KAFKA_BOOTSTRAP_SERVERS` | String | Yes | *None* | `^[a-zA-Z0-9\-\.]+:[0-9]+(,[a-zA-Z0-9\-\.]+:[0-9]+)*$` | Comma-separated list of Kafka broker cluster nodes. |

#### 2. Encryption Keys and Secrets

| Env Variable Name | Type | Required | Default Value | Validation Rule / Regex / Format | Description |
|---|---|---|---|---|---|
| `JWT_SECRET_KEY` | String | Yes | *None* | `^[a-zA-Z0-9+/=]{44,}$` (Base64 encoded, min 256 bits) | Secret signing key for authenticating and verification of user JWT tokens. |
| `SESSION_COOKIE_SECRET` | String | Yes | *None* | `^[a-fA-F0-9]{64}$` (Hex encoded, min 256 bits) | Key used to encrypt server-side cookie payload hashes. |
| `ENCRYPTION_MASTER_KEY` | String | Yes | *None* | `^[a-fA-F0-9]{64}$` | Key utilized for transparent encryption of database personal attributes (PII). |

#### 3. Service Provider APIs

| Env Variable Name | Type | Required | Default Value | Validation Rule / Regex / Format | Description |
|---|---|---|---|---|---|
| `STRIPE_API_KEY` | String | Yes | *None* | `^sk_live_[a-zA-Z0-9]{24,}$` | Production Stripe private payment API token. |
| `SENDGRID_API_KEY` | String | Yes | *None* | `^SG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43}$` | SendGrid transactional email service API credential. |
| `OPENAI_API_KEY` | String | Yes | *None* | `^sk-proj-[a-zA-Z0-9]{40,}$` | OpenAI LLM gateway key for article intelligence processing. |
| `PAGERDUTY_INTEGRATION_KEY` | String | No | *None* | `^[a-zA-Z0-9]{32}$` | Routing integration key for posting backup failures. |

#### 4. Webhook Signatures

| Env Variable Name | Type | Required | Default Value | Validation Rule / Regex / Format | Description |
|---|---|---|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | String | Yes | *None* | `^whsec_[a-zA-Z0-9]{32,}$` | Stripe webhook payload signature verification secret. |
| `GITHUB_WEBHOOK_SECRET` | String | No | *None* | `^[a-zA-Z0-9]{40}$` | GitHub payload validation token for auto-deploy hooks. |

#### 5. Distributed Storage & CDNs

| Env Variable Name | Type | Required | Default Value | Validation Rule / Regex / Format | Description |
|---|---|---|---|---|---|
| `AWS_S3_MEDIA_BUCKET` | String | Yes | *None* | `^[a-z0-9.\-]{3,63}$` | Target S3 bucket name for hosting user media assets uploads. |
| `CDN_BASE_URL` | String | Yes | *None* | `^https://[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(/.*)?$` | CDN root URL mapped to S3 bucket edge distributions. |
| `AWS_REGION` | String | Yes | `us-east-1` | `^[a-z]{2}-[a-z]+-[0-9]$` | AWS Target deploy region for cluster storage services. |

### Configuration Manifest: `.env.example`

Developers can copy this template to set up their local environments.

```bash
# ==============================================================================
# File: .env.example
# Purpose: Environment template configuration file for NewsOps Cloud local environment
# Instructions: Copy this file to .env and configure actual values
# ==============================================================================

# System Node Settings
NODE_ENV=development
PORT=8080
LOG_LEVEL=debug

# Databases & Cache Connections
DATABASE_URL=postgresql://developer:dev_password@127.0.0.1:5432/newsops_dev?sslmode=disable
DATABASE_MAX_CONNECTIONS=10
REDIS_URL=redis://:redis_password@127.0.0.1:6379/0
ELASTICSEARCH_URL=http://127.0.0.1:9200
KAFKA_BOOTSTRAP_SERVERS=127.0.0.1:9092

# Secrets & Encryption Keys (Generated using: openssl rand -base64 32 / openssl rand -hex 32)
JWT_SECRET_KEY=bW9yZS10aGFuLTMyLWNoYXJhY3Rlci1zZWNyZXQta2V5LXNhbXBsZS1iYXNlNjQ=
SESSION_COOKIE_SECRET=8f83b1657ff1fc53b92c48d28cf3b3a2a129ef318182b8a09cf31828f7318ff2
ENCRYPTION_MASTER_KEY=bc3188ffab32a10129cfba839e928cf892301988fac12bc1298ffca812bc8ff2

# Third-Party Integrations
STRIPE_API_KEY=sk_test_51NzABC123XYZ...
SENDGRID_API_KEY=SG.example_key_123456_7890abcdef...
OPENAI_API_KEY=sk-proj-exampleprojkey1234567890abcdef...
PAGERDUTY_INTEGRATION_KEY=ab12cd34ef56gh78ij90kl12mn34op56

# Webhooks Validations
STRIPE_WEBHOOK_SECRET=whsec_testwebhookkey1234567890...
GITHUB_WEBHOOK_SECRET=githubsecretkey1234567890abcdef123456

# AWS Storage Settings
AWS_REGION=us-east-1
AWS_S3_MEDIA_BUCKET=newsops-dev-media-uploads
CDN_BASE_URL=https://cdn-dev.newsopscloud.net
```

## UI Design
The system administration control panel contains a "Runtime Configurations" page:
- **Configuration Cards**: Categorized lists of env keys (Databases, Third-party APIs, Storage, Keys).
- **Status Badges**: Shows green checks for "Valid Format", and orange marks for "Pending Rotation".
- **Hash Verifier**: Tool to paste a local env key configuration to compare its SHA256 hash against the cluster state, ensuring configurations match.
- **Masked Values**: Secret fields display dots and have a hidden toggle to reveal configurations (available only to audited administrators).

## Permissions
Access to env variables and audit records uses these RBAC permissions:
- `configs:read`: View configuration variable names, hashes, and validation statuses.
- `configs:write`: Create new environment key declarations or trigger a validation run.
- `configs:reveal`: View plaintext sensitive properties. Restricted to the Security Administrator role.

## Security
- **Dynamic Decryption**: Secrets are never cached locally on disk. They exist strictly in memory.
- **Log Scrubbing**: Log drivers employ regex interceptors to scrub occurrences of keys like `JWT_SECRET` or API tokens, replacing them with `[REDACTED_SECRET]`.
- **Entropy Demands**: Secrets validation requires keys containing high entropy (e.g., minimum 256 bits, encoded in base64 or hex).

## Performance
- **Zero Cost Checks**: Startup parsing uses pre-compiled Regex objects inside the app runtime to maintain microsecond performance checks.
- **Connection Pools**: Database strings are parsed once and mapped into standard reusable connection pool clients, avoiding regex checks during HTTP requests.

## Monitoring
- **Prometheus Metrics**:
  - `newsops_config_validation_failures`: Count of invalid parameters encountered during runtime execution.
  - `newsops_config_days_until_expiration{secret_name="..."}`: Metrics tracking target credential ages.
- **Alert Rules**:
  - **SecretExpirationWarning**: Alert if `newsops_config_days_until_expiration < 14` days. Action: Send reminder Slack message.
  - **SecretExpirationCritical**: Alert if `newsops_config_days_until_expiration < 3` days. Action: Open high-priority Jira ticket.

## Logging
Runtime config logger prints structured configuration check states.

```json
{
  "timestamp": "2026-06-27T22:45:10.002Z",
  "level": "INFO",
  "logger": "app.config.validator",
  "message": "Environment variable validation completed successfully",
  "details": {
    "parsed_count": 28,
    "missing_optional": [
      "REDIS_REPLICA_URL",
      "KAFKA_SASL_PASSWORD"
    ],
    "environment": "production"
  }
}
```

## Error Handling
| Variable Parsing Error | App Status Code | Diagnostic Description | Remediation |
|---|---|---|---|
| `ERR_ENV_MISSING_MANDATORY` | 78 (EX_CONFIG) | "Required env key not found." | Check deployment environment configurations. |
| `ERR_ENV_MALFORMED_URL` | 78 (EX_CONFIG) | "Database URL failed parsing check." | Check that URI protocol, hostname, and ports match pattern. |
| `ERR_ENV_WEAK_SECRET` | 78 (EX_CONFIG) | "Security key fails entropy threshold." | Generate a secure cryptographically random key. |

## Edge Cases
- **Secret Rotation Grace Period**: During rotation, old database connections may fail. The system manages this by accepting a semicolon-separated backup URL in `DATABASE_URL_FALLBACK`.
- **Special Characters in Passwords**: DB connection strings containing symbols like `@` or `:` can break standard URI parsers. The validation framework mandates percent-encoding (`RFC 3986`) for username and password fields before processing connection strings.

## Future Improvements
- **Kubernetes Vault Agent Sidecars**: Migrate from static environment mapping to dynamic sidecar mounts, fetching secrets on-the-fly and pushing signups straight to memory namespaces without Docker environmental variables exposure.

## Mermaid Diagrams

### Environment Variables Parsing & Verification Architecture

```mermaid
flowchart TD
    subgraph Host OS Environment
        A["DATABASE_URL"]
        B["JWT_SECRET_KEY"]
        C["STRIPE_API_KEY"]
        D["AWS_S3_MEDIA_BUCKET"]
    end
    
    subgraph Microservice Entrypoint
        E["Config Loader Client"]
        F{"Regex & Format Checks"}
        G["Fail: Exits with Code 78"]
        H["Pass: Bootstraps App Components"]
    end
    
    A & B & C & D --> E
    E --> F
    F -- "Validation Fail" --> G
    F -- "Validation Success" --> H
    
    H --> I["PostgreSQL Connection Pool"]
    H --> J["JWT Validator Filter"]
    H --> K["Stripe payment client"]
```

## References
- [Backup Scripts and Disaster Recovery Procedures](./backup_scripts.md)
- [Git Workflow and Deployment Policies](./git_workflow.md)
- [Infrastructure as Code (IaC) Architecture](./infrastructure_as_code.md)
