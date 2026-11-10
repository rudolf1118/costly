# Ledger tables

## `accounts`

Where money lives. Introduced by migration `20261110064015_add_accounts` (Chapter 1, task 5). The behaviour is in [`02-requirements/ledger-accounts.md`](../../02-requirements/ledger-accounts.md).

### Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | Time-ordered, so ordering by id means creation order. |
| `user_id` | `uuid` | no | — | References `users.id`, `ON DELETE RESTRICT`. |
| `name` | `text` | no | — | |
| `type` | `account_type` enum | no | — | `checking`, `cash`, `savings`, `credit_card` |
| `currency` | `char(3)` | no | — | ISO 4217; `AMD` only in v1, an application rule. |
| `is_liquid` | `boolean` | no | — | The API defaults it from the type. |
| `opening_balance` | `bigint` | no | — | Minor units (ADR-0002); the balance at the start of `opening_date`. May be negative. |
| `opening_date` | `date` | no | — | |
| `archived_at` | `timestamptz(3)` | yes | — | `NULL` means active. |
| `created_at` | `timestamptz(3)` | no | `CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamptz(3)` | no | `CURRENT_TIMESTAMP` | Also set by Prisma's `@updatedAt`, and by archive and restore. |

There is **no balance column**: technical design §1.1 derives the balance from `opening_balance` and the ledger.

### Constraints and indexes

| Name | Rule | Why |
|---|---|---|
| `accounts_name_check` | trimmed, 1–64 characters, no control characters | The API applies the same rules first. |
| `accounts_active_name_key` | unique `(user_id, lower(name))` where `archived_at IS NULL` | A name is unique among a user's active accounts, ignoring case; archived accounts free their names. Concurrent creates can't duplicate a name. |
| `accounts_currency_format_check` | `^[A-Z]{3}$` | ISO 4217 shape |
| `accounts_opening_balance_range_check` | between ±999,999,999,999,999 | Below 2^53 (see the requirements document) |
| `accounts_opening_date_check` | `>= 1900-01-01` | "Not in the future" depends on the clock and the user's time zone, so the API checks it. |
| `accounts_archived_after_creation_check` | `archived_at IS NULL OR archived_at >= created_at` | Both timestamps come from the API's clock, because Prisma sets `created_at` on insert. Mixing in the database's `now()` broke this check whenever the database clock ran behind. |
| `accounts_user_id_id_idx` | index `(user_id, id)` | Every query is scoped by user; listings are ordered by id. |
| `accounts_user_id_fkey` | `ON DELETE RESTRICT` | Accounts carry financial history, so a user who owns accounts can't be deleted by accident. |

### How rows change

- **Create:** inserts an active account for the authenticated user.
- **Update:** changes `name`, `type` and `is_liquid` only, with one conditional `UPDATE ... WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`.
- **Archive and restore:** set or clear `archived_at` with one conditional `UPDATE` scoped by `(id, user_id)`. The time comes from the API's clock, the same one Prisma uses for `created_at`.
- **Never changed:** `opening_balance`, `opening_date`, `currency` and `user_id`.
- **Never deleted:** rows stay forever.

### Future ledger integration

Transactions (task 6) will reference `accounts.id`. A balance at the end of day `D` will be `opening_balance` plus inflows minus outflows over posted transactions with `opening_date <= occurred_on <= D`. The ledger will refuse:
- transactions dated before an account's opening date;
- new transactions on archived accounts.

### Tests

- `apps/api/test/accounts.schema.spec.ts` checks every constraint by SQLSTATE and name, against a fresh container.
- `apps/api/test/accounts.e2e.spec.ts` covers the API: lifecycle, money, validation and two-user ownership.
