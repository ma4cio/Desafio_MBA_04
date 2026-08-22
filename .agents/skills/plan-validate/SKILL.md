---
name: plan-validate
description: "Stage 2 of the plan pipeline. Reads context.md, detects gaps and conflicts, and produces validation.md with a clean or dirty verdict. Use after plan-context and after each resolution cycle."
---

# Plan Pipeline — Stage 2: Validate

Inspect context.md for coherence issues. Emit a fresh `validation.md` with per-section issue IDs and a `status: clean|dirty` verdict. Preserve the history of resolved issues across reruns.

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, issue IDs, `sources_mtime`, staleness abort, frontmatter format, read strategy). This file references them without repeating.

## Input

One argument: the target phase number `NN` (integer, phase mode) OR a task slug `{slug}` (kebab-case string, task mode). Mode detection per `plan-pipeline/SKILL.md`.

## Preflight — abort-fast checks

1. **Mode detection + identifier resolution** per `plan-pipeline/SKILL.md`. Phase mode resolves `{slug}` via phase-scope decisions-doc slug discovery; task mode expects `docs/tasks/task-{slug}/` to already exist. If task mode is detected but the dir does not exist, abort: `"docs/tasks/task-{slug}/ not found. Run /plan-context {slug} first."`

2. **Slug discovery (phase mode only)**. Per `plan-pipeline/SKILL.md` canonical abort messages:
   - On 0 matches: `"Run /research phase NN first"`.
   - On ≥2 matches with integer arg: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`
   - Slug-primary: when a slice slug is passed directly, lookup resolves the single matching phase-scope doc; only 0-match aborts apply.

3. **context.md existence**. If `docs/{phases|tasks}/{dir}/context.md` does not exist, abort: `"context.md not found for {phase NN | task {slug}}. Run /plan-context <arg> first."`

4. **context.md frontmatter kind check**. Bounded-read the frontmatter. **Parse the full frontmatter into memory** — capture all standard fields (`kind`, `name`, `sources_mtime`) AND any transient-state markers (`state:` per `plan-pipeline/SKILL.md`'s Artifact frontmatter format). Infer `kind` per the rules in `plan-pipeline/SKILL.md` (rule 1 → `kind:`; rule 2 → `name:` prefix `task-`; rule 3/4 → `name:` prefix `phase-`). Must match the detected input mode. If mismatch, abort: `"context.md is a {inferred} artifact but you ran plan-validate in {detected} mode. Check the argument and retry."`. Keep the parsed frontmatter in memory — Step 4.5 and Step 5 reuse it without re-reading.

4.5. **Partial context.md detection (Decisão #28, task mode only).** From the frontmatter just read in step 4, if `state: partial-awaiting-inventory` is present, abort immediately: `"context.md for task {slug} is partial (state: partial-awaiting-inventory — plan-context wrote minimum scope-only context for screen-inventory to read). Run /screen-inventory {slug} to create inventory, then rerun /plan-context {slug} to complete context.md."` This check runs before any body read of context.md — do not try to validate a partial artifact.

5. **context.md staleness** (shared convention). For each key in context.md's `sources_mtime`, `stat` the source and compare. If any source is newer than recorded → abort: `"context.md is stale relative to {source}. Run /plan-context <arg> to regenerate, then retry /plan-validate <arg>."`

6. **Prior validation.md** (optional). If `validation.md` already exists, read its frontmatter to recover the `issues:` list. The markdown body will be fully regenerated; the frontmatter preserves the audit trail.

## Scope of reads

Per shared convention, this stage reads **only** `context.md`. It does not re-read project-plan.md, prior phase docs, decisions docs, or testing-guide skills — those were consolidated into context.md by stage 1.

> **Load-bearing invariant — DO NOT extend this stage to cover specs / SIs.** plan-validate has NO knowledge of `**Test Specs:**` fields, `test_specs_aware: true` frontmatter, `<subproject>/specs/*.plan.md` files, or any `/plan-test-specs` machinery. Spec-related gates live exclusively in `/plan-test-specs` (delta report — Stage 5) and `/implement` preflight (MISSING / STALE / PENDING TEST SPECS aborts). Extending plan-validate to cover specs would create asymmetric responsibility between Stage 2 (validate) and Stage 5 (specs) — plan-validate would have to read artefacts não-existentes na sua timeline (specs só existem após Stages 3-5 rodarem). This invariant is documented in `docs/plan-spec-driven-test-skill.md` § "NO CHANGE — `.claude/skills/plan-validate/SKILL.md`" and was a deliberate decision of the 2026-05-02 grill session (Q10).

- **context.md** — Read in full. Contains all TD information needed for the coherence checks: `## Decisions Index`, `## Decisions Detail` (current-scope TDs), `## Inherited Decisions Detail` (inherited TDs), `## Inherited Conventions`, `## Inherited Deferred Capabilities` (informational-only), `## Testing Requirements`, **plus `## Capability Coverage` in phase mode only** (omitted entirely in task mode), **plus `## UI Inventory` (present-only when UI scope detected)** and **`## Non-UI / Deferred Capabilities` (always emitted in context.md regenerated post-integration — empty or populated; omitted in partial context.md per Decisão #28, which aborts this stage anyway via preflight state marker detection). **Legacy context.md pre-integration may lack `## Non-UI / Deferred Capabilities`** — treated as empty by this stage; absence never fires a false issue.

## Procedure

1. **Read context.md.** You are about to regenerate validation.md — having context.md fully in memory is the budget for this stage.

2. **Run the coherence checks** (below) AND any custom validation rules in `docs/rules/plan-validate/` (see `## Custom validation rules` further down). Each check is a focused pass; all checks AND all rules run before emitting the artifact. Built-in check IDs (`IC-N`, `AMB-N`, `MD-N`, `DG-N`, `ICC-N`, `OQ-N`, `UIG-N`, `CC-N`, `MC-cross-N`) and custom rule IDs (prefix declared in each rule body, e.g., `CSF-N`, `CXE-N`, …) all accumulate into the same `issues:` / `advisories:` lists; Step 3 (Merge with prior issue state) processes them uniformly. Accumulate findings into the applicable categories for the current mode:

   **Phase mode checks (8 categories; Check 8 is cross-slice and runs only when ≥2 phase-scope docs exist for NN):**
   - **Inconsistencies (`IC-N`)** — contradictions between sources.
   - **Ambiguities (`AMB-N`)** — scope described too vaguely to decompose into SIs.
   - **Missing Decisions (`MD-N`)** — a capability needs a strategic choice but no TD exists (both sub-types: "uncovered bullet" and "decision without TD"; plus the shared-types contract sync sub-type per Decisão #29).
   - **Dependency Gaps (`DG-N`)** — the phase depends on something from a prior phase that was not planned or delivered.
   - **Inherited Constraint Conflicts (`ICC-N`)** — a current-phase decision conflicts with an inherited TD.
   - **Unresolved Open Questions (`OQ-N`)** — pending TDs and open questions carried forward; extended to ingest `### Open Questions from Inventory` verbatim when UI scope is present.
   - **UI Coverage Gaps (`UIG-N`)** — capability has TD coverage but no verb in the inventory covering it (fires only when `## UI Inventory` is populated).
   - **Cross-slice Coverage (`CC-N` hard-error + `MC-cross-N` advisory)** — slicing-only; fires only when `count(phase-scope docs for NN) ≥ 2`. See Check 8. CC-N flips `status` to `dirty`; MC-cross-N is advisory (tracked under `advisories:` and does NOT flip status).

   Additionally in phase mode: **Capability coverage gate** — every bullet in `## Capability Coverage` must map to ≥1 TD. Uncovered bullets emit as `MD-N`.

   **Task mode checks (6 categories):**
   - **Inconsistencies (`IC-N`)** — same semantics, applied to the prose `## Scope` and TDs in `## Decisions Index` / `## Decisions Detail`.
   - **Ambiguities (`AMB-N`)** — same semantics, applied to the prose `## Scope` instead of capability bullets.
   - **Missing Decisions (`MD-N`)** — only "decision required by scope that no TD resolves". The "uncovered bullet" sub-type does NOT apply (tasks have no capability bullets). The shared-types contract sync sub-type is **phase mode only** (Decisão #29 not fired in task mode).
   - **Inherited Constraint Conflicts (`ICC-N`)** — same semantics.
   - **Unresolved Open Questions (`OQ-N`)** — same semantics; extended to ingest inventory Open Questions.
   - **UI Coverage Gaps (`UIG-N`)** — same semantics as phase mode (tasks can also have UI scope).

   **DG-N is never emitted in task mode.** Tasks have no phase-dependency lineage.

   **Task-mode advisory (Decisão #12):** if `MD-N` count `≥ 2` at the end of the checks, emit at the top of validation.md's `## Findings` section:
   ```
   _Advisory: N missing decisions detected. Consider running `/research {slug}` to batch-decide these open choices._
   ```
   This advisory is informational — it does NOT affect `status: clean|dirty`.

3. **Merge with prior issue state.** For each issue currently being emitted:
   - If an issue with the same `(category, summary)` tuple already existed in the prior `issues:` frontmatter with `status: resolved`, drop it — it has been addressed already.
   - Otherwise, assign it a fresh ID within its category (lowest unused `N`).
   - Preserve the prior `issues:` entries with `status: resolved` in the new frontmatter, and render them under `## Resolved Issues` in the body.

4. **Compute verdict.**
   - `status: clean` iff every issue in the frontmatter `issues:` list has `status: resolved`. The advisory (task mode, `MD-N ≥ 2`) does NOT block `clean` — verdicted status follows the resolved-issue list only.
   - Otherwise `status: dirty`.

5. **Fast path (task mode only, Decisão #13).** On the FIRST validate run for a task slug — i.e., no prior `validation.md` exists — validate returns `status: clean` if ALL of the following hold:
   - No decisions doc exists for the task slug (`docs/decisions/technical-decisions-{slug}.md` is absent), AND
   - No `IC-N` raised, AND
   - No `AMB-N` raised (the prose `## Scope` was specific enough that Check 2 flagged nothing), AND
   - No `MD-N` raised (no decision required that lacks a covering TD), AND
   - No `ICC-N` raised from correlated inherited TDs, AND
   - No `OQ-N` raised, AND
   - No `UIG-N` raised.

   If any check raises an issue OR a decisions doc exists, fast path does not apply — normal verdict computation runs. Fast path only affects the verdict; it does not change how checks are executed.

6. **Write `validation.md`** using the template below. Record `sources_mtime` for `context.md` and every decisions doc listed in context.md's `_Source files:_` subsection (or empty in task-sem-research). **If Check 8 ran (phase mode, ≥2 slices)**, additionally record `docs/project-plan.md` and every **sibling** phase-scope decisions doc (the other slices of NN, excluding self — self is already recorded via the standard `_Source files:_` path above) whose `covers_capabilities` was read by 8.a/8.b. Check 8 reads those files directly, so their mtimes must be tracked to surface staleness on subsequent reruns. Only new-to-Step-6 files (project-plan.md + siblings) require explicit addition here.

## Coherence checks

### Check 1 — Inconsistencies (`IC-N`)

Compare the scope against the TDs listed in `## Decisions Index`:

> **Note (decisions history model):** an `IC-N` does NOT always require a Supersede or new TD. When the user resolves the issue in `/plan-resolve` and the chosen option matches the existing decided letter (parameter/prose drift only), the resolution is classified as **Append revision** and `/plan-resolve` appends a `**Revisions:**` block to the existing TD instead of flipping its `Decision:` field. See `plan-resolve/SKILL.md` § "Per-issue action classification" → "Append revision to TD-YY". `/decide` is the alternative front-door for the same primitive when the user starts from a free-text need rather than from a validation issue. Validate's job here is unchanged — emit the IC-N; resolve decides the primitive.


- **Phase mode:** compare each capability bullet from `## Scope` against decided TDs. (Legacy context.md may use `## Phase Scope` — accept either heading during transition; the canonical heading is `## Scope`.)
- **Task mode:** compare the prose `## Scope` paragraph against decided TDs semantically.

Flag:

- Scope requires behavior X while a decided TD says "no X" (e.g., scope "email confirmation" while TDs decided "no mail service").
- Two decided TDs whose choices imply mutually exclusive runtime behavior.
- **Phase mode only:** a current-phase TD whose `Capability:` field cites a bullet not present in `## Scope` capabilities.

**UI ↔ Scope inconsistency (when `## UI Inventory` is populated):**

- If a verb in `## UI Inventory → UI ↔ Capability Join` cites a capability that is NOT present in the current phase/task scope:
  - **Phase mode:** capability string doesn't match any bullet in `## Capability Coverage` (verbatim or as a `Transversal — covers:` entry).
  - **Task mode:** capability string doesn't match any substring derivable from `## Scope` prose.
  Emit IC-N. Message is slicing-aware in phase mode:
  - **Phase mode, slice has `covers_capabilities` populated (sliced phase)** — 3 choices: `"Verb '{verb}' in inventory cites capability '{cap}' not present in current phase scope. Explicit choice: (a) update inventory to remove stale verb via /screen-inventory extension run; (b) claim the capability in this slice's covers_capabilities frontmatter (if the bullet already exists in project-plan.md but another slice owns it — transfer ownership); (c) add new capability to project-plan.md + include in this slice's covers_capabilities."`
  - **Phase mode, monolithic (no `covers_capabilities`)** — 2 choices: `"Verb '{verb}' in inventory cites capability '{cap}' not present in current phase scope. Explicit choice: (a) update inventory to remove stale verb via /screen-inventory extension run; (b) add capability to current scope (edit project-plan.md, then rerun /plan-context)."`
  - **Task mode** — 2 choices: `"Verb '{verb}' in inventory cites capability '{cap}' not present in current task scope. Explicit choice: (a) update inventory to remove stale verb via /screen-inventory extension run; (b) add capability to current scope (edit task prose, then rerun /plan-context)."`
- Rationale: catches drift where inventory was built against a different phase's scope (e.g., inventory from phase 02 reused for phase 03 without updating capability references).

**Scope-Subsection orphan (prevents TD from being silently lost in final artifact):**

- If `## Decisions Index` has any TD with `Scope: Frontend` (not `Cross-layer`, not `Backend`, not `Repo-wide`) AND `## UI Inventory` is absent or has the **deferred placeholder** (`ui_in_scope: false` or `ui_in_scope: deferred`):
  - Emit IC-N: `"TD {slug}/TD-NN has Scope: Frontend but phase/task has no active UI scope (UI Inventory absent or deferred). The TD would be orphaned in the final artifact (filtered out of backend subsections per Decisão #17; UI Contracts subsection not emitted). Explicit choice: (a) change TD Scope to 'Cross-layer' if the decision informs backend contracts as well; (b) add active UI scope (ensure /screen-inventory runs and user doesn't pick 'defer' option); (c) remove the TD if it's out of scope for this phase/task; (d) mark TD as Renders in: frontend-runtime + flip UI Inventory to logic-only via /plan-resolve (use when the TD is FE-runtime architectural-transversal — TanStack Query global, React Compiler, Suspense pattern — and the phase has no UI surface)."`
- Rationale: without this check, Frontend TD in backend-only phase is filtered from Data Model/API Contracts (Scope mismatch) AND UI Contracts does not exist to render it → TD silently orphaned.
- **Does NOT fire for `Scope: Cross-layer`** — Cross-layer TDs legitimately appear in backend subsections even without UI, via API Contracts that may expose a contract prepared for future UI.
- **The `### API Contracts` BFF tier does NOT change this orphan logic.** The BFF tier (per `plan-build/phase-a.md` § A2's "`### API Contracts` 