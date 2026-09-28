# ADR-0003: Prisma for application data, raw SQL for analytics

Status: Accepted
Date: 2026-09-28

## Context

Costly has two data-access shapes that pull in opposite directions.

The first is ordinary persistence: create, read, update and delete across roughly twenty related
tables, with migrations that have to stay reviewable as the schema grows through four chapters.

The second is analytics. Baselines, pace-adjusted month-to-date comparison, rolling averages,
OLS trend, volatility classes, frequency-versus-price decomposition and the cumulative spending
profile are all aggregations over date ranges — `GROUP BY`, `FILTER`, window functions,
percentiles, common table expressions. Experiment E6 measures these queries at roughly 3–5
million rows and reads their `EXPLAIN ANALYZE` plans, so the exact SQL that runs has to be
visible and tunable.

One tool that handles both well does not exist.

## Decision

Prisma is the ORM for application persistence, schema definition and migrations, used directly
inside the module that owns the tables.

Analytics and reporting queries are written as parameterised raw SQL through Prisma's
`$queryRaw` tagged template or TypedSQL.

There is no generic repository layer, and no second ORM or query builder.

## Rationale

Prisma keeps one schema file as the single definition of the database, generating both the
migration and the TypeScript types from it, so the two cannot drift apart. `prisma migrate`
produces plain SQL migration files that can be read and reviewed before they are applied, which
matters because the supervisor reviews the domain model and constraints before the Chapter 1
migrations.

Prisma is called directly from module services. A repository interface wrapping it "in case we
switch ORM" would add a layer of hand-written indirection to every query in exchange for a
migration that will never happen.

Analytics goes to raw SQL because that is where the ORM stops helping. Window functions,
`GROUP BY` with `FILTER`, `percentile_cont` and multi-stage CTEs either cannot be expressed
through the query API or come out as something slower and less readable than the SQL it
generates. Writing the query directly also means the statement being tuned in E6 is the
statement that runs in production, with no generator between the plan and the code.

Two constraints keep raw SQL safe. It is always parameterised through the tagged template, never
assembled by string concatenation, so user input cannot reach the parser. And it is confined to
query files inside `analytics` — later also `forecasting` — rather than scattered across
services.

The risk raw SQL carries is that it is typed by hand, so a schema change can break it silently
at runtime instead of loudly at compile time. That is covered by differential tests: each
analytics query is run against random generated data and compared with an in-memory reference
implementation of the same metric. A schema or logic change that breaks the SQL shows up as a
mismatch. Where TypedSQL can generate the result type from the query, it is preferred.

## Consequences

Positive: each half of the problem uses the tool suited to it; migrations are generated and
reviewable; CRUD types come from the schema instead of being maintained by hand; analytics stays
fast, readable and directly tunable against query plans.

Negative: two styles of data access to learn and review; raw SQL result types are hand-written
and can drift from the schema, mitigated by the differential tests and by keeping the SQL in one
place; Prisma adds a client-generation step to the build and to CI.

## Alternatives Considered

**Prisma alone.** Rejected: the analytics queries either cannot be expressed or become slow and
unreadable, and the Chapter 2–3 work depends on them.

**Raw SQL or a query builder (Kysely, Drizzle) alone.** Rejected: hand-writing and hand-typing
CRUD across twenty tables is a large amount of low-value work, and giving up generated
migrations costs more than the consistency gains.

**Kysely alongside Prisma for the analytics half.** Rejected: a third way to express a query,
with its own types and idioms, to solve a problem `$queryRaw` already solves.

**TypeORM or MikroORM.** Rejected: no advantage over Prisma for this project, with weaker type
generation and migration ergonomics.

## References

- `../../00-planning/03-technical-design.md` §2.3 — boundary rules and data-access policy
- `../../00-planning/05-final-specification.md` §19 — differential testing of SQL analytics
- `../../00-planning/04-roadmap-experiments-defense.md` §1 — experiment E6
