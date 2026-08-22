# StreamTube — Codex instructions

This monorepo is developed with an evidence-first planning pipeline. Read this file and the nearest nested `AGENTS.md` before changing code.

## Workflow

1. Research open technical choices and record them in `docs/decisions/`.
2. Produce `context.md`, then `validation.md`; implementation is blocked until validation is `clean`.
3. Resolve libraries from primary documentation and record exact versions in `library-refs.md`.
4. Build an executable plan with SIs, Technical Specifications, dependencies and deliverables.
5. Implement one SI at a time and update `progress.md` only after its tests pass.
6. Audit the final implementation against every acceptance and automatic-rejection criterion.

Repository skills are in `.agents/skills/`. Read-only planning agents are in `.codex/agents/`. Project MCP configuration is in `.codex/config.toml`.

## Architecture

- `nestjs-project/`: NestJS 11 API, PostgreSQL 17, TypeORM, MinIO/S3 storage, BullMQ/Redis queue and the FFmpeg worker.
- `next-frontend/`: Next.js frontend; video UI is outside Phase 03.
- `docs/`: decisions, phase plans, diagrams and evaluation evidence.

Phase 03 uploads never pass through the API. The API creates an S3-compatible multipart upload and signs part URLs; MinIO receives bytes directly. Completing an upload validates the stored object, persists `processing`, and adds an idempotent BullMQ job. `src/worker.ts` consumes the job, streams the source to temporary disk, runs FFprobe/FFmpeg, uploads a thumbnail and persists `ready` or `error`. Streaming must honor a single HTTP byte range and return `206` with `Content-Range`.

## Definition of Done

- Relevant unit, integration and E2E tests pass, then the full suites pass.
- `npx tsc --noEmit`, `npm run build` and `npm run lint` exit zero.
- Migrations are versioned and `synchronize` remains false.
- Compose dependencies use service names (`db`, `redis`, `minio`, `mailpit`), never `localhost`; the only intentional localhost address is the browser-facing MinIO presigned endpoint.
- Work is on `feature/*` branched from `dev`; never commit directly to `main`.
- Documentation must cite only files and behavior that exist.

## Security and reliability

- Never expose S3 credentials or internal object keys in API responses.
- Enforce the 10 GiB limit in both DTO validation and the database constraint.
- Validate ownership through the authenticated user's channel for every video operation.
- Queue jobs use stable IDs, bounded retries and exponential backoff. Processing must be safe to retry and temporary files must always be removed.
- Never buffer complete videos in API or worker memory.
