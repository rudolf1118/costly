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
| 6. Categories | 2026-11-17 | #6, #10 | `categories` table with 36 seeded system categories; two levels with `nature`; users' own categories, including under system parents; archive and restore with row locks. #10 applied the audit fixes. |

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
- **Task 6 audit:**
  - Refusing to archive or restore a system or foreign category queried outside the transaction,
    holding one pooled connection while waiting for another. With five connections, twelve
    concurrent refusals deadlocked the pool: they and every other request answered 500 until
    connections timed out. Fixed by querying through the transaction; a burst test pins it.
  - Income categories rejected the `"nature": null` that responses carry, so a round-trip failed.
  - The two-clock lesson a third time: the lock tests archived with the database's `now()` and
    failed whenever Docker's clock lagged the API's. Any raw `archived_at` write must use
    `GREATEST(now(), created_at)`.

### Web client

The web client was built alongside the API from task 6 on. Each step merged with CI green and
was checked in a browser against a running API.

| Step | Merged | Pull request | Outcome |
|---|---|---|---|
| Web architecture | 2026-11-17 | #7 | ADR-0010: React with TanStack Router and Query, shadcn/ui on Radix, Tailwind reading the design tokens, react-hook-form with zod. |
| Native clients | 2026-11-17 | #8 | ADR-0011 (proposed, for the supervisor): Expo clients after the web, sharing `packages/shared`. |
| Shared package | 2026-11-17 | #9 | `packages/shared`: the AMD money codec (parse, format, strict input) and RFC 9457 problem details. |
| Design system | 2026-11-17 | #11 | `packages/design-tokens` generating CSS variables and the Tailwind theme; light and dark themes without a flash; base components; WCAG contrast pairs tested. |
| Application shell | 2026-11-17 | #12 | Routing, four responsive layouts (sidebar, icon rail, top bar, bottom tabs), skip link and focus on navigation, toasts. |
| Sign-in | 2026-11-17 | #13 | API client with single-flight refresh, in-memory session restored from the HttpOnly cookie, route guards, sign-in, registration and sign-out. |
| Accounts | 2026-11-18 | #14 | List with active and archived views, add and edit in a drawer, details with archive and restore. |

Notes worth keeping for the thesis:
- **ADR numbers:** 0007–0009 were already reserved for planned backend decisions, so the web
  ADRs became 0010 and 0011 instead of taking the next free number.
- **Money on screen** (#9):
  - Amounts stay `bigint` from the API to the screen. Decimals are shown only when non-zero.
  - Input refuses ambiguous text instead of guessing: `0,500` could be half a dram or five
    hundred.
- **The client computes no figures** (ADR-0010). An account shows only its opening balance,
  labelled as such. A current balance or a total waits for the ledger to provide it.
- **Every response is validated** with zod at the client boundary, so a drifted contract shows
  as an error, never as a wrong number.
- **Sessions** (#13):
  - The API accepts each refresh token once, so concurrent refreshes share one request.
  - An API that can't be reached is a separate state with its own screen. An outage never signs
    the user out.
- **Design tokens** (#11): `tailwind-merge` silently dropped custom text sizes such as
  `text-body` next to a colour class, because both start with `text-`. It now knows the theme's
  names.
- **Accessibility:**
  - Page tests first ran axe on the rendered container only, which hid two problems: the sign-in
    logo and footer were outside every landmark, and the not-found page had no `<main>`. Page
    checks now run on the whole document.
  - Known gap: input borders are 1.5:1 against the surface, below the 3:1 WCAG asks of
    component boundaries. They are kept as designed for now.
- **Browser check of accounts** (#14): the not-found text said an account might belong to
  someone else. The API deliberately answers 404 for both, so the page now says neither.

Next in Chapter 1: merchants, transactions and transfers (the ledger), recurring
rules, the first dashboard and seeded demo data, released as `v0.1.0`. On the web: categories,
then transactions as their API arrives.
