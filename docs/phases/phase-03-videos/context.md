---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-08-17 13:24:48.975828443 +1200"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-17 13:45:13.849079787 +1200"
  docs/phases/phase-02-auth/context.md: "2026-08-17 13:25:50.137256216 +1200"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-08-17 13:25:50.133038169 +1200"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** frontend de vídeos, edição/publicação, visibilidade pública, CDN/transcoding e acesso anônimo pertencem às fases posteriores.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`, `docs/`, root Codex/Claude instructions.

**Dependencies:** Phase 01 configuration and Phase 02 JWT/user/channel model. Every video is owned by the authenticated user's 1:1 channel.

## Decisions Index

| Ref | Scope | Topic | Status | Decision | Libraries |
|-----|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | Backend | Processing queue | decided | BullMQ + Redis | bullmq, ioredis |
| phase-03-videos/TD-02 | Backend | 10 GiB upload | decided | presigned multipart, 64 MiB parts | AWS SDK v3 |
| phase-03-videos/TD-03 | Backend | Object organization | decided | two private buckets | AWS SDK v3 |
| phase-03-videos/TD-04 | Backend | Worker/media processing | decided | separate worker + FFprobe/FFmpeg | system ffmpeg |
| phase-03-videos/TD-05 | Backend | Unique URL | decided | random 128-bit public ID | Node crypto |
| phase-03-videos/TD-06 | Backend | Streaming/download | decided | authenticated Range proxy | AWS SDK v3 |
| phase-03-videos/TD-07 | Backend | Lifecycle/failure | decided | draft → processing → ready/error | — |

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | TD-03 |
| Serviço de processamento em segundo plano (filas) | TD-01, TD-04 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | TD-04, TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | TD-06 |
| Download do vídeo pelo usuário | TD-06 |

## Decisions Detail

- **TD-01:** durable BullMQ queue on Redis, stable job ID, three attempts and exponential backoff.
- **TD-02:** API handles metadata/signatures only; MinIO receives 64 MiB parts directly; all ETags and `HeadObject` validation are mandatory.
- **TD-03:** private `streamtube-videos` and `streamtube-thumbnails` buckets; deterministic channel/video namespaces; storage keys are internal.
- **TD-04:** one independent Nest application-context worker; stream to temporary disk; FFprobe JSON and FFmpeg JPEG; unconditional cleanup.
- **TD-05:** primary UUID and independent 32-hex public identifier, both protected by database constraints.
- **TD-06:** owner-only single-range streaming in this phase, `206` headers, streamed download attachment; public playback deferred.
- **TD-07:** explicit lifecycle and endpoint preconditions; final queue failure persists `error`; ready jobs are no-ops on retry.

## Inherited Decisions and Conventions

- Phase 02 JWT guard is global; controllers are protected unless explicitly `@Public()`.
- User-to-channel ownership is 1:1 and channel IDs are the video foreign key.
- Domain exceptions use `{ statusCode, error, message }`; validation uses the global `ValidationPipe` and validation filter.
- Nest controllers map HTTP only; services own use cases; TypeORM migrations are reversible and `synchronize` remains false.
- Integration and E2E suites run serially because they share real services.

## Non-UI / Deferred Capabilities

| Capability | Status | Target |
|------------|--------|--------|
| Video upload/processing/streaming backend | in scope | Phase 03 |
| Video management and publication | deferred | Phase 04 |
| Anonymous video player | deferred | Phase 05 |
| Video frontend upload UI | deferred | later frontend slice |

