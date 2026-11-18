# Dashboard v1: run, test and demonstrate

What the dashboard task delivered, how to check it, and a demo script. The rules are in
[`dashboard-v1.md`](../02-requirements/dashboard-v1.md); the endpoint is in
[`api-conventions.md`](../03-architecture/api-conventions.md#dashboard).

## What is implemented, and what is not

| Implemented | Not yet (later chapters) |
|---|---|
| `GET /dashboard/summary?month=YYYY-MM` in a new `analytics` module: five aggregate SQL queries in one read-only `REPEATABLE READ` snapshot | Baselines, pace, trends, volatility (Dashboard v2, Chapter 2) |
| Income, expense and net for the month and the previous one; active accounts' balance at both month ends | Net worth vs. liquid money, runway |
| 12 months of income and expense, spending by category, spending by day, the month's 8 latest transactions, the active accounts | Budgets, goals, forecasts |
| Web: summary cards, month picker, income vs expenses bars (6/12 months), category donut with linked list, daily spending area, recent transactions, accounts, statements about the month | The insights engine with rules, scores and lifecycle (Chapter 4) |

## Financial invariants

1. **Every total is a database sum over `bigint`**, cast back to `bigint`: an overflow is an error,
   never a rounded number. The browser reads each sum straight into a `bigint`.
2. **Category amounts add up to the month's expense exactly**, including the folded "other" slice.
3. **Percentages are integer arithmetic on `bigint`** (`percentChange`, `percentOf` in
   `packages/shared`), rounded half away from zero, and absent when the base is zero.
4. **Balances are derived, not stored.** The accounts list on the dashboard equals `GET /accounts`;
   the balance card at the end of the current month equals the sum of the active accounts' current
   balances.
5. **One month everywhere.** Cards, charts, statements and recent transactions follow the month
   picker; the accounts list is labelled as current balances.

## Run it

```bash
pnpm infra:up
pnpm db:deploy
pnpm --filter @costly/api dev
pnpm --filter @costly/web dev
```

Sign in as any user with accounts and transactions, such as the local demo account, and open
`/`.

## Test it

| What | Where |
|---|---|
| Totals, boundaries (first and last day, leap February), the 12-month window, balances at month ends, archived accounts, user isolation, sums beyond 2^53, validation | `apps/api/test/dashboard.e2e.spec.ts` (real PostgreSQL) |
| Month arithmetic and the month parameter | `apps/api/src/analytics/dashboard/month.spec.ts` |
| Wire contract, percentages and their zero bases | `packages/shared/src/dashboard.spec.ts` |
| Chart data: history ranges, category slices and "other", daily running total | `apps/web/src/features/dashboard/chart-data.spec.ts` |
| Statements, including "so far" wording and missing comparisons | `apps/web/src/features/dashboard/insights.spec.ts` |
| The page: numbers, month switching and the address, links, empty and error states, accessibility | `apps/web/src/features/dashboard/DashboardPage.spec.tsx` |

## Verified against the demo data (19 Nov 2026)

The dashboard for `test@test.com` was compared with SQL run directly on the database:

| Check | Database | Dashboard |
|---|---|---|
| November income / expense / transactions | 700,000 ֏ / 581,046 ֏ / 22 | same |
| October income / expense / transactions | 1,107,580 ֏ / 589,494 ֏ / 25 | same |
| Sum of the five active accounts' balances | 7,773,832 ֏ | Total balance 7,773,832 ֏ |
| Balance at the end of October | 7,654,878 ֏ | "Balance on 31 Oct" 7,654,878 ֏ |
| November's largest categories | Rent 43.03 %, Groceries 15.83 %, University fees 12.91 % | 43 %, 16 %, 13 % |

## Demo script

1. Open the overview: the four cards, then the income vs expenses bars; switch to 12 months.
2. Hover a bar: income, expenses and net for that month.
3. Point at the category list: amounts and shares add up to the month's spending. Click "Rent":
   the transactions page opens filtered to rent in that month.
4. Back on the overview, step to October with the arrow: every number changes, the balance card
   becomes "Balance on 31 Oct", and the address keeps the month.
5. Show the statements: each one is a fixed sentence over the numbers above, with no percentage
   where the previous month was empty.
