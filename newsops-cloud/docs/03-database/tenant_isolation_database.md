# Tenant Isolation Database Architecture

## Purpose
This document details the multi-tenant database isolation strategies implemented in NewsOps Cloud. It provides a deep architectural comparison between shared-database schema isolation and database-per-tenant isolation models, accompanied by concrete NestJS code implementations and dynamic database resolver middleware configurations.

## Executive Summary
Multi-tenancy is a core requirement of NewsOps Cloud. To accommodate diverse clients ranging from small local news portals to multinational media networks, the system implements a hybrid isolation model. Standard and Professional tiers are housed in a single PostgreSQL cluster partitioned logically using **PostgreSQL Schemas** (`tenant_a`, `tenant_b`). Enterprise clients are allocated a dedicated, physically isolated **Database-per-Tenant** configuration. This document outlines how the NestJS monolith dynamically resolves, pools, and routes requests to the appropriate database resource using `AsyncLocalStorage` context propagation and dynamic Prisma connection factories.

## Vision
The goal is a zero-latency overhead multi-tenant database router. The system will transparently intercept every HTTP, GraphQL, or worker request, resolve the tenant context, and return a cached, fully pooled Prisma database client scoped to that tenant's database resource, allowing the monolith to scale linearly across tenant tiers.

## Scope
This document covers:
1. **Comparative Architecture Analysis**: Shared schema vs. database-per-tenant architectures.
2. **NestJS Context Propagation**: Middleware and `AsyncLocalStorage` implementation to capture tenant identifiers.
3. **Dynamic Prisma Client Resolver**: Connection caching, PgBouncer configurations, and dynamic schema injection.
4. **Connection Pool Management**: Handling connection limit safety, replica routing, and cache eviction.

It does not cover tenant registration forms or billing pipelines (covered in `01-business`).

## Goals
- **Absolute Data Segregation**: Guarantee that no database query ever leaks data between tenants.
- **Dynamic Context Routing**: Resolve tenant context dynamically at runtime within $< 2\text{ ms}$ on every incoming request.
- **Efficient Pool Allocation**: Prevent connection exhaustion by caching and recycling tenant database client connections.
- **Operational Scalability**: Enable seamless upgrades of standard-tier schemas to dedicated physical databases.

## Functional Requirements
- **Tenant Context Extraction**: The system must extract the tenant identifier from the subdomain (e.g., `tenant1.newsops.cloud`) or the `x-tenant-id` request header.
- **Dynamic Prisma Connection Routing**: Provide a dynamic Prisma instance at runtime pointing to the correct PostgreSQL schema or dedicated database URI.
- **Auto-Provisioning**: Support executing automated schema migrations when a new tenant is provisioned.
- **Dynamic Connection Eviction**: Automatically close idle database connections to prevent pool starvation.

## Non-Functional Requirements
- **Tenant Resolution Latency**: Tenant extraction and connection resolver lookup must execute in $< 1.5\text{ ms}$.
- **Connection Reuse Ratio**: Maintain a client connection cache hit ratio of $> 98\%$ to avoid reconnect overhead.
- **Concurrency Support**: The dynamic router must handle at least 15,000 requests per second across 1,000 distinct tenant contexts.

## Business Rules
- **Enterprise Isolation Guarantee**: Any tenant registered as an Enterprise tier must be deployed in a dedicated database cluster; shared schemas are forbidden.
- **Billing Suspension Enforcement**: If a tenant's billing status changes to `SUSPENDED`, the tenant resolver must immediately reject connections with a 403 status code.
- **Global Table Exemption**: Global system tables (e.g., tenant registries, subscription tiers) must only reside in the default `public` schema.

## Actors
- **Application Request**: The incoming execution context requesting database access.
- **Tenant Middleware / Interceptor**: Extracts headers/subdomains and populates the request context.
- **Database Resolver Service**: Manages client connection caches and returns the correct Prisma client.
- **Database Administrator (DBA)**: Monitors connections across both shared and dedicated clusters.

## User Stories
- **User Story 1**: As an Enterprise Tenant Administrator, I want my data to reside on a physically separate database instance so that our internal security and compliance policies are satisfied.
- **User Story 2**: As a Backend Developer, I want the database connection routing to happen transparently behind the scenes so that I can write standard database queries without worrying about multi-tenancy configurations.
- **User Story 3**: As a DevOps Engineer, I want the system to automatically close idle tenant connections so that our PostgreSQL servers do not run out of file descriptors.

## Acceptance Criteria
- Shared schemas must use unique Postgres schemas (e.g., `tenant_id` as the schema name).
- Under load, the NestJS tenant resolver must not exceed 2 ms of overhead for connection retrieval.
- Idle tenant connection clients must be evicted from the memory cache and disconnected after 10 minutes of inactivity.
- Dedicated tenant DB connection strings must be encrypted and retrieved from AWS Secrets Manager.

## Workflows
### Request Context Routing Workflow
1. **Ingress**: An HTTP request strikes the NestJS Application (`GET tenant-a.newsops.cloud/api/v1/articles`).
2. **Interception**: The `TenantMiddleware` extracts `tenant-a` from the hostname.
3. **Validation**: The middleware checks the cached global tenant registry to verify that `tenant-a` is active and reads its database strategy.
4. **Context Binding**: The middleware binds `tenant-a` data to `AsyncLocalStorage`.
5. **Database Resolution**: The `PrismaClientResolver` checks its internal cache for an active client matching `tenant-a`.
6. **Execution**: If cached, the client is returned; if not, a new Prisma Client is instantiated with the tenant's connection string/schema, added to the cache, and returned to run the query.

## API Design
### Tenant Configuration Management API
Administrative endpoints to configure tenant isolation details.

* **URL**: `/api/v1/admin/tenants/:id/db-config`
* **Method**: `PUT`
* **Headers**:
  * `Authorization: Bearer <JWT>`
  * `X-Tenant-ID: system`
* **Request Payload**:
```json
{
  "dbStrategy": "DEDICATED_DB",
  "connectionUrl": "postgresql://db_user:enc_password@rds-ent-cluster.xyz.us-east-1.rds.amazonaws.com:5432/tenant_a_db?schema=public&sslmode=require&pgbouncer=true",
  "poolMaxConnections": 30,
  "idleTimeoutSeconds": 600
}
```
* **Response Payload (200 OK)**:
```json
{
  "tenantId": "5fa23d4c-c049-43c7-9cfb-81d368e7b34e",
  "dbStrategy": "DEDICATED_DB",
  "status": "CONFIGURED",
  "lastMigrationVersion": "20260627_init",
  "updatedAt": "2026-06-27T22:17:28Z"
}
```

## Database Design
### Isolation Strategies Comparison
| Dimension | Shared Database (Schema Isolated) | Dedicated Database-per-Tenant |
| :--- | :--- | :--- |
| **Physical Isolation** | Shared RDS Instance & Disk | Dedicated RDS Instance / DB |
| **Logical Isolation** | Postgres Schema (`tenant_foo`) | PostgreSQL Database Cluster |
| **Max Scale** | Limited by single RDS cluster size | Virtually infinite, scale per tenant |
| **Cost Profile** | Low (Resource sharing) | High (Separate instances) |
| **Noisy Neighbor Effect**| Moderate risk (Shared CPU/Memory) | Isolated completely |
| **Maintenance** | Single backup, consolidated migrations | Backup per tenant, complex orchestrations |

## UI Design
The Tenant Operations Admin portal includes:
- **Tenant Provisioning Wizard**: Allows operators to set subdomains, select tiering (Standard, Enterprise), configure connection details, and select DB isolation strategy.
- **Connection Monitor**: Live chart showing cache hits vs. cache misses for the dynamic Prisma connections, active connection count, and average pool allocation latency.
- **Tenant Schema Migrator Console**: Allows manual triggering of schema updates to specific groups of tenants, showing execution logs in a terminal-like viewport.

## Permissions
Access to manage tenant database connections and strategies requires critical administrative authorization:
- `tenants:read`: View tenant lists, strategies, and connection status.
- `tenants:configure-db`: Modify database routes, migration versions, and pool parameters.

## Security
- **Credential Storage**: Dedicated tenant credentials must be stored in AWS Secrets Manager using a key format: `newsops/tenant/{tenantId}/db-credentials`.
- **SQL Parameterization**: The system must utilize parameterized inputs for dynamic schema routing. No raw SQL query string interpolation is permitted.
- **Tenant Context Sanitization**: Subdomains and header values must pass strict regex validation (`^[a-zA-Z0-9\-]+$`) before processing to block directory traversal or injection.

## Performance
- **Connection Caching**: Prisma client instances must be cached in-memory inside the NestJS execution space using a Least-Recently-Used (LRU) cache.
- **PgBouncer Pooling**: Every tenant connection string must enforce `pgbouncer=true` in its query params and target transactional-mode PgBouncer endpoints to minimize connection creation overhead.
- **Replication Routing**: Reading operations should target reader replicas (using connection parameters or custom Prisma plugins) to balance traffic.

## Monitoring
- **Prometheus Metric**: `tenant_resolver_cache_hit_ratio` (Gauge measuring active client cache efficiency).
- **Prometheus Metric**: `tenant_connection_evictions_total` (Counter tracking dynamic client destructions).
- **Prometheus Metric**: `tenant_db_latency_seconds` (Histogram tracking database response times segmented by tenant ID).
- **Alert Trigger**: Trigger AlertManager notification if `tenant_resolver_cache_hit_ratio < 0.90` over 5 minutes, indicating potential connection churning.

## Logging
Structured JSON formatting must include trace contexts and tenant contexts:
* **Log Pattern**: `{"timestamp": "%ISO8601%", "level": "INFO", "tenant_id": "tenant-a", "context": "PrismaClientResolver", "message": "Resolved client from cache", "duration_ms": 0.12}`
* **Error Level**: `ERROR` for connection failures to dedicated DB clusters; `WARN` for schema resolution timeouts.

## Error Handling
| Internal Error Code | HTTP Status | Customer-Facing Message |
|:---|:---|:---|
| `ERR_TENANT_NOT_FOUND` | 404 Not Found | The requested publishing workspace does not exist. |
| `ERR_TENANT_SUSPENDED` | 403 Forbidden | The workspace has been suspended due to administrative reasons. |
| `ERR_TENANT_DB_CONN_FAIL` | 503 Service Unavailable | Failed to establish database connection for the workspace. |

## Edge Cases
- **Stale Tenant Cache**: If tenant configurations (e.g., strategy update) are altered, the cache must be invalidated. The system implements a Redis Pub/Sub channel (`tenant_config_invalidated`) to coordinate cash invalidation across all NestJS monolith nodes.
- **Cold Boot Thrashing**: When the NestJS instances restart, thousands of requests can cause concurrent cache-miss instantiations. The resolver implements a request coalescing locking pattern to ensure a tenant client is only instantiated once.

## Future Improvements
- **Aurora Serverless Integration**: Migrate enterprise tenants to Aurora Serverless v2 to automatically scale compute capacity down to zero during off-peak hours, optimizing cost.
- **Dynamic Database Sharding Platform**: Transition standard schema tenants to an automated sharding architecture using Citus or CockroachDB when the shared database exceeds 5TB.

## Mermaid Diagrams
### Dynamic Database Routing Request Lifecycle
```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant Gate as NestJS TenantMiddleware
    participant Storage as AsyncLocalStorage Context
    participant Resolver as PrismaClientResolver
    participant Cache as Client Cache (LRU)
    participant DB as PostgreSQL Server

    User->>Gate: GET /api/v1/articles (Host: tenant1.newsops.cloud)
    Gate->>Gate: Extract 'tenant1' subdomain
    Gate->>Storage: Set('tenantId', 'tenant1')
    Gate->>Resolver: getClient()
    Resolver->>Storage: Get('tenantId')
    Storage-->>Resolver: 'tenant1'
    Resolver->>Cache: Find('tenant1')
    
    alt Cache Hit
        Cache-->>Resolver: Active PrismaClient Instance
    else Cache Miss
        Resolver->>Resolver: Retrieve config & build connection string
        Resolver->>DB: Instantiate PrismaClient (Connect & Handshake)
        Resolver->>Cache: Store('tenant1', PrismaClient)
        Cache-->>Resolver: PrismaClient
    end
    
    Resolver-->>Gate: PrismaClient
    Gate->>DB: Exec SQL Query (SET search_path TO tenant1; SELECT * FROM articles)
    DB-->>Gate: SQL Result
    Gate-->>User: JSON Response (200 OK)
```

## NestJS Code Implementation
Below is the concrete code implementation for dynamic database resolution in NewsOps Cloud.

### 1. Tenant Storage Context (`tenant-context.storage.ts`)
```typescript
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
  dbStrategy: 'SHARED_SCHEMA' | 'DEDICATED_DB';
  connectionUrl?: string;
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantContext>();
```

### 2. NestJS Tenant Middleware (`tenant.middleware.ts`)
```typescript
import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantLocalStorage, TenantContext } from './tenant-context.storage';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  // Simulating database lookup for active tenants. In production, this utilizes Redis cache.
  private async getTenantConfig(subdomain: string): Promise<TenantContext | null> {
    const mockTenants: Record<string, TenantContext> = {
      'techcrunch': { tenantId: 'techcrunch-uuid', dbStrategy: 'SHARED_SCHEMA' },
      'wired': { tenantId: 'wired-uuid', dbStrategy: 'SHARED_SCHEMA' },
      'nytimes': { 
        tenantId: 'nytimes-uuid', 
        dbStrategy: 'DEDICATED_DB',
        connectionUrl: 'postgresql://nytimes_usr:pass@ent-db-cluster:5432/nytimes?schema=public&pgbouncer=true'
      }
    };
    return mockTenants[subdomain] || null;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];
    
    // Resolve custom tenant ID header or fall back to subdomain
    const tenantHeader = req.headers['x-tenant-id'] as string;
    const lookupKey = tenantHeader || subdomain;

    if (!lookupKey) {
      throw new UnauthorizedException('Tenant context missing from host subdomain or custom header.');
    }

    const tenantConfig = await this.getTenantConfig(lookupKey);
    if (!tenantConfig) {
      throw new ForbiddenException(`Workspace '${lookupKey}' does not exist or has been disabled.`);
    }

    tenantLocalStorage.run(tenantConfig, () => {
      next();
    });
  }
}
```

### 3. Dynamic Prisma Client Resolver (`prisma-client.resolver.ts`)
```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantLocalStorage } from './tenant-context.storage';

@Injectable()
export class PrismaClientResolver implements OnModuleDestroy {
  // In-memory cache holding Prisma instances per tenant
  private clientCache = new Map<string, PrismaClient>();
  private defaultDatabaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/newsops?schema=public';

  /**
   * Retrieves or instantiates the dynamic Prisma client scoped to the current tenant context.
   */
  public getClient(): PrismaClient {
    const context = tenantLocalStorage.getStore();
    if (!context) {
      throw new Error('Database query executed outside of a valid active tenant context.');
    }

    const cacheKey = context.tenantId;
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    let prismaClient: PrismaClient;

    if (context.dbStrategy === 'SHARED_SCHEMA') {
      // Direct client to the shared database but override search path (schema) for the request
      const schemaName = `tenant_${context.tenantId.replace(/-/g, '_')}`;
      const connectionUrl = `${this.defaultDatabaseUrl}&schema=${schemaName}`;
      
      prismaClient = new PrismaClient({
        datasources: {
          db: { url: connectionUrl },
        },
        log: ['query', 'error', 'warn'],
      });
    } else {
      // Dynamic connection to a physically dedicated database
      if (!context.connectionUrl) {
        throw new Error(`Connection configuration is missing for dedicated tenant: ${context.tenantId}`);
      }
      prismaClient = new PrismaClient({
        datasources: {
          db: { url: context.connectionUrl },
        },
        log: ['query', 'error', 'warn'],
      });
    }

    // Cache the newly created client instance
    this.clientCache.set(cacheKey, prismaClient);
    return prismaClient;
  }

  async onModuleDestroy() {
    // Gracefully disconnect all clients on application shutdown
    for (const [tenantId, client] of this.clientCache.entries()) {
      await client.$disconnect();
    }
    this.clientCache.clear();
  }
}
```

## References
- Database Architecture Overview: [index.md](./index.md)
- Schema Design Standards: [schema_design_standards.md](./schema_design_standards.md)
- Identity and Organization Schema: [identity_and_org_schema.md](./identity_and_org_schema.md)
- Multi-Tenancy Architecture Document: [../02-architecture/multi_tenancy_architecture.md](../02-architecture/multi_tenancy_architecture.md)
