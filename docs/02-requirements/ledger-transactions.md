# Transactions: behaviour

Chapter 1: income and expense entries, and the current balances derived from them.

**Sources:**
- `03-technical-design.md` §1.1, `transactions`: `id, user_id, account_id, type (income|expense|transfer_out|transfer_in), amount bigint CHECK (amount > 0), currency, occurred_on date, category_id (null for transfers), merchant_id, description, note, …, created_at, updated_at`. The category is required for income and expense. Indexes `(user_id, occurred_on DESC)`, `(user_id, category_id, occurred_on)` and `(account_id, occurred_on)`.
- `03-technical-design.md` §1, Conventions: the amount is always positive and the direction comes from the type. Transactions are hard-deleted by the user.
- `03-technical-design.md` §1.6: balances are **computed, not stored**.
- `04-roadmap-experiments-defense.md`, Chapter 1: list with filters and keyset (cursor) pagination, edit, delete.
- [`ledger-accounts.md`](ledger-accounts.md), Balance semantics: the balance formula, no transaction before the opening date, none on archived accounts.
- [`ledger-categories.md`](ledger-categories.md), For transactions: an active category the user can see, of the matching kind; an archived category stays valid on the transactions that already use it.

The rules below settle what those sources leave open. Each rule says where it comes from.

## Scope of this task

| Included | Later |
|---|---|
| `income` and `expense` on one account | Transfers (`transfer_out` / `transfer_in` pairs) |
| Create, list with filters and cursor pagination, read, edit, delete | Merchants (`merchant_id`) and a separate `note` field |
| Current balance of every account | Recurring rules, imports, the recompute marker of §3.3 (nothing reads derived data yet) |

The enum holds only `income` and `expense`. Transfers add their values with `ALTER TYPE … ADD VALUE` when they arrive, together with the `transfer_group_id` column and its CHECK, so the table never allows a row this API can't produce.

## Fields

| Field | Rule | Source |
|---|---|---|
| `type` | `income` or `expense`. Decides the direction: income adds to the account, expense takes from it. | technical design |
| `amount` | Minor units as a decimal string (ADR-0002), **strictly positive**: `"1"` to `"999999999999999"`. `"0"`, a minus sign or a JSON number is a 400. | positivity: technical design; range: the accounts rule |
| `currency` | Not sent. Copied from the account, and the database guarantees it equals the account's. | decided here: one source of truth per account |
| `accountId` | One of the user's accounts, **active** for any write. | ledger-accounts.md |
| `categoryId` | Required. A system category or the user's own, with `kind` equal to `type`. It must be **active** when it is assigned; an archived category already on the transaction stays valid. | ledger-categories.md |
| `occurredOn` | A real calendar date `YYYY-MM-DD`, not before the account's `openingDate`, and not in the future anywhere on Earth (at most today in UTC+14). | opening date: ledger-accounts.md; future dates decided here |
| `description` | Optional, up to 255 characters, NFC-normalized and trimmed, no control characters. An empty or blank string is stored as `null`. | decided here |

**No future dates.** A dated-ahead entry is a plan, not something that happened, and planned money belongs to recurring rules and forecasts (later chapters). With past and present entries only, "current balance" needs no date cut-off. The UTC+14 limit is the same as the opening date's, so no user is refused today's date in their own time zone.

**A category of any level.** Both a top-level category (`Food`) and a subcategory (`Food → Restaurants`) can be used.

## Lifecycle

| Operation | Rule |
|---|---|
| Create | `type`, `accountId`, `categoryId`, `amount` and `occurredOn` are required, `description` is optional. The owner is always the authenticated user. |
| Update | Any of `type`, `accountId`, `categoryId`, `amount`, `occurredOn`, `description` (`null` clears it). The result must satisfy every rule of Create, except that an archived category the transaction already has may stay. Changing `type` therefore needs a `categoryId` of the new kind. |
| Delete | **Hard delete** (technical design): the row is removed, `204`. A balance is a sum, so it is correct again at once. |
| Archived accounts | **Read-only (accounts rule):** their transactions can't be created, edited, moved to or from, or deleted (409). They stay in the list and in the account's balance. Restore the account to change them. |

## Balance

There is still **no balance column**. Every account in the API now carries `balance`, computed in the database on each read:

```
balance = opening_balance + Σ amount of income − Σ amount of expense   (over the account's transactions)
```

- All of an account's transactions count. They can't predate the opening date and can't be in the future, so this is the balance **now**.
- The sum runs in PostgreSQL over `bigint`; the result is cast back to `bigint`, so an impossible overflow is an error, never a rounded number.
- An archived account still has a balance. Excluding it from totals (net worth, liquid money) is the job of those totals, which don't exist yet.
- Nothing is cached. If experiment E6 shows the sum is too slow, a cache is added then, with the measurement.

## Listing

`GET /transactions` returns the user's transactions **newest first**: by `occurredOn` descending, then by `id` descending. The id is a time-ordered UUIDv7, so entries of one day appear in the order they were added, latest first, and the order is total: no two rows tie.

| Parameter | Rule |
|---|---|
| `accountId` | Only this account's. |
| `categoryId` | Only this exact category (a parent doesn't include its subcategories). |
| `type` | `income` or `expense`. |
| `from`, `to` | Inclusive `YYYY-MM-DD` bounds on `occurredOn`. `from` after `to` is a 400. |
| `limit` | 1–100, default 50. |
| `cursor` | The `nextCursor` of the previous page. |

- **Keyset pagination (roadmap).** The cursor encodes the last row's `(occurredOn, id)`; the next page is the rows strictly after it in the order above. Unlike an offset, a row added or deleted meanwhile neither repeats nor skips another row. `nextCursor` is `null` on the last page.
- The cursor is opaque to clients. A malformed one is a 400.
- An `accountId` or `categoryId` the user can't see simply matches nothing: the list is scoped to the user anyway, so it reveals nothing.

## Ownership

- Every query is scoped by the user id from the access token, as for accounts.
- Another user's transaction and a missing one both give 404 "Transaction not found."
- An `accountId` or `categoryId` in a body that the user can't use is a 400 on that field, with the same message whether it is missing or another user's.

## Concurrency

A transaction is written in one database transaction that first locks its account (and the category, when one is being assigned) **`FOR SHARE`**:

- Archiving an account or a category updates its row, which waits for that lock. So "check the account is active, then insert" can't interleave with an archive: either the archive runs first and the write sees it (409), or the write commits first and the archive follows.
- Several writes on one account only share the lock, so they don't wait for each other.
- An edit or delete locks the transaction row `FOR UPDATE` first, so two edits of one transaction run one after the other and neither is lost.

No balance is ever read, changed and written back, so there is no lost-update race on balances to begin with.

## What the database enforces

The service checks every rule first and answers with a precise error. The table enforces the same rules, so no other code path can break them:

| Rule | Mechanism |
|---|---|
| Positive amount within range | `CHECK (amount BETWEEN 1 AND 999999999999999)` |
| The account is the user's and has the same currency | composite foreign key `(account_id, user_id, currency)` → `accounts (id, user_id, currency)` |
| The category is a system one or the user's, of the matching kind | trigger `transactions_rules` |
| Not before the account's opening date | trigger `transactions_rules` |
| The owner never changes | trigger `transactions_rules` |
| Description shape | `CHECK` (trimmed, 1–255, NFC, no control characters) |

Whether the account and category are **active** is an application rule, protected by the locks above, as with category parents.

## Errors

| Situation | Status |
|---|---|
| Invalid body or query, unknown field, an owner or currency in the body | 400 with field errors |
| `accountId` or `categoryId` the user can't use (missing or another user's: the same message) | 400 on that field |
| Category of the other kind | 400 on `categoryId` |
| `occurredOn` before the account's opening date | 400 on `occurredOn` |
| Malformed cursor, or `from` after `to` | 400 |
| Account archived, or category archived when it is being assigned | 409 |
| Another user's or a nonexistent transaction | 404 "Transaction not found." |

## Endpoints

| Method and path | Result |
|---|---|
| `POST /transactions` | 201 with the transaction and `Location` |
| `GET /transactions?…` | 200 `{ "items": [...], "nextCursor": string \| null }` |
| `GET /transactions/:id` | 200 with the transaction, or 404 |
| `PATCH /transactions/:id` | 200 with the transaction; 400; 404; 409 |
| `DELETE /transactions/:id` | 204; 404; 409 if the account is archived |
