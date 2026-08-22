---
name: plan-test-specs
description: "Stage 5 of the plan pipeline. Generates and synchronizes spec-driven test scenario files from phase or task plans for later implementation. Use after plan-build completes when controller or cross-layer scenarios need executable specifications."
---

# Plan Pipeline — Stage 5: Test Specs

This is **Stage 5** (optional, post-build) of the plan pipeline defined in `.claude/skills/plan-pipeline/SKILL.md`. Read that file first for the cross-stage convention (frontmatter format, registered values, stage interaction). Stage 1-4 produce/edit a phase or task plan; Stage 5 derives external **spec files** from screen-wiring / controller-wiring / cross-layer SIs of that plan.

The skill is **skippable**: legacy plans (frontmatter without `test_specs_aware: true`) are routed to an abort message instructing migration; modern plans without any SI carrying `**Test Specs:**` (e.g., backend-pure phases) fall through silently.

## Input

- Positional argument: phase number `NN` (phase mode) OR task slug (task mode).
- Resolves the plan path same way `/implement` does:
  - phase mode → `docs/phases/phase-{NN}-{slug}/phase-{NN}-{slug}.md`
  - task mode → `docs/tasks/task-{slug}/task-{slug}.md`
- No flags in v1. (`--analyze`, `--reconcile`, `--force-regen <scenario>` deferred to v2 — see § "Out-of-scope".)

## Preflight

Run **in order**; abort on the first failure.

### 1. Plan existence

`Bash`-based stat on the resolved plan path. If file missing:

```
Plano não existe em <resolved-path>. Verifique se /plan-build já rodou para <slug>.
```

### 2. Mode detection

The discriminator is the frontmatter `test_specs_aware: true` field — same algorithm `/implement` uses for `PLAN_MODE`:

```bash
TEST_SPECS_AWARE=$(awk '/^---$/{f=!f;next} f' "$PLAN" | grep -c "^test_specs_aware: true$" || echo 0)
```

- `TEST_SPECS_AWARE = 0` → plano legacy. Abort:

  ```
  Plano <slug> está em modo legacy (frontmatter não declara `test_specs_aware: true`).
  Para migrar: rode '/plan-build <slug> --rebuild' primeiro para regenerar no novo formato,
  então rerun /plan-test-specs.
  ```

- `TEST_SPECS_AWARE > 0` → plano modern. Continue.

### 3. SI count with `**Test Specs:**`

```bash
TEST_SPECS_COUNT=$(grep -c "^\*\*Test Specs:\*\*" "$PLAN" || echo 0)
```

- `TEST_SPECS_COUNT = 0` → modern plan but zero screen/controller/cross-layer SIs (legitimate backend-pure phase or foundations-only). **No-op exit silently** with:

  ```
  /plan-test-specs: nenhum SI com `**Test Specs:**` field em <slug>. Skip silently.
  ```

  Não é erro — é o caminho previsto para fases backend puras.

- `TEST_SPECS_COUNT > 0` → continue to Procedure.

### 4. (No host-only binary precondition)

`/plan-test-specs` does NOT depend on the `playwright-cli` host binary. The binary's interactive workflow (Section 2 / Section 3 of the vendored skill) is not invoked by this skill nor by `/implement` Step 3a — both stages author specs and tests via single-pass LLM authoring (see `playwright-cli/VENDOR.md` § "Adaptations vs source"). The Playwright **test runner** (`@playwright/test` package in the frontend subproject) is a runtime dependency of `/implement` Step 4 (subagent runs the generated tests via the frontend subproject's Playwright invocation — e.g., `npx playwright test ...` for Node-based stacks), but that is the frontend subproject's dependency-manifest responsibility — not a precondition this skill checks.

## Procedure

Three stages, em ordem. Stage 1 lê e classifica; Stage 2 emite report; Stage 3 aplica NEW + re-stamp PRESERVED + no-op-bump per spec. UPDATED/DELETED/ORPHAN são apenas reportados (warnings) em v1.

### Stage 1 — Iterate SIs and classify

Locate every SI block via `Grep -n '^### SI-' "$PLAN"`. For each SI block:

1. **Bounded read** between this SI's header and the next `^### SI-` header (or end of file).
2. **Compute discriminator triplet** (canonical algorithm — see § "Discovery via **Test Specs:** field" below for the full rationale):

   The bounded read from Step 1 (the SI block content from `### SI-NN.X` until the next `### SI-` or EOF) is the canonical extraction mechanism. The pseudo-code below is illustrative and uses awk only to make the field-extraction logic concrete; the LLM may use the Read-tool excerpt instead.

   ```bash
   # Inputs: $SI_HEADER_LINE = the matched header from `Grep -n '^### SI-'` output
   # (e.g., "42:### SI-03.5b — Tela de Signup (lógica & wiring)")
   SI_HEADER=$(echo "$SI_HEADER_LINE" | sed -E 's/^[0-9]+://')
   N=$(echo "$SI_HEADER" | sed -E 's|^### SI-([0-9]+)\.[0-9a-z.]+.*|\1|')   # ex: "03"
   Y=$(echo "$SI_HEADER" | sed -E 's|^### SI-[0-9]+\.([0-9a-z.]+).*|\1|')    # ex: "5" or "5b"

   # Bounded slice of this SI's content (already obtained via Read in Step 1; awk shown for clarity):
   SI_BLOCK=$(awk "/^### SI-${N}\\.${Y}/,/^### SI-/" "$PLAN")

   HAS_TEST_SPECS=$(echo "$SI_BLOCK" | grep -c "^\*\*Test Specs:\*\*")
   HAS_ROUTE=$(echo "$SI_BLOCK" | grep -cE "^\*\*Route:\*\* (GET|POST|PUT|PATCH|DELETE) /")
   SI_ID="SI-${N}.${Y}"
   TITLE=$(echo "$SI_BLOCK" | head -1)
   IS_CROSS_LAYER=$(echo "$TITLE" | grep -c '(cross-layer)')
   ```

3. **Classify** per the discriminator table:

   | Caso | HAS_TEST_SPECS | HAS_ROUTE | SI_ID shape | `(cross-layer)` no título | Subproject inferido |
   |---|---|---|---|---|---|
   | Skip — não é screen/controller wiring | 0 | * | qualquer | * | n/a (skip silently) |
   | **Frontend Xb** | 1 | 0 | termina em `b` (ex: `SI-03.5b`) | * | `frontend` (Playwright) |
   | **Backend controller wiring** | 1 | 1 | plain `SI-NN.X` ou `SI-NN.X.Y` (sem letra) | * | `backend` |
   | **Cross-layer** | 1 | 0 | plain `SI-NN.X` (sem letra, sem Route) | sim | emit AMBOS frontend + backend specs |
   | (impossível por construção) | 1 | 1 | termina em `b` | * | assert + abort |
   | **FALL-THROUGH** | 1 | 0 | plain `SI-NN.X` sem letra **OU** shape `SI-NN.X.0` (drift audit-SI) | não | abort com mensagem actionable (ver baixo) |

   Fall-through abort message:

   ```
   SI-NN.X tem **Test Specs:** mas não casa nenhum case válido
   (sem sufixo 'b', sem **Route:**, sem keyword '(cross-layer)' no título;
   OU shape SI-NN.X.0 — audit-SIs nunca devem carregar **Test Specs:** field
   por construção, ver phase-b.md § "Which SIs receive the placeholder").
   Estado inválido por construção — investigar emissão do placeholder em phase-b.md/phase-c.md.
   Provavelmente bug em /plan-build.
   Run /plan-build <slug> --rebuild OR remova manualmente o **Test Specs:** field do SI antes de retry.
   ```

4. **Resolve spec path(s) for this SI:**

   The default path is `<subproject>/specs/<feature>.plan.md` where `<subproject>` is the relevant subproject directory (resolved from the plan frontmatter's `affected_subprojects:` field — the entry that plays the frontend or backend role for the SI). Per-case:

   - **Frontend Xb (single subproject):**
     - `<subproject>` = the frontend subproject directory; `<feature>` is derived from the SI title's screen name (kebab-cased, no spaces, no special chars).
     - If `**Test Specs:**` is already populated (`see \`<path>\``), trust the path verbatim — user may have customized it.
   - **Backend controller wiring (single subproject):**
     - `<subproject>` = the backend subproject directory; `<feature>` derives from the route's resource name (e.g., `POST /auth/register` → `auth-register`).
   - **Cross-layer (dual subproject):** emit BOTH `<frontend-subproject>/specs/<feature>.plan.md` and `<backend-subproject>/specs/<feature>.plan.md`.

   **Resolving the role-to-directory mapping:** `affected_subprojects:` lists directory names but does NOT label which one plays the frontend/backend role. Discover the mapping in this order:

   1. Inspect the directory's layout and dependency manifest for framework markers — entry-point conventions, framework-specific config files, and routing structure (e.g., a Next.js `app/` or `pages/` layout signals frontend; a Vite + React entry signals frontend; a NestJS-style controllers/modules layout signals backend; a Django `manage.py` or a Spring Boot `pom.xml` signals backend) — to infer the role unambiguously.
   2. Cross-reference `docs/project-plan.md`'s `### Subprojects` section, which typically annotates each subproject's role.
   3. **If the mapping is still ambiguous** (e.g., two backend candidates, or a stack-agnostic name like `app/`), ask the user via `AskUserQuestion` before resolving the path. Do not guess — writing a spec to the wrong directory is silent corruption.

5. **Read existing spec(s)** if any. Do a single Read per spec file (full content — specs are small, ~100-200 lines). Cross-layer iterates twice.

6. **Compute lifecycle state per scenario** of the spec — the per-cenário classification feeds the delta report:

   | State | Detection | Decision in Stage 3 |
   |---|---|---|
   | **NEW** | AC do plano sem cenário cobrindo | Generate scenario; mark `Source: auto`; set `Last sync` ao timestamp da operação |
   | **PRESERVED** | Cenário existe; mtime do source (phase plan) ≤ `Last sync` do cenário | Re-stamp `Last sync` (Edit cirúrgica substitui só a linha) — atualiza file mtime como side-effect |
   | **MANUAL** | Cenário com `Source: manual` ou sem `Source` field | Skip silently (não toca o file; user é dono) |
   | **UPDATED** | Cenário com `Source: auto` E mtime do plano > `Last sync` | Warning only (v1) |
   | **DELETED** | Cenário com `Source: auto` cobrindo apenas ACs que sumiram do plano | Warning only (v1) |
   | **ORPHAN** | `Covers AC: #N` aponta a AC inexistente no SI | Warning only (v1) |

   **Comparison mechanism (PRESERVED vs UPDATED).** The plan's `mtime` from `stat -c %Y` is an integer (Unix epoch seconds); each scenario's `Last sync` is an ISO-8601 string (e.g. `2026-05-02T14:30:00Z`). Both must be normalized to epoch integers before comparison:

   ```bash
   PLAN_MTIME=$(stat -c %Y "$PLAN")
   LAST_SYNC_EPOCH=$(date -u -d "$LAST_SYNC_ISO" +%s)
   if [ "$PLAN_MTIME" -le "$LAST_SYNC_EPOCH" ]; then echo PRESERVED; else echo UPDATED; fi
   ```

   Date-only comparison (e.g., `2026-05-02 > 2026-04-29`) is **insufficient** — same-day edits would be silently misclassified as PRESERVED.

7. **Coverage gate** (warnings, never abort):

   ```
   ACs_SI         = todas linhas Acceptance criteria do SI
   ACs_in_spec    = união de **Covers AC:** fields de TODOS os cenários em TODOS os specs do SI
   ACs_no_spec    = ACs_SI \ ACs_in_spec
   ```

   For cross-layer especificamente: a união entre frontend.plan.md + backend.plan.md cobre o SI. Warning emite só se algum AC fica uncovered em AMBOS os specs.

   `ACs_no_spec ≠ ∅` → warning no delta report. Razão: muitas ACs podem ser cobertas legitimamente por linhas Unit/Integration na Tests table do SI; v1 não infere essa cobertura.

8. **Accumulate** per-spec:
   - List of (state, scenario_id, AC_set) tuples.
   - Coverage gap (`ACs_no_spec`).
   - Whether any Edit will fire in Stage 3 (PRESERVED re-stamp ou NEW append).

### Stage 2 — Surface delta report

Emit a single block to user (no `AskUserQuestion` in v1 — informational only):

```
/plan-test-specs: delta report for <slug>

Per-spec breakdown:

  <frontend-subproject>/specs/signup.plan.md (frontend, SI-03.5b)
    NEW:        2 cenários
    PRESERVED:  3 cenários (Last sync re-stamp)
    UPDATED:    0
    MANUAL:     0
    Coverage:   AC #1, #2, #3, #4 covered ✓

  <backend-subproject>/specs/auth-register.plan.md (backend, SI-03.3)
    NEW:        1 cenário
    PRESERVED:  0
    UPDATED:    1 (warning — review manually)
    MANUAL:     0
    Coverage:   AC #5 not covered (warning)

Warnings:
  - SI-03.3 spec has 1 UPDATED scenario: source mtime (2026-05-02) > Last sync (2026-04-29).
    Resolutions: (a) edit content + manually update Last sync; (b) mark Source: manual.
  - SI-03.3 AC #5 not covered by any spec scenario. Add a cenário OR ensure Tests table
    Unit/Integration row covers it (v1 não rastreia coverage cross-source).

Apply pass: vai emitir 3 NEW cenários + 3 Last sync re-stamps + 1 no-op file mtime bump.
```

### Stage 3 — Apply NEW + re-stamp PRESERVED + no-op bump

For each spec file:

1. **NEW state per scenario**: Edit (or Write if file não existe) — append a new `#### N.M. <kebab-name>` block under the appropriate `### N. <Group Name>` section. Frontmatter is initialized on Write (first NEW per file). Each NEW scenario gets:

   ```markdown
   #### 1.2. <kebab-case-name>

   **Covers AC:** #2
   **Source:** auto
   **Last sync:** 2026-05-02T14:30:00Z

   **Steps:**
     1. <user-actor or API-caller voice — depending on subproject>
       - expect: <observable outcome>
   ```

   Material de partida vem da UI Contract section (frontend) ou da API Contract section (backend) — interpretado autoral mas determinístico (mesmos prompts → mesmas saídas).

2. **PRESERVED state per scenario**: Edit cirúrgica substitui apenas a linha `**Last sync:** <old-iso>` pelo `**Last sync:** <current-iso>`. Conteúdo do cenário fica intacto.

3. **MANUAL / UPDATED / DELETED / ORPHAN state**: skip — emite warning no Stage 2 já reportado, mas Stage 3 não toca conteúdo.

4. **Update `**Test Specs:**` field no plano se ainda contém `_pending_`** (independente de qual state classificou os cenários). The trigger is "field is still pending", NOT "we just generated a NEW scenario" — caso contrário, um `--rebuild` que regenera o plano com `_pending_` placeholder e logo depois roda `/plan-test-specs` (todos cenários classificados PRESERVED ou UPDATED) ficaria em deadlock infinito: `/implement` aborta `PENDING TEST SPECS`, user roda `/plan-test-specs`, nada de NEW, field nunca repara.

   Algorithm:

   ```bash
   # For each spec path resolved in Stage 1 Step 4 (regardless of lifecycle state distribution):
   if grep -q "^\*\*Test Specs:\*\* _pending" <SI_BLOCK_in_PLAN>; then
     # Edit cirúrgica no plano: replace `_pending /plan-test-specs_` with populated form
     # Single-subproject:    `see \`<spec-path>\``
     # Cross-layer:           `see \`<frontend-path>\`, \`<backend-path>\``
   fi
   ```

   `_pending_` placeholder → `see \`<spec-path>\`` populated form. Single-subproject SI → 1 path; cross-layer SI → 2 paths comma-separated. Edit cirúrgica no plano. Forma populada:

   ```markdown
   **Test Specs:** see `<frontend-subproject>/specs/<feature>.plan.md`
   ```

   Cross-layer (subproject names resolved per Step 4 above — including the role-to-directory ask-user fallback):

   ```markdown
   **Test Specs:** see `<frontend-subproject>/specs/<feature>.plan.md`, `<backend-subproject>/specs/<feature>.plan.md`
   ```

   If the field is already populated (`see ...`), skip — already done in a prior `/plan-test-specs` run.

5. **Edge case — non-content-touching specs (zero NEW + zero PRESERVED Edits).** Quando TODOS os cenários de um spec ficaram em **UPDATED / MANUAL / DELETED / ORPHAN** states, nenhum Edit content-bearing fire e o file mtime stays old → /implement preflight aborta STALE mesmo após /plan-test-specs ter rodado. **Mitigação obrigatória (aplica-se inclusive a all-MANUAL specs):** emit um **no-op Edit no frontmatter do spec** (substituição idempotente do próprio valor atual — ler o frontmatter, escolher uma linha estável, e substituí-la por ela mesma) só pra bumpar o file mtime. Exemplo: para um spec frontend, replace `subproject: frontend` por `subproject: frontend`; para um spec backend, replace `subproject: backend` por `subproject: backend`. **Use o valor atual do campo, não um literal hardcoded** — substituir `subproject: backend` por `subproject: frontend` corromperia o spec e quebraria a detecção de runner em `/implement` Step 3a. O frontmatter bump **não viola** a invariant "user is owner of MANUAL content" porque nenhum cenário tem seu corpo tocado — a única mudança é file metadata. Alternativa equivalente: `Bash touch <spec-path>`. Skill **escolhe o no-op Edit** (não requer dispatch de Bash). Esta é a mitigação canônica do **MANUAL deadlock**: sem ela, all-MANUAL specs causariam loop infinito (`/implement` aborta STALE → user roda `/plan-test-specs` → MANUAL skip silently → file mtime ainda velho → `/implement` aborta