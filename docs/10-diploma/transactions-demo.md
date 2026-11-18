# Transactions MVP: run, test and demonstrate

What the transactions task delivered, how to check it, and a demo script for the first progress
review. The rules are in [`ledger-transactions.md`](../02-requirements/ledger-transactions.md).

## What is implemented, and what is not

| Implemented | Not yet (later tasks) |
|---|---|
| Income and expense on one account, with a category, date, amount and optional description | Transfers between accounts |
| Create, list, read, edit and hard-delete through `/transactions` | Merchants, notes, recurring rules, imports |
| Filters by account, category, type and inclusive date range; keyset pagination | Totals, net worth, analytics, forecasts |
| Current balance of every account, derived on each read | A balance as of a past date |
| Web: Transactions page with filters and "Show more", add, edit and delete dialogs, balances on the accounts screens | A categories screen (categories are read-only in the web client) |
| Database rules: positive amounts, owner and currency through a composite foreign key, category and opening-date trigger | The recompute marker and background jobs (nothing derived exists yet) |

## Financial invariants

1. **Money is exact.** Amounts are `bigint` minor units in PostgreSQL, decimal strings in JSON and
   `bigint` in the browser. No step converts an amount to a floating-point number.
2. **Amounts are positive; the type is the direction.** `CHECK (amount BETWEEN 1 AND
   999999999999999)`.
3. **Balance = opening balance + Σ income − Σ expense.** No balance is stored, so an edit or a
   delete is reflected at once and no concurrent write can lose an update.
4. **A transaction belongs to its owner's account, in the account's currency.** Enforced by the
   composite foreign key `(account_id, user_id, currency)`.
5. **The category is the owner's or a system one, of the transaction's kind**, and the date is
   not before the account was opened. Enforced by the `transactions_rules` trigger.
6. **Archived accounts are read-only.** Writes lock the account `FOR SHARE`, so an archive can't
   interleave with a write.

## Running it

From the repository root, with Docker running:

```bash
pnpm install
pnpm infra:up                      # PostgreSQL on 5433, Redis on 6380
pnpm db:deploy                     # applies 20261119090000_add_transactions among the others
pnpm --filter @costly/api dev      # API on http://localhost:3100
pnpm --filter @costly/web dev      # web client on http://localhost:5173
```

`apps/api/.env` and `apps/web/.env` are copied from their `.env.example` files. An existing local
database only needs `pnpm db:deploy` to get the new table.

## Testing it

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

The parts that cover this task:

| File | What it proves |
|---|---|
| `apps/api/test/transactions.schema.spec.ts` | Every constraint, foreign key and trigger rule, by SQLSTATE, on a fresh PostgreSQL |
| `apps/api/test/transactions.e2e.spec.ts` | The API end to end: validation, ownership, archived accounts and categories, edits, deletes, filters, pagination, balances, lock interleavings |
| `apps/api/src/platform/money/minor-units.spec.ts` | The positive-amount grammar |
| `packages/shared/src/transactions.spec.ts`, `accounts.spec.ts` | The client contracts, including balances beyond 2^53 |
| `apps/web/src/features/transactions/*.spec.tsx` | The page, filters, paging, the form's checks, edit and delete flows, accessibility |

Only the API tests need Docker; they start their own containers.

To run just this feature:

```bash
pnpm --filter @costly/api exec vitest run test/transactions.schema.spec.ts test/transactions.e2e.spec.ts
pnpm --filter @costly/web exec vitest run src/features/transactions
```

## Demo script (about 5 minutes)

1. **Register and add accounts.** On `/register`, create a user. On Accounts, add "Card"
   (checking, opening balance `250,000`, opening date the 1st of last month) and "Cash" (`50,000`).
   Each shows its **current balance**, equal to the opening balance.
2. **Record income.** Transactions → Income: `900,000`, Salary, Card. Toast "Income added"; the
   row shows `+900,000 ֏`.
3. **Record expenses.** Expense: `18,500.50` Food › Groceries on Card; `4,500` Transport › Taxi on
   Cash with the description "Taxi home".
4. **Show the balance.** Accounts: Card is `250,000 + 900,000 − 18,500.50 = 1,131,499.50 ֏`, Cash
   `45,500 ֏`.
5. **Edit and delete.** Change the taxi to `5,000`: Cash becomes `45,000`. Delete the groceries
   (confirmation dialog): Card becomes `1,150,000`.
6. **Validation.** Try an amount of `0`, a date before the account's opening date, or switch an
   expense to Income: the form explains each before sending anything, and the API enforces the
   same rules.
7. **Filters and paging.** Filter by Expenses, by Cash, by a date range; the address keeps the
   filters, so Back and bookmarks work.
8. **Archived account.** Archive Cash: its transactions stay listed without edit or delete, and
   "Expense" no longer offers it.
9. **Under the hood** (optional):

   ```bash
   docker exec -it costly-postgres-1 psql -U costly -d costly \
     -c 'select type, amount, occurred_on, description from transactions order by occurred_on'
   ```

   Amounts are positive integers of minor units: `1850050` is 18,500.50 ֏.

## Points to make

- **Why no balance column?** A stored balance is a second copy of the truth that every write must
  keep in step, and a read-modify-write race in waiting. A sum over an indexed column is exact and
  fast at this scale; experiment E6 measures it, and a cache is added only if the numbers ask for
  one.
- **Why keyset pagination?** An offset shifts when a row is added or deleted between pages, so a
  row repeats or is skipped. The cursor `(occurred_on, id)` names the last row shown, and the
  test that inserts a row between two pages pins it.
- **Why lock `FOR SHARE`?** "Check the account is active, then insert" is two steps. Without the
  lock, an archive could commit in between. The deterministic tests hold an archive open until
  PostgreSQL shows the request waiting; removing the lock makes them fail on every run.
