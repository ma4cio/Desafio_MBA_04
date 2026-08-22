---
scope_type: phase
related_phases: [3]
covers_capabilities:
  - "Serviço de armazenamento de arquivos (vídeos e thumbnails)"
  - "Serviço de processamento em segundo plano (filas)"
  - "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"
  - "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"
  - "Processamento automático do vídeo após upload (extração de duração e metadados)"
  - "Geração automática de thumbnail a partir de um frame do vídeo"
  - "URL única por vídeo, sem conflito com outros vídeos"
  - "Reprodução via streaming (sem necessidade de download completo)"
  - "Download do vídeo pelo usuário"
status: decided
date: 2026-08-16
scope_description: "Backend Phase 03: direct multipart video upload, S3-compatible storage, asynchronous processing, thumbnail, unique URL, streaming and download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subproject in scope: `nestjs-project/`. The Phase 03 video UI is explicitly out of scope._

## TD-01: Processing Queue

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Processing must survive API restarts, retry transient failures and run in a separate worker container.

**Options:**

### Option A: BullMQ with Redis
- **Pros:** durable Redis-backed jobs, unique job IDs, stalled-job recovery, retry/backoff, mature TypeScript API and independent workers.
- **Cons:** adds Redis and requires operational limits for retained jobs.

### Option B: PostgreSQL polling table
- **Pros:** no new infrastructure and transactional enqueue is straightforward.
- **Cons:** custom polling, locking, retry and stalled-job behavior; processing load competes with domain persistence.

### Option C: RabbitMQ
- **Pros:** dedicated broker with strong routing and acknowledgement semantics.
- **Cons:** substantially more operational complexity than required for one processing flow.

**Recommendation:** BullMQ with Redis. It provides the required reliability primitives without inventing a queue implementation; Redis is isolated from PostgreSQL and runs locally in Compose.

**Decision:** A (BullMQ 6 + Redis 7; three attempts, exponential backoff, stable `video-{id}` job ID)

**Libraries:** `bullmq@^6.1.2`, `ioredis@^5.11.1`

---

## TD-02: Upload Strategy for 10 GiB

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** A single S3 `PutObject` is limited to 5 GB and routing 10 GiB through NestJS would occupy connections and memory. S3 multipart supports up to 10,000 independently retriable parts.

**Options:**

### Option A: API-proxied multipart body
- **Pros:** one origin and centralized byte inspection.
- **Cons:** the API remains in the data path, doubles network traffic and violates the non-blocking requirement.

### Option B: Direct S3-compatible multipart upload with presigned part URLs
- **Pros:** bytes go from client to MinIO/S3, parts retry independently, API handles only metadata and signatures, and 10 GiB fits comfortably in 160 parts of 64 MiB.
- **Cons:** client must retain part ETags and explicitly complete or abort the upload.

**Recommendation:** Direct multipart. Create the draft and multipart upload first, sign at most 20 requested parts per API call, require all consecutive ETags on completion and validate size/content type with `HeadObject` before queueing.

**Decision:** B (64 MiB parts, 15-minute signed URLs, maximum 10 GiB, explicit abort endpoint)

**Libraries:** `@aws-sdk/client-s3@^3.1111.0`, `@aws-sdk/s3-request-presigner@^3.1111.0`

---

## TD-03: Object Organization and Credentials Boundary

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The project mandates S3-compatible storage with MinIO locally. Source and derivative lifecycle/permissions differ.

**Options:**

### Option A: One public bucket
- **Pros:** simplest configuration.
- **Cons:** accidental public originals, mixed lifecycle policies and weak separation.

### Option B: Two private buckets with server-mediated reads
- **Pros:** explicit source/thumbnail boundaries, no credential exposure, and production S3 replacement is configuration-only.
- **Cons:** two bucket resources and an initialization job.

**Recommendation:** Two private buckets: `streamtube-videos` and `streamtube-thumbnails`. Keys are namespaced as `channels/{channelId}/videos/{videoId}/...`; internal keys never appear in API responses.

**Decision:** B (private buckets; API/worker credentials only; MinIO initializer is idempotent)

**Libraries:** `@aws-sdk/client-s3@^3.1111.0`

---

## TD-04: Worker and Media Processing

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** FFmpeg work is CPU/I/O intensive and must not share the API process. Very large objects cannot be buffered in memory.

**Options:**

### Option A: Spawn FFprobe/FFmpeg inside the API
- **Pros:** fewer deployable processes.
- **Cons:** media work can starve HTTP requests and couples scaling/restarts.

### Option B: Separate Nest application-context worker container
- **Pros:** independent concurrency, lifecycle and resources; shares typed entities/config/storage code; streams the object to temporary disk.
- **Cons:** another Compose service and temporary disk capacity must be provisioned.

**Recommendation:** Separate `video-worker`. Download with a stream, probe JSON metadata, capture a frame at 10% capped at 10 seconds, scale to 640px JPEG, upload the thumbnail and always remove the temporary directory.

**Decision:** B (native `child_process.spawn`, FFmpeg package in the image, worker concurrency 1 by default)

**Libraries:** system `ffmpeg`/`ffprobe` (Debian package; no deprecated Node wrapper)

---

## TD-05: Unique Video URL

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Options:**

### Option A: Slug derived from title
- **Pros:** human-readable.
- **Cons:** collisions, renames and information leakage require suffix rules.

### Option B: Cryptographically random public identifier with database uniqueness
- **Pros:** title-independent, unguessable enough for routing and protected by a unique constraint.
- **Cons:** not human-readable.

**Recommendation:** A separate 128-bit random UUID rendered as 32 hexadecimal characters. Keep the database UUID primary key private from URLs.

**Decision:** B (`crypto.randomUUID()` without hyphens + unique index)

---

## TD-06: Streaming and Download

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** Playback must seek without retrieving the full object. Phase 05, not Phase 03, introduces anonymous viewing.

**Options:**

### Option A: Return a full presigned GET URL
- **Pros:** removes API bandwidth.
- **Cons:** weak control over response disposition and authorization lifetime; no consistent domain errors.

### Option B: Authenticated API stream proxy backed by S3 `Range`
- **Pros:** owner authorization on every request, correct `206`, `Content-Range` and download disposition, constant memory through streaming.
- **Cons:** media bytes traverse the API until a CDN/presigned delivery policy is introduced.

**Recommendation:** Range proxy for Phase 03. Accept one RFC-style byte range, reject invalid/multiple ranges with 416, stream the S3 body without buffering, and use a separate attachment route for download.

**Decision:** B (owner-only until publication/public-view phases)

---

## TD-07: Status Lifecycle, Failure and Idempotency

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Options:**

### Option A: Boolean processed flag
- **Pros:** small model.
- **Cons:** cannot distinguish open uploads, active processing and terminal failure.

### Option B: Explicit state machine
- **Pros:** observable lifecycle and enforceable endpoint preconditions.
- **Cons:** transitions must be coded deliberately.

**Recommendation:** `draft → processing → ready | error`. Only draft uploads can be signed/completed/aborted; only ready videos can stream/download. Completion validates storage before `processing`. Retried work is idempotent: a ready row returns immediately and derivative keys are deterministic. Only the final failed attempt sets `error`.

**Decision:** B (error detail retained internally; bounded to 4,000 characters)

