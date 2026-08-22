---
name: plan-context
description: "Stage 1 of the plan pipeline for phase and task modes. Consolidates decisions, prior phases and testing guidance into context.md. Use to start planning a phase or task or generate pipeline context."
---

# Plan Pipeline — Stage 1: Context

Consolidate the planning inputs into a lean, indexed `context.md`. This stage is a **pure consolidator** — it reads sources via subagents, produces a short structured artifact, and nothing else. It does not detect inconsistencies (that is `plan-validate`'s job), does not ask the user questions beyond slug confirmation and correlated-decisions confirmation, does not edit decisions docs.

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, slug discovery, `sources_mtime`, abort-with-command protocol, subagent dispatch, frontmatter format, read strategy rules). This file references those conventions by name without repeating them.

## Input handling

Detect mode from the argument format using the **unified slug lookup** defined in `plan-pipeline/SKILL.md` (Mode detection + Slug discovery). Slug is the pipeline's primary key (Decisão 2.3); integer `NN` remains a shortcut.

**Integer arg `NN`** → phase mode shortcut. Per `plan-pipeline/SKILL.md` → Slug discovery → Phase mode integer arg `NN`:

- Resolve via atomic Grep set-arithmetic (`S_phase ∩ S_NN`) — see `plan-pipeline/SKILL.md` for the canonical primitive and PCRE pattern. No per-file frontmatter iteration.
- Exactly 1 match → resolve to that slice's slug; target dir `docs/phases/phase-NN-{slug}/`.
- 0 matches → abort with canonical message: `"Run /research phase NN first"`.
- ≥2 matches → abort with canonical message: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`

**String arg `{slug}`** → unified slug lookup. Resolve via `docs/decisions/technical-decisions-{slug}.md`:

- Exists with `scope_type: phase` → **phase mode (slice)**. Extract `NN` from `related_phases[0]`; target dir `docs/phases/phase-NN-{slug}/`. The slice's `covers_capabilities` and `depends_on_slices` frontmatter (per `plan-pipeline/SKILL.md` → Phase slicing) drive downstream behavior (Step 0, Step 0.5, Step 1, Step 6).
- Exists with `scope_type: ad-hoc` → **task mode**. The companion `docs/tasks/task-{slug}/` directory may or may not exist yet; either way Step 1's directory bootstrap (`mkdir -p` per Phase mode item 2 / Task mode item 2 below) materializes it before any write. This explicitly covers the orphan ad-hoc case (`related_phases: []`): a decisions doc authored by `/research` with no companion task dir is accepted as a task-mode scope and the dir is auto-created, so the user can drive the doc through the pipeline (`/plan-context {slug} → /plan-validate {slug} → /plan-resolve {slug}`) without first hand-creating the task dir.
- Doc does not exist → **task mode bootstrap**: if arg matches `^[a-z0-9-]+$` treat as slug; otherwise treat as prose, auto-derive slug via kebab-case. Apply slug-collision disambiguation (Decisão #22) via `AskUserQuestion` before creating `docs/tasks/task-{slug}/`.

**Phase mode scope_prose source** (computed in Step 0):

- If the slice's decisions doc has `covers_capabilities` populated → join those bullets.
- Else (monolithic fallback) → capability bullets from `project-plan.md` for phase `NN`.

**Task mode scope_prose source:** inline prose from user (or `scope_description` from the task's decisions doc if slug match found). See Step 0 for the full source order (including partial-context.md recovery on rerun).

## Input (summary)

One argument: the target phase number `NN` (integer, phase mode) OR a task slug / prose (string, task mode).

## Preflight — abort-fast checks

Before any heavy work, in order:

### Phase mode

1. **Slug resolution** (per `plan-pipeline/SKILL.md` unified lookup):
   - **Integer arg `NN`:** resolve via atomic Grep set-arithmetic (`S_phase ∩ S_NN`) per `plan-pipeline/SKILL.md` → Slug discovery → Phase mode integer arg `NN`. No per-file frontmatter iteration. On 0 matches abort with `"Run /research phase NN first"`; on ≥2 matches abort with `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`; on 1 match record its slug.
   - **Slug arg:** read `docs/decisions/technical-decisions-{slug}.md` frontmatter; require `scope_type: phase`; extract `NN` from `related_phases[0]`.
   - Record slug and target directory `docs/phases/phase-NN-{slug}/`.

2. **Directory bootstrap**: ensure `docs/phases/phase-NN-{slug}/` exists (create it with `mkdir -p` if missing). Do not touch its contents yet.

3. **Testing guide availability (optional)**: for each subproject likely in scope (detected heuristically — for each affected subproject directory `<subproject>/`, look for the `testing-guide-{subproject}` Skill by name match), note whether the guide is available. Missing is not an abort; downstream stages handle it.

### Task mode

1. **Slug resolution + confirmation** (per `plan-pipeline/SKILL.md` task-mode slug discovery). Resolve slug via existing-match → auto-derive → confirm. Handle collision via `AskUserQuestion` before proceeding.

2. **Directory bootstrap**: ensure `docs/tasks/task-{slug}/` exists (create it with `mkdir -p` if missing). Do not touch its contents yet.

3. **Testing guide availability (optional)**: same heuristic as phase mode — if the task's scope prose mentions subproject directory identifiers, note whether the corresponding `testing-guide-{subproject}` Skill is available. Missing is not an abort.

## Procedure

### Step 0 — Pre-step: compute `scope_prose` before the parallel dispatch

`decisions-correlator` needs `scope_prose` as one of its inputs, and it runs in parallel with the other subagents. Compute it first:

- **Phase mode:** Step 0 performs up to 2 bounded reads:
  1. **Frontmatter of the slice's phase-scope decisions doc** (`docs/decisions/technical-decisions-{slug}.md`): check for `covers_capabilities`. If present → `scope_prose` = join those bullets (verbatim) into a single paragraph (bullet markers replaced by "; ").
  2. **`project-plan.md` phase bullets** — always read (bounded to the `### Fase NN` section): used for neighbors / deliverables / out-of-scope extraction by `plan-reader`, AND as the **monolithic fallback** for `scope_prose` when `covers_capabilities` is omitted from the slice's frontmatter.
  Both reads are bounded; main-thread context impact is negligible. `plan-reader` still runs in parallel for the full phase scope block (its output is the `## Phase NN — {title}` block, later restructured into context.md's `## Scope` section by Step 7); consumed after the parallel dispatch.
- **Task mode:** `scope_prose` = the user's inline prose (from the original input) OR, if slug discovery found an existing `docs/decisions/technical-decisions-{slug}.md`, the value of that doc's `scope_description` frontmatter field.

`scope_prose` is small — it is passed via the subagent prompt, not written to disk at this point.

### Step 0.5 — UI scope detection and inventory handling

Before the parallel dispatch, determine:

1. **UI scope detected?** Signals by mode:
   - **Phase mode:** UI signal fires when ANY bullet in the slice's `covers_capabilities` (or, as monolithic fallback when `covers_capabilities` is omitted, ANY phase bullet from `project-plan.md`) matches UI phrasing — `Tela`, `Página`, `Área`, `Login`, `UI` (case-insensitive substring). Note: UI detection now reads the slice's declared capabilities, NOT the phase-level `Affected subprojects:` (which is a neighbor-of-phase concept and doesn't discriminate between slices).
   - **Task mode:** scope prose mentions `Tela`, `tela`, `page`, `screen`, `componente`, `UI`, a route path (`/signup`, `/upload`, ...); OR an existing decisions doc for the task has TDs with `Scope: Frontend | Cross-layer`.
2. **If UI scope detected, does the inventory file exist?** Glob the mode-specific path:
   - Phase mode: `docs/inventories/screen-inventory-phase-NN-{slug}.md` (slug-exact existence check — the slice slug already resolved at preflight; ≥2 matches is structurally impossible under slug-exact lookup).
   - Task mode: `docs/tasks/task-{slug}/inventory.md` (existence check).
3. **If UI signal present AND inventory absent** → dispatch `AskUserQuestion` with 4 options:
   - **(a) Run /screen-inventory {arg} first** — behavior splits by mode to avoid deadlock:
     - **Phase mode:** clean abort with `"UI scope detected for phase NN but no inventory file found. Run /screen-inventory NN first, then rerun /plan-context NN."`. **No files written.** screen-inventory in phase mode reads scope from `project-plan.md` directly — no prior context.md needed.
     - **Task mode — bootstrap parcial:** write `docs/tasks/task-{slug}/context.md` containing only:
       ```yaml
       ---
       kind: task
       name: task-{slug}
       state: partial-awaiting-inventory
       sources_mtime: {}
       ---

       # task-{slug} — Context

       ## Scope

       {scope_prose verbatim}
       ```
       Create `docs/tasks/task-{slug}/` via `mkdir -p` first. Then abort with: `"Partial context.md written for task scope (state: partial-awaiting-inventory). Run /screen-inventory {slug} to create inventory, then rerun /plan-context {slug} to complete context.md with UI digest and all subagent-populated sections."`.
     - **Rationale (mode asymmetry):** phase mode does not need partial write because `project-plan.md` serves as scope source for screen-inventory. Task mode needs it because scope prose only exists in memory at this point; without partial write, deadlock (plan-context needs inventory; screen-inventory needs context.md's `## Scope`).
   - **(b) Proceed without inventory (UI↔API sync deferred)** — set internal flag `ui_deferred: true`. Continue without dispatching `inventory-digest-reader`. In Step 7 assembly, emit `## UI Inventory` with the single-line placeholder `_No screen inventory — UI↔API sync deferred. Run /screen-inventory {NN | slug} and then rerun /plan-context <arg> to activate UI checks._`. Context.md is written full (no `state: partial-awaiting-inventory` marker — deferred is a valid complete state). **Mode-agnostic:** same behavior in phase and task modes.
   - **(b') Logic-only — frontend-runtime architectural changes only (no new UI surface)** — set internal flag `ui_logic_only: true`. Continue without dispatching `inventory-digest-reader`. In Step 7 assembly, emit `## UI Inventory` with the logic-only placeholder body:
     ```
     _Frontend-runtime only — no screen inventory needed for this phase.
     Run /screen-inventory <arg> if a UI surface is added in a future revision._
     ```
     Context.md is written full (no `state: partial-awaiting-inventory` marker — logic-only is a valid complete state, parallel to deferred). **Use this when:** the phase only introduces FE-runtime architectural-transversal TDs (TanStack Query global setup, React Compiler, Suspense pattern, global cache strategy) and does NOT introduce any new screen. **Mode-agnostic:** same behavior in phase and task modes. **Token-anchor `_Frontend-runtime only —`** is mutually exclusive with the deferred placeholder's `_No screen inventory —` token by construction — `plan-build` Gate 9 inference disambiguates with two independent pattern tests.
   - **(c) Cancel** → abort `plan-context` with `"Cancelled by user. No files written."`. Clean exit. **Mode-agnostic.**
4. **If signal present AND inventory present** → dispatch normally; `inventory-digest-reader` is part of the parallel batch.
5. **If no UI signal** → skip UI handling entirely; no `## UI Inventory` section emitted at all in Step 7.

**Rerun semantics after partial write (task mode only):** when user reruns `/plan-context {slug}` after screen-inventory produced `inventory.md`, this stage detects `state: partial-awaiting-inventory` in the existing context.md frontmatter, treats it as a regular fresh run (overwrite completo), dispatches all subagents including `inventory-digest-reader`, and writes context.md full **without** the state marker. Marker absence signals a complete context.md.

**Promotion path — logic-only → ui-active.** Logic-only is NOT a one-way state. If the user later adds a UI surface to a previously-logic-only phase, the promotion path is: (1) run `/screen-inventory NN` (or `/screen-inventory <slug>`) — creates the inventory file from scratch; (2) rerun `/plan-context NN` (or `<slug>`) — regenerates context.md from scratch per this skill's idempotency invariant (see Hard rules), overwriting the logic-only placeholder with the populated UI digest and flipping `ui_in_scope` from `logic-only` to `true` by Gate 9 inference in the next `/plan-build`. This flip happens **by construction** of the skill's idempotency — no new code paths needed; doc here is purely informational so the reader knows the migration is supported.

**inventory-digest-reader dispatch invariant.** The agent `inventory-digest-reader` is **never** dispatched when the user picked option (b') logic-only. Step 1 dispatch list (below) gates it on `Step 0.5 determined UI scope present AND inventory file exists`; logic-only means user opted out of inventory → file is absent → dispatch is suppressed. The logic-only placeholder is emitted **directly by Step 7** assembly from the in-memory `ui_logic_only` flag, with no intermediation from the agent. This avoids ambiguity about which placeholder the agent would otherwise emit (the agent's legacy fallback when called with no file emits the deferred placeholder, which is the wrong text for logic-only).

**scope_prose recovery on rerun from partial (task mode only).** The Step 0 rule (`scope_prose = user inline prose OR decisions doc scope_description`) is extended with a **third source** for the rerun-from-partial case:

**Task mode scope_prose source order (updated):**
1. User inline prose from the original invocation arg (if provided).
2. `scope_description` field from `docs/decisions/technical-decisions-{slug}.md` frontmatter (if decisions doc exists).
3. **`## Scope` section of an existing partial context.md** — recovered via bounded `Grep -n '^## Scope$' docs/tasks/task-{slug}/context.md` + bounded read to the next `^## ` header (or EOF). **Fires only when**: context.md frontmatter has `state: partial-awaiting-inventory` AND sources (1) and (2) are both absent.

Order is (1) → (2) → (3); first available wins. Rationale: partial context.md's `## Scope` was written verbatim from the first run's captured scope_prose → recovering it on rerun is idempotent (same prose → same outputs modulo the newly-present inventory digest).

### Step 1 — Dispatch subagents in parallel

Issue all applicable subagent calls in a **single assistant message** with concurrent `Agent` tool uses.

**Phase mode — dispatch 5–6 subagents in parallel:**

- `subagent_type: plan-reader` (input: `NN`) — extracts phase scope + neighbors from `project-plan.md`.
- `subagent_type: decisions-reader` (input: `mode=phase`, `identifier={slug}`) — builds the TD index. Pass the slice slug resolved at Preflight (not the raw `NN`); the agent derives `NN` internally from the slice's `related_phases[0]`. The keep filter returns the phase-scope doc matching the slug plus all ad-hoc docs with `NN ∈ related_phases`.
- `subagent_type: decisions-detail-reader` (input: `mode=phase`, `identifier={slug}`) — extracts `**Recommendation:**` prose + `**Libraries:**` per decided TD of the current slice. Pass the slice slug (not `NN`); same rationale as decisions-reader above.
- `subagent_type: decisions-correlator` (input: `mode=phase`, `identifier={slug}`, `scope_prose`) — returns ranked shortlist of ad-hoc `related_phases: []` docs semantically relevant to this slice. Pass the slice slug (agent derives `NN` via `related_phases[0]`).
- `subagent_type: phases-reader` (input: `mode=phase`, `NN`, `slug`, `depends_on_slices=[...]`) — extracts Conventions to Match AND Inherited TD Details AND Inherited Deferred Capabilities (from prior phases). When `depends_on_slices` is non-empty, phases-reader additionally resolves sibling slice `context.md` + `library-refs.md` as inheritance sources (tagged `_(from slice {sibling-slug})_`), applying the maturity gate fro