# ADR-0001: Modular monolith instead of microservices

Status: Accepted
Date: 2026-09-28

## Context

Costly has around ten domain areas — `identity`, `ledger`, `recurring`, `import`, `planning`,
`analytics`, `forecasting`, `simulation`, `insights`, optional `assistant` — plus shared
`platform`. That many named areas invites splitting them into separate services.

The actual constraints are:

- one developer, one academic year, alongside a full-time job;
- one user per installation; the largest realistic dataset is a few million rows;
- the whole system must run on a laptop with 1–2 GB of RAM, offline, at the defense;
- correctness across domain boundaries matters: a transfer is two rows written atomically, and a
  ledger write plus its recompute marker must commit together or not at all.

There is no scaling, availability or team-autonomy problem to solve. There is a clear risk of
choosing an architecture because it sounds advanced.

## Decision

One NestJS application, one repository, one deployment unit, one PostgreSQL database, with two
runtime roles started from the same codebase: `main.ts` (HTTP API) and `worker.ts` (BullMQ
processors and schedulers).

Modules are explicit rather than implied. Each owns its tables, exposes exactly one public
service facade, and never reaches into another module's internals or tables. Dependencies point
one way only, in the order listed above; the rule is enforced statically by `dependency-cruiser`
in CI rather than by convention. Upward communication ("ledger data changed, analytics must
recompute") goes through the recompute marker and a job, so `ledger` does not know `analytics`
exists.

## Rationale

Microservices would add deployment, service discovery, inter-service contracts, distributed
tracing, and local orchestration — all work that is not the product — while removing none of the
domain work. For one developer that trade is straightforwardly bad.

Splitting services would also weaken the property the project most needs to get right. Writing a
transfer as two rows, or a ledger row plus its recompute marker, is one database transaction
here. Across services it becomes a saga with compensating actions: more code, more failure modes,
weaker guarantees, no benefit.

The valuable part of "microservices thinking" is boundaries, and boundaries are a property of how
code is organised, not of where it runs. A facade per module, one-way dependencies and
per-module table ownership give the same discipline, checked at build time instead of discovered
at runtime.

Splitting the system to look sophisticated would make it slower to build, harder to demo and
harder to defend, because the honest answer to "why is this a separate service?" would be "it
isn't". That is not a trade-off worth making for appearances.

## Consequences

Positive: one repository, one debugger, one `docker compose up`; refactoring across a boundary is
a rename rather than a coordinated release; real database transactions across domains; fast local
and CI test runs; the worker still scales independently of the API without splitting the codebase.

Negative: modules cannot be deployed or scaled separately; boundary discipline depends on lint
rules and review instead of being physically impossible to violate; a runaway module can affect
the whole process; under time pressure there is a standing temptation to reach across a boundary
"just this once". The dependency rules in CI and the one-facade-per-module convention exist
specifically to make that visible in review.

If a genuine scaling need ever appears, the extraction path is open: because each module already
owns its tables and is reached only through its facade, extracting one means replacing a facade
call with a client. That is a real option, not a promise made to justify the decision.

## Alternatives Considered

**A service per domain.** Rejected: operational cost with no scaling requirement, and distributed
transactions where atomic ones are available today.

**A modular monolith using an in-process event bus for all cross-module communication.** Rejected:
it hides control flow and makes the system harder to follow than direct calls. The single genuine
cross-module trigger uses an explicit marker plus a job instead.

**A conventional layered application with no module boundaries** (controllers / services /
repositories). Rejected: this is the realistic failure mode for an application with this much
CRUD. Without boundaries the analytics, forecasting and simulation engines end up entangled with
ledger internals, which is exactly what makes them untestable.

## References

- `../../00-planning/03-technical-design.md` §2 — module table, boundary rules, what is not used
- `../../00-planning/01-product-and-feature-analysis.md` §3 — technology out-of-scope list
