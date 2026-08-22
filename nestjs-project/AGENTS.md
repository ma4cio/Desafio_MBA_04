# NestJS project instructions

Read the root `AGENTS.md` first. Commands in the evaluator environment run through the `nestjs-api` Compose service; use service names for infrastructure hosts.

Follow the existing module shape: controller for HTTP mapping, service for use cases, TypeORM entities/migrations for persistence, DTOs with `class-validator`, domain exceptions through the global filter, and explicit Nest modules. Keep `strict` TypeScript, `synchronize: false`, snake_case database columns and versioned reversible migrations.

Tests use `*.spec.ts` for unit tests, `*.integration-spec.ts` for real PostgreSQL/Redis/MinIO integration, and `*.e2e-spec.ts` for Supertest. Do not replace real service coverage with mocks where Compose can provide the dependency. Full checks are `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npx tsc --noEmit`, `npm run build`, and `npm run lint`.

Video specifics: direct multipart upload, maximum 10 GiB, private ownership checks, S3 object validation before queueing, one BullMQ worker per job, FFprobe metadata, FFmpeg JPEG thumbnail, range-aware streaming, and attachment download. Do not log signed URLs, credentials, storage keys or JWTs.
