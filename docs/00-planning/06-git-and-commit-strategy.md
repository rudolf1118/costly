# 06 — Git Workflow & Commit Strategy

> The repository history is part of the diploma evidence. It should show, without any staging,
> how Costly was designed, built, tested, measured and improved over the academic year.

## 1. Principles

1. **The history is real.** Commits are made when the work is done. No backdated commits, no
   rewriting dates, no fake "fix" commits for bugs that never existed. An honest history of
   real bugs, real refactors and real experiment-driven changes is more convincing than a
   perfect-looking one, and it's the only kind that survives questions at the defense.
2. **One commit = one meaningful, working step.** Each commit builds, passes tests, and can be
   described in one sentence. If the message needs "and", it's probably two commits.
3. **No commit spam, no commit inflation.** `update`, `fix`, `wip`, `final2` are never used. A
   one-line typo fix isn't split from the change it belongs to, and one feature isn't cut into
   ten pieces to raise the count.
4. **Tests and docs travel with the code** when they describe the same change. Separate commits
   are used when tests or docs are added *later* (e.g., a regression test after a bug report, or
   documenting a decision after an experiment). That's normal and shows the process.
5. **Small tasks produce small commits.** Implementation work is requested and done one task at a
   time (see §7), which naturally produces 1–5 commits per task.

## 2. Commit message format

[Conventional Commits](https://www.conventionalcommits.org/) with the module as scope:

```
<type>(<scope>): <imperative summary, ≤ 72 chars>

<optional body: why, not what; links to issue/ADR/experiment>
```

| Type | Use for |
|---|---|
| `feat` | New user-visible or API-visible behaviour |
| `fix` | A bug fix (the body says what was wrong) |
| `test` | Tests added or improved without behaviour change |
| `refactor` | Restructuring without behaviour change |
| `perf` | Measured performance improvement (the body cites the numbers) |
| `docs` | Documentation, ADRs, thesis material |
| `exp` | Experiment scripts, datasets, results (`experiments/`, `docs/09-research/`) |
| `build` / `ci` | Docker, dependencies, GitHub Actions |
| `chore` | Tooling that fits nowhere else (rarely) |

Scopes: `ledger`, `identity`, `recurring`, `import`, `planning`, `analytics`, `forecasting`,
`simulation`, `insights`, `assistant`, `platform`, `jobs`, `web`, `math` (finance-math),
`generator`, `db`, `docs`, `experiments`.

Good:
```
feat(ledger): create transfers as paired rows in one transaction
fix(analytics): exclude transfers from monthly expense totals
perf(db): add (user_id, category_id, occurred_on) index for category analytics

Category breakdown p95 went from 410 ms to 38 ms on the 3M-row dataset (E6, run 2).
```

## 3. Branching & merging

- **`main` is always runnable** (`docker compose up` works, CI green).
- **Short-lived feature branches** (1–7 days): `feat/ledger-transfers`, `fix/transfer-analytics`,
  `exp/e1-forecast-comparison`, `docs/adr-dirty-marking`, `perf/category-indexes`.
- **Every branch merges through a pull request**, even as a solo developer. The PR description
  states what, why, and how it was tested. PRs are where the supervisor can review and comment,
  and the discussion stays visible in GitHub.
- **Merge with a merge commit (`--no-ff`), not squash.** Squash merging would collapse the
  small commits the history is supposed to show. The merge commit groups a feature; the commits
  inside it show the steps.
- Clean up your *own unpushed* commits before opening a PR (reorder, fix messages). Pushed history
  on `main` is never rewritten.

## 4. Planning artefacts on GitHub

- **Milestones** = chapters (`Ch1 Financial core`, `Ch2 Import & analytics`, …) with due dates.
- **Issues** for each feature, bug and experiment, linked from PRs (`Closes #12`).
  Bugs found during development become issues first, then `fix:` commits.
- **Labels:** `feature`, `bug`, `refactor`, `perf`, `experiment`, `docs`, `supervisor-feedback`.
- **Tags + GitHub Releases** at the end of each chapter: `v0.1.0`, `v0.2.0`, `v0.3.0`, `v1.0.0`,
  with release notes (features, fixes, experiments, known limitations). Intermediate tags
  (`v0.1.1`) for fixes after a supervisor review.
- `CHANGELOG.md` updated at each release.
- `docs/10-diploma/progress-log.md` gets a dated entry per week or two, including supervisor feedback
  and what changed because of it. Feedback-driven changes reference the log entry in their commit body.

## 5. Chapter-by-chapter plan

The commit lists below are **examples of the expected shape**, not a script. Real commits will
differ, and real bugs will appear where they appear.

---

### Chapter 0: Setup & specification (late Sep – early Oct 2026)

**Milestones:** specification approved · monorepo runs locally · CI green.

**Branches:** `build/monorepo-setup`, `ci/github-actions`, `docs/initial-adrs`

**Example commits**
```
docs: add project specification and planning documents        ← already done
build: initialize pnpm workspace with api, web and packages
build(platform): initialize NestJS backend structure
build(web): scaffold React app with Vite and TypeScript
build: add Docker Compose with PostgreSQL and Redis
feat(platform): add health endpoint checking database and Redis
ci: run lint, typecheck and tests on pull requests
docs(adr): record modular monolith decision (ADR-0001)
docs(adr): record money as bigint minor units (ADR-0002)
docs(adr): record Prisma with raw SQL for analytics (ADR-0003)
docs(adr): record BullMQ over RabbitMQ (ADR-0004)
docs: incorporate supervisor feedback on specification
```

---

### Chapter 1: Financial core & architecture foundation (Oct – Nov 2026) → `v0.1.0`

**Milestones**
1. Auth works end-to-end (register, login, refresh, guard)
2. Accounts + categories + merchants
3. Transactions incl. transfers, with integration tests
4. Recurring rules + first BullMQ job
5. Dashboard v1 + seeded persona → release `v0.1.0`

**Branches:** `feat/prisma-setup`, `feat/identity-auth`, `feat/ledger-accounts`,
`feat/ledger-categories`, `feat/ledger-transactions`, `feat/ledger-transfers`,
`feat/recurring-rules`, `feat/jobs-infrastructure`, `feat/generator-v1`, `feat/web-dashboard-v1`

**Feature commits**
```
feat(db): add Prisma with PostgreSQL configuration and first migration
feat(identity): add user registration with password hashing
feat(identity): issue JWT access and refresh tokens on login
feat(identity): rotate refresh tokens and revoke on reuse
feat(ledger): create account domain model and CRUD endpoints
feat(ledger): compute account balance from transactions
feat(ledger): add two-level categories with nature
feat(ledger): seed default categories for new users
feat(ledger): implement transaction creation
feat(ledger): add transaction validation for type, amount and ownership
feat(ledger): normalize merchant names on transaction create
feat(ledger): create transfers as paired rows in one transaction
feat(ledger): add cursor-paginated transaction list with filters
feat(platform): add injectable Clock provider
feat(platform): introduce Redis connection and BullMQ module
feat(jobs): add worker entrypoint sharing the API modules
feat(recurring): add recurring rules with occurrence calculation
feat(recurring): materialize due occurrences in a daily scheduled job
feat(generator): generate 12-month persona with deterministic seed
feat(db): add seed command using the data generator
feat(web): add login and account screens
feat(web): add transaction list and quick-add form
feat(web): add dashboard with balances and monthly totals
```

**Testing / refactoring commits**
```
test(ledger): add transaction integration tests with Testcontainers
test(ledger): add property tests for transfer balance invariants
test(identity): verify users cannot access each other's data
test(recurring): cover month-end edge cases in occurrence calculation
test(jobs): verify materialization is idempotent when run twice
refactor(ledger): extract merchant normalization into its own service
fix(recurring): schedule 31st-of-month rules on last day of shorter months   ← if found
```

**Documentation commits**
```
docs(architecture): describe module boundaries and dependency rules
docs(db): document core schema and constraints
docs(adr): record transfers as paired rows (ADR-0005)
ci: enforce module dependency rules with dependency-cruiser
docs(diploma): add chapter 1 report and progress log entries
```

**Research:** none formal yet. Record the first baseline numbers (API latency of create-transaction)
for later comparison: `exp: add k6 smoke script for transaction creation`.

---

### Chapter 2: Import, analytics & financial behaviour (Dec 2026 – Jan 2027) → `v0.2.0`

**Milestones**
1. Statement import pipeline (async, preview, commit, idempotent)
2. Categorisation rules + recurring detection
3. Analytics facts + dashboard v2
4. Anomaly detection + insights lifecycle
5. Budgets + basic goals → release `v0.2.0`

**Branches:** `feat/import-pipeline`, `feat/categorization-rules`, `feat/recurring-detection`,
`feat/finance-math-stats`, `feat/analytics-facts`, `feat/recompute-job`, `feat/anomaly-detection`,
`feat/insights-lifecycle`, `feat/budgets`, `feat/goals-basic`, `exp/e4-anomaly-methods`,
`exp/e6-query-baseline`

**Feature commits**
```
feat(import): upload statements and parse them in a background job
feat(import): report import progress and row-level parse errors
feat(import): show import preview with duplicate flags before commit
feat(import): commit imported rows in batches with import hash dedupe
feat(import): add column mapping for generic CSV formats
feat(import): add parser for <bank name> statement export
feat(import): learn categorization rules from user corrections
feat(math): add descriptive statistics and percentile functions
feat(math): detect periodic transactions for recurring suggestions
feat(recurring): suggest recurring rules detected from history
feat(analytics): add monthly analytics aggregation
feat(analytics): compute category baselines over last complete months
feat(analytics): add pace-adjusted month-to-date comparison
feat(analytics): detect category trends with OLS and R² gate
feat(analytics): decompose spending change into frequency and price effects
feat(analytics): mark derived data dirty in the ledger write transaction
feat(jobs): add debounced per-user recompute job
feat(jobs): sweep stale recompute markers every five minutes
feat(analytics): flag unusually large transactions with robust z-score
feat(analytics): detect possible duplicate transactions
feat(insights): store insights with fingerprint deduplication
feat(insights): support dismiss, seen and expiry states
feat(planning): add monthly category budgets
feat(planning): add goals with progress and required monthly saving
feat(web): show baseline comparison next to category totals
feat(platform): add admin failed-job view with Bull Board
```

**Testing / refactoring / fix commits**
```
test(import): re-importing the same file creates no duplicates
test(import): worker crash mid-import recovers without duplicates
test(math): property test that decomposition terms sum to total change
test(analytics): compare SQL aggregates with in-memory reference implementation
fix(analytics): exclude transfers from monthly expense totals            ← typical real bug
fix(jobs): re-enqueue recompute when data changes during an active job
refactor(analytics): return typed facts instead of raw query rows
refactor(math): move statistics out of analytics service into finance-math
```

**Documentation commits**
```
docs(analytics): add metrics catalog with formulas
docs(analytics): document anomaly detectors and thresholds
docs(architecture): document background jobs and dirty-marking pattern
docs(adr): record dirty marking instead of transactional outbox (ADR-0006)
docs(diploma): add chapter 2 report
```

**Research commits**
```
feat(generator): add three personas with injected anomalies and ground truth
exp: add anomaly detection evaluation harness (E4)
exp: compare mean z-score, robust z-score and percentile detectors (E4)
docs(research): record E4 results and choose robust z-score
exp: evaluate recurring detection against generator ground truth (E5)
exp: generate 1k-user dataset and measure analytics query latency (E6 baseline)
perf(db): add category analytics index based on E6 query plans
```

---

### Chapter 3: Forecasting, goal projection & what-if (Feb – Mar 2027) → `v0.3.0`

**Milestones**
1. Forecast methods in `finance-math` + backtesting harness
2. EOM / next-month / balance forecasts with data tiers in the product
3. Goal projection
4. What-if simulator + affordability → release `v0.3.0`

**Branches:** `feat/forecast-methods`, `exp/backtest-harness`, `exp/e1-method-comparison`,
`feat/eom-forecast`, `feat/data-tiers`, `feat/forecast-snapshots`, `feat/balance-projection`,
`feat/goal-projection`, `feat/simulation-engine`, `feat/affordability`, `feat/web-simulator`

**Feature commits**
```
feat(math): add naive and moving average forecasts
feat(math): add weighted moving average and exponential smoothing
feat(math): add Holt linear trend with parameter grid search
feat(math): add empirical prediction intervals from residuals
feat(forecasting): add forecast baseline implementation
feat(forecasting): separate recurring obligations from discretionary forecast
feat(forecasting): add credibility-blended end-of-month forecast
feat(forecasting): gate forecasts by data-sufficiency tier
feat(forecasting): store daily forecast snapshots
feat(forecasting): project liquid balance for the next 90 days
feat(forecasting): select method per user by backtest error
feat(planning): project goal completion with priority waterfall
feat(math): add scenario simulation over monthly horizon
feat(math): add loan modifier using annuity payment formula
feat(simulation): build scenario baseline from analytics facts
feat(simulation): add what-if goal simulation endpoint
feat(simulation): add affordability verdict with alternatives
feat(simulation): save and re-run named scenarios
feat(web): add simulator screen with baseline and scenario charts
feat(web): show forecast ranges and confidence labels
```

**Testing / refactoring / fix commits**
```
test(math): simulation with no modifiers equals baseline projection
test(math): income increase never delays goal completion
test(math): annuity payments sum to principal plus interest
test(forecasting): golden tests for fixed persona forecasts
test(experiments): assert backtest windows have no look-ahead
fix(forecasting): use complete months only for baseline at month start
refactor(forecasting): share goal projection between planning and simulation
```

**Documentation commits**
```
docs(forecasting): document methods, parameters and data tiers
docs(decision-support): document what-if modifiers and verdict rules
docs(adr): record synchronous simulation and async snapshots (ADR-0007)
docs(diploma): add chapter 3 report
```

**Research commits**
```
exp: add rolling-origin backtesting harness
exp: compare moving average approaches on synthetic personas (E1)
exp: compare raw and recurring-decomposed forecasts (E1)
exp: measure end-of-month forecast convergence by day (E2)
exp: tune credibility constant K for EOM blending (E2)
exp: measure forecast error against history length (E3)
docs(research): record E1–E3 results and derived tier thresholds
feat(forecasting): adjust tier thresholds based on E3 results            ← research → product
```

---

### Chapter 4: Recommendations, month close, optional AI & polish (Apr – May 2027) → `v1.0.0`

**Milestones**
1. Recommendation rules + scoring + lifecycle
2. Month close + monthly report
3. Performance work driven by E6–E8
4. (Optional) AI explanations
5. Polish, demo mode, feature freeze 15 May → release `v1.0.0`

**Branches:** `feat/insight-rules`, `feat/insight-scoring`, `feat/month-close`,
`perf/analytics-aggregates`, `exp/e7-ingestion`, `exp/e8-queue-behaviour`, `exp/e9-rules`,
`feat/assistant-explain` (optional), `feat/demo-mode`, `feat/web-polish`

**Feature commits**
```
feat(insights): add recommendation rule evaluation framework
feat(insights): add category-over-baseline rule with goal impact
feat(insights): add budget pace and cash-flow warning rules
feat(insights): add goal off-track and acceleration rules
feat(insights): score and rank insights by normalized impact
feat(insights): apply dismissal cooldowns and auto-resolve
feat(insights): collect feedback and track recommendation outcomes
feat(insights): generate monthly report at month close
feat(jobs): fan out scheduled jobs per user
feat(platform): push insight updates over server-sent events
feat(assistant): explain monthly report from structured facts       ← optional
feat(assistant): reject answers with numbers not present in facts   ← optional
feat(platform): add demo mode with clock control
feat(web): improve mobile transaction flow
feat(web): add empty and low-confidence states
```

**Testing / refactoring / perf / fix commits**
```
test(insights): scenario tests for each recommendation rule
test(jobs): month close is idempotent when run twice
test: add Playwright flow for the defense demo path
perf(analytics): introduce monthly category totals table (E6)
perf(import): insert rows in batches of 1000 (E7)
perf(db): optimize transaction query indexes
refactor(insights): build evaluation context once per run
fix(insights): prevent duplicate warnings across month boundary
```

**Documentation commits**
```
docs(decision-support): document rule catalogue and scoring
docs(architecture): update architecture documentation for v1.0
docs(testing): document test strategy and how to run experiments
docs(diploma): add chapter 4 report
docs: add CHANGELOG for v1.0.0
```

**Research commits**
```
exp: load test transaction ingestion and import throughput (E7)
exp: measure recompute debounce and worker concurrency (E8)
exp: verify recovery after killing worker mid-job (E8)
exp: evaluate recommendation rules on scenario personas (E9)
exp: measure AI answer grounding on fixed question set (E10, optional)
```

---

### Final stage: Evaluation & defense (late May – June 2027)

After the feature freeze on 15 May, only these commit types land on `main`: `fix`, `test`, `docs`, `exp`.

```
exp: rerun all experiments on v1.0 code with fixed seeds
docs(research): finalize experiment tables and charts
fix(web): correct forecast range label on narrow screens
docs(diploma): add defense demo script and fallback plan
docs(diploma): add thesis outline mapped to documentation
```
Final tag: `v1.0.x` for the version shown at the defense.

## 6. Expected shape of the history

Rough, not a target: ~40–70 commits per chapter, ~15–30 merged PRs per chapter, ~200–300
commits total, spread across the year with visible gaps around exams. The *mix* matters more
than the count: every chapter should contain feature, test, fix, refactor, docs and (from Ch2)
experiment commits.

## 7. How implementation work is requested

- **One prompt = one task from the chapter plan**, sized for 1–3 hours and 1–5 commits.
  Example: "Implement transfers as paired rows in `ledger`, with integration tests", not
  "Build Chapter 1".
- Each task ends with: code + tests passing, a proposed list of commit messages matching the
  steps actually taken, and any doc updates the change requires.
- New work starts on a feature branch. Nothing is generated ahead of the chapter it belongs to.
- If a task turns out larger than expected, it's split into several tasks, not squeezed into one commit.
- Bugs found along the way are fixed in their own `fix:` commit with a test that reproduces them.
