---
kind: phase-plan
name: phase-03-videos
phase: 3
affected_subprojects: [nestjs-project]
ui_in_scope: false
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-08-17 13:46:08.361081736 +1200"
  docs/phases/phase-03-videos/validation.md: "2026-08-17 13:52:45.733095948 +1200"
  docs/phases/phase-03-videos/library-refs.md: "2026-08-17 13:52:45.829095951 +1200"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver a backend-only, production-shaped video ingestion path: direct uploads up to 10 GiB, durable asynchronous media processing, unique routing, thumbnails, range streaming and download, with real local infrastructure and traceable AI artifacts.

## Step Implementations

### SI-03.1 — Codex foundation, infrastructure, configuration and data model

**Description:** Port the repository AI workflow to Codex and establish the persistence/runtime foundation.

**Technical actions:**

1. Add root/nested `AGENTS.md`, `.agents/skills`, `.codex/agents` and `.codex/config.toml` while retaining Claude compatibility.
2. Fix exact AWS SDK/BullMQ/ioredis versions and validate all environment variables.
3. Extend Compose with Redis, MinIO, idempotent bucket initialization and a separate worker service; add FFmpeg to the image.
4. Create the `Video` entity and reversible migration, including FK, enum, uniqueness, indexes and 10 GiB constraint.

**Tests:** migration integration suite; TypeScript build.

**Dependencies:** none.

**Acceptance criteria:** Compose declares healthy real services; model is channel-owned and migration-backed; Codex artifacts validate.

### SI-03.2 — Direct multipart upload lifecycle

**Description:** Pre-register drafts and keep all video bytes outside the API.

**Technical actions:**

1. Initiate S3 multipart upload after channel ownership lookup and persist the draft.
2. Return only video/public IDs, 64 MiB part size and part count; never return storage keys or credentials.
3. Sign unique requested parts in batches of 20, constrained to the declared part count.
4. Complete only consecutive ETags, validate stored size/content type, transition to processing and enqueue; implement abort cleanup.

**Tests:** `videos.service.spec.ts`, `videos.e2e-spec.ts` direct-storage lifecycle.

**Dependencies:** SI-03.1.

**Acceptance criteria:** 10 GiB produces 160 parts; over-limit declarations fail before storage; API never receives file bodies.

### SI-03.3 — Durable queue and video worker

**Description:** Process completed objects asynchronously with deterministic, retry-safe side effects.

**Technical actions:**

1. Publish `process-video` through BullMQ with stable job ID, three attempts and exponential backoff.
2. Run `src/worker.ts` as an independent Nest application context and BullMQ worker.
3. Stream source to a unique temporary directory, extract probe metadata, generate a 640px JPEG frame and upload it.
4. Persist duration/metadata/thumbnail and `ready`; retain bounded errors and set terminal `error` only on the final attempt; clean temporary files in `finally`.

**Tests:** worker behavior through real Compose services and focused queue/media integration verification.

**Dependencies:** SI-03.1, SI-03.2.

**Acceptance criteria:** API process never invokes FFmpeg; ready jobs are idempotent no-ops; failure is observable in the row.

### SI-03.4 — Status, thumbnail, streaming and download API

**Description:** Expose owner-authorized output without buffering full objects.

**Technical actions:**

1. Return sanitized status/metadata by public ID.
2. Stream only ready videos, parse one byte range and return `206`, `Content-Range`, `Accept-Ranges` and exact length.
3. Provide ready thumbnail stream and attachment download; reject invalid range with 416.
4. Enforce user→channel ownership on every lookup and keep public/anonymous playback deferred.

**Tests:** range parser unit matrix, authentication E2E, entity uniqueness integration.

**Dependencies:** SI-03.2, SI-03.3.

**Acceptance criteria:** seeks do not require full download; non-ready and cross-owner resources are not exposed.

### SI-03.5 — Test pyramid, documentation and contracts

**Description:** Make behavior reviewable and executable by evaluators.

**Technical actions:**

1. Add unit tests for maximum upload, multipart invariants, state transition, queue call and ranges.
2. Add real PostgreSQL entity/migration integration tests and Compose-backed upload E2E tests against MinIO/Redis.
3. Update `.env.example`, `CLAUDE.md`, `AGENTS.md`, API annotations and phase progress.
4. Keep test mocks typed and restrict relaxed unsafe lint rules to test files only.

**Tests:** focused unit suite, integration suite, E2E suite, lint/typecheck/build.

**Dependencies:** SI-03.1, SI-03.2, SI-03.3, SI-03.4.

**Acceptance criteria:** documentation names only existing files/endpoints; each acceptance behavior has code/test evidence.

### SI-03.6 — Instructor-style acceptance audit

**Description:** Compare the delivered repository with every requirement and automatic rejection condition.

**Technical actions:**

1. Trace each requirement to decision, plan, code, migration, Compose service and/or test.
2. Run the full Definition of Done where the environment permits and record exact blockers rather than claiming unexecuted checks.
3. Inspect Git branch/history, secret exposure, memory behavior, state transitions, idempotency and documentation drift.
4. Produce `docs/phases/phase-03-videos/acceptance-audit.md` with pass/block status and commands.

**Tests:** full unit/integration/E2E, `tsc --noEmit`, build, lint, Compose config validation.

**Dependencies:** SI-03.5.

**Acceptance criteria:** zero unaccounted requirements; environment-only blockers are explicit and reproducible.

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints/meaning |
|-------|------|---------------------|
| `id` | uuid | private primary key |
| `channel_id` | uuid | FK `channels.id`, cascade delete, indexed with status |
| `title` | varchar(120) | required |
| `original_filename` | varchar(255) | download filename, response-sanitized |
| `mime_type` | varchar(100) | allowed video MIME |
| `size_bytes` | bigint | `1..10737418240`, represented as string in entity |
| `status` | enum | `draft`, `processing`, `ready`, `error` |
| `public_id` | varchar(64) | unique 32-hex route identifier |
| `source_object_key` | text | unique private storage key |
| `thumbnail_object_key` | text nullable | deterministic derivative key |
| `multipart_upload_id` | varchar(255) nullable | present only while draft upload is open |
| `duration_seconds` | integer nullable | positive after processing |
| `metadata` | jsonb nullable | format, bitrate, codecs, dimensions, frame rate |
| `processing_error` | text nullable | internal bounded worker failure |
| `created_at`, `updated_at` | timestamp | database managed |

State invariants: signing/completion/abort require `draft + multipart_upload_id`; stream/thumbnail/download require `ready`; only worker writes ready; completion or terminal processing failure removes the upload ID.

### API Contracts

#### POST /videos/uploads

- Auth: JWT owner.
- Request: `{ title, filename, contentType, sizeBytes }`.
- Response 201: `{ id, publicId, status: "draft", partSizeBytes: 67108864, totalParts }`.
- Does not accept multipart/form-data or file bytes.

#### POST /videos/:id/upload-parts

- Request: `{ partNumbers: number[1..20] }`; duplicates are deduplicated and output sorted.
- Response 200: `[{ partNumber, url }]`; URL expires in 15 minutes.

#### POST /videos/:id/uploads/complete

- Request: `{ parts: [{ partNumber, eTag }] }`, exactly all consecutive parts.
- Response 202: `{ id, publicId, status: "processing" }` after object validation and queue publish.

#### DELETE /videos/:id/uploads

- Response 204; aborts S3 multipart and deletes the draft.

#### GET /videos/:publicId

- Response 200: sanitized identity, title, state, duration, metadata and timestamps.

#### GET /videos/:publicId/stream

- Optional `Range: bytes=start-end`; response 206 for ranges or streamed 200 for no range.
- Headers: `Accept-Ranges`, `Content-Type`, `Content-Length`, and `Content-Range` for 206.

#### GET /videos/:publicId/download

- Streamed 200 with sanitized `Content-Disposition: attachment`.

#### GET /videos/:publicId/thumbnail

- Streamed JPEG for ready videos; private cache for one hour.

### Authorization Matrix

| Operation | Anonymous | Authenticated non-owner | Owner |
|-----------|-----------|-------------------------|-------|
| create upload | 401 | own channel only | allowed |
| sign/complete/abort upload | 401 | 404 | allowed in draft |
| status/thumbnail/stream/download | 401 | 404 | allowed; media reads require ready |

Anonymous playback is deliberately not introduced before Phase 05.

### Error Catalog

| Code | HTTP | Condition |
|------|------|-----------|
| framework validation | 400 | invalid MIME/shape, >10 GiB, bad UUID |
| `VIDEO_NOT_FOUND` | 404 | missing or not owned (prevents enumeration) |
| `INVALID_VIDEO_STATE` | 409 | upload closed or wrong lifecycle state |
| `VIDEO_NOT_READY` | 409 | media requested before ready |
| `INVALID_MULTIPART_UPLOAD` | 400 | part beyond declared count or missing/nonconsecutive ETags |
| `UPLOADED_OBJECT_MISMATCH` | 422 | stored size/content type differs from declaration |
| `INVALID_RANGE` | 416 | malformed, multiple or unsatisfiable byte range |

### Events/Messages

#### process-video

| Property | Value |
|----------|-------|
| Queue | `video-processing` (configurable) |
| Payload | `{ videoId: uuid }` only; worker reloads canonical row |
| Job ID | `video-{videoId}` |
| Producer | successful upload completion after `HeadObject` validation |
| Consumer | separate `video-worker` service |
| Retry | 3 attempts, exponential starting at 5 seconds |
| Idempotency | ready row returns; deterministic thumbnail key; stable job ID |
| Success | metadata/duration/thumbnail persisted and status `ready` |
| Final failure | bounded error persisted and status `error`; BullMQ failed job retained |

## Dependency Map

```text
SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6
```

No SI starts before all listed dependencies are complete.

## Deliverables

- [x] Research decisions cover every open technical choice.
- [x] Context, validation `clean`, library references, plan and progress exist.
- [x] Direct multipart upload supports declarations through 10 GiB without API file bodies.
- [x] MinIO, Redis, bucket initializer and independent worker are declared in Compose.
- [x] Worker extracts duration/metadata and generates a thumbnail with FFmpeg.
- [x] Unique public ID, status lifecycle, streaming and download are implemented.
- [x] Reversible migration links videos to channels.
- [x] Unit, integration and E2E test files cover appropriate layers.
- [ ] Execute real-service integration/E2E and `docker compose config` in a Docker-capable environment.
- [x] Focused unit tests pass.
- [x] TypeScript typecheck and build pass.
- [x] Lint exits zero.
- [x] AI instructions and workflow are ported to Codex and Claude docs are coherent.
