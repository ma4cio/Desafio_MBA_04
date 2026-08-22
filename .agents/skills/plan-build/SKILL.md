---
name: plan-build
description: "Stage 4 of the plan pipeline. Checks context, clean validation and library references, then writes the executable plan with technical specifications and step implementations."
---

# Plan Pipeline — Stage 4: Build (orchestrator)

This file is the **dispatcher**. It runs preflight gates, decides which phase to execute, and hands off to a companion file:

- `phase-a.md` — scaffold + Technical Specifications + A5 pause.
- `phase-b.md` — SIs + Dependency Map + Deliverables (after A5 "Continue now", or as resume target).
- `phase-c.md` — append-mode (incremental delta builds when a fully-completed artifact exists).
- `templates/screen-si.md` — Screen SI Xa/Xb templates (read on demand from Phase B when `ui_in_scope: true`).
- `templates/tech-specs/*.md` — per-subsection Tech Specs templates (read on demand from Phase A4).

This skill is **main-writes**: the main thread reads `context.md`, decomposes scope into Step Implementations, expands Technical Specifications, and writes the final artifact via incremental `Edit` calls. The runtime is **2-phase + append**, with a pause point between Technical Specifications and Step Implementations — the format of the final file is **unchanged** (`## Step Implementations` precedes `## Technical Specifications` per the canonical artifact shape; sentinelas preserve section order during the split).

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, slug discovery, `sources_mtime` staleness, `status: clean|dirty` gate, frontmatter format).

---

## Input

One argument: phase number `NN` (integer, phase mode) OR task slug `{slug}` (string, task mode). Optional flag: `--rebuild` (forces fresh Phase A even when the artifact is already built — bypasses Phase C).

Mode detection follows `plan-pipeline/SKILL.md`:

- **Phase mode** (integer `NN`): resolve slug via phase-scope decisions-doc filter. On 0 matches abort with `"Run /research phase NN first"`. On ≥2 matches abort with `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` (list = slugs of all matched phase-scope docs). On exactly 1 match, proceed. Compute `{target_dir}` = `docs/phases/phase-NN-{slug}/`. Compute `{target_path}` = `docs/phases/phase-NN-{slug}/phase-NN-{slug}.md`.
- **Phase mode (slice slug)** (string matching a `scope_type: phase` doc): identifier IS the slice slug; `NN` is extracted from the doc's `related_phases[0]`. Same `{target_dir}` / `{target_path}` computation follows. Mode detection rules are defined in `plan-pipeline/SKILL.md`.
- **Task mode** (string `{slug}`): expect `docs/tasks/task-{slug}/` to exist; abort if missing: `"docs/tasks/task-{slug}/ not found. Run /plan-context {slug} first."`. Compute `{target_path}` = `docs/tasks/task-{slug}/task-{slug}.md`.

---

## Preflight — abort-fast checks

Run in order. Every check is O(1) or bounded; no full reads of `context.md`, `library-refs.md`, or decisions docs happen here. Any failed gate aborts immediately with an actionable next-command, never falls through.

### Gate 1 — Mode detection + slug discovery

Per `plan-pipeline/SKILL.md`. Output is `mode`, `identifier` (NN or slug), `slug`, `{target_dir}`, `{target_path}`.

### Gate 2 — context.md existence

Check `{target_dir}/context.md`. Abort with `"context.md not found for {phase NN | task {slug}}. Run /plan-context <arg> first."` if missing.

### Gate 3 — context.md frontmatter kind match

Bounded Read of the top `---` block. **Parse the full frontmatter into memory** — capture all standard fields (`kind`, `name`, `sources_mtime`) AND any transient-state markers (`state:` per `plan-pipeline/SKILL.md`'s Artifact frontmatter format). Infer `kind` per the reading rules in `plan-pipeline/SKILL.md` (rules 1–4). The inferred kind must match the detected input mode. Mismatch aborts with: `"context.md is a {inferred} artifact but you ran plan-build in {detected} mode."` Legacy phase artifacts with `phase:` integer and no `kind:` are accepted as phase mode via the `name:` prefix rules. Keep the parsed frontmatter in memory — downstream gates and Phase A/B/C reuse it without re-reading.

### Gate 3.5 — Partial context.md detection (Decisão #28, task mode only)

Reuse the frontmatter already parsed in Gate 3. If `state: partial-awaiting-inventory` is present → abort: `"context.md for task {slug} is partial (state: partial-awaiting-inventory — plan-context wrote minimum scope-only context for screen-inventory to read). Run /screen-inventory {slug} to create inventory, then rerun /plan-context {slug} to complete context.md before building."`. **No additional reads** — reuses Gate 3's parsed frontmatter.

### Gate 4 — validation.md existence

Check `{target_dir}/validation.md`. Abort with `"validation.md not found for {phase NN | task {slug}}. Run /plan-validate <arg> first."` if missing.

### Gate 5 — validation.md freshness

Bounded Read of the top `---` frontmatter block only. For every key in `sources_mtime`, `stat` and compare. Drift aborts: `"validation.md is stale relative to {source}. Run /plan-validate <arg> to reconfirm status before building."`

### Gate 6 — Status gate

From the validation.md frontmatter in memory:

- `status != clean` → abort: `"validation.md has {issue_count} open issues. Run /plan-resolve <arg>, then /plan-validate <arg>, then retry /plan-build <arg>."`
- `status: clean` → proceed.

### Gate 7 — library-refs requirement (targeted grep)

Run:

`Grep -nP '^\|.*\| decided \|.*\| [^—]' {target_dir}/context.md`

Interpret:
- **Zero matches** → `library_refs_required: false`.
- **≥1 match** AND `{target_dir}/library-refs.md` missing → abort: `"Libraries are decided in context.md's Decisions Index but {target_dir}/library-refs.md is missing. Run /plan-resolve <arg> to refresh the library cache before building."`
- **≥1 match** AND `library-refs.md` exists → `library_refs_required: true`.

The per-library coverage check happens later (Phase B step B2.5); this gate only guarantees the file exists when required.

**Cross-slice library-refs (slicing only).** When the current slice's phase-scope decisions doc declares `depends_on_slices: [<sibling-slug>, ...]`, library-refs lives at `docs/phases/phase-NN-{sibling}/library-refs.md`. For each sibling listed in `depends_on_slices`, check existence of `docs/phases/phase-NN-{sibling}/library-refs.md` AND check whether the sibling's phase-scope decisions doc has any **decided TD with non-empty `**Libraries:**`**. Concrete grep: `Grep -nP '^\*\*Libraries:\*\* (?![—\-]\s*$).+$' docs/decisions/technical-decisions-{sibling}.md` — a match line indicates a Libraries entry whose value is not `—`, not `-`, and not empty/whitespace. If there is ≥1 match, the sibling has decided TDs with non-empty Libraries.

- If sibling has **decided TDs with libraries** AND its `library-refs.md` is absent → **hard abort**: `"Sibling slice {sibling-slug} has decided TDs citing libraries but no library-refs.md at docs/phases/phase-NN-{sibling}/library-refs.md. Run /plan-resolve {sibling-slug} to materialize its library cache, then retry /plan-build {slug}."` This prevents a silent B4-step-3 dead-end where the current slice inherits a TD that cites a lib but the lib doc can't be found in any cache.
- If sibling has **no decided TDs with libraries** (all TDs pending, superseded, or cite no libraries) → missing `library-refs.md` is expected and NOT an abort. Proceed; the sibling contributes no library entries to aggregation.
- If sibling's `library-refs.md` exists → record its path in memory for Phase A1 / B4 step 3 aggregation.

### Gate 8 — Decisions Detail sections presence

Bounded grep on context.md:

`Grep -n '^## Decisions Detail$' {target_dir}/context.md`

Interpret:
- **Zero matches** → context.md is malformed or legacy. Abort: `"context.md for {phase NN | task {slug}} is in old format (no ## Decisions Detail section). Run /plan-context <arg> to regenerate it, then retry /plan-build <arg>."`
- **≥1 match** → proceed.

Note: this check does not verify `## Inherited Decisions Detail` because it may legitimately be empty (Phase 1 with no prior phases, or task mode with no inherited phase + no correlator-confirmed docs).

### Gate 9 — Inventory staleness check (when applicable)

Bounded grep on context.md:

`Grep -n '^## UI Inventory$' {target_dir}/context.md`

Interpret (the four pattern tests below are mutually exclusive by token-anchor construction; order of evaluation does not matter):

- **Zero matches** → no UI scope; `ui_in_scope: false`. Skip the rest of this gate.
- **≥1 match** — bounded read of the section body, then test the body content against two independent pattern tests:
  - **Body matches `_No screen inventory —[^_]*deferred[^_]*_`** → `ui_in_scope: deferred`; skip the staleness check (deferred state is legitimate).
  - **Body matches `_Frontend-runtime only —[^_]*_`** → `ui_in_scope: logic-only`; skip the staleness check (logic-only state is legitimate, parallel to deferred — user opted out of inventory because the phase only introduces FE-runtime architectural-transversal TDs and no UI surface). The token-anchor `_Frontend-runtime only —` is mutually exclusive with the deferred placeholder's `_No screen inventory —` token by construction (per `plan-context/SKILL.md` Step 0.5).
  - **Body has populated digest** (neither placeholder matched) → `ui_in_scope: true`. Extract the `**Source:** \`{path}\`` line via bounded read; `stat` that path; compare against `sources_mtime` entry in context.md frontmatter for the same key. If inventory file mtime is newer → abort: `"Screen inventory at {path} has been updated since context.md was generated. Run /plan-context <arg> to regenerate."`.

After this gate, `ui_in_scope` is one of `true | false | deferred | logic-only` and is held in memory through every phase.

### Gate 9.5 — Last-slice coverage gate (phase mode, slicing only)

Runs only in phase mode and only when the current phase has ≥2 `scope_type: phase` docs for `NN` (monolithic phases skip this gate entirely — no cross-slice gap is possible by construction).

Procedure:

1. Compute the slice set via atomic Grep set-arithmetic (`S_phase ∩ S_NN` per `plan-pipeline/SKILL.md` → Slug discovery → Phase mode integer arg). Subtract the current slug to get **siblings** = `(S_phase ∩ S_NN) \ {current-slug}`. No per-file iteration — Grep returns sets atomically.
2. For each sibling, check that a built artifact exists at `docs/phases/phase-NN-{sibling}/phase-NN-{sibling}.md`.
3. If at least one sibling has no built artifact → this slice is NOT the last; skip the coverage aggregation and proceed to Gate 10.
4. If every sibling has a built artifact → this slice IS the last. Bounded-read `covers_capabilities` frontmatter from self + every sibling; union the values; compare the union against the phase's capability bullets in `project-plan.md`. Extract the phase's bullets via bounded grep/read against the actual heading format used in `project-plan.md`: `Grep -n '^### Fase {NN_zero_padded} — ' docs/project-plan.md` → start line S; `Grep -n '^### Fase \|^## ' docs/project-plan.md` → next H2/H3 after S → end line E-1; Read S..E-1 and extract bullets matching `^- `. **`{NN_zero_padded}` is NN formatted as a 2-digit zero-padded string** (e.g., phase 2 → `02`, phase 10 → `10`). Single-digit NN MUST be padded; otherwise the grep silently matches nothing and the coverage gate trivially passes. (Plan-reader subagent dispatch is NOT allowed here — `/plan-build` default path forbids Agent dispatch per Hard rules.)
5. If any capability is uncovered by the union → hard abort: `"Phase NN has uncovered capabilities: <list>. Update covers_capabilities in at least one sibling's phase-scope doc, or add new slices via /research, before building the last slice."`
6. If the union covers every capability → proceed to Gate 10.

This gate is the hard-error counterpart of `plan-validate`'s Check 8 `MC-cross-N` advisory (per plan-pipeline slicing model — Phase-level coverage gate section).

### Gate 10 — Resume detection

Run a single grep covering both required sentinelas:

`Grep -nE '^<!-- (SIs will be written in Phase B|phase-a-complete) -->$' {target_path}`

The two sentinela strings are the **canonical literals** referenced from every phase file. Phase A (`phase-a.md` § A3) writes them; Phase A4.6 adds `<!-- phase-a-complete -->` (Phase A4.5 may inject `<!-- {rule-id}-pending -->` — canonical: `<!-- ccr-pending -->` — before A4.6 runs, when any rule from `docs/rules/plan-build/` aborts); Phase B (`phase-b.md` § B4-B6) consumes them. Any change to these literals must update Gate 10 AND every phase file together (validator flags inconsistency).

Resume to Phase B **only when both lines match**:
- `<!-- SIs will be written in Phase B -->` — confirms Phase B has not started writing SIs (B4 replaces this on the first SI).
- `<!-- phase-a-complete -->` — confirms Phase A finished cleanly (A4.6 writes this as A's last action, after A4.5's custom-rule dispatch passes without aborts). If Phase A errored mid-A4 OR a rule from `docs/rules/plan-build/` aborted in A4.5, this line is absent → not a valid resume state.

Branches:

- `{target_path}` does not exist → fresh Phase A (case 1).
- Both sentinelas present → skip Phase A; proceed to Phase B (resume case 2; Edit existing file, replacing sentinelas).
- Only `<!-- SIs will be written in Phase B -->` present (no `<!-- phase-a-complete -->`) → Phase A errored mid-A4 last run, OR a rule from `docs/rules/plan-build/` aborted with a `<!-- {rule-id}-pending -->` sentinel injected — partial Tech Specs are not trustworthy in either case (case 3); fresh Phase A (Write overwrites the half-built file, including any abort sentinel from the previous run; A4.5 then re-runs all rules against the freshly-rendered Tech Specs).
- Only `<!-- phase-a-complete -->` present (no SIs sentinela) → Phase B started and replaced the SIs sentinela (case 4); the file is mid-build but Phase B partially advanced. Fresh Phase A (Write overwrites).
- Neither sentinela present → file is a completed prior artifact (case 5); route to **Append-mode** (Phase C) by default, OR fresh Phase A when the user passed the `--rebuild` flag.

No `AskUserQuestion`, no parsing of frontmatter, no extra staleness check (staleness of `context.md` is covered by Gates 1–9 via `validation.md`).

---

## Phase dispatch

After Gate 10 determines the routing branch, Read the corresponding companion file before executing its procedure. The harness loads only `SKILL.md` at invocation; companion files are loaded on-demand at dispatch.

| Gate 10 outcome | Read | Then execute |
|---|---|---|
| Fresh Phase A (case 1) | `.claude/skills/plan-build/phase-a.md` | Phase A procedure (A1-A5) |
| Resume Phase B (case 2) | `.claude/skills/plan-build/phase-b.md` | Phase B procedure (B1-B7) |
| Fresh Phase A (cases 3-4 — partial-artifact recovery) | `.claude/skills/plan-build/phase-a.md` | Phase A procedure (Write overwrites the half-built file) |
| Append-mode (case 5, default) | `.claude/skills/plan-build/phase-c.md` | Phase C procedure (C1-C7) |
| Fresh Phase A (case 5 with `--rebuild`) | `.claude/skills/plan-build/phase-a.md` | Phase A procedure as fresh build |

**Same-session A→B continuation.** When the user picks "Continue now" at the A5 pause, Read `.claude/skills/plan-build/phase-b.md` before executing B1. The companion file is not auto-loaded by the harness — every cross-file procedure step requires an explicit Read. Phase B's B1 step is a no-op in this same-session continuation path (working memory from Phase A carries over).

---

## Output contract

Each phase file emits one of these terminal messages. The literal templates live here so every phase emits the same shape.

### Phase A pause (user picked "Stop here")

```
PHASE A DONE. Wrote scaffold + Technical Specifications ({comma-separated subsection names, or "none"}) for {phase NN | task {slug}}. Sentinelas in place: <!-- phase-a-complete --> + <!-- SIs will be written in Phase B --> + Dep Map / Deliverables. Next: rerun /plan-build {identifier} when ready (Gate 10 will detect both required sentinelas and skip straight to Phase B).
```

### Successful completion (Pha