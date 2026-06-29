# Source Attribution UI

## Purpose
The Source Attribution UI establishes system interfaces and metadata standards for tracking, validating, and displaying the origin of all elements within published articles. It defines components for inline citation layouts, standard bibliography formatting (APA, MLA, AP), AI generation metadata tracing (model type, prompts, system logs), and domain trust indicator levels to maintain reader trust and editorial transparent integrity.

## Executive Summary
Modern news consumers demand transparency. This specification outlines the architecture for the Source Attribution UI. We detail the API endpoints for citation registration, database models representing sources and domain trust values, user interface mockups for editors and readers, security requirements, logging parameters, and the integration of automated trust scores.

## Vision
To provide a unified metadata system where every claim, quote, statistical figure, or AI-generated segment in an article is backed by verifiable source tracking, visible to editors in the CMS and to readers on the final digital layout.

## Scope
The scope of this design document includes:
- Inline citation layout components and sidebar widgets in the editor.
- Automated bibliography formatting engines.
- AI Generation Attribution schema (model type, version, prompt hash, temperature parameter).
- Domain Trust Score validation algorithms.
- API payloads for CRUD operations on article sources.
- Database schemas for attributions and trust indexes.

This document excludes:
- The backend crawler system that indexes and flags fake news domains globally (handled by the News Intelligence system).
- The end-to-end rendering of the customer-facing frontend websites (only the reusable component layouts are defined).

## Goals
- Hydrate citation popups under 30ms for standard mobile web requests.
- Automate citation format generation for at least 5 standard styles (AP, APA, MLA, Harvard, Chicago).
- Log 100% of all AI-generated content blocks with detailed model parameters to ensure regulatory compliance.

## Functional Requirements
- **Inline Reference Markers**: Render clickable superscript tags (e.g. `[1]`) that open a visual popover detailing the source author, publisher, and publication date.
- **Citation Style Generator**: A widget allowing writers to input a URL or DOI and automatically generate standard academic and journalistic citation lines.
- **AI Origin Metadata**: If a paragraph is generated or adjusted by an AI copilot, the system must bind metadata (e.g. `model_name = "gpt-4o"`, `prompt_hash = "sha256:..."`) and display an "AI-Assisted" icon in both the editor workspace and the public reader view.
- **Source Trust Index**: Calculate and show a color-coded "Trust Score Indicator" (0-100) alongside external references, derived from domain rankings, fact-checking histories, and TLS validation flags.
- **Verification Logs**: Enable sub-editors to sign off on specific sources as "Fact-Checked & Verified".

## Non-Functional Requirements
- **Accessibility**: Attribution interfaces must comply with WCAG 2.1 AA requirements, providing ARIA tags for screen readers.
- **Performance**: High concurrency support for public-facing article reading pages with optimized CDN caching of attribution JSON files.
- **Resilience**: The citation engine must fallback to basic text output if citation parsing services (such as Crossref or DOI resolver) fail.

## Business Rules
- **Rule 1 (AI Labeling)**: Under regional transparency directives (e.g., EU AI Act compliance), any text segment containing more than 20% AI-generated tokens must display the public AI attribution tag.
- **Rule 2 (Low Trust Alert)**: If an editor adds a citation linking to a domain with a Trust Score under 35, the CMS must raise an active warning flag requiring Editorial sign-off before publishing.
- **Rule 3 (Immutable History)**: Attributions mapped to published articles cannot be deleted; they must be versioned to retain historical proof of content origins.

## Actors
- **Reporter**: Embeds inline citations and reviews domain trust levels in their drafts.
- **Editor**: Verifies sources, clears low-trust warnings, and monitors AI assistance percentages.
- **Reader**: Clicks superscript citations on the public website to view origin records and verification logs.

## User Stories (At least 3 specific stories)
1. **Adding an External Reference**: As a Reporter, I want to paste a URL into the CMS citation tool and have it automatically generate an inline citation tag and a bibliography entry, saving me manual citation time.
2. **Identifying AI-Assisted Text**: As an Editor, I want to see which paragraphs of an incoming draft were written or modified by our AI tools, along with the prompts used, so that I can ensure the content is factual and aligns with our standards.
3. **Evaluating Source Credibility**: As an Editor, I want the system to alert me if a reporter links to a site that has a history of publishing false information, so that we do not propagate misinformation.

## Acceptance Criteria (At least 3-5 criteria with clear thresholds)
- **Criteria 1 (AI Token Threshold)**: The editor UI must trigger the "AI-Assisted" badge when the AI helper writes 30 or more consecutive words inside a block.
- **Criteria 2 (Low Trust Blocker)**: The publish action must block if a citation domain trust score is below 30 and no editor override validation is recorded.
- **Criteria 3 (Accessibility Compliance)**: Inline popover elements must sustain keyboard focus navigation loops and support standard screen reader reading paths.

## Workflows
1. **Source Insertion**: The Reporter highlights a text block and clicks the "Add Citation" icon.
2. **Source Selection**: The editor opens a modal:
   - *Manual*: Reporter types URL, Author, Publisher, and Date.
   - *Auto-lookup*: Reporter inputs URL or DOI. The server parses metadata and populates fields.
   - *AI Tool*: If generated by the AI copilot, the system automatically appends the AI metadata block.
3. **Trust Evaluation**: The system processes the domain name and calculates a trust score.
4. **Editor Rendering**: The editor renders the inline tag. If the trust score is low, a yellow warning icon appears.
5. **Publishing**: Upon approval, the compiled document includes the attribution payload.
6. **Reader Rendering**: The public page loads the article. Superscript links map to popovers showing the verified origin details.

## API Design

### Create Source Attribution
- **Endpoint**: `POST /api/v1/attributions`
- **Method**: `POST`
- **Request Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <JWT>`
- **Request Payload**:
```json
{
  "article_id": "art_884b22c1_3004_41fe_a2c1_ff88c0a98210",
  "citation_type": "EXTERNAL",
  "source_name": "Department of Labor Statistics Report",
  "source_url": "https://bls.gov/news/report.html",
  "author_name": "Jane Doe",
  "publish_date": "2026-05-15",
  "style_requested": "AP",
  "ai_metadata": null
}
```
- **Response (201 Created)**:
```json
{
  "attribution_id": "att_001d2b3c_4455_4821_a901_fe8d02bb3111",
  "formatted_text": "\"Jane Doe. Department of Labor Statistics Report. May 15, 2026. bls.gov.\"",
  "trust_score": 98,
  "trust_level": "SECURE",
  "created_at": "2026-06-27T22:45:00Z"
}
```

### Save AI Generation Attribution
- **Endpoint**: `POST /api/v1/attributions/ai-generation`
- **Method**: `POST`
- **Request Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <JWT>`
- **Request Payload**:
```json
{
  "article_id": "art_884b22c1_3004_41fe_a2c1_ff88c0a98210",
  "block_id": "blk_992c3a_8876",
  "model_name": "claude-3-5-sonnet-v2",
  "temperature": 0.3,
  "prompt_template": "Summarize the economic report: {{report_text}}",
  "tokens_generated": 145,
  "human_edit_distance": 12
}
```
- **Response (201 Created)**:
```json
{
  "attribution_id": "att_ai_883c0e3f_4821_49de_bb01_ccf87d098e21",
  "is_above_label_threshold": true,
  "required_label": "AI-Assisted Summary",
  "created_at": "2026-06-27T22:46:12Z"
}
```

## Database Design

### Schema Tables

#### `source_attributions`
Main record of verified source items mapped to specific content positions.
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Not Null)
- `article_id` (UUID, Not Null) -- Foreign Key to Articles
- `citation_type` (VARCHAR(16)) -- EXTERNAL, INTERNAL, AI
- `source_name` (VARCHAR(256), Not Null)
- `source_url` (TEXT)
- `author_name` (VARCHAR(128))
- `publish_date` (DATE)
- `formatted_citation` (TEXT) -- Cached style line
- `ai_metadata` (JSONB, Nullable) -- {model, prompt_hash, temp, etc.}
- `trust_score` (INTEGER) -- Evaluated at save time
- `is_verified` (BOOLEAN, Default: false)
- `created_at` (TIMESTAMP WITH TIME ZONE)

#### `source_trust_metrics`
Pre-compiled index of domains and their historical reliability values.
- `id` (UUID, Primary Key)
- `domain_name` (VARCHAR(256), Unique, Not Null) -- e.g. bls.gov, fake-news-daily.org
- `base_trust_score` (INTEGER, Not Null) -- 0-100 range
- `verification_flags` (JSONB) -- History of fact checking verdicts
- `last_scanned_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)

### Indexes
- `idx_attribution_article` ON `source_attributions (article_id, citation_type)`
- `idx_trust_domain` ON `source_trust_metrics (domain_name)`

## UI Design
- **Inline Hover Card**: Hovering over superscript numbers displays a clean popover with the publication source, author, and date.
- **Attributions Inspector Sidebar**: A persistent panel in the CMS editor listing all active sources in the draft. It includes options to re-generate bibliographic styles (APA/AP) and alerts developers of low trust ratings.
- **AI Inspector Panel**: Provides a visual preview showing the differential matching of AI prompt summaries against final draft versions, calculating human edits percentages.
- **Public Attribution Footer**: A grid section rendered at the bottom of published pages listing all citations. It features a trust transparency stamp indicating editorial validation stamps.

## Permissions
- `attributions:read` - Browse citation libraries.
- `attributions:write` - Insert, modify and edit attributions.
- `attributions:verify` - Fact-check and verify source tags.

## Security
- **Domain Whitelisting**: Strict URI validation rules blocking redirection URLs and script executions within URLs.
- **Sanitized Metadata Fields**: Text metadata fields (e.g. prompts history details) are cleaned to prevent potential markdown injection and HTML exploits.
- **Access Isolation**: Verify JWT permissions to ensure only auth organization sub-editors can sign off on verification overrides.

## Performance
- **Hydration Target**: Fetching and parsing citation metadata under 40ms.
- **Caching**: Domain trust metric lists are cached in Redis (`trust_metrics:{domain}`) with a TTL of 24 hours.
- **Target TPS**: Built to withstand up to 500 API queries per second for public-facing attribution blocks.

## Monitoring
- **Prometheus Metrics**:
  - `newsops_attributions_created_total` (counter, labeled by type)
  - `newsops_attributions_low_trust_warnings` (counter)
  - `newsops_attributions_ai_percentage_average` (gauge)
- **Alert Triggers**:
  - Alert if `rate(newsops_attributions_low_trust_warnings[5m]) > 10` (High volume of unreliable sources added to active drafts).

## Logging
- **Format**: JSON.
- **Levels**:
  - `INFO`: Attribution registered, validation updated.
  - `WARNING`: Low trust domain detected.
  - `ERROR`: Metadata scraping failure.
- **Log Context**: Include `tenant_id`, `article_id`, `domain_name`, `trust_score`.

## Error Handling
- **ERR_DOMAIN_BLOCKED**: HTTP 403. "The requested domain is present on the high-risk block list."
- **ERR_METADATA_UNAVAILABLE**: HTTP 422. "Unable to extract citation details from target link."
- **ERR_INVALID_AI_SCHEMAS**: HTTP 400. "AI metadata structure is missing mandatory attributes (model_name/tokens)."

## Edge Cases
- **Missing Author or Date**: If a URL is scraped but metadata is missing, the system prompts the reporter to fill in values manually to build standard bibliographic entries.
- **Paywalled Links**: Upstream crawlers might fail to read paywalled pages. Solution: The system requests the reporter to input custom citation text manually while retaining the link target.
- **Dynamic Content Shifts**: If target citation page contents change, the crawl history retains a SHA256 snapshot representation hash of the read state when the citation was validated.

## Future Improvements
- **Decentralized W3C Verifiable Credentials**: Integrate cryptographically signed credentials to verify official state documents.
- **Automated Archive Web Snapshotting**: Sync with the Internet Archive Wayback Machine to submit automated archive URLs upon citation creation.

## Mermaid Diagrams

```mermaid
graph TD
    A[Reporter: Paste Source URL] --> B[System: Parse Domain Name]
    B --> C[Query Redis: trust_metrics:{domain}]
    C -->|Hit| D[Retrieve Trust Score]
    C -->|Miss| E[Query DB: source_trust_metrics]
    E -->|Found| D
    E -->|Not Found| F[Trigger Background Scanner]
    F --> G[Evaluate domain credentials]
    G --> H[Update DB & Cache]
    H --> D
    
    D --> I{Score >= 35?}
    I -->|Yes| J[Allow Citation Insertion]
    I -->|No| K[Show Low-Trust Warning & Flag Review]
    
    J --> L[Generate AP/MLA Citation Line]
    K --> L
    L --> M[Save to source_attributions]
```

## References
- [BYO AI Model](../04-ai/byo_ai_model.md)
- [News Intelligence Schema](../03-database/news_intelligence_schema.md)
- [Editorial and CMS Schema](../03-database/editorial_and_cms_schema.md)
