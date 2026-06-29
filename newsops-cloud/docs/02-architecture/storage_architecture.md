# Storage Architecture
## Purpose
This document defines the storage architecture for media assets and files within the NewsOps Cloud digital publishing platform. It outlines the structure of object storage, security isolation in a multi-tenant environment, the lifecycle of signed URLs, and the design of the asynchronous image optimization and thumbnail processing pipelines.

## Executive Summary
NewsOps Cloud uses an S3-compatible object storage architecture (hosted on AWS S3 or Supabase Storage) integrated with Cloudflare CDN for global delivery. Files are organized hierarchically by tenant, organization, and project. Uploads bypass application servers, going directly to storage using secure pre-signed URLs. The moment an asset is uploaded, an event-driven serverless pipeline triggers to compress, resize, and convert images into optimized formats (WebP/AVIF). Access control is enforced using distinct public and private buckets, bucket-level IAM policies, and cryptographic signed URLs for restricted media.

## Vision
The storage engine aims for zero application server storage overhead and sub-second asset rendering globally. By offloading files to object storage and running automated processing in the background, the system achieves massive file ingestion rates with high availability and complete multi-tenant tenant isolation, preserving bandwidth and reducing storage costs.

## Scope
The scope of this storage architecture covers:
1. **Object Storage Topology**: Multi-bucket strategy, replication, and lifecycle configurations.
2. **Directory Partitioning**: Tenant-level logical separation rules.
3. **Upload Ingestion Pattern**: Direct-to-bucket S3 uploads via pre-signed URLs.
4. **Processing Pipeline**: Serverless thumbnail creation, image optimization, and metadata extraction.
5. **Security & Access Control**: Public vs. Private assets, signed URL lifespans, and CORS rules.
6. **Database Syncing**: Maintaining asset registries and variants mappings.

## Goals
- **Eliminate Server Overhead**: Avoid local file storage on application servers, relying entirely on object storage.
- **Optimize Assets Globally**: Reduce media bandwidth consumption by converting 100% of eligible uploaded images to next-generation formats (AVIF/WebP).
- **Enforce Strict Tenant Separation**: Ensure that Tenant B cannot access Tenant A's private storage assets under any circumstances.
- **Asynchronous Processing Time**: Process and generate all standard thumbnails and responsive variants in <= 3 seconds from ingestion.

## Functional Requirements
- **Hierarchical Path Allocation**: Automatically generate paths using the format: `tenant-id/organization-id/project-id/year/month/file-uuid.ext`.
- **Pre-signed Upload Link Generation**: Provide REST endpoints that return short-lived upload URLs allowing clients to upload assets directly to S3.
- **Automated Compression Pipeline**: Compress images to 80% quality, strip EXIF metadata (except copyright/attribution if configured), and generate multiple responsive sizes (small, medium, large, raw).
- **Private Asset Security**: Allow sensitive uploads (e.g., source documents, drafts) to be designated as "Private", requiring a signed URL to read.
- **Soft Deletion**: Flag deleted assets in the database and move them to a `.trash/` folder in object storage before permanent deletion.

## Non-Functional Requirements
- **High Durability**: Rely on object storage offering 99.999999999% durability (AWS S3 standard tier).
- **CDN Edge Availability**: Ensure public assets have 99.99% availability via Cloudflare caching.
- **Low Latency Processing**: The background workers must scale dynamically to handle upload spikes (up to 5,000 files/hour) without queuing delays.
- **CORS Constraints**: Restrict direct S3 bucket uploads to authorized tenant domain names and the NewsOps Cloud admin console.

## Business Rules
- **Size Limits**: Prevent uploads exceeding 10MB for images, 50MB for documents (PDF/DOCX), and 250MB for raw video uploads.
- **Retention of Trash**: Soft-deleted files in the `.trash/` folder must be permanently deleted by an S3 Lifecycle Rule after exactly 30 days.
- **Watermark Application**: If enabled in tenant settings, the optimization pipeline must automatically overlay a PNG watermark on the "large" and "raw" variants.
- **Attribution Enforcement**: Media files must retain author attribution and alt text metadata within the application database to enforce compliance guidelines.

## Actors
- **Content Creator**: Uploads photos, graphics, and articles attachments.
- **Public Reader**: Retrieves optimized web images when viewing published articles.
- **Subscriber**: Retrieves high-quality images and private attachments (e.g., PDFs).
- **Asynchronous Image Processor**: Serverless Lambda function or Celery worker that processes the raw upload.
- **Tenant Administrator**: Configures storage limits, default formats, and watermark templates.

## User Stories
- **Story 1 - Upload Performance**: As a Content Creator, I want to drag and drop a 15MB raw JPEG into the editor and have the system upload it directly to S3, so that I don't tie up application server threads and can continue writing.
- **Story 2 - Page Speed Optimization**: As a Public Reader browsing on a mobile network, I want to receive the AVIF image formatted to 400px wide rather than the raw 4000px image, so that my mobile page loads quickly and saves cellular data.
- **Story 3 - Secure Attachments**: As a Tenant Administrator, I want to upload a restricted PDF report for premium subscribers and ensure it cannot be accessed via direct public links or indexed by search engines.

## Acceptance Criteria
- **AC-1 (Pre-signed Expire)**: Pre-signed upload links must expire within exactly 15 minutes of generation and support only the specific HTTP PUT verb and Content-Type.
- **AC-2 (Pipeline Time)**: From the instant S3 sends the `s3:ObjectCreated` event, the processing pipeline must complete image conversion and write database entries for variants in <= 3.0 seconds (for files <= 10MB).
- **AC-3 (Isolation Enforcement)**: Direct attempts to access `/tenant-a/` objects using a session token from `/tenant-b/` must be blocked by bucket-level access control, returning an HTTP 403 response.
- **AC-4 (File Compression)**: The optimization pipeline must output AVIF/WebP variants that are at least 50% smaller in file size than the original uploaded image while maintaining visual fidelity (SSIM index >= 0.95).

## Workflows
### Step-by-Step Media Upload and Processing Workflow
1. **Client Requests Upload**: The Content Creator clicks "Upload Image" in the UI.
2. **Retrieve Signed URL**:
   - Client sends `POST /api/v1/media/upload-url` with filename, file size, and MIME type.
   - The application checks tenant storage quotas and validates the MIME type.
   - The application calls the S3 client to generate a pre-signed `PUT` URL for path: `public/tenant-1/org-1/2026/06/f37ba304-4df1.jpg`.
   - The API returns the signed URL and the final destination path to the client.
3. **Client Uploads Directly to S3**:
   - The browser performs a direct `PUT` request to the S3 pre-signed URL with the file binary.
   - S3 validates the request signature, content length, and processes the upload.
4. **Trigger Processing Pipeline**:
   - Upon upload completion, S3 emits an `ObjectCreated:Put` event.
   - The event triggers an AWS Lambda function (`newsops-image-processor`).
5. **Optimize and Resize**:
   - The Lambda function downloads the original raw image from the target path.
   - It reads the image metadata (width, height, EXIF).
   - It generates three optimized variants:
     - *Large (WebP)*: 1200px max width, 80% quality.
     - *Medium (WebP)*: 800px max width, 80% quality.
     - *Thumbnail (AVIF)*: 200px width, 75% quality.
   - The Lambda writes the variants to the optimized S3 bucket.
6. **Update Database Registry**:
   - The Lambda function calls the Editorial API `POST /api/v1/media/register` with the dimensions, variant paths, file size, and EXIF tags.
   - The application writes the records to `media_assets` and `media_variants` tables.
7. **Client Notification**:
   - The application pushes a WebSocket notification to the Content Creator's browser signifying that processing is complete.
   - The UI replaces the local loading placeholder with the live optimized thumbnail.

```mermaid
sequenceDiagram
    autonumber
    actor Client as Editor Browser
    participant API as Editorial API
    participant S3 as AWS S3 Storage
    participant Lambda as Image Processor (Lambda)
    participant DB as PostgreSQL DB

    Client->>API: POST /api/v1/media/upload-url (MIME, size)
    API->>API: Validate quota & MIME type
    API->>S3: Generate pre-signed PUT URL
    S3-->>API: Pre-signed URL (15m expiration)
    API-->>Client: 200 OK with Pre-signed URL
    
    Client->>S3: HTTP PUT raw image (Direct Upload)
    S3-->>Client: 200 OK (Upload Complete)
    
    S3->>Lambda: ObjectCreated Event Notification
    activate Lambda
    Lambda->>S3: GET raw uploaded image
    S3-->>Lambda: Raw image binary
    Lambda->>Lambda: Optimize quality, strip EXIF, resize
    Lambda->>S3: PUT variants (WebP Large, Medium, AVIF Thumbnail)
    Lambda->>API: POST /api/v1/media/register (metadata, paths)
    API->>DB: INSERT into media_assets & media_variants
    DB-->>API: Row IDs
    API-->>Lambda: Success Ack
    deactivate Lambda
    API-->>Client: WebSocket Notification: Asset Ready
```

## API Design
### 1. Request Pre-Signed Upload URL
- **Endpoint**: `POST /api/v1/media/upload-url`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <jwt_token>`
  - `X-Tenant-ID: tenant-1`
- **Request Payload**:
  ```json
  {
    "filename": "breaking-news.jpg",
    "mime_type": "image/jpeg",
    "size_bytes": 4829310,
    "folder": "articles",
    "is_private": false
  }
  ```
- **Response Payload (Success)**:
  ```json
  {
    "status": "success",
    "asset_id": "8c7f99d9-69b5-4422-95ab-f32bf5273d42",
    "upload_url": "https://newsops-media-bucket.s3.amazonaws.com/raw/tenant-1/org-1/2026/06/8c7f99d9.jpg?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D&Expires=1782575200",
    "destination_path": "raw/tenant-1/org-1/2026/06/8c7f99d9.jpg",
    "expires_at": "2026-06-27T22:30:00Z"
  }
  ```

### 2. Register Processed Media Asset
- **Endpoint**: `POST /api/v1/media/register`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <internal_system_token>`
- **Request Payload**:
  ```json
  {
    "asset_id": "8c7f99d9-69b5-4422-95ab-f32bf5273d42",
    "tenant_id": "tenant-1",
    "filename": "breaking-news.jpg",
    "original_size_bytes": 4829310,
    "mime_type": "image/jpeg",
    "width": 4000,
    "height": 3000,
    "is_private": false,
    "variants": [
      {
        "resolution": "large",
        "format": "webp",
        "width": 1200,
        "height": 900,
        "size_bytes": 182490,
        "path": "optimized/tenant-1/org-1/2026/06/8c7f99d9_large.webp"
      },
      {
        "resolution": "thumbnail",
        "format": "avif",
        "width": 200,
        "height": 150,
        "size_bytes": 12450,
        "path": "optimized/tenant-1/org-1/2026/06/8c7f99d9_thumb.avif"
      }
    ]
  }
  ```
- **Response Payload (Success)**:
  ```json
  {
    "status": "success",
    "message": "Asset and variants successfully logged in registry"
  }
  ```

## Database Design
To represent media structures and associate them with articles and pages, the database defines these two main entities:

```sql
-- Core Media Assets Registry
CREATE TABLE public.media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL,
    organization_id VARCHAR(50) NOT NULL,
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    original_size_bytes BIGINT NOT NULL,
    width INT,
    height INT,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    raw_storage_path VARCHAR(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for searching assets within an organization
CREATE INDEX idx_media_assets_org ON public.media_assets(tenant_id, organization_id);
CREATE INDEX idx_media_assets_created ON public.media_assets(created_at DESC);

-- Media Variants (For processed sizes and formats)
CREATE TABLE public.media_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
    resolution_label VARCHAR(50) NOT NULL, -- 'large', 'medium', 'thumbnail', 'raw'
    file_format VARCHAR(10) NOT NULL,      -- 'webp', 'avif', 'jpg'
    width INT NOT NULL,
    height INT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index to quickly query all variants of a specific asset
CREATE INDEX idx_media_variants_asset ON public.media_variants(asset_id);
CREATE UNIQUE INDEX idx_media_variants_unique ON public.media_variants(asset_id, resolution_label, file_format);
```

## UI Design
The **Media Library Gallery** component is built as a responsive grid in the editorial client interface.
1. **Component Layout**:
   - **Upload Zone**: A drag-and-drop dashboard container at the top of the interface. Highlighting changes to dashed blue borders when dragging files over it.
   - **Filter & Search Bar**: Search input with filters for "MIME type" (Images, Videos, PDFs), "Upload Date Range", and "Access" (Public/Private).
   - **Grid Catalog**: Items displaying card thumbnails:
     - Cards show image preview, title, size, and optimization status badge.
     - Optimization status displays "Processing..." (spinner icon) or "Optimized" (green checkmark).
   - **Detail Sidebar**: Appears when a grid item is clicked, rendering:
     - Asset resolution (e.g. 4000x3000).
     - Compressed size reduction percentage (e.g. *"Saved 92% of original space"*).
     - Copy optimized URL button.
     - Alt text input and Caption text fields.

2. **Actions**:
   - Dragging a file starts immediate generation of signed URL, uploads to S3, and starts local progress indicator (0 to 100%).
   - Clicking "Make Private" flips the access control flag and switches direct links to pre-signed temporary links in the clipboard copy function.

3. **States**:
   - **Empty State**: Displays an folder icon: *"No media found. Upload your first asset to get started."*
   - **Uploading State**: Shows uploading bar with progress percentage per file.
   - **Error State**: Renders a red error alert under the upload zone if a file exceeds the size bounds or violates content validation.

## Permissions
- `media:read`: Retrieve list of public assets and access basic thumbnails.
- `media:read_private`: Generate read-signed URLs for restricted tenant files.
- `media:upload`: Request upload URLs and execute binary transfers to the bucket.
- `media:edit`: Modify alt text, title, and metadata of logged assets.
- `media:delete`: Initiate soft deletions and trigger purge actions.

## Security
- **MIME Sniffing Prevention**: S3 configuration must serve files with `X-Content-Type-Options: nosniff`.
- **Signed URL Expiration**: Private documents must be served with signed URLs containing signature parameters configured with a maximum lifetime of 3600 seconds (1 hour).
- **Upload Restrictions**: Pre-signed PUT links restrict parameters to `Content-Length` bounds and require explicit hashes of content to match the request header before S3 accepts the binary.
- **Bucket Isolation**: S3 Bucket policies enforce permissions so that IAM credentials generated for Tenant A cannot perform `GetObject`, `PutObject`, or `ListBucket` operations on the namespace folders of Tenant B.

## Performance
- **Target Latencies**:
  - Pre-signed URL retrieval: <= 80ms.
  - S3 direct upload: Dependant on user bandwidth; server-side ingestion target latency of <= 200ms.
  - Image transformation execution time: <= 1.5 seconds.
- **Caching**: CDN edge caches optimized images (`optimized/` path) indefinitely (`max-age=31536000`), purging only if the parent asset is explicitly updated or deleted.
- **Target Throughput (TPS)**: 50 concurrent file uploads per second, 1,000 read operations per second.

## Monitoring
Prometheus storage and pipeline metrics:
- `newsops_media_uploads_bytes`: Histogram monitoring incoming file sizes.
- `newsops_media_processing_time_seconds`: Duration metrics for the Lambda processor function.
- `newsops_media_processing_failures_total{failure_reason}`: Counter of failed conversions (e.g. invalid format, out of memory).
- `newsops_tenant_storage_used_bytes{tenant_id}`: Tracking overall consumption relative to organization plans.

*Alert Trigger Rules*:
- **Trigger**: `newsops_media_processing_failures_total > 5` in 1 minute.
  - *Action*: Alert critical: Media pipeline is failing to process uploads.
- **Trigger**: `newsops_tenant_storage_used_bytes / newsops_tenant_storage_limit_bytes > 0.90`
  - *Action*: Alert warning: Tenant is reaching 90% of their storage quota.

## Logging
Structured JSON system logs:
- **Info Level Log (Ingestion)**:
  ```json
  {"timestamp":"2026-06-27T22:31:05Z","level":"info","logger":"media_api","message":"Pre-signed upload URL generated","tenant_id":"tenant-1","asset_id":"8c7f99d9-69b5-4422-95ab-f32bf5273d42","path":"raw/tenant-1/org-1/2026/06/8c7f99d9.jpg"}
  ```
- **Info Level Log (Optimization Completed)**:
  ```json
  {"timestamp":"2026-06-27T22:31:08Z","level":"info","logger":"lambda_processor","message":"Image variants processed successfully","asset_id":"8c7f99d9-69b5-4422-95ab-f32bf5273d42","original_bytes":4829310,"optimized_bytes":194940,"saved_percentage":95.9}
  ```
- **Error Level Log (Processing Exception)**:
  ```json
  {"timestamp":"2026-06-27T22:31:09Z","level":"error","logger":"lambda_processor","message":"Failed to resize corrupt file payload","asset_id":"8c7f99d9-69b5-4422-95ab-f32bf5273d42","error":"PIL.UnidentifiedImageError: cannot identify image file"}
  ```

## Error Handling
| Internal Error Code | Triggering Scenario | HTTP Status | Customer-Facing Message |
|:---|:---|:---|:---|
| `STORAGE_QUOTA_EXCEEDED` | Tenant has used up all allocated subscription storage | 400 Bad Request | "Upload blocked. Your organization has exceeded its storage quota. Please upgrade your plan." |
| `INVALID_FILE_TYPE` | User uploads file extensions that are blocked (e.g. `.exe`, `.bat`) | 400 Bad Request | "Unsupported file format. Please upload JPEG, PNG, WEBP, AVIF, PDF, or MP4 files." |
| `UPLOAD_EXPIRED` | Upload to pre-signed URL started after 15-minute validity window | 403 Forbidden | "The upload link has expired. Please initiate the file upload process again." |
| `ASSET_NOT_FOUND` | Requesting private download link for non-existent asset | 404 Not Found | "The requested media file could not be found or has been deleted." |

## Edge Cases
- **Database Insertion Failure After Object Upload**: If S3 contains the raw binary but database logging fails, we create an orphaned asset. *Mitigation*: Run a weekly background sweeper worker that lists raw objects in S3, checks if their UUID exists in the `media_assets` table, and purges orphaned objects older than 7 days.
- **Corrupt File Upload**: A user uploads a file with a fake extension but garbage contents. *Mitigation*: The Lambda image optimizer checks MIME signatures and validates structural integrity using the PIL library. If corrupt, it immediately logs a processing failure, moves the raw file to a quarantine folder, and sets the asset status in the DB to `CORRUPT`.
- **Concurrency in Asset Modification**: Multiple editors edit the caption of the same media asset at once. *Mitigation*: Implement standard optimistic locking in PostgreSQL using an `updated_at` column mismatch check.

## Future Improvements
- **Video Transcoding Engine**: Introduce a serverless video transcoding pipeline using AWS Elemental MediaConvert to generate HLS streaming manifests (`.m3u8`) and multi-bitrate profiles for video content.
- **AI-Driven Vector Search**: Run an asynchronous CLIP model on uploaded images to generate embeddings, storing them in PgVector to allow editors to search media using natural language descriptions (e.g., "crowded newsroom at night").

## Mermaid Diagrams
(See the sequence diagram in the **Workflows** section above for details on the interaction pattern.)

## References
- [Caching Strategy and CDN Config](../02-architecture/caching_strategy.md)
- [Database Relational Schemas](../03-database/schemas.md)
- [SaaS Organizations and Billing Engines](../08-saas/index.md)
