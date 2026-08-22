---
name: research
description: "Research technical options and generate a structured decisions document. Use whenever the user needs to explore alternatives, understand trade-offs, or define technical paths — whether for a project phase or an ad-hoc topic. Trigger phrases include: 'research options for phase X', 'research how to do Y', 'technical decisions for Z', 'what are the options for...', 'explore alternatives for...', 'research the phase', 'investigate options for parallel DB testing', or any mention of exploring alternatives, trade-offs, or technical choices before planning or implementing."
---

# Research

Research technical options and generate a structured decisions document for a defined scope — a project phase, an ad-hoc technical question, a bug investigation, or a refactoring exploration. This document identifies decisions that need to be made, presents alternatives with trade-offs, and recommends a path. The user reviews, decides, and the result feeds `plan-context`, or stands alone as a reference when no planning step follows.

## Related entry points

- **`/decide "<free-text>"`** — front-door for unstructured needs (when you don't know if a TD already covers the area, or if a change is a Revision vs Supersede). `/decide` triages and either applies a Revision inline OR sends you back here for greenfield research / superseding research.
- This skill (`/research`) is the right direct entry when you **know** it's a new TD: phase research kickoff, or an ad-hoc topic you've already decided to research formally.

## Input handling

The user provides the research scope in one of three ways:

1. **Phase reference:** the user names a phase (e.g., "research phase 03", "technical decisions for the upload phase"). The skill reads that phase's capabilities from `docs/project-plan.md` as the scope definition.
2. **Inline description:** the user describes the topic directly in the chat (e.g., "research how to run tests in parallel against the same database instance"). No phase is involved; the description IS the scope.
3. **External document:** the user points to a file containing the problem description, scope, and constraints (e.g., "research from docs/topics/parallel-db-testing.md").

If the user provides both a phase reference and an inline description, the phase capabilities define the scope boundary and the inline description narrows the focus. If the user provides both an inline description and an external document, the document takes precedence and the inline message adds context. If the user provides both a phase reference and an external document, the phase capabilities define the hard scope boundary (nothing outside the phase's bullets belongs in the document) and the external document supplies additional context, constraints, or detail within that boundary.

**Mode detection:** determine the mode from the user's input:
- If the input references a phase number or unambiguous phase name matching `docs/project-plan.md` → **phase mode**.
- Otherwise → **ad-hoc mode**.

The mode affects context gathering and output metadata. The **capability gate** (each TD traces to a phase bullet, via the **`Capability:` field** per TD) applies to phase mode **and** to ad-hoc mode when `related_phases` is non-empty. The research process, option analysis, and most rules apply identically in both modes. Aggregate capability coverage is not written here — it is assembled downstream by `plan-context`.

**If the input is too vague to identify technical decisions** (e.g., "research the database" — which aspect? performance? schema design? migration strategy?), ask the user to clarify before proceeding.

## Context — read before generating

1. **`docs/project-plan.md`** — general project plan.
   - **Phase mode:** read the target phase's description, capabilities, and the defined stack. The phase capabilities are the primary scope definition.
   - **Ad-hoc mode:** read only the **Stack** and **General Architecture** sections. These constrain which technologies are in play. The phase list may help identify whether the topic overlaps with a planned phase — if it does, record the overlap in the YAML frontmatter's `related_phases` field (see Output structure).
2. **`docs/decisions/`** — canonical source of prior technical decisions. These are hard constraints — do not reopen decisions already made, regardless of mode. In ad-hoc mode, read only decisions relevant to the topic area (not all files).
3. **`docs/phases/`** and **`docs/tasks/`** — already planned phases and tasks. Read for format and naming consistency reference only, not as a source of technical decisions. In ad-hoc mode, scan for overlap with the research topic — if a phase or task already covers the area, note it.
4. **User's scope description** _(ad-hoc mode only)_ — the primary input. Extract: what question needs answering, which modules/layers/areas are affected, what constraints exist.
5. **Current code** _(when the topic relates to existing code)_ — if the research concerns a bug, refactoring, or improvement to existing code, read the relevant source files to understand the current implementation. More common in ad-hoc mode.

### Scope detection

Before identifying decisions, determine what the scope spans — along two independent dimensions:

**Dimension 1 — Subprojects affected:**
- **Phase mode:** read the target phase in `docs/project-plan.md` and list every subproject directory referenced by its capabilities (e.g., the backend or frontend subproject).
- **Ad-hoc mode:** infer from the user's description which subprojects are affected. Database/persistence/server-side topics map to the backend subproject; rendering/UI/client-side topics map to the frontend subproject.

**Resolving subproject directory names** — discover them in this order:

1. `docs/project-plan.md`'s `### Subprojects` section, if present.
2. The repo root directory listing (subproject dirs are typically at the root, named after their stack/framework).
3. **If the role-to-directory mapping is still ambiguous** (e.g., multiple candidates for "backend", or unclear which dir is "frontend"), ask the user via `AskUserQuestion` before proceeding. Do not guess.

**Dimension 2 — Repository-transversal concerns:** independent of which subprojects are in play, decide whether the scope also touches monorepo tooling, Docker Compose structure, CI/CD, lint/format config, git hooks, shared TS config, or env management. If yes, the **Repo-wide / Infra & Tooling** category (see below) comes into play.

The two dimensions together drive which context sources to load and which decision categories (backend, frontend, cross-layer, repo-wide) to consider. If only one subproject is affected and no transversal concern applies, load only that subproject's sources; otherwise load all relevant sources — a single decisions document covers everything.

## When this skill is needed

Not every scope needs a formal research document. Use this checklist:

- Does the scope involve **choices of lib, framework, or service** with real alternatives? (e.g., bcrypt vs argon2, JWT vs session)
- Are there **competing implementation patterns** with relevant trade-offs? (e.g., refresh token rotation vs blacklist)
- Does the scope have **non-functional requirements** that impact technical choices? (e.g., 10GB upload → chunked vs streaming vs tus)
- Do you have a **real doubt** about which path to take?

If the answer is no to all:
- **Phase mode:** skipping is only valid when **every** capability bullet of the target phase can be mapped to either (i) a TD already decided in a prior phase and recorded in `docs/decisions/`, or (ii) a canonical stack pattern explicitly documented in `docs/decisions/` or `{subproject}/CLAUDE.md`. Before proposing the skip, produce the mapping in writing — one line per capability → source — and present it to the user. If a single capability is unmapped, proceed with research; "no real doubts" without a documented mapping is not a valid skip.
- **Ad-hoc mode:** tell the user there are no meaningful alternatives to research — the answer is straightforward and does not warrant a decisions document.

## What counts as a Technical Decision (and what doesn't)

A TD documents a **strategic choice** — one whose trade-offs and second-order effects the implementer cannot re-derive from best-practices alone at execution time. **Implementation details do NOT belong in a TD**; they are resolved by `implement` using best-practices skills (e.g., `typeorm`, `nestjs-best-practices`) and the neighboring code.

Apply this test before writing any TD:

- **(d) Best-practices resolution** — is the item's answer already documented in a best-practices skill, framework doc (fetch via `context7`), or canonical stack idiom? If yes, `implement` converges without a TD.
- **(a) Cross-component contract** (tie-breaker) — is the item cited in ≥2 files that must stay consistent (e.g., Joi schema + `compose.yaml` + `.env.example`)? If yes, strategic. If no, likely implementation.

**Drop the TD candidate when (d) holds AND (a) does not.** Examples to drop:

- Export form of a file (`export default` vs `export const`) — typeorm convention.
- Glob patterns for framework discovery (`*.entity.ts`, `*.migration.ts`) — framework docs.
- Directory names following stack conventions (`src/database/seeds/`) — stack idiom.
- npm script names (`migration:generate`, `seed`) — CLI tool convention.
- Framework module options with established defaults (`ConfigModule.isGlobal`, `TypeOrmModule.synchronize`).
- Container-level defaults (healthchecks, volume strategies, command idioms) — compose convention.

**Keep the TD when (d) fails (no skill covers it) OR (a) holds (genuinely cross-component).** Examples to keep:

- Token storage (cookie vs header) — cross-component contract backend↔frontend.
- Canonical set of environment variable keys — cross-component (schema + compose + runtime).
- Auth strategy (stateless vs stateful) — no single skill resolves.
- Upload protocol (tus vs multipart vs presigned) — cross-component + multiple viable options genuinely dominate each other.

Edge case — **skill silence**: if (d) holds in principle (the skill is in scope for the subproject) but the skill does not document the specific item, fall back to (a) alone. Cross-component → strategic, keep. Single-component → implementation-by-default; drop.

A TD that fails this test is extrapolation. Drop it — the implementer will resolve it with the skill + code context.

## How to identify technical decisions

Read each element of the defined scope — phase capabilities from `docs/project-plan.md` in phase mode, or the problem/question described by the user in ad-hoc mode — and ask: "is there more than one reasonable way to implement this with the project's stack?" If yes, it is a technical decision.

Technical decisions appear in recurring categories:

- **Strategy:** how to approach the problem (e.g., stateless vs stateful auth)
- **Lib/Service:** which tool to use (e.g., Passport.js vs manual implementation)
- **Pattern:** which pattern to follow (e.g., refresh token rotation vs blacklist)
- **Storage:** where and how to persist data (e.g., token in cookie vs localStorage)
- **Limits and policies:** values and technical business rules (e.g., token expiration, rate limit, max size)

Ignore decisions already made in project-plan.md or in previous phases. Also ignore trivial decisions that have an obvious answer in the context of the stack.

The categories above are a **thinking framework** — they help you ask "what kind of decision is this?". The lists below are **domain checklists** — they help you ask "where do decisions typically appear in this kind of work?". Use both lenses: the framework to classify, the checklists to not miss areas.

### Capability gate (phase mode and ad-hoc-linked-to-phase)

The checklists are a scanning aid, not a to-do list. A TD only belongs in the document if it traces back to at least one literal capability bullet of a target phase in `docs/project-plan.md`. The gate applies whenever the document is tied to a phase — i.e., in **phase mode**, and also in **ad-hoc mode when `related_phases` is non-empty** (the ad-hoc research explicitly constrains one or more phases).

**Slice-narrowed gate (when `covers_capabilities` is set):** under the slicing model, a phase-scope doc owns a SUBSET of its phase's bullets. If this doc's frontmatter declares `covers_capabilities`, the gate narrows accordingly:

- If `covers_capabilities` is populated → the TD's `**Capability:**` field MUST cite a bullet ∈ this slice's `covers_capabilities` (NOT any bullet of the phase). TDs whose capability belongs to a sibling slice's ownership cannot be accepted here.
- If `covers_capabilities` is omitted (monolithic phase) → the gate applies unchanged: any bullet of the target phase is valid.
- `Transversal — covers: ...` is still allowed but every listed bullet must belong to this slice when `covers_capabilities` is set.
- Rationale: prevents TDs from leaking across slices. A TD whose capability belongs to auth-backend's ownership cannot be accepted in a `/research auth-frontend` run.

Before including any TD:

1. Identify which phase capability (from which related phase) makes this decision necessary. If the doc declares `covers_capabilities`, the bullet must belong to that set.
2. If you cannot point to a specific capability (or the bullet is outside the slice's `covers_capabilities`), **drop the TD** — it belongs to a future phase, a sibling slice, or a truly global ad-hoc research (`related_phases: []`) if the user asks for it directly.
3. Record the mapping in each TD's `Capability:` field (see Output structure).

A TD that only exists because it appears in the checklist — with no capability to justify it — is extrapolation. Drop it.

The aggregate coverage table (every phase bullet → some TD) is **not** written in this document. It is assembled downstream by `plan-context` from all decision documents tied to the phase; completeness gating (each capability has at least one covering TD) is then enforced by `plan-validate`, which emits `MD-N` issues for uncovered capabilities. Your job here is per-TD traceability; the aggregate view is the pipeline's job.

### Backend-specific categories

When the scope includes back-end work, look for decisions in these areas:

- **Persistence & data access:** ORM patterns (Active Record vs Data Mapper), query strategy (builder vs raw SQL), transaction boundaries, migration approach.
- **Authentication & sessions:** stateless vs stateful, password hashing algorithm, token rotation strategy, session storage.
- **Authorization:** RBAC vs ABAC vs attribute-based; guards vs middleware vs decorators; per-resource vs per-role checks.
- **Validation & DTOs:** validation lib (class-validator, Zod, Joi); DTO pattern; whether to share schemas with the front-end.
- **Background jobs & workers:** queue lib (BullMQ, Bee, custom); retry strategy; idempotency; job scheduling vs event-driven.
- **File storage & uploads:** upload protocol (multipart vs streaming vs chunked vs tus); storage backend (S3, MinIO, local); signed URL strategy.
- **Rate limiting & abuse prevention:** algorithm (sliding window, token bucket); storage (in-memory, Redis, DB); scope (per-IP, per-user, per-endpoint).
- **Email & notifications:** transactional email service; template engine; delivery guarantees and retry.
- **Observability:** logging library; structured logs format; metrics and tracing; correlation IDs.
- **Testing strategy:** unit scope boundaries; integration test DB strategy (Testcontainers vs shared DB vs transactional rollback); e2e tooling (e.g., Supertest, Pactum, REST Assured, pytest+httpx — chosen per backend stack); factory vs fixture for test data; test data lifecycle between specs.

### Frontend-specific categories

When the scope includes front-end work, look for decisions in these areas:

- **Rendering strategy:** React Server Components vs Client Components vs hybrid; Server Actions vs Route Handlers for mutations; when to opt into `"use client"`.
- **Data fetching:** native `fetch` + Next cache vs React Query vs SWR; where to place Suspense boundaries; streaming vs full SSR.
- **State manageme