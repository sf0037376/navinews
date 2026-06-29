# Docker Environments Specification
## Purpose
This document provides production-ready multi-stage `Dockerfile` configurations and local development `docker-compose.yml` setups for the NewsOps Cloud digital publishing platform. It ensures a standardized containerization blueprint for running the NestJS backend monolith and the Next.js frontend, maintaining consistent behaviors from local testing to Kubernetes production clusters.

## Executive Summary
NewsOps Cloud containerization relies on lightweight Docker images using official Node.js Alpine base images. The NestJS backend is compiled to pure JavaScript, stripping all development dependencies to minimize the production container footprint. The Next.js frontend utilizes Next.js Standalone Output to package the web server with only the minimal files required for production execution. Local development uses Docker Compose to orchestrate Next.js, NestJS, PostgreSQL, PgBouncer, and Redis with live-reloads and volume-mount bindings.

## Vision
The vision is to establish immutable, zero-dependency, and highly secure runtime environments. Containers should serve as predictable, stateless units that boot instantly, run with minimal privileges, and scale horizontally without localized environment conflicts.

## Scope
This specification includes:
- **Production NestJS Dockerfile**: Multi-stage build compilation and minimal runtime environments.
- **Production Next.js Dockerfile**: Multi-stage build utilizing standalone directory structures.
- **Development Docker Compose Map**: Full development stack orchestration.
- **Environment Variables**: Local mappings and configuration variables.

It excludes cloud-specific container task definitions (e.g., AWS ECS Task JSONs) and registry storage policies.

## Goals
- **Minimize Attack Surface**: Remove build-time tools (like gcc, git, npm cache, python) from the final production images.
- **Build Performance**: Leverage Docker build caching efficiently by ordering layers from least-frequently changed to most-frequently changed.
- **Fast Startup**: Keep final container image sizes under $150\text{ MB}$ to ensure rapid image pulling and scaling.
- **Developer Productivity**: Maintain sub-second hot reload reflection from local workspace modifications.

## Functional Requirements
- **Separate Build Environments**: Build steps must compile TypeScript into JavaScript before copying outputs to clean runner images.
- **Port Mapping standards**:
  - NestJS Monolith must listen on port `8080` (App traffic) and port `8081` (Admin metrics).
  - Next.js Frontend must listen on port `3000`.
- **Database Synchronization Hook**: Local Docker Compose must block the NestJS monolith from booting until PostgreSQL is healthy and accepting connections.
- **Volume Mounts**: Development configurations must mount host code folders to containers to enable live reload functionality.

## Non-Functional Requirements
- **Target Image Size**: NestJS production image size must be $< 100\text{ MB}$. Next.js production image size must be $< 125\text{ MB}$.
- **Container Startup Overhead**: Containers must start and reach a healthy state in $< 8$ seconds.
- **Storage Layer**: Output images must only use read-only root filesystems, reserving writable space only in designated `/tmp` directories.

## Business Rules
- **Non-Root Execution**: Every Docker container must run under the unprivileged `node` user (UID `1000`). Root execution (`UID 0`) is strictly forbidden in production.
- **Deterministic Versions**: Every image in `FROM` statements must specify a precise semantic tag (e.g., `node:20.11.0-alpine3.19`) rather than floating tags like `latest` or `20`.
- **Docker Cache Hydration**: Pipelines must use `--build-arg` cache tags to leverage build engines (such as BuildKit) for remote caching.

## Actors
- **Backend Developer**: Uses local compose configurations to run services and verify code changes.
- **Frontend Developer**: Modifies Next.js layouts, mapping API host parameters to the Docker local proxy.
- **SRE / Release Manager**: Audits production Dockerfiles to verify alignment with security baselines and container limits.

## User Stories
- **User Story 1**: As a Backend Developer, I want to edit a NestJS controller file and have the change compile and load in my running container automatically, so that my feedback loop is instantaneous.
- **User Story 2**: As an SRE, I want the production backend image to only contain production dependencies, so that we minimize memory usage and vulnerability risks.
- **User Story 3**: As a Frontend Developer, I want to build a standalone Next.js image that does not require installing devDependencies or running dev servers in production, to reduce cloud hosting overhead.

## Acceptance Criteria
- Running `docker build` on NestJS must result in an Alpine-based runtime image under $100\text{ MB}$ containing only the `/dist` output and `node_modules` generated from production dependencies.
- Modifying a file inside the `./apps/backend` directory must trigger the NestJS dev server inside Docker Compose, restarting and reflecting changes in $< 2$ seconds.
- The Next.js production image must start successfully with the command `node server.js` within a `/app` directory, without containing the raw source code or development configurations.

## Workflows
### Local Development Service Boot Workflow
1. **Command Execution**: Developer runs `docker compose -f docker-compose.dev.yml up -d`.
2. **Network Creation**: Compose configures the isolated bridge network `newsops-net`.
3. **Database Spin-up**: PostgreSQL and Redis containers boot. Healthcheck scripts poll Postgres.
4. **Proxy Initialization**: PgBouncer initializes, mapping its pool to the PostgreSQL container.
5. **App Initialization**: NestJS monolith container boots after PgBouncer matches the health check parameters. The container executes `npm run start:dev` with volume mount.
6. **Frontend Boot**: Next.js container boots, executes `npm run dev`, and mounts the frontend source directory.

```
+---------------+      +-------------+      +-------------------+
| Developer     | ---> | Postgres DB | ---> | PgBouncer Proxy   |
| (Compose Run) |      | & Redis     |      | (Wait for Health) |
+---------------+      +-------------+      +-------------------+
                                                      |
                                                      v
                       +-------------+      +-------------------+
                       | Next.js App | <--- | NestJS Monolith   |
                       | (Port 3000) |      | (Port 8080/8081)  |
                       +-------------+      +-------------------+
```

---

## API Design
The Docker containers contain built-in health check integrations.

### Dockerfile Health Endpoint
Every backend container uses a local curl command to monitor runtime states.
* **Command**: `curl -f http://localhost:8081/admin/health || exit 1`
* **Port**: `8081` (Admin management port)
* **Response Status**: `200 OK`
* **Response Schema**:
```json
{
  "status": "healthy",
  "uptimeSeconds": 1284,
  "checks": {
    "monolithic-bootstrap": "completed"
  }
}
```

---

## Database Design
Local Docker Compose maps database components onto isolated volumes to persist database files across restarts.

### Compose Service Mappings
- **Postgres Database Service (`newsops-db`)**:
  - Image: `postgres:16.1-alpine`
  - Volumes: `newsops-db-data:/var/lib/postgresql/data`
  - Port: `5432` (accessible inside network only)
- **PgBouncer Service (`newsops-pgbouncer`)**:
  - Image: `edoburu/pgbouncer:1.21.0`
  - Port: `6432` (mapped to host for developer tool access)
- **Redis Service (`newsops-redis`)**:
  - Image: `redis:7.2-alpine`
  - Volumes: `newsops-redis-data:/data`

---

## UI Design
Monitoring container states locally is managed via command line or the Docker Desktop dashboard:
- **Service Status Dashboard**: Shows runtime resource consumption indicators (CPU/Memory gauges) for backend, database, proxy, and redis services.
- **Log Stream Panel**: Consolidates stdout feeds, prefixing each entry with its service color key (e.g. `[backend-1]`, `[frontend-1]`).

---

## Permissions
- **Filesystem Permissions**: Inside the runtime image, all target folders must be recursively owned by the `node` user:
  ```bash
  mkdir -p /app && chown -R node:node /app
  ```
- **Execution Rights**: Root configurations are disabled. No container process has permission to issue administrative commands on the host machine.

---

## Security
- **Strict User Mapping**: The containers run under UID `1000` (`USER node`).
- **Read-Only Root Filesystems**: In production environments, containers run with the option `--read-only` enabled. Local cache directories and configuration folders are mapped to temporary memory shares (`tmpfs` or empty volumes):
  ```yaml
  tmpfs:
    - /tmp:mode=1777
  ```
- **No Secrets in Images**: Production builds strictly fetch secrets through environment integrations at execution time. No `.env` files are baked into container layers.

---

## Performance
- **Leveraging Cache Layers**: Dependency resolution commands (`npm ci`) run ahead of source copy commands. This ensures that layers are cached until `package.json` or `package-lock.json` files change.
- **Multi-Core Threading**: Next.js and NestJS are configured to respect container resource allocations. Node options are mapped to enforce memory limits:
  ```env
  NODE_OPTIONS="--max-old-space-size=2048"
  ```

---

## Monitoring
- **Prometheus Metric**: `container_cpu_usage_seconds_total` (Tracks CPU consumption per container).
- **Prometheus Metric**: `container_memory_working_set_bytes` (Tracks memory footprint).
- **Alert Trigger**: Trigger automated redeployment or scale-out if `container_memory_working_set_bytes` reaches $85\%$ of the container's hard limit for more than 3 minutes.

---

## Logging
Container runtimes output logs directly to stdout/stderr using structured formats.

* **Log Format**: `{"timestamp": "2026-06-27T17:15:30Z", "level": "INFO", "service": "nestjs-backend", "message": "Container initialized successfully under user UID 1000"}`
* **Compose Logging Configuration**:
  ```yaml
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
  ```

---

## Error Handling
The container engine handles typical runtime crashes through restart policies.

| Internal Error Code | HTTP Status / CLI Code | Customer-Facing / Operator Message |
|:---|:---|:---|
| `ERR_PORT_IN_USE` | Exit Code 128 | Port allocation conflicts on host machine. Stop other services running on target ports. |
| `ERR_DB_CONN_TIMEOUT` | Exit Code 1 | NestJS failed to establish connection to PgBouncer within 10 seconds. |
| `ERR_OOM_KILLED` | Exit Code 137 | Container exceeded allocated memory allocation. SRE must increase container limits in specs. |

---

## Edge Cases
- **Unhealthy Database Startup**: If PgBouncer or Postgres crashes during boot, the application container uses a shell retry loop checking connection availability before executing runtime scripts, rather than exiting and triggering crash loop alerts.
- **File Watch Limits (Host system)**: On systems with large monorepos, local file systems might exhaust file watches. Compose documentation provides commands to increase `fs.inotify.max_user_watches` on host configurations.

---

## Mermaid Diagrams
### Local Multi-Container Execution Interaction
```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Compose as Docker Compose
    participant DB as Postgres Container
    participant PGB as PgBouncer Container
    participant API as NestJS Container

    Dev->>Compose: docker compose up -d
    activate Compose
    Compose->>DB: Spin up DB (Port 5432)
    Compose->>PGB: Spin up PgBouncer (Port 6432)
    Compose->>API: Initialize NestJS Container (Port 8080)
    activate API
    note over API: Run entrypoint.sh wait-for-it loop
    API->>PGB: Ping PgBouncer pool
    PGB-->>API: Connection Refused (Postgres initializing)
    DB-->>PGB: DB Healthy
    API->>PGB: Ping PgBouncer pool
    PGB-->>API: Connection Accepted
    API->>API: Run db:migrate
    API->>API: Boot NestJS Monolith
    deactivate API
    Compose-->>Dev: Stack Ready
    deactivate Compose
```

---

## Production Dockerfiles & Compose Specs

### 1. NestJS Backend Production Dockerfile (`Dockerfile.backend`)
```dockerfile
# --- Stage 1: Build & Compile ---
FROM node:20.11.0-alpine3.19 AS builder
WORKDIR /usr/src/app

# Install dependencies required for native node module compilation
RUN apk add --no-cache python3 make g++

# Copy package configurations
COPY package*.json ./
RUN npm ci

# Copy codebase
COPY . .

# Compile TypeScript
RUN npm run build

# Remove development node_modules and install production dependencies only
RUN rm -rf node_modules && npm ci --only=production

# --- Stage 2: Runtime Runner ---
FROM node:20.11.0-alpine3.19 AS runner
WORKDIR /usr/src/app

# Ensure we run as non-root user
USER node

# Copy compiled files and production dependencies from builder stage
COPY --chown=node:node --from=builder /usr/src/app/package*.json ./
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

# Expose production traffic ports
EXPOSE 8080 8081

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "dist/main.js"]
```

### 2. Next.js Frontend Production Dockerfile (`Dockerfile.frontend`)
```dockerfile
# --- Stage 1: Dependencies ---
FROM node:20.11.0-alpine3.19 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Stage 2: Builder ---
FROM node:20.11.0-alpine3.19 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# --- Stage 3: Runner ---
FROM node:20.11.0-alpine3.19 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy essential assets for standalone server execution
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
```

### 3. Local Development Compose Specification (`docker-compose.dev.yml`)
```yaml
version: '3.8'

networks:
  newsops-net:
    driver: bridge

volumes:
  newsops-db-data:
    driver: local
  newsops-redis-data:
    driver: local

services:
  newsops-db:
    image: postgres:16.1-alpine
    container_name: newsops-db
    environment:
      POSTGRES_USER: newsops_admin
      POSTGRES_PASSWORD: admin_secret_password
      POSTGRES_DB: newsops_platform
    volumes:
      - newsops-db-data:/var/lib/postgresql/data
    networks:
      - newsops-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U newsops_admin -d newsops_platform"]
      interval: 5s
      timeout: 5s
      retries: 5

  newsops-pgbouncer:
    image: edoburu/pgbouncer:1.21.0
    container_name: newsops-pgbouncer
    ports:
      - "6432:6432"
    environment:
      - DB_USER=newsops_admin
      - DB_PASSWORD=admin_secret_password
      - DB_HOST=newsops-db
      - DB_PORT=5432
      - DB_NAME=newsops_platform
      - PORT=6432
      - POOL_MODE=transaction
      - MAX_CLIENT_CONN=500
      - DEFAULT_POOL_SIZE=20
    depends_on:
      newsops-db:
        condition: service_healthy
    networks:
      - newsops-net

  newsops-redis:
    image: redis:7.2-alpine
    container_name: newsops-redis
    ports:
      - "6379:6379"
    volumes:
      - newsops-redis-data:/data
    networks:
      - newsops-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  newsops-backend:
    image: node:20.11.0-alpine3.19
    container_name: newsops-backend
    working_dir: /usr/src/app
    ports:
      - "8080:8080"
      - "8081:8081"
      - "9229:9229" # Debug port
    volumes:
      - .:/usr/src/app
      - /usr/src/app/node_modules
    environment:
      - NODE_ENV=development
      - PORT=8080
      - DATABASE_URL=postgresql://newsops_admin:admin_secret_password@newsops-pgbouncer:6432/newsops_platform
      - REDIS_URL=redis://newsops-redis:6379/0
    command: npm run start:dev
    depends_on:
      newsops-pgbouncer:
        condition: service_started
      newsops-redis:
        condition: service_healthy
    networks:
      - newsops-net

  newsops-frontend:
    image: node:20.11.0-alpine3.19
    container_name: newsops-frontend
    working_dir: /app
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
    command: npm run dev
    depends_on:
      - newsops-backend
    networks:
      - newsops-net
```

---

## References
- Master DevOps Index: [./index.md](./index.md)
- System Architecture Design: [../02-architecture/system_architecture.md](../02-architecture/system_architecture.md)
- Multi-Tenancy Architecture: [../02-architecture/multi_tenancy_architecture.md](../02-architecture/multi_tenancy_architecture.md)
- CI/CD Deployment Pipeline Designs: [./ci_cd_pipelines.md](./ci_cd_pipelines.md)
- Kubernetes Manifest & Helm structures: [./kubernetes_deployment.md](./kubernetes_deployment.md)
