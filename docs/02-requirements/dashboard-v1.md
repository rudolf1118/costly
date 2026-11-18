# Dashboard v1: behaviour

Chapter 1: one screen that answers "where is my money and what happened this month", computed
from the ledger on every read.

**Sources:**
- `04-roadmap-experiments-defense.md`, Chapter 1: "Dashboard v1: balances, this month's
  income/expense/net, category breakdown".
- `05-final-specification.md` §13: the monthly summary is the first analytics method.
- `03-technical-design.md` §1: analytics groups by `occurred_on`, never by `created_at`; balances
  are computed, not stored.
- ADR-0002 (money is `bigint` minor units), ADR-0003 (raw SQL for analytics), ADR-0004 (all reads,
  including the dashboard's, stay synchronous).
- [`ledger-transactions.md`](ledger-transactions.md), Balance: the balance formula.

The rules below settle what those sources leave open. Each rule says where it comes from.

## Scope of this task

| Included | Later |
|---|---|
| One month's income, expense and net, with the previous month beside them | Baselines, pace, trends and every "compared with usual" number (Dashboard v2, Chapter 2) |
| Total balance of the active accounts at the end of the month | Net worth vs. liquid money, runway |
| 12 months of income and expense, spending by category, spending by day | Budgets, goals, forecasts |
| The month's latest transactions; the active accounts with their balances | Transfers (they don't exist yet) |
| Short statements derived from the numbers above | The insights engine with its rules, scores and lifecycle (Chapter 4) |

## One request, one month

`GET /dashboard/summary?month=YYYY-MM` returns everything the screen shows for that month in one
response. One endpoint, not five calls to the existing ones: `GET /transactions` is paged at 100
rows, and a total must never depend on how many rows a client managed to fetch.

| Rule | Source |
|---|---|
| `month` is required. The API doesn't guess it: "this month" depends on the user's time zone, which the client already holds. | decided here |
| A real month from `1900-01` up to the current month in UTC+14. A later month is a 400: no transaction can be dated there (`ledger-transactions.md`, no future dates). | decided here |
| A month is the calendar days `YYYY-MM-01` to its last day, compared on the `occurred_on` date. No time zone arithmetic happens on the server: a transaction's date is already the user's own day. | technical design |
| All numbers come from one database snapshot (a read-only `REPEATABLE READ` transaction), so a transaction saved during the request can't appear in one total and be missing from another. | decided here |
| Every query filters by the authenticated user. | technical design |

## The numbers

All amounts are minor units as decimal strings (ADR-0002) and positive unless the rule says
otherwise. Every sum runs in PostgreSQL over `bigint` and is cast back to `bigint`: an impossible
overflow is an error, never a rounded number. Nothing is converted to a floating-point number on
the server.

| Field | Rule |
|---|---|
| `income`, `expense` | Σ amount of the month's income / expense transactions, on **every** account, archived ones included: the money moved in that month whatever happened to the account later. |
| `net` | `income − expense`. May be negative. |
| `previous` | The same three for the month before. |
| `balance.total` | Σ balance of the **active** accounts at the end of the month: each account's opening balance (if it was open by then) plus its income minus its expense dated up to the month's last day. For the current month this is the current balance, since no transaction is dated in the future. May be negative (a credit card). |
| `balance.previousMonthEnd` | The same at the end of the previous month, or `null` when none of today's active accounts was open yet. No comparison is better than one against an empty ledger. |
| `history` | 12 entries, the selected month and the 11 before it, oldest first, each with `income` and `expense`. Months without transactions are present with zeros, so a chart's axis has no gaps. |
| `categories` | The month's expense by category, largest first: the category actually on the transaction (a subcategory stays itself), with its parent's name for display. Their amounts add up to `expense` exactly. |
| `daily` | One entry per day of the month with that day's `income` and `expense`, zeros included. |
| `recentTransactions` | The month's 8 latest transactions in the list order of `GET /transactions` (newest `occurredOn`, then newest id), with their account and category names. |
| `accounts` | The active accounts, in creation order, each with its **current** balance (the same number `GET /accounts` returns). |

**Why the balance card follows the month.** A dashboard that shows October's spending next to
today's balance mixes two periods. The total balance is therefore taken at the end of the selected
month, so it changes with the month picker like every other number on the screen. The accounts list
is the one exception and says so: it is the list of accounts as they are now.

## Percentages and statements

Percentages are computed by the client from the exact amounts above, in integer arithmetic on
`bigint`, rounded half away from zero to whole percent.

- A change is shown only when the earlier value is not zero. "From 0 to 50,000 ֏" has no
  percentage; the client says "no spending last month" instead.
- A share of the month's expense is shown only when the expense is not zero.
- Statements ("Spending increased by 12% compared with last month", "Groceries were 28% of this
  month's spending") are fixed sentences filled with these numbers. Nothing is generated, predicted
  or recommended: that is the insights engine of Chapter 4.

## Performance

Five queries per request, each a single aggregate over an index range:

| Query | Index |
|---|---|
| Monthly totals for the 12-month window (also gives this and the previous month) | `(user_id, occurred_on DESC, id DESC)` |
| Expense by category for the month | the same range, grouped |
| Income and expense by day for the month | the same range, with `generate_series` for the empty days |
| The month's 8 latest transactions | the same index, read in order, `LIMIT 8` |
| Account balances, now and at both month ends | `(account_id, occurred_on)` |

No query reads more than the 12-month window except the balances, which are sums over each
account's rows, as in `GET /accounts`. Nothing is cached; experiment E6 measures whether an
aggregate table is ever needed.
