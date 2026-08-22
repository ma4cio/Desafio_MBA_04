---
name: plan-pipeline
description: "Entry point and shared conventions for the plan pipeline (phase and task modes). Invoke directly when the user asks about planning without specifying a stage — this skill orients them to the pipeline stages (context → validate → resolve → build → specs [optional]). For actual work, use the stage skills: plan-context, plan-validate, plan-resolve, plan-build, plan-test-specs."
---

# Plan Pipeline Overview

Planning is a pipeline of up to **five stages** that works for both project phases and ad-hoc tasks. Each stage is a separate skill with one responsibility and one artifact. Stages 1-4 (context → validate → resolve → build) are the canonical happy path; Stage 5 (`/plan-test-specs`) is optional and only fires when the build emitted spec placeholders. The stages share the conventions defined below — every stage skill references this document instead of repeating them.

```
/research [opcional em task mode]       → docs/decisions/technical-decisions-{slug}.md
/plan-context <NN | slug | "prose">     → docs/{phases|tasks}/{dir}/context.md
/plan-validate <NN | slug>              → docs/{phases|tasks}/{dir}/validation.md
/plan-resolve <NN | slug>               → edits decisions doc + context.md + validation.md + library-refs.md
/plan-validate <NN | slug>              → re-run until status: clean
/plan-build <NN | slug>                 → docs/{phases|tasks}/{dir}/{name}.md
/plan-test-specs <NN | slug>                 → <subproject>/specs/<scenario>.plan.md
```

When the user asks generically to "plan phase NN" or "plan this task", direct them to `/plan-context <arg>` first. Each stage aborts with an explicit next-command when a precondition is missing, so the pipeline self-guides once started.

**Alternative front-door — `/decide`.** When the user input is a free-text need rather than a structured pipeline argument (e.g., "quero mudar X", "tem decisão sobre Y?"), route them to `/decide "<need>"` instead. `/decide` triages against existing `docs/decisions/*.md`, then either applies an inline Revision OR directs the user back to `/research` (Supersede / Greenfield) or to specific pipeline stages via its impact report. The pipeline stages above are the right entry when the input is already shape-matched (phase NN, slice slug, task slug); `/decide` is the right entry when shape detection is the user's question.

**`/plan-build` append-mode.** When `/plan-build <scope>` is invoked and a plan file already exists in the scope dir, the skill defaults to **append-mode** (incremental delta processing — see `plan-build/SKILL.md` § "Phase C — Append-mode"). To force the legacy fresh-rebuild behavior, pass `--rebuild`. Append-mode requires `progress.md` to exist (created automatically on first build).

## Mode detection

Every stage skill detects the mode from the argument format. Phase slicing means ≥2 `scope_type: phase` decisions docs may exist for the same `NN`; the integer shortcut still works but now aborts when ambiguous, and **slug is the pipeline's primary key** (Decisão 2.3).

- **Integer arg `NN`** → **phase mode shortcut** — see "Slug discovery → Phase mode integer arg" below for the resolution algorithm.
- **String arg `{slug}`** → **unified slug lookup**. Resolve via `docs/decisions/technical-decisions-{slug}.md`:
  - Exists with `scope_type: phase` → **phase mode** (slice). Extract `NN` from `related_phases[0]`; target dir is `docs/phases/phase-NN-{slug}/`.
  - Exists with `scope_type: ad-hoc` AND `docs/tasks/task-{slug}/` exists → **task mode**.
  - Doc does not exist → **task mode bootstrap** (treat arg as slug if it matches `^[a-z0-9-]+$`; otherwise treat as prose and auto-derive a slug, kebab-case, max 40 chars, confirming with the user before creating `docs/tasks/task-{slug}/`).

**Canonical abort messages** (downstream skills MUST use these verbatim so the same condition produces the same message everywhere):

- **0-match (integer arg):** `"Run /research phase NN first"`
- **≥2-match (integer arg):** `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`

Phase and task modes share every artifact shape (`context.md`, `validation.md`, `library-refs.md`, `{name}.md`, `progress.md`), differing only in sources of input, one section (`## Capability Coverage` — phase-only), and a few validate checks. Only `plan-context` in task mode may bootstrap the `docs/tasks/task-{slug}/` directory; all later stages assume it already exists.

## Stage responsibilities (one-line each)

- **plan-context** — consolidates sources (project-plan, decisions docs tied to the phase, prior phases, testing guide) into a lean `context.md`. Pure consolidator; **does not detect issues**; aborts on hard violations (missing/duplicate phase-scope doc).
- **plan-validate** — reads `context.md` + the decisions doc, regenerates `validation.md` with issues by category and a `status: clean|dirty` verdict.
- **plan-resolve** — reads `validation.md`, asks the user (batched), applies decisions to the decisions doc + patches `context.md` + marks issues resolved. Writes `library-refs.md` when a new library is decided.
- **plan-build** — reads `context.md` (lean) and `library-refs.md`, emits the final `phase-NN-{slug}.md` artifact. Hard-blocks when validation.md is not `clean`.
- **plan-test-specs** — *(optional, post-build)* reads the plan artifact, derives `<subproject>/specs/<scenario>.plan.md` files for screen-wiring / controller-wiring / cross-layer SIs (in Microsoft spec-driven format). Frontend specs are consumed by `/implement` Step 3a (which loads the `playwright-cli` Skill for Playwright pattern reference, then LLM-authors the `.spec.ts`); backend specs guide LLM-authoring of E2E tests using the backend subproject's testing conventions (no external Skill load at 3a — the `testing-guide-{subproject}` Skill loaded earlier at Step 2 informs what-to-test and best practices per artifact). Skippable when the plan is legacy (no `test_specs_aware: true` frontmatter) or has no SI carrying `**Test Specs:**` field.

## Stage 5 — Test Specs (optional)

Stage 5 is **opt-in** and runs only when the plan satisfies all three triggers:

1. The plan file already exists in the scope dir (Stages 1-4 ran).
2. The plan frontmatter declares `test_specs_aware: true` (modern build — emitted by `plan-build/phase-a.md` post-migration).
3. At least one SI carries a `**Test Specs:**` field (i.e. the plan has screen-wiring / controller-wiring / cross-layer SIs that warrant external scenario authoring).

When any trigger fails the skill exits with an actionable message — see `plan-test-specs/SKILL.md` § "Preflight" for the full decision table. Backend-pure phases without server-connected UI legitimately skip this stage; legacy plans (built before this migration) skip it indefinitely without forcing migration.

`/plan-test-specs` is also the **canonical re-stamp pass** after `/plan-build` append-mode (Phase C). C5 refreshes `sources_mtime` on the plan, which makes `mtime(plan) > Last sync(spec)` for every PRESERVED scenario; running `/plan-test-specs` re-stamps `Last sync` per scenario so `/implement`'s preflight does not falsely abort STALE. See `plan-test-specs/SKILL.md` § "Lifecycle states" for details.

## Directory layout

```
docs/
├── project-plan.md                          # source for phase capabilities
├── decisions/
│   └── technical-decisions-{slug}.md        # owned by research; mutated by resolve
├── inventories/
│   ├── screen-inventory-phase-NN-{slug}.md           # owned by screen-inventory; read-only to plan-*
│   └── screen-inventory-phase-NN-{slug}.progress.md  # owned by screen-inventory
├── phases/
│   ├── phase-NN-{slug-a}/                  # slice A of phase NN (≥1 per NN; slicing model)
│   │   ├── context.md                       # owned by plan-context
│   │   ├── validation.md                    # owned by plan-validate
│   │   ├── library-refs.md                  # owned by plan-resolve (optional)
│   │   ├── progress.md                      # owned by implement (optional)
│   │   └── phase-NN-{slug-a}.md             # owned by plan-build
│   └── phase-NN-{slug-b}/                  # additional slices (optional — monolithic phases have 1)
└── tasks/
    └── task-{slug}/
        ├── context.md                       # owned by plan-context
        ├── validation.md                    # owned by plan-validate
        ├── library-refs.md                  # owned by plan-resolve (optional)
        ├── inventory.md                     # owned by screen-inventory (optional); read-only to plan-*
        ├── inventory.progress.md            # owned by screen-inventory (optional)
        ├── progress.md                      # owned by implement (optional)
        └── task-{slug}.md                   # owned by plan-build
```

Every artifact is **owned by exactly one stage**. Other stages may read or patch it (e.g., resolve patches context.md), but never recreate it from scratch.

## Shared convention — Slug discovery

Every stage skill needs the slug for its artifacts. Under the slicing model, **≥1 `scope_type: phase` docs may exist per `NN`** (one per slice). Discovery is **automatic** and mode-dependent:

### Phase mode integer arg `NN`

**Use atomic Grep set-arithmetic** — no per-file frontmatter iteration. Tool semantics make set computation complete by construction (Grep cannot silently skip files; it processes the entire input atomically). This is the canonical primitive used across `decisions-reader`, `decisions-detail-reader`, `plan-validate` Check 8, and `plan-build` Gate 9.5 — all of which reference back to this section.

1. `Grep -l '^scope_type: phase$' docs/decisions/technical-decisions-*.md` with `output_mode: files_with_matches` → set `S_phase` (every phase-scope decisions doc on disk).
2. `Grep -l '^related_phases:\s*\[(?:[^\]]*[,\s])?{NN}(?=[,\s\]])' docs/decisions/technical-decisions-*.md` with `output_mode: files_with_matches` (line-anchored ripgrep regex; **no `multiline` flag needed** — `^` matches line start in line-by-line mode by default; `{NN}` is the literal integer; trailing lookahead `(?=[,\s\]])` avoids consuming the closing `]`, correctly matching `[NN]` / `[..., NN]` / middle positions and rejecting `[12]` / `[21]` / `[]` for NN=2 — see `decisions-reader.md` for the test verification table). Result: set `S_NN`.
3. **Match set = `S_phase ∩ S_NN`** (intersection: phase-scope docs whose `related_phases` contains NN).
4. Match resolution:
   - **Exactly one match** → extract slug from filename `technical-decisions-{slug}.md`; target directory `docs/phases/phase-NN-{slug}/`.
   - **Zero matches** → abort with canonical message: `"Run /research phase NN first"`.
   - **Two or more matches** → abort with canonical message: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` (where `<list>` is the comma-separated slugs of the matching docs).

### Phase mode — slug arg (primary)

1. Read `docs/decisions/technical-decisions-{slug}.md` frontmatter.
2. Require `scope_type: phase` and a single integer in `related_phases`.
3. Extract `NN` from `related_phases[0]`; target directory `docs/phases/phase-NN-{slug}/`.

### Task mode (slug or prose)

1a. If arg matches the slug pattern `^[a-z0-9-]+$` AND `docs/decisions/technical-decisions-{arg}.md` exists with `scope_type: ad-hoc` → use that slug.
1b. If arg matches the slug pattern AND `docs/tasks/task-{arg}/` exists → use that slug.
1c. Otherwise, treat arg as prose; auto-derive slug via kebab-case, max 40 chars (strip stop words, lowercase, replace non-alphanumeric with `-`, collapse repeated dashes, trim).
1d. **Slug-collision disambiguation (Decisão #22).** If the auto-derived slug (or a slug passed literally) collides with an existing `docs/tasks/task-{slug}/` or `docs/decisions/technical-decisions-{slug}.md` whose scope does not obviously match the input, dispatch `AskUserQuestion` presenting two options: (a) reuse the existing slug; (b) create a new differentiated slug (ask the user to supply it). Resolve the collision before proceeding — no subagent dispatch and no filesystem writes happen before the user confirms.
1e. Confirm the chosen slug with the user via a simple `AskUserQuestion` before creating `docs/tasks/task-{slug}/`.
2. Target directory: `docs/tasks/task-{slug}/`.
3. Decisions doc may or may not exist (research is optional in task mode).

## Shared convention — Staleness via `sources_mtime`

Every artifact (`context.md`, `validation.md`, `library-refs.md`) carries a `sources_mtime:` dict in its frontmatter listing every upstream file it was built from, with the source's mtime at build time.

**Before any stage reads a prior artifact, it checks `sources_mtime`:**

- For each key, `stat` the file and compare mtime against the recorded value.
- If **any** source has a newer mtime than recorded → abort with:
  `"{artifact} is stale relative to {source} (recorded: X, current: Y). Run /plan-context NN to regenerate context before proceeding."`

**Never auto-regenerate.** Staleness always aborts with an explicit next-command. This keeps every regeneration user-triggered and predictable — the user's original pain was silent re-reads; this rule prevents them.

Populate `sources_mtime` by running `stat -c '%y' <file>` (or `ls -l --time=full`) when building each artifact and recording ISO-8601 timestamps.

## Shared convention — `status: clean|dirty` gate

`validation.md` frontmatter carries `status: clean | dirty`:

- `clean` — every issue in `issues:` has `status: resolved`; `## Findings` sections are empty.
- `dirty` — at least one issue is open.

`plan-build` hard-blocks on `status != clean` with:
`"validation.md has N open issues. Run /plan-resolve NN, then /plan-validate NN, then retry build."`

## Shared convention — Issue IDs

`validation.md` issues use per-section stable IDs:

| Section | ID prefix | Meaning |
|---------|-----------|---------|
| Inconsistencies | `IC-N` | Contradictions between documents |
| Ambiguities | `AMB-N` | Capability or scope described too vaguely |
| Missing Decisions | `MD-N` | Decision required but no TD exists |
| Dependency Gaps | `DG-N` | Missing prerequisite from prior phase (phase mode only) |
| Inherited Constraint Conflicts | `ICC-N` | Current-phase decision conflicts with inherited TD |
| Unresolved Open Questions | `OQ-N` | Questions surfaced by research or earlier work |
| UI Coverage Gaps | `UIG-N` | Capability has TD coverage but no covering verb in screen inventory (fires only when `## UI Inventory` is populated) |
| Missing Capability (cross-slice) | `MC-cross-N` | Phase capability not covered by any slice's `covers_capabilities`. Phase mode only, fires only when ≥2 phase-scope docs per NN. Advisory in plan-validate (does not flip status to dirty); hard-error in plan-build on last slice. |
| Capability Consistency | `CC-N` | A `covers_capabilities` entry does not match any bullet in `project-plan.md` verbatim. Phase mode only (slicing). Hard-error — flips status to dirty. Surfaced early (before cross-slice advisory) to catch typos and stale bullets. |

IDs are sequential within their section, never reused. Resolved issues keep their ID and move to `## Resolved Issues` at the end of `validation.md` with `resolved_by:` pointing to the TD (or action) that closed them.

Frontmatter mirrors this:

```yaml
status: dirty
issue_count: 1          # number of issues with status: open
issues:
  - id: AMB-1
    status: open
    summary: "<≤80-char headline>"
  - id: MD-1
    status: resolved
    summary: "<≤80-char headline>"
    resolved_by: auth/TD-11
```

## Shared convention — Abort-with-command protocol

When a stage cannot proceed, it **aborts with an explicit command the user can copy-paste**. Always of the form:

```
{one-sentence explanation of what's missing/wrong}. Run {command} {args} first.
```

Never guess, never auto-recover, never partially proceed. The pipeline is deterministic and observable — every state transition is a command, every failure points to the next one.

## Shared convention — Subagent delegation