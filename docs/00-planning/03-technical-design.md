# 03 — Technical Design: Database, Backend, Background Processing, Flows, Local Environment

---

## 1. Database design (PostgreSQL)

### Conventions
- Primary keys: `uuid` v7 (time-ordered, index-friendly; native `uuidv7()` in PostgreSQL 18). Foreign keys use `ON DELETE RESTRICT`
  unless stated otherwise.
- **Money:** `bigint` minor units + `currency char(3)`. Never `float`, never `numeric` in app
  code. AMD's exponent is 2 per ISO 4217, but it's displayed without decimals.
- Sign convention: `amount` is always **positive**. Direction comes from `type`. That avoids a
  whole class of sign bugs in aggregates (tested by property tests).
- Dates: `occurred_on date` (the business date the user cares about) and `created_at timestamptz`.
  Analytics groups by `occurred_on`, never by `created_at`.
- Every user-owned table has `user_id`, and every query filters by it (enforced in the service layer + tests).
- Soft delete only where history matters (categories, accounts → `archived_at`). Transactions are hard-deleted
  by the user (it's their ledger), and this marks derived data dirty.

### 1.1 Core (Chapter 1)

**`users`**: `id, email (unique, citext), password_hash, base_currency, timezone, created_at`
- `timezone` matters: "which month does this belong to" is timezone-dependent.

**`refresh_tokens`**: `id, user_id, token_hash, expires_at, revoked_at`. Index `(user_id)`.

**`accounts`**: `id, user_id, name, type (enum: checking|cash|savings|credit_card), currency, is_liquid, opening_balance, opening_date, archived_at`
- Unique `(user_id, name)` where not archived.
- **No `balance` column.** Balance = `opening_balance + Σ inflows − Σ outflows`. For performance, see §1.2.

**`categories`**: `id, user_id (null = system default), parent_id (nullable, self-FK), name, kind (income|expense), nature (essential_fixed|essential_variable|discretionary; null for income), archived_at`
- Check: depth ≤ 2 (enforced in the service: the parent must have `parent_id IS NULL`).
- Unique `(user_id, parent_id, name)`.

**`merchants`**: `id, user_id, normalized_name, display_name, default_category_id`
- Unique `(user_id, normalized_name)`.

**`transactions`**
```
id, user_id, account_id, type (income|expense|transfer_out|transfer_in),
amount bigint CHECK (amount > 0), currency,
occurred_on date, category_id (null for transfers), merchant_id, description, note,
transfer_group_id uuid null,       -- pairs transfer_out/transfer_in
recurring_rule_id uuid null,       -- set if materialised from a rule
recurring_occurrence date null,    -- which occurrence
import_id uuid null, import_hash text null,   -- (Ch2)
created_at, updated_at
```
- Check: `(type IN ('transfer_out','transfer_in')) = (transfer_group_id IS NOT NULL)`
- Check: category required for income/expense.
- **Unique `(recurring_rule_id, recurring_occurrence)`.** This is what makes recurring
  materialisation idempotent at the database level.
- **Unique `(user_id, import_hash)`** where not null. Re-importing the same file is a no-op (Ch2).
- Indexes: `(user_id, occurred_on DESC)` for the list and all analytics ranges;
  `(user_id, category_id, occurred_on)` for category analytics; `(account_id, occurred_on)` for balances;
  `(transfer_group_id)`. Whether each index is needed is **verified with EXPLAIN ANALYZE in experiment E6**.

**`recurring_rules`**: `id, user_id, account_id, type (income|expense), amount, category_id, merchant_id, description, frequency (weekly|monthly|yearly), interval, anchor_date, day_of_month, next_occurrence date, end_date, status (active|paused|ended), source (manual|detected)`
- Index `(status, next_occurrence)` for the daily materialisation scan.

### 1.2 Analytics (Chapter 2)

**`import_batches`**: `id, user_id, account_id, filename, file_sha256, format, status (pending|parsing|preview|committed|failed), total_rows, imported_rows, duplicate_rows, error, created_at`
- Unique `(user_id, file_sha256)` to prevent importing the same file twice.

**`import_rows`** (staging): `id, batch_id, row_number, raw jsonb, parsed_date, parsed_amount, parsed_description, suggested_category_id, suggested_merchant_id, duplicate_of_transaction_id, decision (import|skip)`
- Kept so the user can review a preview before committing. Rows are deleted N days after commit.

**`categorization_rules`**: `id, user_id, match_type (merchant|contains|regex), pattern, category_id, priority, created_from (user|learned)`
- Learned when a user recategorises an imported transaction ("always categorise YANDEX GO as Taxi?").

**`budgets`**: `id, user_id, category_id, amount, effective_from (year-month), effective_to null`
- Unique `(user_id, category_id, effective_from)`. Versioned so past months keep their budget.

**`goals`** + **`goal_contributions`** (basic goals end of Ch2)
- `goals: id, user_id, name, target_amount, target_date, priority, linked_account_id, status, created_at`
- `goal_contributions: id, goal_id, amount, occurred_on, transaction_id null`

**`monthly_category_totals`** (**introduced only if E6 shows it's needed**)
- `user_id, year_month, category_id, total bigint, tx_count int, computed_at`, PK `(user_id, year_month, category_id)`.
- A derived, disposable cache. It's rebuilt idempotently per `(user_id, year_month)`
  (`DELETE + INSERT … SELECT` in one DB transaction). It can always be regenerated from `transactions`.

**`recompute_markers`**: `user_id, from_month, marked_at`, PK `user_id`
- The "dirty flag" written *in the same DB transaction* as ledger writes. See §3.3.

### 1.3 Forecasting (Chapter 3)

**`forecast_snapshots`**: `id, user_id, kind (eom_total|eom_category|next_month_total|next_month_category|balance_min), target_period, subject_id null, as_of date, method, point bigint, lower bigint, upper bigint, data_tier, inputs jsonb, created_at`
- Unique `(user_id, kind, subject_id, target_period, as_of)`. The daily job is idempotent.
- `actual` is **not** stored here; it's joined from ledger data when evaluating. (Storing it would
  duplicate truth.)
- This table powers the convergence curve and per-user method selection.

**`scenarios`**: `id, user_id, name, modifiers jsonb (schema-validated), created_at, updated_at`. Results are never stored.

### 1.4 Insights (table and lifecycle in Chapter 2; recommendation rules and reports in Chapter 4)

**`insights`**: `id, user_id, type (warning|anomaly|recommendation), rule_id, subject_type, subject_id, period, fingerprint, severity, score, impact_amount_yearly, impact_goal_days, facts jsonb, status, created_at, updated_at, seen_at, expires_at, resolved_at`
- **Unique `(user_id, fingerprint)`**. Deduplication is guaranteed by the database, not by application logic.
- Index `(user_id, status, score DESC)`.

**`insight_feedback`**: `insight_id, user_id, action (dismiss|snooze|acted|helpful|not_helpful), reason, created_at`

**`insight_suppressions`**: `user_id, rule_id, subject_id, until` (dismissal cooldowns).

**`monthly_reports`**: `user_id, year_month, facts jsonb, generated_at`, PK `(user_id, year_month)`
- A frozen month-end snapshot ("what changed and why"). Stored because it's a *document at a
  point in time*: if the user edits old transactions later, the report still reflects what was
  known at month close (and can be regenerated explicitly).

### 1.5 Infrastructure (only what's needed)
- **No generic outbox table.** The `recompute_markers` pattern covers the one dual-write problem
  we have (see §3.3). A general outbox would be justified only if we published to external systems.
- **No audit log table.** Out of scope for a personal app. `created_at` / `updated_at` are enough.
- **Job history** comes from BullMQ (completed/failed retention) + structured logs. A
  `job_runs` table is not needed.

### 1.6 What is NOT stored (calculated instead)
- Account balances (a sum over transactions; cache only if measured)
- Baselines, averages, trends, CVs, savings rate, runway
- Goal progress, expected completion date, required monthly saving
- Scenario results
- Anomaly scores (computed during evaluation; only the resulting insight is stored)
- Budget usage %
- Forecast *actuals* and errors (joined at evaluation time)

Rule: **store facts the user entered, and snapshots whose point-in-time value matters
(forecast snapshots, monthly reports, insights). Compute everything else.**

---

## 2. Backend architecture: NestJS modular monolith

### 2.1 Repository layout
```
costly/
  apps/
    api/            NestJS app. Two entrypoints: main.ts (HTTP), worker.ts (BullMQ processors + schedulers)
    web/            React + Vite SPA
  packages/
    finance-math/   pure TS: stats, forecasting, simulation, detection. No Nest, no Prisma.
    shared/         API DTO types / zod schemas shared by api and web
    data-generator/ synthetic personas → seed + experiment datasets
  experiments/      scripts + notebooks-as-markdown producing results for docs/09-research
  docker-compose.yml
  docs/
```
**One codebase, two runtime roles** (API and worker). Same modules, different bootstrap. That's
still a monolith: it shares a database and a deploy unit, and the worker can scale separately.

### 2.2 Modules

| Module | Owns (tables) | Responsibility | Depends on |
|---|---|---|---|
| `identity` | users, refresh_tokens | Registration, login, JWT guard, current user | — |
| `ledger` | accounts, categories, merchants, transactions | Ledger CRUD, transfers, balances, merchant normalisation. **Single writer of transactions.** | identity |
| `recurring` | recurring_rules | Rules CRUD, occurrence calculation, materialisation (via ledger), detection from history | ledger |
| `import` | import_batches, import_rows, categorization_rules | Upload, parse, preview, duplicate matching, commit (via ledger) | ledger, recurring |
| `planning` | budgets, goals, goal_contributions | Budgets and goals CRUD, goal progress | ledger |
| `analytics` | monthly_category_totals (opt.), recompute_markers | Facts: summaries, baselines, trends, CV, decomposition, anomaly detection | ledger, recurring, planning |
| `forecasting` | forecast_snapshots | EOM / next-month / balance forecasts, tiers, method selection, backtest | analytics, recurring |
| `simulation` | scenarios | Baseline builder, simulate, affordability | analytics, forecasting, planning |
| `insights` | insights, insight_feedback, insight_suppressions, monthly_reports | Rule evaluation, lifecycle, month close | analytics, forecasting, planning, simulation |
| `assistant` *(optional)* | — | LLM explanations over facts | insights, analytics, simulation (read-only) |
| `platform` (shared infra) | — | Prisma, BullMQ setup, Clock, config, logging, error mapping | — |

Dropped or merged on purpose:
- *Users* merged into `identity`. *Accounts, Categories, Transactions* are one aggregate cluster → `ledger`.
- *Budgets* + *Goals* → `planning` (both are "user intent about the future").
- *Recommendations* + *Anomalies* + *Notifications* → `insights`. There's no external notification channel.

### 2.3 Boundary rules
- A module exposes **one public service facade** (e.g., `LedgerService`, `AnalyticsFacts`).
  Other modules never import its internal services or touch its tables.
- **Dependencies point downward only** (the table order above). Enforced with `dependency-cruiser` in CI.
- Upward communication ("a transaction changed → analytics must update") goes through the
  **recompute marker + job** (§3.3), not direct calls. So `ledger` doesn't know `analytics` exists.
- Data access: **Prisma directly inside the owning module**. No generic repository layer.
  Analytics uses **raw SQL** (`$queryRaw` / Prisma TypedSQL) for aggregations, which is the right
  tool for GROUP BY and window functions.
- All domain math is called from `finance-math`. Services orchestrate (load facts → call pure
  function → persist/return).
- A **`Clock` provider** is injected everywhere "today" matters. Tests and the demo can set
  the date ("jump to the 30th of the month").

### 2.4 What we don't use, and why
- **CQRS (NestJS CQRS module):** Rejected. We do separate *reads* (analytics facts via SQL) from
  *writes* (ledger via Prisma), but that's just good module design. Command/query buses
  add ceremony without solving a problem.
- **Event sourcing:** Rejected. The ledger is already an append-mostly log of facts, and
  replaying events gives no benefit over recomputing from `transactions`.
- **Domain events via an in-process event emitter:** Mostly rejected. It hides control flow. The
  single cross-module trigger is explicit (the marker).

---

## 3. Background processing (BullMQ)

### 3.1 Queues and jobs

Scheduled jobs use BullMQ job schedulers (`upsertJobScheduler`), so re-deploying doesn't create duplicate schedules.

| Queue | Job | Trigger | Idempotency | Concurrency / retries |
|---|---|---|---|---|
| `import` | `parse-import` | User uploads file | `jobId = batchId`; batch status machine | conc. 2, 3 attempts, exp. backoff |
| `import` | `commit-import` | User confirms preview | `import_hash` unique constraint; batched inserts | conc. 2, 3 attempts |
| `recompute` | `recompute-user` | Ledger write marks dirty | `jobId = recompute:{userId}` + delay (debounce); job reads the marker | conc. 4, per-user dedupe, 5 attempts |
| `scheduled` | `materialize-recurring` | Repeatable, daily 00:15 (user TZ approx.) | Unique `(rule_id, occurrence)` | conc. 1 (fan-out to per-user jobs) |
| `scheduled` | `forecast-snapshot` | Repeatable, daily 03:00 | Unique snapshot key | fan-out per user |
| `scheduled` | `month-close` | Repeatable, 1st of month 02:00 | PK `(user_id, year_month)` on report | fan-out per user |
| `scheduled` | `expire-insights` | Repeatable, hourly | Pure update by `expires_at` | conc. 1 |
| `scheduled` | `sweep-dirty` | Repeatable, every 5 min | Enqueues `recompute-user` for stale markers | conc. 1 |
| `assistant` *(opt.)* | `explain` | User asks | `jobId = hash(question, factsVersion)` | rate-limited, 3 attempts |

Stays **synchronous**: create/update/delete transaction, all reads, simulate scenario, goal CRUD,
dismissing insights.

### 3.2 Job design principles (things to learn and demonstrate)
- **Jobs carry IDs, not data** (`{ userId }`, `{ batchId }`). The job loads current state, so a
  retried or late job never acts on stale payloads.
- **Every job is safe to run twice.** Guaranteed by unique constraints or recompute-by-replace
  (`DELETE + INSERT` in one DB transaction), not by "hoping it runs once".
- **Fan-out:** scheduled jobs enqueue per-user child jobs in bulk (`addBulk`). A failure for one
  user doesn't block the others, and each user's work is retried independently.
- **Failure handling:** exponential backoff, `attempts`; after final failure the job stays in the
  failed set (visible in Bull Board) and is logged with `jobId`, `userId`, error class.
  Poison-pill jobs (validation errors) are marked `UnrecoverableError` and aren't retried.
- **Observability:** Bull Board UI (local), structured JSON logs (pino) with `jobId` / `requestId`
  correlation, and counters for duration/failed/completed exposed at `/metrics` (optional Prometheus
  format, no Grafana required).
- **Graceful shutdown:** the worker drains active jobs on SIGTERM. Tested by killing the worker
  mid-import (experiment E8).

### 3.3 Dirty-marking pattern (solving dual-write without a general outbox)
Problem: we save a transaction in Postgres and need a job in Redis. If Redis enqueue fails after
commit, derived data goes stale. If we enqueue before commit, the job may run on uncommitted data.

Solution:
1. In the **same DB transaction** as the ledger write: `UPSERT recompute_markers (user_id, from_month = LEAST(existing, affected_month), marked_at = now())`.
2. **After commit:** `queue.add('recompute-user', {userId}, { jobId: 'recompute:'+userId, delay: 3000 })`.
   The same `jobId` means 20 fast edits → 1 job (debounce/dedupe).
3. The worker reads and **clears the marker atomically** (`DELETE … RETURNING`) and recomputes from
   `from_month`.
   - **BullMQ pitfall:** adding a job whose `jobId` already exists is silently ignored. That
     includes a job that's currently *active*, and a *completed* job that hasn't been removed. So:
     (a) use `removeOnComplete: true` / `removeOnFail` with retention for these jobs, and (b) at the
     end of the job, re-check the marker and, if a write arrived during the recompute, enqueue a
     follow-up (or rely on BullMQ's built-in `deduplication` option in debounce mode). A test
     writes *during* an active recompute and asserts the change is picked up.
4. If step 2 fails (Redis down), `sweep-dirty` finds markers older than 5 minutes and enqueues them.

That's a guaranteed eventual update with a small, understandable mechanism, and it's a solid thesis subsection.

Inside `recompute-user`, steps run in order: aggregates (if enabled) → anomaly checks on new
transactions → today's forecast snapshot refresh → insight evaluation. It starts as one job with
steps. It's split into a BullMQ Flow only if a measurement or failure mode justifies it.

### 3.4 Realtime UI updates
Optional: one Server-Sent Events endpoint `GET /events` pushes `insights.updated` /
`import.progress` messages (published by the worker via Redis pub/sub). If time is short,
the UI polls. There are no WebSockets unless bidirectional communication appears, and it won't.

---

## 4. End-to-end flows

### Flow 1: User adds a normal expense (4,500 AMD, Taxi, card)
1. **UI:** quick-add form → `POST /transactions {accountId, type: expense, amount: 450000, categoryId, merchant: "Yandex Go", occurredOn}`.
2. **API/ledger:** validate DTO (zod/class-validator) → check that account and category belong to the user
   → normalise the merchant (find or create `merchants`).
3. **PostgreSQL (one DB transaction):** insert `transactions`, upsert `recompute_markers(user, 2026-10)`.
4. **Response 201** with the transaction. The UI optimistically updates the list and MTD total
   (≈ 20–40 ms total).
5. **BullMQ:** after commit, add `recompute-user` (debounced).
6. **Worker:** duplicate check (same amount/merchant within 48h? no) → large-transaction check
   (4,500 is below P95 → nothing) → refresh EOM snapshot → run insight rules (Taxi now +12% pace-adjusted:
   below the 20% threshold → nothing).
7. **UI:** nothing new to show. That's correct behaviour for a normal expense, and the absence of
   noise is a feature.

### Flow 2: User receives salary
Case A (recurring rule exists: 900,000 AMD monthly, day 25):
1. **Scheduler 00:15:** `materialize-recurring` → per-user jobs → find rules with `next_occurrence ≤ today`.
2. **PostgreSQL:** insert income with `(recurring_rule_id, recurring_occurrence)`. A duplicate run
   hits the unique constraint → treated as already done. Advance `next_occurrence`. Mark dirty.
3. **Worker `recompute-user`:** month income updated; savings-rate forecast updated; balance
   projection recomputed (cash-flow warning from earlier in the week → **auto-resolved**);
   goal projections refresh.
4. **Insights:** `goal_acceleration` may trigger if the forecast surplus exceeds allocations.
5. **UI:** dashboard shows "Salary received". The cash-flow warning disappears; a goal chip may
   show "on track".
Case B (salary differs from the rule, e.g. 1,000,000 after a raise): the user edits the
materialised amount → the rule suggests "Update recurring amount to 1,000,000 from now on?" →
forecasts and goals update on the next recompute.

### Flow 3: User creates an apartment goal
1. **UI:** goal form (name, target 40M, current 6M via linked savings account or an initial
   contribution, target date, priority).
2. **API/planning:** validate, insert `goals` (+ `goal_contributions` if not linked). Synchronous.
3. **Response** includes the **projection computed on the fly**: `simulation` builds the baseline
   (analytics facts + forecast `Ŝ`) → `finance-math.projectGoals()` → remaining, required
   monthly saving, expected date, on-track status, gap.
4. **No queue needed** for the answer. A `recompute-user` is enqueued only so that
   `goal_off_track` / `goal_acceleration` insights get evaluated with the new goal.
5. **UI:** goal card: "Expected: Jun 2033 (21 months after your target). Gap 146,667/month.
   Biggest levers: Restaurants, Travel, Shopping." with a "Open in simulator" button.

### Flow 4: User suddenly spends much more than usual
Scenario: day 12, three restaurant transactions and a 180,000 electronics purchase.
1. **UI → API → ledger:** each insert is synchronous, as in Flow 1. Markers upserted.
2. **BullMQ:** 4 writes within seconds → **one** `recompute-user` job (debounce by jobId).
3. **Worker/analytics:**
   - Large transaction: 180,000 in Shopping, robust z = 5.1, > P95 → `unusual_transaction` insight.
   - Restaurants pace-adjusted MTD: +46% vs. expected-by-day-12 → `category_over_baseline` (warning).
   - EOM forecast: 612k (range 570–670k) vs. baseline 480k → stored snapshot.
   - Balance projection: minimum 35k on the 24th, below buffer → `cash_flow_warning`.
4. **Insights:** candidates scored. Upsert by fingerprint (a re-run doesn't duplicate). The top 3
   are shown. SSE pushes `insights.updated`.
5. **UI:** a warning banner "Spending is running 28% above your usual pace", with each insight
   showing *why* (baseline, percentile) and an impact line. The user can mark the purchase
   "expected one-off", which excludes it from baselines (`note`/flag), dismiss, or open the
   simulator.

### Flow 5: "Can I afford a 5,000,000 AMD purchase?"
1. **UI:** Affordability card: amount 5,000,000, month = now (optionally: "as a loan at 14% for 36 months").
2. **API:** `POST /scenarios/simulate { modifiers: [{kind:'one_time_expense', amount, at}] }`, synchronous.
3. **Simulation:** `ScenarioBaselineBuilder` loads facts (liquid 3.2M, savings 6M, `Î` 900k,
   `Ê` 480k, buffer 3 × 350k essentials = 1.05M, goals). `finance-math.simulate()` runs baseline
   and scenario over 36 months, then `compare()`.
4. **Result:** "Paying now: liquid + savings drop to 4.2M, which is above your 1.05M buffer, but
   Apartment moves from Jun 2033 to Jun 2034 (+12 months). Verdict: affordable with trade-offs.
   Alternative: saving up for it instead takes ~12 months and delays the goal by the same
   amount, but keeps liquid money well above the buffer the whole time. Loan option: 171k/month
   for 36 months, 1.15M total interest, Apartment +15 months (interest is the extra cost)."
5. **No DB writes** unless the user saves the scenario. **No queue.** Response in < 100 ms.
6. **UI:** verdict card + baseline vs. scenario balance chart + goal date chips. Optional:
   "Explain" → assistant verbalises the same result.

### Flow 6: Month ends → insights generated
1. **Scheduler (1st, 02:00):** `month-close` → fan-out per user.
2. **Worker per user (idempotent, PK `(user, year_month)`):**
   - analytics facts for the closed month: totals, savings rate, category deltas vs. baseline,
     frequency/price decomposition, trends, fixed/discretionary split;
   - forecast evaluation: compare last month's forecast snapshots with actuals → error stored in
     report facts (feeds "our forecasts for you are usually within ±X%");
   - budget review (`budget_unrealistic`), goal progress for the month;
   - insight rules for the new month; expire the previous month's period-bound insights;
   - write `monthly_reports`.
3. **UI next login:** "September report": saved 412k (46% rate, best in 4 months);
   spending +82k vs. August, 73% of it from Travel (+60k, one trip) and Restaurants (+18k, more
   visits); forecast accuracy for September −4%; Apartment moved 2 weeks earlier.
   2–3 recommendations for October.
4. **Optional AI:** "Explain my month" → the report facts JSON → narrative.

---

## 5. Local demo environment

```yaml
# docker-compose.yml (sketch; the real file is written in Chapter 1)
services:
  postgres: image postgres:18, volume, healthcheck
  redis:    image redis:8, appendonly yes
  api:      build apps/api, command "node dist/main.js",   depends_on healthy db+redis, port 3000
  worker:   build apps/api, command "node dist/worker.js", same image as api
  web:      build apps/web (nginx serving static build) or vite dev, port 5173
  # dev only: bull-board mounted in api under /admin/queues (auth-protected)
```

- `make up` / `pnpm dev:up` → everything starts. `pnpm db:migrate && pnpm db:seed` loads demo data.
- **Seed via `data-generator`:** deterministic (seeded PRNG) personas:
  - *Anna, 27, software engineer:* stable salary, rent, 4 subscriptions, rising restaurant
    trend, apartment + car goals, one trip in July; 12 months.
  - *Student:* low irregular income, high volatility; tests cold-start and low-confidence paths.
  - *Family-like:* high fixed share, tight cash flow; tests cash-flow warnings.
  - Each generated dataset ships with a **ground-truth file** (recurring rules, injected anomalies,
    duplicates) used by experiments.
- **Demo clock:** in demo mode an admin endpoint sets the `Clock` offset ("today = 28 Sep") so month-end
  and pace behaviour can be shown live.
- The whole system runs on a laptop with ~1–2 GB RAM.
