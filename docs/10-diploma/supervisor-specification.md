# Costly: Initial Project Specification

**Diploma title:** «Անձնական ֆինանսների կառավարման, վերլուծության և կանխատեսման համակարգի մշակում»
*(Development of a system for personal finance management, analysis and forecasting)*

**Degree:** Bachelor, Applied Mathematics and Computer Science
**Author:** Rudolf Harutyunyan
**Supervisor:** _______________
**Period:** October 2026 – June 2027
**Document status:** initial specification for supervisor review

---

## 1. Project idea

Costly is a personal finance web application. It records a person's accounts, income,
expenses and recurring payments, and uses that history to answer forward-looking questions:

- Is my spending this month normal for me, and if not, why?
- How much will I probably spend by the end of the month?
- When will I reach my savings goal at my current pace?
- Can I afford a large purchase, and what does it cost my goals?
- Which specific change would help most?

## 2. Problem

Expense trackers and banking apps show where money went. They rarely compare spending with the
person's own normal behaviour, they don't project the future, and they give generic advice.
A user who wants to save 40,000,000 AMD for an apartment has no easy way to see whether their
current habits are enough, or what would change the date.

## 3. Objective

Design and build a working system that:

1. keeps a correct financial record (accounts, transactions, transfers, recurring payments);
2. analyses spending behaviour against the user's own history;
3. forecasts short-term spending and balances, with an honest measure of uncertainty;
4. projects goal completion and simulates "what-if" scenarios;
5. produces concrete, quantified recommendations;

and to **evaluate** the analytical and forecasting methods experimentally.

## 4. Why it's useful

The system turns data a person already has (a bank statement) into decisions: a warning before
overspending, a realistic date for a goal, and a clear answer to "can I afford this?". Every
result is calculated from the user's own data with transparent formulas.

## 5. Main functionality

| Area | Functionality |
|---|---|
| Financial record | Accounts, income, expenses, transfers between accounts, categories (essential / discretionary), merchants, recurring payments (entered or automatically detected), bank statement import (CSV/XLSX) |
| Planning | Monthly category budgets; financial goals with priorities |
| Analytics | Comparison with personal baseline, month-to-date pace, trends, spending stability, fixed vs. discretionary structure, emergency-fund months, explanation of changes between months |
| Anomalies | Unusually large transactions, category spikes, possible duplicates, recurring payment price increases |
| Forecasting | End-of-month spending, next-month spending, category spending, account balance for the next 1–3 months |
| Decision support | Goal projection, what-if simulator, affordability check, recommendations with a quantified effect |
| Optional AI | Natural-language explanation of already computed results |

## 6. Difference from an expense tracker

| Expense tracker | Costly |
|---|---|
| "Food: 180,000 AMD" | "Food is 23% above your 3-month average, mostly because of more restaurant visits" |
| Shows the current month | Forecasts the end of the month with a range |
| Goal = progress bar | Goal = expected completion date, required monthly saving, what delays it |
| General tips | "Reducing restaurants by 15% saves ≈ 118,000 AMD/year and moves your apartment goal ≈ 8 weeks earlier" |
| No decision support | Simulates a purchase, loan, salary change or spending change against real data |

## 7. Analytical component

Analytics is based on descriptive statistics applied to the user's own history:
monthly totals and savings rate; baselines (average or median of recent months); pace-adjusted
month-to-date comparison; trend detection with linear regression; spending stability using the
coefficient of variation; decomposition of changes into *frequency* and *average amount* effects.

Anomaly detection uses understandable statistics: robust z-score (median and median absolute
deviation), percentile thresholds and simple rules for duplicates and price changes. Methods are
compared on synthetic data with known anomalies (precision, recall, false alerts per month).

## 8. Forecasting component

The main idea is to split spending into **known recurring obligations** (rent, subscriptions,
salary), which are predicted almost exactly from their schedule, and **variable spending**,
predicted with lightweight time-series methods: moving average, weighted moving average,
exponential smoothing and Holt's trend method. The end-of-month forecast blends the current
month's pace with historical behaviour, weighted by how much of the month has passed.

The system uses **data-sufficiency levels**: with a few days of data it doesn't forecast; the
methods and the confidence shown grow with the amount of history. Methods are evaluated with
rolling-origin backtesting against a naive baseline (MAE, MASE, interval coverage). Complex ML
models are deliberately not used, because personal monthly data is too short for them.

## 9. What-if and decision-support component

A deterministic simulator projects the user's finances month by month (default three years)
from real data, then applies scenario changes: income change, spending change in a category,
extra saving, one-time purchase, new recurring payment, or a loan (annuity formula). It reports
the effect on goal dates, the minimum balance, the emergency buffer, and loan interest, and gives
an affordability verdict with alternatives (pay now, save first, or take a loan).

Recommendations are generated by explicit rules over calculated facts. Each has a trigger, a
quantified impact (calculated with the same simulator), a priority, duplicate protection,
expiry and user feedback.

## 10. Optional AI component

If time allows, a language model will explain results already computed by the system
("Why did I spend more this month?"). The model receives only structured facts and never
performs calculations or makes financial decisions. The system is complete without this component.

## 11. Backend architecture

A **modular monolith** in NestJS (TypeScript): one codebase with clear domain modules (identity,
ledger, recurring payments, import, planning, analytics, forecasting, simulation, insights).
Dependencies point in one direction and are checked automatically. The same codebase runs as
two processes: the **HTTP API** and a **background worker**. All mathematical logic (statistics,
forecasting, simulation) lives in a separate framework-independent package, which makes it easy
to test and to reuse in experiments.

Microservices, message brokers such as Kafka or RabbitMQ, and container orchestration are
intentionally not used. They aren't needed for this problem.

## 12. Database

PostgreSQL. The model is introduced gradually:
- **core:** users, accounts, categories, merchants, transactions, recurring rules;
- **analytics & planning:** statement imports, categorisation rules, budgets, goals;
- **forecasting:** forecast snapshots (to measure accuracy over time), saved scenarios;
- **insights:** recommendations/warnings with lifecycle, monthly reports.

Key rules: money is stored as integers in minor units; balances and statistics are calculated,
not stored; database constraints guarantee correctness (e.g., a recurring payment can't be
created twice for the same date, the same statement row can't be imported twice).

## 13. Background processing

**BullMQ with Redis** is used only where asynchronous work is justified:
- bank statement import (large files, progress, retries);
- scheduled tasks: daily creation of recurring transactions, daily forecast snapshots,
  month-end report generation, expiry of old insights;
- recalculation of analytics, forecasts and recommendations after data changes, combined so that
  many quick edits trigger one recalculation.

Normal operations (adding a transaction, reading data, running a simulation) stay synchronous.
Every background job is designed to be safe to run more than once, and this is verified by tests
(repeated runs, parallel runs, worker crash during a job).

## 14. Technology stack

TypeScript, Node.js, NestJS, PostgreSQL, Prisma (with SQL for analytical queries), Redis,
BullMQ, React (Vite), Docker Compose. Testing: Vitest/Jest, property-based tests (fast-check),
integration tests against real PostgreSQL/Redis containers, k6 load tests. The whole system runs
locally with `docker compose up`. Cloud deployment is not required.

## 15. Development stages

| Stage | Period | Result |
|---|---|---|
| 0. Setup and specification | late Sep – early Oct 2026 | Agreed specification, repository, CI, local environment |
| 1. Financial core | Oct – Nov 2026 | Accounts, transactions, transfers, categories, recurring payments, first background job, synthetic data generator |
| 2. Import and analytics | Dec 2026 – Jan 2027 | Statement import, recurring detection, behavioural analytics, anomaly detection, budgets, basic goals |
| 3. Forecasting and simulation | Feb – Mar 2027 | Forecasts with confidence levels, backtesting, goal projection, what-if simulator, affordability check |
| 4. Recommendations and completion | Apr – May 2027 | Recommendation engine, monthly reports, performance optimisation, optional AI, UI polish |
| 5. Evaluation and defense | late May – Jun 2027 | Final experiments, thesis, demonstration |

Each stage ends with a working version of the application and a written section of the thesis.

## 16. Testing and research

Planned experiments with measurable results:
1. comparison of forecasting methods (error vs. a naive forecast);
2. how the end-of-month forecast error decreases during the month;
3. forecast quality depending on the amount of history (cold start);
4. anomaly detection methods on data with known anomalies (precision/recall);
5. accuracy of automatic recurring-payment detection;
6. database query performance with and without indexes/pre-aggregation (≈ 1,000 users, 2 years of data);
7. transaction and import throughput;
8. background job behaviour: deduplication, concurrency, recovery after a crash;
9. correctness of recommendation rules on prepared scenarios.

Data sources: a synthetic data generator with several realistic user profiles and known
"ground truth", plus the author's own anonymised bank history.

## 17. Expected final result

A working, locally deployable application that demonstrates the full chain
*record → analyse → forecast → decide*, with documented architecture, a tested codebase,
and experimental results that show how well the analytical and forecasting methods work, and
where they don't.

## 18. Knowledge I expect to gain

- domain modelling of financial data and correctness through database constraints;
- modular monolith design and module boundaries;
- background processing: idempotency, retries, scheduling, deduplication, failure recovery;
- SQL analytics, indexing and query performance analysis;
- time-series forecasting basics and proper evaluation methodology;
- simulation design with pure, testable functions;
- a multi-level testing strategy and performance testing.

## 19. Areas where supervisor mentoring would help most

1. Review of the domain model and database constraints before implementation starts.
2. Module boundaries and dependencies in the monolith.
3. Background job design and failure scenarios.
4. Query optimisation and reading execution plans.
5. Testing strategy: what to test at which level.
6. API design conventions and regular code review at the end of each stage.
7. Production-quality practices: configuration, logging, graceful shutdown, safe migrations.
