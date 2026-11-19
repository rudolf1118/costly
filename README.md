# Costly

**Personal finance management, analysis and forecasting system** (Bachelor diploma project)

> «Անձնական ֆինանսների կառավարման, վերլուծության և կանխատեսման համակարգի մշակում»

Costly records a person's accounts, income, expenses and recurring payments, then uses that
history to analyse behaviour, forecast spending and balances, project financial goals, and
simulate decisions ("Can I afford this? What if I cut restaurants by 20%?"). Every suggestion
comes with a quantified effect on the user's goals.

```
record  →  understand  →  anticipate  →  decide
ledger     analytics       forecasting    goals · what-if · recommendations
```

## Status
**Chapter 1 — financial core, in progress.** The API has registration, login with rotating
refresh sessions and rate limiting, financial accounts and two-level categories (seeded system
categories plus the user's own). The web client has sign-in, registration and accounts, in four
responsive layouts with light and dark themes. Merchants, transactions and transfers, recurring
rules and a first dashboard follow, released as `v0.1.0`. See the
[progress log](docs/10-diploma/progress-log.md).

## Running locally
Requires Node 24, pnpm 12 and Docker.

```bash
pnpm install
pnpm infra:up                                  # PostgreSQL on 5433, Redis on 6380
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm db:deploy                                 # migrations, including the system categories
pnpm --filter @costly/api build && pnpm --filter @costly/api start   # API on http://localhost:3100
pnpm --filter @costly/web dev                  # web client on http://localhost:5173
```

`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` run the same checks as CI. The API
tests start their own PostgreSQL and Redis containers. `pnpm infra:down` stops the local
infrastructure.

## Documents
| Document | For |
|---|---|
| [Supervisor specification](docs/10-diploma/supervisor-specification.md) | Short project overview for the supervisor |
| [Final specification](docs/00-planning/05-final-specification.md) | The agreed scope, one page per topic |
| [Product & feature analysis](docs/00-planning/01-product-and-feature-analysis.md) | What Costly is, feature decisions, out of scope, critique |
| [Engines design](docs/00-planning/02-engines-design.md) | Analytics, forecasting, goals, what-if, anomalies, recommendations, AI |
| [Technical design](docs/00-planning/03-technical-design.md) | Database, modular monolith, background jobs, end-to-end flows |
| [Roadmap, experiments, defense](docs/00-planning/04-roadmap-experiments-defense.md) | Academic-year plan, research experiments, demo script |
| [Architecture decisions](docs/03-architecture/adr/) | Why the significant technical choices were made |
| [Git & commit strategy](docs/00-planning/06-git-and-commit-strategy.md) | How the repository history is built during the year |
| [Docs structure](docs/README.md) | How the documentation grows during the year |

## Planned stack
TypeScript · NestJS (modular monolith) · PostgreSQL · Prisma · Redis · BullMQ · React (Vite) · Docker Compose.
The whole system runs locally.

## Timeline
| Chapter | Period | Theme |
|---|---|---|
| 1 | Oct – Nov 2026 | Financial core & architecture foundation |
| 2 | Dec 2026 – Jan 2027 | Import, analytics, anomaly detection |
| 3 | Feb – Mar 2027 | Forecasting, goal projection, what-if simulation |
| 4 | Apr – May 2027 | Recommendations, month-end reports, optional AI, polish |
| Final | Jun 2027 | Evaluation, thesis, defense |
