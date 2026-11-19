# Demo account for progress reviews

A development-only account with five AMD accounts and about five months of income and expenses,
so the ledger, the transactions list and the dashboard can be shown with realistic history. It is
a stopgap until `packages/data-generator` (technical design §6) produces the planned personas;
that generator, not this script, is the seed for experiments and the final defense.

## Running it

The credentials are never committed. Put them in `apps/api/.env`, which git ignores:

```dotenv
DEMO_EMAIL=...
DEMO_PASSWORD=...
```

Then, with the API running (`pnpm --filter @costly/api dev`):

```bash
pnpm db:seed:demo             # seed, or verify an existing demo account
pnpm db:seed:demo --dry-run   # print the generated history, touch nothing
```

`DEMO_API_URL` points the script at another local API (default `http://localhost:$PORT`).

## How it works

`apps/api/scripts/seed-demo.mts` drives the public HTTP API, exactly as the web client does:
register (time zone Asia/Yerevan), log in, create four custom categories, five accounts and the
transactions. Every row therefore passes the same validation, ownership checks and database rules
as real input; nothing is inserted into the database directly.

| Account | Type | Opening balance |
|---|---|---:|
| Main Bank Card | checking | 850,000 AMD |
| Savings Account | savings | 2,500,000 AMD |
| Cash Wallet | cash | 120,000 AMD |
| Secondary Bank Card | checking | 350,000 AMD |
| Emergency Fund | savings | 1,000,000 AMD |

All accounts open on the first day of the month five months back. The history is generated from a
fixed seed with a small PRNG: salary of 700,000 AMD on the 5th (moved to Friday on weekends), four
freelance payments of 300,000–800,000 AMD, deposit interest, a bonus and a gift; rent, utilities
that rise in winter, internet, groceries, restaurants, coffee, fuel, taxis, subscriptions charged
in USD at a varying rate, shopping, health, tuition and small cash expenses. Amounts are generated
as integers and sent as minor units; no amount passes through a floating-point calculation. The
plan is checked so that no account ever dips below zero.

Custom categories, used where the system set has no place: `Subscriptions`, `Food › Coffee`,
`Education › University fees` (expense) and `Bonus` (income).

## Safety and idempotency

- Refuses to run when `NODE_ENV=production`, when the API URL is not localhost, or when
  `DATABASE_URL` points at another host.
- Seeds only while the demo user has no accounts and no transactions. If it holds exactly the five
  demo accounts, the run writes nothing and only verifies balances. Any other state stops the run
  without writing, because existing data cannot be told apart from real data.
- Never deletes anything and touches no other user.
- After seeding, and on every rerun, it lists all transactions through the API, recomputes each
  balance as opening balance + Σ income − Σ expense, and compares it with the balance the Accounts
  API derives (and, after seeding, with the balance expected from the plan).

## Demo walkthrough (about 5 minutes)

1. **Sign in** as the demo user. The Overview shows the month's dashboard: total balance across
   five accounts, income and expenses against last month, net cash flow and the charts.
2. **Accounts.** Five accounts with current balances. Point out that no balance is stored: each is
   the opening balance plus the ledger, computed on every read (ADR-0002, integer minor units).
3. **Transactions.** About 150 rows, newest first. Show the filters: one account (Cash Wallet),
   type Income (salary, freelance, interest), a category (Food › Groceries) and a date range.
4. **Show more.** Pages of 50 with keyset pagination: rows never repeat or go missing while data
   changes.
5. **Write path.** Add an expense on Main Bank Card, return to Accounts and show the balance drop
   by exactly that amount; edit the amount and show it change again; delete it and show the
   balance return to where it was.
6. **Rules.** Try a date before the account's opening date or a future date, or an income category
   on an expense: the API refuses each one, and the database enforces the same rules.
