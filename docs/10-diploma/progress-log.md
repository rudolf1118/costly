# Progress log

Dated entries: what was built, what was decided, and what changed because of review or
measurement. The git history and the pull requests linked here are the evidence.

## Chapter 0: Foundation (September 2026)

- pnpm monorepo, NestJS API with health checks against PostgreSQL and Redis, React client, Docker
  Compose, GitHub Actions CI.
- ADR-0001 to ADR-0004: modular monolith, money as bigint minor units, Prisma with raw SQL for
  analytics, BullMQ over RabbitMQ.

## Chapter 1: Financial core

| Task | Merged | Pull request | Outcome |
|---|---|---|---|
| 1. Prisma infrastructure | 2026-11-06 | #1 | Prisma 7 with the PostgreSQL driver adapter; health checks through Prisma. |
| 2. User model | 2026-11-06 | #2 | `users` table and the first migration; case-insensitive email via `citext`. |
| 3. Registration | 2026-11-06 | #3 | `POST /auth/register`, Argon2id (ADR-0005), RFC 9457 errors, zod validation. |
| 4. Authentication | 2026-11-10 | #4 | Login, JWT access tokens, rotating refresh sessions, logout, guard, Redis rate limits (ADR-0006). |
| 5. Financial accounts | in review | #5 | `accounts` table; create, list, read, update, archive and restore; money as minor-unit strings. |

Notes worth keeping for the thesis:
- **Task 2:** Prisma's generated migration lacked `CREATE EXTENSION citext` and would have failed on
  a fresh database.
- **Task 3 audit:**
  - Body-parser errors were answered with 500.
  - Unpaired-surrogate passwords collided.
  - An intermittent e2e failure was traced to supertest binding `[::]:0` next to other loopback
    listeners.
- **Task 4:**
  - The smoke test found refresh tokens in the request logs, through `Set-Cookie`.
  - The audit found and fixed two refresh/logout races (READ COMMITTED phantoms; fixed with a
    per-session advisory lock), a non-atomic account login limit, IPv6 per-IP bypass and an owner
    lockout.
  - Test parallelism was capped at four files after measuring container-start failures.
- **Task 5:**
  - Zod 4 runs later checks after a failed one. A malformed date reached `new Date()` and caused a
    500 until the format check was made to abort.
  - Repeated runs exposed a two-clock bug. Prisma emulates `@default(now())` on the API host while
    archive used the database's `now()`, so `archived_at >= created_at` failed whenever Docker's
    clock lagged. Fixed by using one clock; a test pins it by running the API's clock ahead.

Next in Chapter 1: transactions and transfers (the ledger), categories and merchants, recurring
rules, the first dashboard and seeded demo data, released as `v0.1.0`.
