# 05 — Costly: Final Specification (the version we build)

> One recommendation, no alternatives. Details and justifications are in documents 01–04.

## 1. Product definition
Costly is a single-user personal finance web application that records a person's money and
turns their own history into analysis, forecasts and quantified, goal-aware decisions.

## 2. Core problem
People can see what they spent, but not whether their current behaviour gets them to their goals,
or which specific change would matter most.

## 3. Core differentiator
**Goal-aware decision support built on the user's own baseline:** a deterministic what-if
simulator and recommendation engine that express every suggestion as "X AMD per year and N
weeks earlier for your goal", backed by forecasts whose accuracy is measured.

## 4. Target user
A salaried individual (22–35, AMD income) with 1–2 concrete savings goals who will import a
statement monthly or add expenses daily.

## 5. Final feature list
Ledger (accounts, income/expense, transfers, 2-level categories with nature, merchants) ·
recurring rules (manual + detected) · statement import with categorisation rules · budgets ·
goals with projection · analytics (baselines, pace, trend, volatility, structure, runway,
decomposition) · anomaly detection (4 detectors) · forecasting (EOM, next month, category,
balance) with data tiers · what-if simulator & affordability · insights (warnings, anomalies,
recommendations) with lifecycle · monthly report · optional AI explanations.

## 6. First working version (`v0.1`, end of November 2026)
Auth, accounts, categories, merchants, transactions with transfers, manual recurring rules
with daily materialisation, dashboard v1, 12-month seeded persona, Docker Compose, CI.

## 7. Final diploma version (`v1.0`, May 2027)
Everything in §5, all experiments E1–E9 executed, demo mode, documentation complete.

## 8. Optional features (only if ahead of schedule)
AI explanations and Q&A (E10) · SSE push · goal completion range from percentiles · multi-currency
accounts with per-transaction rate · AI category suggestions for unknown merchants · Armenian UI.

## 9. Explicitly excluded
Bank integrations · investments/crypto · loans as tracked entities · multi-user/households ·
tags · split transactions · receipts/OCR · email/push notifications · native mobile · ML/ARIMA/Prophet
models · microservices · Kubernetes · Kafka/RabbitMQ · event sourcing · CQRS · GraphQL · cloud deployment.

## 10. Modular architecture
NestJS modular monolith, one codebase with two runtime roles (API, worker).
Modules (dependencies point downward):
`identity` → `ledger` → `recurring` → `import` → `planning` → `analytics` → `forecasting` → `simulation` → `insights` → `assistant` (optional), plus shared `platform`.
Pure math in `packages/finance-math`. Cross-module "data changed" goes through recompute markers and a job.
Prisma inside owning modules, raw SQL for analytics, no generic repository layer.

## 11. Database domains
- **Core:** users, refresh_tokens, accounts, categories, merchants, transactions, recurring_rules
- **Analytics:** import_batches, import_rows, categorization_rules, budgets, goals, goal_contributions, recompute_markers, *(monthly_category_totals only if E6 justifies it)*
- **Forecasting:** forecast_snapshots, scenarios
- **Insights:** insights, insight_feedback, insight_suppressions, monthly_reports
- **Infrastructure:** none beyond the above. BullMQ holds job state.
Not stored: balances, baselines, projections, scenario results, scores.

## 12. BullMQ jobs
`parse-import`, `commit-import`, `recompute-user` (debounced, deduped per user),
`materialize-recurring` (daily), `forecast-snapshot` (daily), `month-close` (monthly),
`expire-insights` (hourly), `sweep-dirty` (every 5 min), `explain` (optional).
All idempotent through unique constraints or replace-in-transaction; fan-out per user for scheduled jobs.

## 13. Analytics methods
Monthly summary & savings rate · k-month mean / median baselines · pace-adjusted MTD with the
user's cumulative spending profile · rolling averages · OLS trend with R² gate · CV volatility
classes · fixed/discretionary structure and recurring load · runway · category and
frequency×price decomposition · income stability.

## 14. Forecasting methods
Recurring + discretionary decomposition. Naive (benchmark), SMA, WMA, SES, Holt (tier-dependent,
per-user selection by backtest). Credibility-blended EOM forecast. Empirical residual intervals.
Five data tiers (< 14 days … 9+ months) that restrict what is shown. Evaluated by rolling-origin MAE,
MASE, coverage.

## 15. Recommendation engine
Pure rules over a facts context (10 initial rules). Score = severity × normalised impact ×
confidence × freshness. Impact computed through the what-if engine. Fingerprint uniqueness,
lifecycle states, 60-day dismissal cooldown, expiry, auto-resolve, feedback, outcome tracking.

## 16. What-if engine
Pure `simulate(baseline, modifiers)` over a monthly horizon (default 36 months). Eight modifier types
including loan (annuity). Comparison output: goal date shifts, minimum balance, buffer breaches, interest,
affordability verdict and alternatives. Synchronous API, saved scenarios re-run on fresh data.

## 17. AI role
Optional explanation layer. Receives computed facts only, may call read-only engine tools, never
computes or decides. Numeric grounding check. The system is complete with AI disabled.

## 18. Technology stack
TypeScript everywhere · Node.js 24 LTS · NestJS · PostgreSQL 18 · Prisma (+ raw SQL/TypedSQL) ·
Redis 8 · BullMQ + Bull Board · React + Vite + TanStack Query + a component library (shadcn/ui or Mantine) +
one chart library (Recharts or ECharts) · zod for shared schemas · Vitest/Jest, fast-check, Testcontainers,
Supertest, Playwright (a few e2e), k6 · pino logging · Docker Compose · GitHub Actions CI · pnpm workspaces.

## 19. Testing strategy
- **Unit + property tests** for all of `finance-math` (the highest-value tests)
- **Integration tests** against real Postgres/Redis (Testcontainers) for modules and jobs
- **Idempotency & concurrency tests** for every job (run twice, run in parallel, kill mid-run)
- **Differential tests:** SQL analytics vs. an in-memory reference implementation
- **Golden tests** for forecasts and simulations on fixed personas
- **Scenario tests** for insight rules
- **API tests** (Supertest) including authorisation isolation; **a few Playwright** flows for the demo path
- **Performance:** k6 + EXPLAIN ANALYZE (E6, E7)

## 20. Academic-year roadmap
| Chapter | Period | Theme | Version |
|---|---|---|---|
| 0 | late Sep – early Oct 2026 | Setup, spec, ADRs | — |
| 1 | Oct – Nov 2026 | Financial core & architecture foundation | v0.1 |
| 2 | Dec 2026 – Jan 2027 | Import, analytics, anomalies, budgets, basic goals | v0.2 |
| 3 | Feb – Mar 2027 | Forecasting, goal projection, what-if | v0.3 |
| 4 | Apr – May 2027 | Recommendations, month close, optional AI, performance, polish | v1.0 |
| Final | late May – Jun 2027 | Experiments rerun, thesis, defense | — |
Feature freeze: 15 May 2027.

## 21. Main risks
Frontend time sink · insufficient real data · modest forecast accuracy (handled as a research result) ·
scope creep · late thesis writing. Mitigations are in `04-roadmap-experiments-defense.md §3`.

## 22. What I will learn
Domain modeling of money and time · transactional correctness and constraints as invariants ·
module boundaries in a monolith · background job design (idempotency, dedupe, retries, scheduling,
fan-out, crash recovery, dual-write) · SQL analytics, indexing and query-plan reading · time-series
forecasting fundamentals and honest evaluation · simulation design with pure functions · property-based
and integration testing · performance measurement · (optionally) safe LLM integration.

## 23. Where the backend supervisor can help most
1. Reviewing the domain model and constraints before Ch1 migrations (money, transfers, recurring)
2. Module boundaries and dependency direction: where a boundary is wrong
3. The dirty-marking / job design: failure modes I haven't considered
4. Query and index review during E6 (reading EXPLAIN plans together)
5. The testing strategy: what's worth testing at which level
6. API design conventions (errors, pagination, versioning) and code review at each chapter end
7. Production-style concerns: configuration, logging, graceful shutdown, migrations safety
