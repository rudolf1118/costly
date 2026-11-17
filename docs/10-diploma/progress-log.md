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
| 5. Financial accounts | 2026-11-10 | #5 | `accounts` table; create, list, read, update, archive and restore; money as minor-unit strings. |
| 6. Categories | in review | #6 | `categories` table with 36 seeded system categories; two levels with `nature`; users' own categories, including under system parents; archive and restore with row locks. |

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
- **Task 5 audit:**
  - One clock is not enough. A second API instance, or NTP stepping the host clock back, could
    still archive "before" creation, and the CHECK answered 500. Archive now stores
    `max(now, created_at)`. A test runs the archiving clock a minute behind.
  - "Café" typed with a combining accent passed as a second active account next to the
    precomposed one. Names are now NFC-normalized, and a new migration adds a CHECK.
  - A mutation check found the concurrent-archive test couldn't tell whether the `archived_at IS
    NULL` guard was there. A deterministic stale-read test replaced reliance on timing.
- **Task 6:**
  - System categories are shared rows (`user_id IS NULL`), seeded by a migration with fixed ids
    that sort before every UUIDv7, so one `ORDER BY id` lists them first.
  - A unique index with `NULLS NOT DISTINCT` covers names: with plain `NULL`s, neither system nor
    top-level names would have been unique.
  - A trigger enforces the rules that span two rows: depth, parent kind, parent owner and
    immutability.
  - "An active category never has an archived parent" needs row locks: `FOR SHARE` on the parent
    when adding a child, `FOR UPDATE` before counting children on archive.
    - The round-based race tests caught a removed lock only by chance.
    - Deterministic tests now hold the conflicting lock in a second transaction until PostgreSQL
      reports the request waiting, so each removed lock fails every run.
  - A test fixture set `archived_at` before Prisma set `created_at` and failed intermittently,
    the same two-clock lesson as task 5.

Next in Chapter 1: merchants, transactions and transfers (the ledger), recurring
rules, the first dashboard and seeded demo data, released as `v0.1.0`.
