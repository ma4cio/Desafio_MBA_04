---
kind: library-refs
name: phase-03-videos
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-17 13:45:13.849079787 +1200"
  nestjs-project/package.json: "2026-08-17 13:32:07.341051659 +1200"
---

# Phase 03 — Library References

The project Context7 server is ported in `.codex/config.toml`. It was not exposed in the authoring runtime, so primary official documentation was used directly and the exact installed versions were fixed in `package.json`/`package-lock.json`.

| Library/runtime | Fixed version | Used APIs | Primary source checked |
|-----------------|---------------|-----------|------------------------|
| `@aws-sdk/client-s3` | `^3.1111.0` | Create/UploadPart/Complete/Abort multipart, Head/Get/Put/Delete object | AWS S3 multipart overview and limits |
| `@aws-sdk/s3-request-presigner` | `^3.1111.0` | `getSignedUrl(UploadPartCommand)` | AWS SDK v3/S3 documentation |
| `bullmq` | `^6.1.2` | `Queue`, `Worker`, attempts/backoff, stable job IDs, retention | BullMQ retry and idempotent-job guides |
| `ioredis` | `^5.11.1` | BullMQ Redis runtime dependency | BullMQ connection guidance |
| Redis | `7-alpine` | queue persistence/AOF | Redis container image contract |
| MinIO | `RELEASE.2025-04-22T22-12-26Z` | S3-compatible object storage | MinIO S3 compatibility contract |
| FFmpeg/FFprobe | Debian image package | probe JSON, capture/scale JPEG | FFmpeg CLI manuals |

Implementation constraints derived from documentation:

- Single PUT stops at 5 GB; 10 GiB therefore uses multipart.
- S3 multipart part numbers are 1–10,000; all non-final parts are at least 5 MiB. 64 MiB yields 160 parts at the maximum accepted size.
- Completion sends ordered part numbers and returned ETags.
- Failed BullMQ jobs retry only when the processor throws; the job is designed to be idempotent and uses exponential backoff.
