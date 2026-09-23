# 04 — Academic-Year Roadmap, Experiments, Defense

> Assumed calendar: start of October 2026 → defense in June 2027. Winter exams (January)
> are planned as a lighter period. Adjust dates to the university schedule.

## 0. Structure: why this division

The suggested structure (Core → Analytics → Forecasting/Goals/What-if → Recommendations/AI)
is mostly right. Three changes:

1. **Statement import and the data generator move early** (Ch1–Ch2). Analytics and forecasting
   are meaningless without history, and the generator is both the demo seed and the experiment
   dataset. Building it late would make Ch3 experiments rushed.
2. **Basic goals move into Ch2.** Goals are the product's centre. Having them early makes
   every chapter's version a coherent product, and Ch3 adds projection on top.
3. **Recommendations become "Insights" and start in Ch2** with the anomaly/duplicate rules
   (the lifecycle table and fingerprinting). Ch4 adds the goal-aware recommendation rules, which
   need forecasting and simulation.

Each chapter ends with: a working, tagged version (`v0.1`, `v0.2`, `v0.3`, `v1.0`), a short demo recording,
and a written diploma section.

---

## Chapter 0: Setup & specification (≈ 2 weeks, late Sep – early Oct 2026)
- Agree on this specification with the supervisor. Create the repository and `docs/` skeleton.
- Monorepo, lint/format, CI (GitHub Actions: lint, typecheck, test), Docker Compose with
  Postgres + Redis, empty NestJS app with health check, empty React app.
- ADRs 0001–0004 (modular monolith, money representation, Prisma + raw SQL, BullMQ).
- **Deliverable:** `docker compose up` shows a "hello" page backed by a healthy API.

---

## Chapter 1: Financial core & architecture foundation (Oct – Nov 2026)

**Goals.** A correct ledger and the architectural skeleton every later chapter builds on.
Learn NestJS module design, Prisma migrations, transaction boundaries, testing with real Postgres,
first BullMQ job.

**Features**
- Registration/login (JWT access + rotating refresh token), user timezone and base currency
- Accounts (4 types), balances computed from transactions
- Categories (2-level, seeded defaults, `nature`), merchants (normalisation)
- Transactions: income, expense, transfer (atomic pair); list with filters and pagination
  (keyset/cursor), edit, delete
- Recurring rules (manual) + daily materialisation
- Dashboard v1: balances, this month's income/expense/net, category breakdown
- `data-generator` v1: one persona, 12 months, deterministic seed

**Architecture introduced**
- Module boundaries (`identity`, `ledger`, `recurring`, `platform`), dependency rules in CI
- API conventions: DTO validation, error format (RFC 7807 problem+json), cursor pagination, OpenAPI docs
- Two entrypoints (API / worker), BullMQ job scheduler, `Clock` provider
- Idempotency by unique constraint `(recurring_rule_id, occurrence)`

**Applied mathematics.** Minimal: money arithmetic in integer minor units, occurrence
calculation for recurring schedules (month-end edge cases: "31st" in February).

**Testing**
- Unit: recurring schedule calculation (edge cases), merchant normalisation
- Property-based (fast-check): transfers never change total balance across accounts, and
  never change income/expense totals; balance = Σ rows for any random sequence of operations
- Integration (Testcontainers Postgres + Redis): transaction creation, transfer atomicity
  (failure mid-transfer → nothing persisted), user data isolation (user A can't read B)
- Job: materialisation run twice → one transaction per occurrence

**Deliverable `v0.1`.** A usable manual tracker with correct accounts, transfers and automatic
recurring transactions, seeded with 12 months of synthetic history.

**Diploma material.** Domain model chapter (ledger, transfers, money representation and why),
architecture overview (modular monolith, module boundaries), first background job and
idempotency.

---

## Chapter 2: Import, analytics & financial behaviour (Dec 2026 – Jan 2027, lighter during exams)

**Goals.** Get real data in, and turn numbers into analysis. Learn file processing in the
background, SQL aggregation and window functions, index design, first measurements.

**Features**
- CSV/XLSX statement import: upload → async parse → preview (categorisation suggestions,
  duplicate flags) → commit. One or two real Armenian bank formats + generic column mapping.
- Categorisation rules (user-created + learned from corrections)
- Recurring detection from history → suggestions the user confirms
- Analytics: monthly summary & savings rate, baselines, pace-adjusted MTD, rolling averages,
  trend (OLS), CV/volatility classes, fixed-vs-discretionary, recurring load, runway,
  period decomposition (category + frequency/price)
- Anomalies: large transaction (robust z + percentile), duplicates, recurring price change,
  category spike
- `insights` table + lifecycle (active/seen/dismissed/expired, fingerprint dedupe) for anomaly-type insights
- Budgets (monthly per category, budget vs. actual)
- Goals basic: target, current, progress, required monthly saving
- Dashboard v2: every number has a reference point (baseline or budget)
- `data-generator` v2: 3 personas, injected anomalies, ground-truth files

**Architecture introduced**
- `import`, `analytics`, `planning`, `insights` (skeleton) modules
- `recompute_markers` + debounced `recompute-user` job + `sweep-dirty` (dual-write handling)
- Job progress reporting, retries, `UnrecoverableError` for bad files, Bull Board
- `finance-math` package established (stats + detection)
- Raw SQL analytics queries; first EXPLAIN ANALYZE-driven indexes

**Applied mathematics.** Descriptive statistics, percentiles, CV, robust z-score (median/MAD),
OLS trend + R², additive change decomposition, periodicity detection.

**Testing**
- Unit/property: decomposition terms always sum to the total delta; z-score/MAD on
  known distributions; recurring detection on generated series
- Import: the same file twice → no duplicates; malformed rows reported, not fatal; worker killed
  mid-import → retry completes without duplicates
- Analytics SQL vs. an in-memory reference implementation on random data (differential testing)

**Scope valve:** Chapter 2 overlaps with winter exams. If it runs late, budgets and basic goals move to
the start of Chapter 3 (goal projection builds on them anyway). Import and analytics don't move.

**Deliverable `v0.2`.** Import a real statement → within seconds see baselines, trends, anomalies
and "why did I spend more" explanations. Basic goals and budgets.

**Diploma material.** Import pipeline and background-processing design; analytics methods
with formulas; anomaly detection method comparison (first results of E4, E5); first performance
measurements (E6 baseline).

---

## Chapter 3: Forecasting, goal projection & what-if simulation (Feb – Mar 2027)

**Goals.** The technical heart of the diploma. Learn time-series basics, evaluation methodology,
simulation design, pure-function architecture.

**Features**
- Forecasts: EOM total & category, next-month total & category, balance projection (30–90 days)
- Data tiers and confidence labels; per-user method selection by backtest
- Daily `forecast-snapshot` job; convergence tracking
- Goal projection: expected contribution (priority waterfall), expected date, on-track status,
  gap, sensitivity
- **What-if simulator:** modifiers (income, category, extra saving, one-time expense/income,
  recurring add/remove, loan), baseline vs. scenario, affordability verdict + alternatives,
  saved scenarios
- Budget pace warnings (projected overrun)
- UI: forecast cards with ranges, goal detail with projection, simulator screen

**Architecture introduced**
- `forecasting` and `simulation` modules; facts-in → pure-function → result pattern
- A backtesting harness (CLI in `experiments/`) running the same `finance-math` code as production
- A synchronous, stateless compute endpoint (simulate) vs. an asynchronous scheduled one (snapshots): an
  explicit design decision documented as an ADR

**Applied mathematics.** SMA, WMA, SES, Holt with parameter search; credibility blending;
empirical prediction intervals; MAE/MASE/coverage; rolling-origin validation; annuity formula;
waterfall allocation.

**Testing**
- Property: simulate with zero modifiers == baseline projection; income increase never delays a goal;
  the loan annuity sum equals principal + interest
- Golden tests: fixed persona → known forecast/projection numbers (regression protection)
- Backtest harness tests: no look-ahead (training window strictly before target)

**Deliverable `v0.3`.** Costly predicts, projects goals and answers "what if / can I afford".
This version is already a defensible diploma product.

**Diploma material.** Forecasting chapter (methods, cold start, results of E1–E3), goal and
simulation model, decision-support design.

---

## Chapter 4: Recommendations, month close, optional AI & polish (Apr – May 2027)

**Goals.** Close the loop from facts to actions. Harden the system. Learn rule-engine design,
prioritisation, feedback loops, performance tuning, LLM integration with guardrails (optional).

**Features**
- Recommendation rules: category over baseline (with goal impact), budget pace, budget unrealistic,
  cash-flow warning, goal off-track, goal acceleration, recurring review
- Prioritisation score, dismissal cooldowns, snooze, feedback, auto-resolve, expiry job
- Month close job → monthly report (what changed and why, forecast accuracy, goal movement)
- Optional SSE push for insight updates
- **Optional AI:** "explain this month / insight / scenario", Q&A with read-only tools, numeric
  grounding check, off by default
- UI polish, empty/cold-start states, demo mode (clock control, persona switch)

**Architecture introduced**
- The rule interface + evaluation context; fingerprint-based idempotent upserts
- Scheduled fan-out jobs at scale (all users), concurrency tuning
- Performance work driven by E6/E7 (aggregate table only if justified)
- `assistant` module behind a feature flag and an `LlmClient` interface

**Applied mathematics.** Impact estimation via one-modifier simulations; normalised scoring;
outcome measurement (did the recommended category go down?).

**Testing**
- Scenario-based rule tests: persona with a known problem → the expected recommendation, and *not* others
- Idempotency: month close twice → one report; insight evaluation twice → no duplicates
- Load tests (k6) for ingestion and dashboard reads; worker concurrency tests
- AI: grounding rate on a fixed question set (if AI is implemented)

**Deliverable `v1.0`.** The final diploma system.

**Diploma material.** Recommendation engine chapter, performance/experiment results chapter,
(optional) AI integration section.

---

## Final stage: Evaluation, thesis, defense (late May – June 2027)
- Freeze features (**feature freeze on 15 May**; only fixes afterwards).
- Rerun all experiments on the final code; produce tables and charts.
- Complete the thesis (most sections already drafted per chapter).
- Rehearse the demo 3+ times on the defense laptop, offline (AI demo pre-recorded as a fallback).

---

## 1. Experiments & metrics

Each experiment lives in `docs/09-research/experiments/Exx-*.md` with: hypothesis, dataset,
method, metric, results table, conclusion. Scripts in `experiments/` make results reproducible
(fixed seeds).

| ID | Experiment | Metric(s) | Expected result to discuss |
|---|---|---|---|
| **E1** | Forecast method comparison (naive, SMA3, SMA6, WMA, SES, Holt; raw vs. recurring-decomposed) on 3 personas × 5 seeds + the author's anonymised real data | MAE, **MASE**, interval coverage | Does decomposition help? Which method wins per data tier? |
| **E2** | EOM forecast convergence: linear run-rate vs. profile-based vs. credibility-blended | MAE by day-of-month (curve) | How fast the error falls, and whether blending beats run-rate early in the month |
| **E3** | Cold start: error vs. months of history (1–12) | MASE vs. history length | Empirical justification for the tier thresholds |
| **E4** | Anomaly detection: mean-z vs. robust-z vs. percentile on injected anomalies | Precision, recall, F1, alerts/user/month | Robust methods reduce false positives with a similar recall |
| **E5** | Recurring detection vs. ground truth | Precision, recall, amount/period error | How often suggestions are right |
| **E6** | Dashboard/analytics query performance at 1k users × 24 months (~3–5M rows): no index / indexes / aggregate table | p50/p95 latency, EXPLAIN plans, table sizes | When (and whether) aggregates are worth it |
| **E7** | Ingestion: API create p95 under load; import throughput by batch size (1/100/1000) | req/s, p95, rows/s | Cost of per-row vs. batched inserts; enqueue overhead |
| **E8** | Queue behaviour: debounce effectiveness (writes vs. jobs executed); concurrency 1/2/4/8 throughput; crash recovery | jobs/writes ratio, jobs/s, data correctness after a forced kill | Idempotency proven, not assumed |
| **E9** | Recommendation rules on scenario personas | Rule-level precision (expected vs. produced), duplicates = 0 | Rules fire when they should and stay silent otherwise |
| **E10** *(opt.)* | AI grounding on 30 fixed questions | % answers with all numbers grounded; manual quality score | LLM stays within facts |

Real data note: the author's own bank history (exported, anonymised: merchants hashed, amounts
kept) is the most valuable single dataset for E1–E5. Synthetic data proves the methods work
where the truth is known. Real data shows how they behave in practice.

---

## 2. Defense demonstration (≈ 12–15 minutes)

**Setup:** laptop, `docker compose up`, persona "Anna" with 12 months of history, demo clock set
to the 22nd of the month. Bull Board open in a second tab. AI pre-recorded as a fallback.

| # | Time | What is shown | What the commission should notice |
|---|---|---|---|
| 1 | 1:00 | Problem statement: one slide, "tracker vs. Costly" | The question is *decisions*, not charts |
| 2 | 1:00 | Dashboard: this month vs. usual pace, EOM forecast with range, goal chips | Every number has a reference point |
| 3 | 1:30 | Add 3 restaurant expenses + a large purchase → insights appear within seconds | Live pipeline: sync write → async recompute; Bull Board shows **one** debounced job |
| 4 | 1:00 | Open the anomaly: "larger than 97% of your Shopping transactions"; the restaurant spike explained as a frequency effect | Explainable statistics, not black boxes |
| 5 | 1:30 | Forecast screen + backtest chart: "our method vs. naive: MASE 0.7" and the convergence curve | Measured accuracy; the system knows its confidence |
| 6 | 1:30 | Apartment goal: expected date, gap, levers | Goals as projections |
| 7 | 2:00 | Simulator: "Can I afford 5M now?" → verdict, trade-offs; switch to loan → interest + delay; drag a slider for restaurants −20% | The signature feature. Instant, deterministic |
| 8 | 1:00 | Recommendation card with quantified impact → dismiss → cooldown | Lifecycle, not spam |
| 9 | 1:00 | *(optional)* "Why did I spend more this month?" → AI explanation with the numbers highlighted | AI explains, the engine computes |
| 10 | 2:00 | Architecture: module diagram, job table, dirty-marking diagram; kill the worker during an import, restart, no duplicates | Engineering quality made visible |
| 11 | 1:00 | Results summary: E1/E4/E6 tables | "I built it *and* measured it" |

**What makes it technically impressive without fake complexity**
- Showing *one* job handling many writes (debounce) and *surviving* a crash (idempotency).
- Showing forecast *error numbers* and admitting where the forecast is weak.
- A simulator that answers in < 100 ms with consistent numbers across screens (same engine).
- Cold-start honesty: switch to the "student" persona with 10 days of data and show the app
  *refusing* to forecast.

---

## 3. Main risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Frontend consumes too much time | High | Component library, one chart lib, a fixed screen list per chapter |
| Not enough real data | Medium | Own bank export early (Ch2) + generator |
| Forecast accuracy is underwhelming | Medium | It's still a result. The thesis is about *evaluating* methods honestly |
| Scope creep | High | §3 in `01-product-and-feature-analysis.md`; ADR required to add anything |
| Thesis written too late | High | Diploma material is a deliverable of every chapter |
| Bank CSV formats vary/change | Medium | Generic column mapping as a fallback |
| LLM cost/availability at defense | Low | AI optional + pre-recorded fallback |
| Exams/work overload | Medium | Ch2 is intentionally lighter; a 2-week buffer before feature freeze |
