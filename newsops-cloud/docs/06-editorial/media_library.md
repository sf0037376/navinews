# Digital Asset Management (DAM)

## Purpose
This document establishes the architecture, metadata schemas, ingestion workflows, and transformation hooks for the Digital Asset Management (DAM) media library within the NewsOps Cloud digital publishing platform.

## Executive Summary
A modern newsroom depends on high-velocity ingestion and precise reuse of multimedia assets. The NewsOps Cloud DAM is an enterprise media library designed to store, enrich, organize, and transform digital assets. It features a virtual folder directory system, automated metadata extraction (supporting IPTC, XMP, EXIF, and AI-powered visual/audio transcription), strict metadata schemas, and real-time, non-destructive cropping and scaling hooks designed for responsive web, mobile apps, and social publishing targets.

## Vision
To build a highly performant, serverless-backed asset repository that acts as a single source of truth for all journalistic media, maximizing discoverability via automated intelligence while ensuring immediate delivery of optimized images and videos to end-users globally.

## Scope
The scope of this document includes:
*   Ingestion pipelines for images, video, and audio.
*   Automated metadata parser configurations (EXIF, IPTC, XMP).
*   AI tagging, OCR, and speech-to-text transcripts integrations.
*   Crop, focal-point, and scale hook specs.
*   Storage architecture mappings and directory structures.

## Goals
*   **Search Acceleration**: Enable instantaneous search across millions of assets using extracted IPTC data and AI tags.
*   **Asset Processing Speed**: Process uploaded images (extract metadata and generate thumbnails) in under 1 second.
*   **Bandwidth Optimization**: Deliver dynamic crop and scale operations at edge CDNs using query parameters to avoid storage inflation.

## Functional Requirements
*   **Virtual Folder Systems**: Users must be able to organize assets using directories, subdirectories, and search-driven virtual collections.
*   **Automated Tags & Transcription**: The system must extract image subjects (using computer vision) and transcribe uploaded audio/video files automatically into text components.
*   **Crop and Scale Coordinates**: The editor must record non-destructive cropping vectors (x, y, width, height, focal-point) for various device configurations (mobile, tablet, desktop, specific social network sizes).
*   **IPTC/XMP Data Mapping**: The platform must parse embedded media credentials (creator, copyright, caption, credit line) and populate corresponding DB fields on ingestion.

## Non-Functional Requirements
*   **Processing Throughput**: Support parallel ingestion of up to 200 high-resolution RAW images or video streams per minute.
*   **Storage Resilience**: Assets must be stored on distributed object store clusters (e.g. AWS S3 or MinIO) with 99.999999999% durability.
*   **Image Delivery Latency**: Transformed, scaled images requested via the CDN must be served in under 50ms from cache.

## Business Rules
*   **Copyright Compliance**: All assets must contain valid attribution before being attached to an article set for public release.
*   **Original File Preservation**: The original master file must never be overwritten, modified, or compressed directly; all transformations must occur on copies or via on-the-fly request parameters.
*   **Restricted Resource Access**: Sensitive assets (e.g. source identity documents) must be flagged as "Internal Restricted" and blocked from CDN access.

## Actors
*   **Photojournalist**: Uploads raw image assets from the field with embedded metadata.
*   **Graphic Designer**: Edits aspect ratios, sets focal points, and structures design assets.
*   **Journalist**: Searches the library for relevant footage or imagery to insert into articles.
*   **Media Pipeline Service**: Processes raw objects, extracts markers, and indexes results.

## User Stories
1.  As a photojournalist, I want my camera's embedded IPTC keywords and copyright fields to import automatically during upload so that I do not spend time re-entering metadata in the CMS.
2.  As a content creator, I want to define a custom crop zone for mobile devices on an image so that key visual details aren't cut off by automatic responsive centering.
3.  As an editor, I want video uploads to run background transcription automatically so that I can search for spoken phrases and generate closed-caption SRT files.

## Acceptance Criteria
*   **Extraction Accuracy**: 100% of uploaded JPEG/WebP files containing valid IPTC headers must correctly parse those fields into the database search indexes.
*   **Dynamic Resizing Bounds**: Dynamic cropping endpoints must reject invalid dimensions (e.g., negative coordinates, aspect ratios exceeding 10:1) with a `400 Bad Request` status.
*   **Transcription Coverage**: Audio files up to 10 minutes long must complete transcription in under 60 seconds.

## Workflows
1.  **Asset Ingestion and AI Enrichment Workflow**:
    *   User uploads media file (e.g., JPEG image) to S3 via presigned URL.
    *   S3 triggers an `ObjectCreated` event, prompting the Ingestion Service to start processing.
    *   Ingestion Service runs the metadata extractor parser to pull EXIF, IPTC, and XMP payloads.
    *   Ingestion Service invokes the Computer Vision API to detect objects, generate labels, and identify safety metrics.
    *   System saves parsed values to the `media_assets` database table and indexes the data in Elasticsearch.
2.  **Crop and Scale Hook Workflow**:
    *   Designer opens asset manager, selects an image, and selects the Tiptap layout preview.
    *   Designer draws a crop box, defining crop offsets `x=10, y=20, w=400, h=300` and sets a focal point at `x=210, y=170`.
    *   Client posts coordinates to `/api/v1/editorial/media/{id}/crops`.
    *   When the article is rendered on a client device, the client requests the image from the CDN using parameters: `https://cdn.newsops.cloud/media/image.jpg?w=400&h=300&crop=10,20,400,300&fp=210,170`.

## API Design

### Create Presigned Upload URL
```http
POST /api/v1/editorial/media/presign HTTP/1.1
Host: cms.newsops.cloud
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "filename": "breaking_news_photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 4820194,
  "folder_path": "/2026/june/politics"
}
```
**Response:**
```json
{
  "asset_id": "media_abc123789",
  "upload_url": "https://s3.us-east-1.amazonaws.com/newsops-assets/raw/2026/june/politics/breaking_news_photo.jpg?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D&Expires=1700000000",
  "mime_type": "image/jpeg"
}
```

### Save Crop Transformations
```http
POST /api/v1/editorial/media/media_abc123789/crops HTTP/1.1
Host: cms.newsops.cloud
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "crops": [
    {
      "target_channel": "mobile_portrait",
      "aspect_ratio": "9:16",
      "x": 120,
      "y": 50,
      "width": 1080,
      "height": 1920,
      "focal_point": {
        "x": 660,
        "y": 1010
      }
    },
    {
      "target_channel": "desktop_hero",
      "aspect_ratio": "16:9",
      "x": 0,
      "y": 120,
      "width": 1920,
      "height": 1080,
      "focal_point": {
        "x": 960,
        "y": 660
      }
    }
  ]
}
```
**Response:**
```json
{
  "asset_id": "media_abc123789",
  "configured_crops": [
    "mobile_portrait",
    "desktop_hero"
  ],
  "updated_at": "2026-06-27T22:34:00Z"
}
```

### Fetch Asset Details (Including parsed metadata)
```http
GET /api/v1/editorial/media/media_abc123789 HTTP/1.1
Host: cms.newsops.cloud
Authorization: Bearer <JWT_TOKEN>
```
**Response:**
```json
{
  "asset_id": "media_abc123789",
  "filename": "breaking_news_photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 4820194,
  "storage_path": "/raw/2026/june/politics/breaking_news_photo.jpg",
  "metadata": {
    "dimensions": {
      "width": 3840,
      "height": 2160
    },
    "iptc": {
      "byline": "John Doe",
      "copyright": "NewsOps Publishing 2026",
      "credit_line": "NewsOps Editorial",
      "caption": "Protesters gather at the municipal hall steps.",
      "keywords": ["protest", "politics", "city hall"]
    },
    "ai_tags": [
      { "label": "crowd", "confidence": 0.98 },
      { "label": "demonstration", "confidence": 0.95 },
      { "label": "building", "confidence": 0.88 }
    ]
  }
}
```

## Database Design

### PostgreSQL: Media Assets Directory Schema
```sql
CREATE TABLE IF NOT EXISTS media_folders (
    folder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    parent_folder_id UUID REFERENCES media_folders(folder_id) ON DELETE CASCADE,
    folder_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_folders_hierarchy ON media_folders (tenant_id, parent_folder_id);

CREATE TABLE IF NOT EXISTS media_assets (
    asset_id VARCHAR(64) PRIMARY KEY,
    tenant_id UUID NOT NULL,
    folder_id UUID REFERENCES media_folders(folder_id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    iptc_metadata JSONB DEFAULT '{}'::jsonb,
    exif_metadata JSONB DEFAULT '{}'::jsonb,
    ai_annotations JSONB DEFAULT '{}'::jsonb,
    transcription TEXT,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_assets_tags ON media_assets USING gin (iptc_metadata);
CREATE INDEX idx_media_assets_search ON media_assets USING gin (ai_annotations);
```

### PostgreSQL: Crop Configs Table
```sql
CREATE TABLE IF NOT EXISTS asset_crops (
    crop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id VARCHAR(64) NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
    target_channel VARCHAR(64) NOT NULL,
    aspect_ratio VARCHAR(16) NOT NULL,
    crop_x INT NOT NULL,
    crop_y INT NOT NULL,
    crop_w INT NOT NULL,
    crop_h INT NOT NULL,
    focal_x INT NOT NULL,
    focal_y INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (asset_id, target_channel)
);

CREATE INDEX idx_asset_crops_link ON asset_crops (asset_id);
```

## UI Design
The Digital Asset Management UI comprises:
*   **Media Browser**: Sidebar directory navigation showing folder structures and a grid view of thumbnails. It features multi-select operations for tags, moving folders, and deleting files.
*   **Metadata Editor Inspector**: Slide-out detail drawer displaying parsed EXIF details, IPTC fields (editable with validation warnings), AI labels, and transcription text (with timestamp linkages for video files).
*   **Focal/Crop Editor Window**: Interlocking crop tool. Users choose preset outputs (e.g. Facebook feed, Web banner, Mobile screen) and drag boundaries overlaying the image, placing a red target reticle to specify the focal center.

## Permissions
*   `media:assets:read`: View assets, search directories, and copy links.
*   `media:assets:write`: Upload media, edit tags, and save crops.
*   `media:assets:delete`: Move items to the system bin or permanently delete files.
*   `media:folders:manage`: Create, rename, or destroy directory pathways.

## Security
*   **Presigned Expiration validation**: Upload URL signatures must expire within 15 minutes of generation.
*   **Content-Type Enforcement**: The ingest worker must run file magic-number verification to block executable payload execution masquerading as media (e.g. PHP script disguised as JPEG).
*   **Secure Object Isolation**: Tenant storage keys must be prefixed with `{tenant_id}/` in the S3 bucket configuration, enforced via dynamic IAM bucket policies.

## Performance
*   **Ingest Processing Latency**: EXIF extraction must complete under 100ms.
*   **API Response Bounds**: Paginated search results must execute in under 35ms.
*   **Edge Scaling Performance**: Dynamic image adjustments at the CDN must execute on first-request cache miss in under 200ms, and under 5ms on cache hit.

## Monitoring
*   `newsops_dam_upload_bytes_total`: Counter tracking volume of inbound media assets.
*   `newsops_dam_processing_duration_seconds`: Histogram tracking asset pipeline enrichment time.
*   `newsops_dam_ai_pipeline_failures`: Counter tracking downstream computer vision/transcription API failures.

## Logging
```json
{
  "timestamp": "2026-06-27T22:35:10Z",
  "level": "INFO",
  "logger": "com.newsops.dam.enrichment.MetadataExtractor",
  "message": "Metadata extraction completed successfully",
  "context": {
    "asset_id": "media_abc123789",
    "parsed_exif_fields": 14,
    "parsed_iptc_fields": 6
  }
}
```

## Error Handling
| Error Code | HTTP Status | Customer-Facing Message |
| :--- | :--- | :--- |
| `ERR_MEDIA_TOO_LARGE` | 413 Payload Too Large | File size exceeds the maximum upload limit of 100MB for image assets. |
| `ERR_UNSUPPORTED_MIME` | 415 Unsupported Media Type | The uploaded file type is not supported by our conversion library. |
| `ERR_INVALID_CROP_BOUNDS` | 400 Bad Request | The crop offset coordinates lie outside the dimensions of the source image. |

## Edge Cases
*   **Orphaned Assets**: If a user uploads an asset but immediately closes the tab before metadata indexing is written: a nightly cron sweeper queries DB records lacking corresponding `media_assets` fields and cleans up unreferenced S3 raw objects older than 24 hours.
*   **Corrupted EXIF Headers**: If metadata blocks are malformed, the parser logs a warning, skips the metadata block, and proceeds with the upload rather than crashing the ingestion pipeline.

## Future Improvements
*   **AI Auto-Cropping**: Utilize semantic saliency models to automatically recommend crop rectangles and focus markers around main subjects.
*   **Vector Search Database**: Implement pgvector indexing over AI annotations to support natural language visual queries (e.g., "Find photos of politicians standing near flags").

## Mermaid Diagrams
```mermaid
sequenceDiagram
    autonumber
    actor Photographer
    participant CMS as CMS Portal
    participant S3 as AWS S3 Storage
    participant Worker as Media Ingest Worker
    participant DB as PostgreSQL DB
    participant AI as Cognitive Vision API

    Photographer->>CMS: Upload breaking_news.jpg request
    CMS->>DB: Initialize media_assets entry (Pending status)
    CMS-->>Photographer: Send S3 Presigned Upload URL
    Photographer->>S3: PUT raw file with authentication
    S3-->>Worker: Trigger ObjectCreated event hook
    
    activate Worker
    Worker->>S3: Download metadata headers
    Worker->>Worker: Parse EXIF/IPTC/XMP blocks
    Worker->>AI: Send image for classification & safety check
    AI-->>Worker: Return labels ("protest", "crowd") & Safe status
    Worker->>DB: UPDATE media_assets (Set metadata, AI tags, and active status)
    deactivate Worker
    
    Worker-->>CMS: Send completion confirmation
    CMS-->>Photographer: Asset ready in Media Library explorer
```

## References
*   [Editorial Directory Overview](index.md)
*   [Database Unified ERD](../03-database/unified_erd.md)
*   [Storage Architecture Specs](../02-architecture/storage_architecture.md)
