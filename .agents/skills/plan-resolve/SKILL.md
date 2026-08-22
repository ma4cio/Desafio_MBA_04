---
name: plan-resolve
description: "Stage 3 of the plan pipeline. Resolves validation issues, updates decisions and context, and records verified library references. Use after plan-validate reports dirty."
---

# Plan Pipeline — Stage 3: Resolve

Close the open issues in `validation.md` by asking the user and materializing answers into the decisions doc + context.md + validation.md. Fetches fresh docs via Context7 for any library that was newly decided in this cycle and caches them in `library-refs.md`.

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, issue IDs, abort-with-command protocol, read strategy). This file references them without repeating.

## Input

One argument: **slice slug** `{slug}` (primary) OR phase number `NN` (integer shortcut) OR task slug `{slug}` (string, task mode). Mode detection per the unified slug lookup in `plan-pipeline/SKILL.md`:

- **Integer `NN`** → phase mode shortcut. Resolves to the single phase-scope decisions doc for `NN` if exactly one exists; aborts with the canonical messages when 0 or ≥2 exist (see plan-pipeline/SKILL.md's canonical abort messages — `"Run /research phase NN first"` for 0, `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` for ≥2).
- **String `{slug}`** → unified slug lookup against `docs/decisions/technical-decisions-{slug}.md`. Phase-scope match → phase mode (slice); ad-hoc match with `docs/tasks/task-{slug}/` present → task mode.

## Preflight — abort-fast checks

1. **Mode detection + target-dir resolution.** Phase mode resolves `{slug}` via phase-scope decisions-doc discovery; task mode reads `docs/tasks/task-{slug}/`. If the expected dir does not exist, abort with the standard "run /plan-context first" message.

2. **validation.md existence**. If absent, abort: `"validation.md not found for {phase NN | task {slug}}. Run /plan-validate <arg> first."`

3. **validation.md status gate** — bounded Read of the frontmatter only:
   - `status: clean` → check the **library-cache carve-out** before aborting:
     - If `docs/phases/phase-NN-{slug}/library-refs.md` (or `docs/tasks/task-{slug}/library-refs.md`) is **absent** AND the scope's decisions doc has at least one **decided** TD with a non-empty `**Libraries:**` entry (bounded grep `^\*\*Libraries:\*\* ` on the decisions doc, filtering out values that match `^\*\*Libraries:\*\* [—\-]?\s*$`) → proceed in **library-cache-only mode**: skip Step 1–4 (no open issues to resolve, no frontmatter flips, no context.md rewrites) AND execute only Step 5's library cache materialization (WebFetch + write `library-refs.md` + cross-scope byte-copy for ad-hoc libs). Write-back: (a) `validation.md` — `status` unchanged (remains `clean`); only the `sources_mtime` frontmatter is refreshed to add the new `library-refs.md` entry. (b) `context.md` — also add/refresh the `library-refs.md` entry in its `sources_mtime` frontmatter (`stat -c '%y'` the new file and write the ISO-8601 timestamp). Both refreshes are mandatory; skipping context.md's refresh leaves the next `/plan-build` or `/plan-validate` run seeing `library-refs.md` as newer than context.md's recorded mtime and aborting with a spurious staleness error. Rationale: enables first-time cache materialization for a slice that was validated clean before any resolve run, and especially for slices whose siblings need the cache (see `plan-build/SKILL.md` Gate 7 sibling check).
     - Otherwise → abort: `"validation.md is already clean — nothing to resolve. Run /plan-build <arg> to generate the plan."`
   - `status: dirty` → proceed (full resolve path).

4. **validation.md staleness check** — (reuse the frontmatter from step 3). For every key in `sources_mtime`, `stat` the source and compare. If any source has drifted newer → abort: `"validation.md is stale relative to {source}. Run /plan-validate <arg> to reconfirm status before resolving."`

## Scope of writes

This stage is the **only** writer of:

- **`docs/decisions/technical-decisions-{slug}.md`** — fills `**Decision:**` fields; injects `<!-- status: superseded-by: {slug}/TD-NN -->` markers. **Task mode only:** may also *create* this file on-the-fly when the task-sem-research case surfaces `MD-N` issues (see Input handling → "task-sem-research inline create" below).
- **`docs/{phases|tasks}/{dir}/context.md`** — patches the `Decisions Index` row for each newly decided or superseded TD AND refreshes the matching `sources_mtime` frontmatter entries for every decisions doc edited in this run.
- **`docs/{phases|tasks}/{dir}/validation.md`** — moves issues from open to resolved (frontmatter `status`, body section).
- **`docs/{phases|tasks}/{dir}/library-refs.md`** — creates or updates when a new library is decided; its `sources_mtime` entries must be fresh from `stat`, not guessed.

It **never** touches project-plan.md or prior phase artifacts. Supersede markers (`<!-- status: superseded-by: {slug}/TD-NN -->`) and `**Revisions:**` blocks may be injected into **any** decisions doc (phase-scope or ad-hoc) when the inferred action requires it — see "Per-issue action classification" below. The marker syntax and position (immediately after the TD heading) are identical in both doc types; the `**Revisions:**` block syntax and position (after `**Libraries:**`, before `---`) follow `research/SKILL.md` § "Revisions block".

## Input handling — task-sem-research inline create (task mode)

In task mode, the decisions doc may not exist yet (task created without `/research`). When `plan-validate` emitted `MD-N` issues requiring a decision, resolve can create the decisions doc on-the-fly:

1. On the **first `MD-N` resolved**, check whether `docs/decisions/technical-decisions-{slug}.md` exists.
2. If it does NOT exist:
   2a. Dispatch `AskUserQuestion` to determine `related_phases`:
       > Is this task related to a specific phase?
       > - No, standalone task (default → `related_phases: []`)
       > - Yes, phase NN (if yes, a follow-up question asks for NN → `related_phases: [NN]`)
   2b. Create the decisions doc with frontmatter:
       ```yaml
       ---
       scope_type: ad-hoc
       related_phases: []          # or [NN] from 2a
       status: decided              # TDs born here are already decided
       date: <today ISO>
       scope_description: "{task ## Scope prose}"
       ---
       ```
3. Append the TD to the body in the same format `research/SKILL.md` uses (`## TD-N: <name>`, `**Scope:**`, `**Trigger:**` when `related_phases: []` OR `**Capability:**` when `related_phases: [NN]`, `**Context:**`, `**Options:**`, `**Recommendation:**`), with **`**Decision:**` already filled** (the user's answer from `AskUserQuestion`). **Never write `_[pending]_`** in a TD born here — the decision is made at creation time.
4. Update `sources_mtime` in context.md / validation.md to include the newly-created decisions doc (per `stat`).
5. Subsequent `MD-N` resolutions in the same run append to the same file. `related_phases` stays unchanged — step 2a's `AskUserQuestion` only runs once, on first creation.

If the user chooses to abort rather than resolve inline (e.g., to run `/research` first), no file is created; validation.md stays dirty and the stage emits:
`"Aborted MD-N resolution on request. Run /research {slug}, then /plan-context {slug}, then /plan-validate {slug}, then /plan-resolve {slug} to continue."`

## Procedure

### Step 1 — Inventory open issues

Read `validation.md` in full (it is bounded by design). Collect every issue with `status: open`, grouped by category. Record each issue's ID, summary, and the `Explicit choice:` clause (which is the action a resolution must take).

### Step 2 — Handle `MD-N` issues (mode-dependent)

**Phase mode — abort-fast.** Missing Decisions cannot be resolved by this stage in phase mode — they require research (options, pros/cons, recommendations). For every `MD-N` in the open set:

- Emit: `"Issue MD-N requires a new technical decision (<topic>). Run /research <topic> with related_phases=[NN], then /plan-context NN to reaggregate, then /plan-validate NN to reconfirm, then /plan-resolve NN to continue."`

If at least one `MD-N` is present in phase mode, abort after listing them — do not proceed to `AskUserQuestion` for the other categories. The user must add the TDs first; re-entering the cycle brings them back here with a cleaner queue.

**Task mode — inline resolution allowed.** Task mode MD-N issues may be resolved inline via the "task-sem-research inline create" flow above. For each `MD-N`:

1. Build a 2-4-option `AskUserQuestion` for the decision, labeling options with short names and optionally a brief description of each. If the issue's `Explicit choice:` clause lists options verbatim, use them.
2. On the first accepted answer, run the "task-sem-research inline create" procedure (create decisions doc if missing, set `related_phases` once).
3. Append a TD to the doc with the chosen option filled into `**Decision:**`.
4. Add a `**Libraries:**` line if the chosen option implies specific libraries.
5. If the user chooses "defer — run /research first" for any `MD-N`, abort with the /research instruction (same shape as phase mode's abort) and do NOT create the decisions doc for the deferred issue.

After task-mode `MD-N` handling (inline-resolved or deferred), proceed to Step 2.5 for UIG-N, then Step 3 for remaining categories.

### Step 2.5 — Handle `UIG-N` issues

For each open `UIG-N`:

1. Build `AskUserQuestion` with a multi-choice question — option labels encode both the decision AND a pre-defined rationale bucket (since `AskUserQuestion` is choice-based and does NOT support free-form text input):
   - **(a) Run /screen-inventory extension run** (add verb to inventory) → `answers[UIG-X] = {choice: 'extension_run'}`.
   - **(b) Non-UI — backend service only** (no UI surface required) → `answers[UIG-X] = {choice: 'non_ui', rationale: 'backend_service'}`.
   - **(c) Non-UI — admin/internal only** (user-facing UI not part of this phase) → `answers[UIG-X] = {choice: 'non_ui', rationale: 'admin_only'}`.
   - **(d) Non-UI — other (I'll add details manually to context.md)** → `answers[UIG-X] = {choice: 'non_ui', rationale: 'other'}`; resolve writes `Rationale: _[manual — edit context.md to add details]_` and user edits after the run finishes.
   - **(e) Defer UI to next phase** → `answers[UIG-X] = {choice: 'deferred', rationale: 'deferred_to_next_phase'}`.
2. The `rationale` string is written verbatim into the `Rationale` column of `## Non-UI / Deferred Capabilities` when Step 4 applies the edit. For the "other" case, the placeholder invites manual follow-up; `plan-validate` does not re-raise the UIG-N because the issue is marked resolved in validation.md regardless of rationale quality.
3. Continue with other categories. Apply UIG-N edits in Step 4 after all answers collected.

**If any UIG-N answer is `extension_run`, the abort is emitted in place of Step 6's next-command, AFTER Step 4 has applied all other edits** (distinct ordering from phase-mode MD-N abort, which fires at Step 2 before any edits). Abort message:
`"UIG-N resolution requires running /screen-inventory {NN | slug} (extension run) to add verb for capability '{cap}'. After that, run /plan-context <arg>, /plan-validate <arg>, /plan-resolve <arg>. Other non-UIG-N resolutions from this run have been applied and persisted."`

Unlike phase-mode MD-N, resolve DOES apply edits from all other resolutions before aborting:
- All non-UIG-N categories (IC-N, AMB-N, DG-N, ICC-N, OQ-N) — their edits are applied in Step 4.
- **Other UIG-N issues in the same run** that chose (b)/(c)/(d)/(e) — their edits are also applied (rows appended to `## Non-UI / Deferred Capabilities` in Step 4).
- **Only the specific UIG-N with `extension_run` choice is left unresolved** — its resolution requires running `/screen-inventory` externally.

Rationale: there's no dependency between non-UI resolutions and the extension run; letting the other edits land lets the user make incremental progress before the next `/screen-inventory` cycle.

### Step 3 — Build question batches for remaining categories

Remaining categories to resolve: `IC-N`, `AMB-N`, `DG-N`, `ICC-N`, `OQ-N`.

For each open issue, construct a question with:

- **Header**: the issue ID (e.g., `AMB-2`).
- **Body**: the issue's summary + the `Explicit choice:` text from validation.md.
- **Options**: derived from the issue text when explicit (e.g., two options listed in the `Explicit choice:` clause). If not explicit, include at minimum: (a) a concrete resolution the stage can apply via edits; (b) "defer — keep issue open" when the answer is genuinely external.

**Two-pass resolve** (per `plan-pipeline/SKILL.md` soft preference):

- **Pass 1 — Collect all answers.** Call `AskUserQuestion` in batches of up to 4 questions per call, sequentially until all open non-MD issues are asked. Collect every answer into an in-memory mapping `answers[issue_id] = {choice, target_td (if applicable), notes}`. Do not perform any Edit between `AskUserQuestion` calls.
- **Pass 2 — Apply edits.** After all answers are in, translate them into edit tuples and apply (see Step 4).

### Step 4 — Apply edits in a deterministic order

For each answered issue, determine the edit kind:

- **Fill pending TD** — the user chose Option X for a `TD-YY` that was `_[pending]_`. Edit the decisions doc: replace `_[pending]_` under TD-YY with the chosen option letter or short name. If the chosen option implies specific libraries (mentioned in the option's prose description or surfaced explicitly in the `AskUserQuestion` choice label), append a `**Libraries:**` line to the TD block right after the `**Decision:**` line, listing them comma-separated. The `research/SKILL.md` template does not structure libraries inside `### Option X:` blocks — the library list is a fresh field resolve adds when materializing the decision.

- **Supersede an existing TD** — the user chose an option that contradicts a previously decided TD-YY. Insert `<!-- status: superseded-by: {slug}/TD-ZZ -->` on the line immediately after `### TD-YY:` in the decisions doc. The superseding TD-ZZ must already exist (it was created by a prior /research cycle); if not, the issue should have been classified as MD and aborted earlier. The marker may be injected into **either** phase-scope or ad-hoc decisions docs (no doc-type restriction).

- **Append revision to TD-YY** — the user's answer points to a previously decided TD-YY where the chosen Option letter is the **same** as the existing decision (so it's not a Supersede), AND the issue (`IC-N` typically) indicates a parameter/prose-level drift between the TD and current reality. Append a new entry to the `**Revisions:**` block of TD-YY in the decisions doc:
  - **Locate position.** Within TD-YY's range (`### TD-YY:` to next `### TD-` or `---`), find the `**Libraries:**` line. The Revisions block goes after it; if `**Revisions:**` already exists below `**Libraries:**`, append a new bullet at the end of the existing block. If absent, insert a new block.
  - **Format the new entry.** `- {today's date YYYY-MM-DD via Bash 'date +%F'} — {one-liner derived from the issue's title} . Rationale: {bucket selected by the user via AskUserQuestion}.` Date is automatic (no user input). One-liner and rationale come from pre-defined option labels in the AskUserQuestion (`AskUserQuestion is choice-based and does NOT support free-form text input` — see line 100). To support the rationale field with no free-form text, the question MUST encode at least 2 short rationale buckets as option labels (e.g., `"Param updated to match new lib version"`, `"Param tightened by new policy"`, `"Path moved to follow ownership convention"`); the chosen label IS the rationale text.
  - **Trigger detection.** During Pass 1, when an `AskUserQuestion` for an `IC-N` issue references a `target_td` whose `**Decision:**` is non-pending and the option offered matches the existing letter, surface `Append revision` as one of the answer options (alongside `Supersede` and `Reaffirm with no change`). The user picks; classification follows.
  - The block may be appended to **either** phase-scope or ad-hoc decisions docs (no doc-type restriction; mirrors Supersede).

- **Clari