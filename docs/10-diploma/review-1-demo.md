# First review: demo script

About seven minutes. It shows what Chapter 1 has delivered so far, how the work was done, and
what comes next. Everything shown runs locally; no figures are invented for the demo.

## Before the review

1. Start the system from an empty database, following
   [Running locally](../../README.md#running-locally). Check that
   `http://localhost:3100/health` reports the database and Redis as `up`.
2. Open three browser tabs:
   - the web client at `http://localhost:5173/register`;
   - the [pull requests](https://github.com/rudolf1118/costly/pulls?q=is%3Apr+is%3Amerged), with
     #14 (accounts) open on its Checks tab;
   - this repository's [progress log](progress-log.md).
3. Use a browser profile with no Costly cookie, so the demo starts signed out.
4. Rehearse once. If something fails during the review, say what failed and move to the next
   step; the pull requests and tests still show the work.

## 1. The project in one sentence (30 s)

Costly records a person's money and turns their own history into analysis, forecasts and
decisions with a quantified effect. The [README](../../README.md) pipeline: record →
understand → anticipate → decide. Chapter 1 (October–November) is the "record" part: a correct
ledger and the architecture every later chapter builds on.

## 2. Registration and sign-in (1 min)

1. Register a new account. The time zone is preset from the browser; it decides where days and
   months begin.
2. Point out the checks before sending (password length counted as the API counts it) and the
   messages written for people when the API refuses something.
3. Reload the page: the session survives. The access token lives only in memory; the refresh
   token is an HttpOnly cookie the page's scripts can't read (ADR-0006).
4. Sign out, then sign in again.

## 3. Accounts (2–3 min)

1. **Add a checking account** with an opening balance of `250 000.50`. It is stored as the
   integer `25000050` minor units: money is never a floating-point number (ADR-0002).
2. **Add a credit card** with `-45000`. Negative opening balances record debt.
3. **Try a name that differs only in capitals**, such as `AMERIABANK CARD`. The API refuses it,
   and the error appears on the Name field.
4. **Point at "Opening balance, <date>".** There is no current balance and no total yet: without
   transactions the system can't know them, and it never shows a figure it can't justify
   (ADR-0010). Balances arrive with the ledger.
5. **Open the credit card, archive it**, show the read-only notice, then **restore** it. Nothing
   is ever deleted; archived accounts keep their history.
6. **Edit an account**: only name, type and "spendable" can change. Changing an opening balance
   would silently rewrite every balance derived from it, so it is fixed by design.

## 4. Same app, any screen (30 s)

Narrow the window: sidebar → icon rail → top bar → bottom tabs. Switch to the dark theme in
Settings.

## 5. How it was built (2 min)

1. **Pull requests:** fourteen merged before this review, each one reviewable step with CI
   green. Open #14's Checks: lint, format, typecheck, tests and build, the same commands as
   local development.
2. **Tests:**
   - The API is tested against real PostgreSQL and Redis containers, including race tests that
     hold one transaction's lock while another waits.
   - The web client has 180 tests and the shared package (money and API client) 132,
     including property-based tests and automated accessibility checks.
3. **Decisions are written down:** [ADRs](../03-architecture/adr/) 0001–0006, 0010 and 0011 (0011
   is a proposal: native mobile clients after the web).
4. **Findings, not just features** ([progress log](progress-log.md)). Two worth telling:
   - The two-clock bug: Prisma's timestamps came from the API host, archiving used the database
     clock, and a check constraint failed whenever Docker's clock lagged.
   - A connection-pool deadlock: twelve concurrent refusals held all five connections and every
     request answered 500, found by an audit and pinned by a burst test.

## 6. What comes next (30 s)

To finish Chapter 1 by the end of November, as `v0.1.0`:
- merchants, transactions and transfers (a transfer is two rows written atomically), with
  balances computed from them;
- recurring rules and the first background job;
- a dashboard with this month's income, expenses and net;
- a deterministic generator of 12 months of history for demos and experiments.

On the web, categories come next: the API for them is already merged.

## Likely questions

| Question | Short answer |
|---|---|
| Why integer minor units? | Floating point can't represent 0.10 exactly; sums drift. `bigint` minor units are exact, and the API sends them as strings so no client rounds them (ADR-0002). |
| Why one application, not microservices? | One person, one database, strong consistency for money. Modules with one-way dependencies keep the boundaries; a worker process runs the jobs (ADR-0001). |
| Why no current balance yet? | It is derived from transactions, which come next. Showing the opening balance as if it were current would be wrong. |
| Can one user see another's data? | Every query is scoped by the signed-in user. Another user's account and a missing one both answer 404, so ids reveal nothing. |
| Why a web client first, mobile later? | The web needs no store review and runs anywhere for the defense. ADR-0011 proposes native clients that reuse the shared money and API code. |
| Is it on schedule? | Chapter 1 runs to the end of November. Identity, accounts and categories are done; the ledger is next. |
