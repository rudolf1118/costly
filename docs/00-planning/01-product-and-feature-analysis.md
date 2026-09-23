# 01 — Product & Feature Analysis

> Status: planning, pre-implementation. Covers: what Costly is, the financial foundation,
> what not to build, and a critical review of the idea.

---

## 1. What exactly are we building?

**Costly is a single-user personal finance application that turns a person's own transaction
history into quantified, goal-aware decisions.**

It records money (accounts, income, expenses, transfers, recurring obligations), but the
recording is the input, not the product. The product is the layer above it:

```
record  →  understand  →  anticipate  →  decide
ledger     analytics       forecasting    goals + what-if + recommendations
```

### Target user

A salaried individual (the reference persona is a 22–35-year-old working in Yerevan, paid in AMD)
who:

- has a regular income and a mix of fixed and discretionary expenses;
- has one or two concrete savings goals (apartment, car, emergency fund, relocation);
- is willing to spend ~2 minutes per day, or ~15 minutes per month importing a bank statement;
- wants to know *"am I on track, and what should I change?"* more than *"make me a pie chart"*.

**Not targeted:** households with shared finances, freelancers with complex invoicing,
investors, small businesses. Each one brings its own domain model and would double the scope.

### Core problem

People can see what they spent. They can't see:

1. whether their current behaviour is enough to reach what they want, and
2. which specific change would matter most.

Banking apps and expense trackers answer "where did my money go?" Very few answer
"given how I actually behave, when will I have 40M AMD, and what moves that date?"

### Core value

> "Costly tells me whether I'm on track for my goals, why, and which concrete change moves
> the date the most, calculated from my own data, not from generic advice."

### Daily / weekly / monthly use cases

| Frequency | Use case |
|---|---|
| Daily (≤1 min) | Add an expense, or glance at "this month so far vs. usual pace" |
| Weekly | Check warnings: category running hot, unusual transaction, possible duplicate |
| Monthly | Import a bank statement; read the month-end report ("what changed and why") |
| Occasionally | Big decision: "Can I afford X?", "What if I change jobs / take a loan?" |
| Occasionally | Create or adjust a goal; see how the projected date moved |

### Why would someone keep using it?

Honest answer: **manual entry is the #1 reason finance apps get abandoned.** Costly can't fully
solve that without bank integrations, which are out of scope. Mitigations:

1. **CSV/XLSX statement import** with merchant-based auto-categorisation rules. Monthly import
   replaces daily discipline.
2. **Recurring transactions are materialised automatically**, so salary, rent and subscriptions
   don't need to be typed.
3. **The payoff is personal and forward-looking.** Goal date movement and month-end reports give
   the user a reason to come back, which a static chart does not.

### What differentiates it from an expense tracker

| Expense tracker | Costly |
|---|---|
| Shows totals per category | Compares against *your* baseline and explains the delta (count vs. price effect) |
| Shows this month | Projects end of month with an uncertainty range, separating known obligations from discretionary spend |
| Goals = progress bar | Goals = projection: expected date, required monthly saving, what's slowing it down |
| No decision support | What-if simulator: purchase, loan, salary change, category cut, all against your real baseline |
| Generic tips | Recommendations derived from computed facts, each with a quantified impact in AMD and goal-weeks |
| No quality measurement | Forecast accuracy is tracked and backtested; the app knows when it doesn't know |

### Final diploma version: capability statement

At defense, Costly should be able to:

1. Maintain a correct multi-account ledger with transfers that don't distort income/expense.
2. Import bank statements asynchronously with categorisation rules and duplicate protection.
3. Detect recurring payments from history and use them in forecasts.
4. Produce behavioural analytics: baselines, trends, volatility, fixed-vs-discretionary split,
   period-over-period decomposition.
5. Flag anomalies (unusual transactions, category spikes, duplicates, recurring price increases)
   with explainable statistics.
6. Forecast end-of-month spending, next-month spending and account balance, with confidence
   levels that depend on data sufficiency.
7. Project goal completion and simulate scenarios deterministically.
8. Generate prioritised, deduplicated, expiring recommendations with quantified impact.
9. (Optional) Explain any of the above in natural language via an LLM that only sees computed facts.
10. Back each of the claims above with a measured experiment (forecast error, detection precision/recall, query latency).

---

## 2. Financial foundation: feature-by-feature decisions

Legend: **Core** = Chapter 1–2 · **Later** = introduced in a later chapter · **Excluded** = not built.

### Accounts: **Core**
1. *Why:* Money lives in places (card, cash, savings, deposit). Balance forecasting and
   affordability need to know how much *liquid* money exists.
2. *Problem solved:* "How much do I actually have available?"
3. *MVP:* Yes.
4. *Analytics:* Yes (liquid vs. savings balance, emergency-fund months).
5. *Forecasting:* Yes (balance projection is per account type).
6. *Worth it:* Yes, it's cheap. Keep types minimal: `checking`, `cash`, `savings`, `credit_card`.
   Add an `is_liquid` flag (derived from type, overridable).

### Income: **Core**
Required for savings rate, cash flow, goal projection. Modelled as a transaction type, not a
separate entity.

### Expenses: **Core**
Obviously. Also a transaction type.

### Transfers: **Core, and correctness-critical**
1. *Why:* Moving 500,000 AMD from card to savings isn't spending. If it's recorded as an
   expense, every metric is wrong.
2. *Problem:* Correct income/expense/savings figures.
3. *MVP:* Yes.
4–5. Analytics and forecasting depend on transfers being *excluded* from flows but *included*
   in account balances.
6. *Design:* A transfer is **two transaction rows** (outflow from A, inflow to B) sharing a
   `transfer_group_id`, created atomically. This handles different account currencies later and
   keeps "balance = sum of rows" true for every account. Full double-entry bookkeeping is
   rejected as overkill for a personal app.

### Categories: **Core**
- Two levels max (e.g., `Food → Restaurants`, `Food → Groceries`). Deeper trees add UI cost and
  little analytic value.
- System defaults are seeded; users can add, rename and archive (never hard-delete if used).
- **Each category has a `nature`: `essential_fixed`, `essential_variable`, `discretionary`.**
  This is the most important piece of metadata in the system. It drives fixed-vs-discretionary
  analytics, emergency-fund calculation (essential expenses only), and the rule that
  recommendations only ever suggest cutting discretionary spend.

### Merchants: **Core (lightweight)**
1. *Why:* Recurring detection, categorisation rules, duplicate detection and "top merchants"
   all need a stable merchant identity. A free-text description isn't enough.
2. *Design:* `merchants` table with a normalised name (`YANDEX GO*1234` → `yandex go`) and an
   optional default category. Transactions reference the merchant, nullable.
3. *Worth it:* Yes. It's small and unlocks four features.

### Tags: **Excluded**
Nothing in analytics, forecasting or recommendations depends on tags. They add a many-to-many
table, filters and UI for marginal value. Categories + merchants + notes cover the need.

### Recurring transactions: **Core (Ch1 manual) → Later (Ch2 auto-detected)**
1. *Why:* Rent, salary, subscriptions, loan payments. The most predictable part of anyone's finances.
2. *Problem:* Removes manual entry; makes future obligations known.
3. *MVP:* Manual recurring rules in Ch1 (also the first real BullMQ scheduled job).
4. *Analytics:* Recurring load (% of income committed), subscription total.
5. *Forecasting:* **Critical.** The forecast is decomposed as
   *known recurring obligations + estimated discretionary spend*. This decomposition is the main
   technical idea of the forecasting chapter.
6. *Worth it:* Yes. High value for the cost.

### Subscriptions: **Not a separate feature**
A subscription is a recurring rule with a discretionary category. Build a "Subscriptions" *view*
(filter over recurring rules), not a separate entity. Price-increase detection works on recurring
rules generally.

### Budgets: **Core-lite (Ch2), forecast-aware (Ch3)**
1. *Why:* A monthly limit per category is the user's own statement of intent. That makes
   recommendations more personal ("you said 80k for restaurants").
2. *MVP:* No. Budgets are useful only once analytics exist.
3. *Design:* Monthly amount per category. No rollover, no envelope accounting, no weekly
   budgets. Budget-vs-actual in Ch2; budget *pace* (projected overrun) in Ch3.
4. *Worth it:* Yes, if kept this simple.

### Financial goals: **Core to the product (basic in Ch2, projected in Ch3)**
The central feature. It's what connects analytics, forecasting and decisions. See
`02-engines-design.md §3`.

### Debts / loans: **Excluded as a tracked entity; included as a simulation input**
- Tracking loans properly (amortisation schedules, early repayment, variable rates) is a
  sub-domain of its own.
- Existing loan payments = a recurring expense in category `Loan payments` (`essential_fixed`).
- *New* loans exist only inside the what-if simulator (annuity formula). That covers the useful
  question ("what if I take a loan?") at a fraction of the cost.

### Currencies: **Schema-ready, single currency implemented**
- Armenia makes this tempting (AMD + USD accounts are common), but multi-currency analytics
  means exchange-rate history, conversion timing, and FX gain/loss. It's a trap for a
  one-person diploma.
- Decision: every account has a `currency` column and money is stored as `bigint` minor units
  from day one, but the user has one **base currency** and v1 only allows accounts in it.
  Multi-currency (with a manually entered rate stored per transaction as `amount_base`) is listed
  as an optional extension.

### Split transactions, attachments/receipts, notes
- Notes: **Core**. It's a single text column.
- Split transactions: **Excluded**. Rare for the target user, and it complicates every aggregate.
- Receipt photos / OCR: **Excluded**.

### Final recommended foundation feature set

| Feature | Chapter | Note |
|---|---|---|
| Users & auth (email + password, JWT access + refresh) | 1 | Single-user data isolation |
| Accounts (4 types, liquid flag) | 1 | |
| Transactions: income / expense / transfer | 1 | Money as `bigint` minor units |
| Categories: 2-level, with `nature` | 1 | Seeded defaults |
| Merchants: normalised, default category | 1 | |
| Recurring rules (manual) + daily materialisation | 1 | First BullMQ job |
| CSV/XLSX statement import + categorisation rules | 2 | Async, idempotent |
| Recurring detection from history | 2 | User confirms suggestions |
| Budgets (monthly per category) | 2 | |
| Goals (basic) | 2 | Projection in Ch3 |
| Multi-currency | optional | Schema ready |
| Tags, splits, receipts, loan tracking | excluded | |

---

## 3. What NOT to build (scope-creep firewall)

These are deliberately excluded. Revisiting any of them requires a written reason in
`docs/03-architecture/adr/`.

**Product scope**
- Real bank integrations / open banking / scraping bank websites
- Investment portfolio tracking, stock/crypto prices, trading
- Double-entry accounting, invoicing, tax calculation
- Multi-user households, shared budgets, family accounts, social features
- Loan/mortgage tracking with amortisation schedules (a loan exists only as a what-if input)
- Receipt OCR, photo attachments
- Tags, split transactions
- Email / SMS / push notifications (in-app insight feed only)
- Native mobile app (a responsive web UI is enough)
- Gamification, streaks, badges
- Live exchange-rate feeds
- Payment processing of any kind
- A chatbot as the primary interface

**Technology**
- Microservices, Kubernetes, service mesh, Terraform, cloud-specific services
- Kafka, RabbitMQ, NATS (BullMQ covers every asynchronous need)
- Event sourcing, full CQRS
- GraphQL (REST is enough; there's no client diversity)
- Deep learning / LSTM / Prophet / ARIMA-family models (the data length doesn't justify them;
  see forecasting analysis)
- A separate cache layer in Redis *unless a measurement shows a need*
- Elasticsearch / OLAP databases (PostgreSQL handles this data volume)
- Fine-tuning or training any ML/LLM model

---

## 4. Challenging the project

### What's currently boring?
- Accounts, categories and transactions: the classic CRUD. Unavoidable, but it should take
  weeks, not months. The interesting parts of Chapter 1 are correctness (transfers, money
  representation, idempotent recurring posting), not screens.
- Dashboards with pie charts. Every tracker has them. Costly needs them, but they aren't the
  story, and they shouldn't take a large share of the time.

### What looks like a normal expense tracker?
Anything that shows a number without comparing it to something: category totals, a month list,
a budget progress bar. The fix is systematic: **every number shown should have a reference point**
(baseline, budget, forecast, or goal requirement).

### What actually differentiates it?
1. Goal projection + what-if simulator (the signature feature).
2. Recurring + discretionary decomposed forecasting with honest confidence levels.
3. Quantified recommendations tied to goals ("…moves your apartment goal 8 weeks earlier").
4. Period-over-period decomposition ("you ate out *more often*, not *more expensively*").

### What sounds impressive but has little value?
- **ML forecasting.** With 6–24 monthly points per category, ML can't beat simple methods in
  any meaningful, defensible way.
- **Monte Carlo simulation** of goals from 6 months of history. Resampling six numbers gives
  a probability that *looks* precise and isn't. Optional only, and labelled as such.
- **An "AI financial advisor".** An LLM giving advice is a liability. An LLM *explaining
  computed facts* is fine.
- **Real-time WebSockets everywhere.** One user, one tab. A single push channel for
  "insights updated" is enough, and polling would also work.
- **Anomaly detection on everything.** Without restraint it produces alert fatigue. The false
  positive *rate per month* has to be measured and kept low.
- **Weekday/hour-of-day spending heatmaps.** Pretty, rarely actionable.

### What would make the diploma technically stronger?
1. **A backtesting harness.** Forecasts evaluated with rolling-origin validation, compared
   against a naive baseline. This turns "I built forecasting" into "method X reduces error by
   Y% vs. naive on Z datasets".
2. **A synthetic data generator with ground truth.** Personas with known recurring
   payments, seasonality and injected anomalies. It enables precision/recall for anomaly
   detection and recurring detection, and it's the demo seed.
3. **Stored forecast snapshots.** Tracking how the end-of-month forecast converges as the month
   progresses gives a real, novel chart for the thesis.
4. **A pure `finance-math` package.** All statistics, forecasting and simulation as pure,
   property-tested functions with no framework dependency.
5. **Correctness-focused background processing.** Idempotent jobs, debounced recomputation,
   crash recovery, all demonstrated with tests.

### What could become too difficult for one student?
- The frontend. Charts, forms and the simulator UI can eat months. Mitigation: a component
  library (e.g., shadcn/ui or Mantine) and one chart library; no custom design system.
- Multi-currency (excluded for this reason).
- Robust CSV parsing across many banks. Mitigation: support 1–2 real bank formats + a generic
  column-mapping step.
- Recurring detection with irregular real data. Mitigation: suggestions require user confirmation.
- Writing the thesis at the end. Mitigation: each chapter ends with written diploma material.

### Is forecasting actually meaningful with the available data?
**Partly, and the thesis should say so openly.**
- *End-of-month forecasting* is meaningful: by day 15 you have half the month's actual data plus
  known remaining recurring payments. Error shrinks predictably as the month progresses.
- *Next-month total* is moderately meaningful: the recurring portion is nearly exact, and the
  discretionary portion has real variance. Honest intervals matter more than point accuracy.
- *Category-level monthly forecasting* is noisy for volatile categories (travel, shopping).
  Costly should label these "unpredictable" (high coefficient of variation) instead of
  pretending.
- *Seasonality* needs ≥ 24 months of data. Out of scope except as a mention.

The research question becomes: *how much does decomposing recurring vs. discretionary
spending, plus data-sufficiency-aware method selection, improve forecast accuracy over naive
methods on personal-finance data?* That's a defensible, measurable question.

### Is AI necessary?
No. The system must be complete without it. It's a presentation layer for facts and is
scheduled last (Chapter 4, optional).

### Is BullMQ justified?
Yes, for specific jobs, and the thesis should list them explicitly:
- statement import (large file, progress reporting, retry);
- scheduled work (daily recurring materialisation, forecast snapshots, month-end close, insight expiry);
- debounced recomputation of derived data after writes;
- LLM calls (slow, rate-limited, retry-worthy).

Not justified for: creating transactions, running a what-if scenario (pure in-memory math in
milliseconds), reading analytics.

### Is Redis justified?
As the BullMQ backend, yes. As a cache, **not by default**. Add caching only if the performance
experiment shows a query that needs it. Rate limiting for auth endpoints can also use it.

### Are we overengineering anything?
Risks to avoid:
- Repository interfaces wrapping Prisma "in case we switch ORM". Don't. Use Prisma directly in
  module services and raw SQL for analytics.
- A generic event bus. In-process calls + one "mark dirty and enqueue" helper are enough.
- Separate modules for Notifications, Anomalies and Recommendations. These are one concept,
  **Insights**, with a `type` column.
- Pre-computed aggregate tables before measuring. Start with on-the-fly SQL; introduce
  aggregates when the performance experiment justifies them (it becomes an experiment result).
