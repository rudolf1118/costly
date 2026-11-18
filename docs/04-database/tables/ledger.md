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

There is **no balance column**: technical design §1.1 derives the balance from `opening_balance` and the ledger (see [Balance](#balance) under `transactions`).

### Constraints and indexes

| Name | Rule | Why |
|---|---|---|
| `accounts_name_check` | trimmed, 1–64 characters, no control characters | The API applies the same rules first. |
| `accounts_name_nfc_check` | `name IS NFC NORMALIZED` | Added by `require_nfc_account_names`. Without it, a composed and a decomposed spelling of the same name ("Café") were two different names to the unique index. The API normalizes to NFC first. |
| `accounts_active_name_key` | unique `(user_id, lower(name))` where `archived_at IS NULL` | A name is unique among a user's active accounts, ignoring case; archived accounts free their names. Concurrent creates can't duplicate a name. |
| `accounts_currency_format_check` | `^[A-Z]{3}$` | ISO 4217 shape |
| `accounts_opening_balance_range_check` | between ±999,999,999,999,999 | Below 2^53 (see the requirements document) |
| `accounts_opening_date_check` | `>= 1900-01-01` | "Not in the future" depends on the clock and the user's time zone, so the API checks it. |
| `accounts_archived_after_creation_check` | `archived_at IS NULL OR archived_at >= created_at` | Prisma sets `created_at` from the clock of the API instance that inserted the row. Another instance, or the same host after NTP steps its clock back, may archive with an earlier clock, so archive stores the later of its own time and `created_at`. |
| `accounts_user_id_id_idx` | index `(user_id, id)` | Every query is scoped by user; listings are ordered by id. |
| `accounts_user_id_fkey` | `ON DELETE RESTRICT` | Accounts carry financial history, so a user who owns accounts can't be deleted by accident. |
| `accounts_id_user_id_currency_key` | unique `(id, user_id, currency)` | Added by `add_transactions`. `id` alone is already unique; this key exists only as the target of `transactions`' composite foreign key. |

### How rows change

- **Create:** inserts an active account for the authenticated user.
- **Update:** changes `name`, `type` and `is_liquid` only, with one conditional `UPDATE ... WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`.
- **Archive and restore:** set or clear `archived_at` with one conditional `UPDATE` scoped by `(id, user_id)`. Archive first reads the account, owner-scoped, to get `created_at`, and stores `max(now, created_at)`. The `UPDATE` also requires `archived_at IS NULL`, so of two concurrent archives only the first sets the time.
- **Never changed:** `opening_balance`, `opening_date`, `currency` and `user_id`.
- **Never deleted:** rows stay forever.

### Ledger integration

Transactions reference an account through `(account_id, user_id, currency)`, so the database itself guarantees that a transaction's account is its owner's and has its currency. Rows with transactions can't be deleted, and their owner and currency can't change (`ON DELETE RESTRICT`, `ON UPDATE RESTRICT`). The balance is described under [`transactions`](#balance).

### Tests

- `apps/api/test/accounts.schema.spec.ts` checks every constraint by SQLSTATE and name, against a fresh container.
- `apps/api/test/accounts.e2e.spec.ts` covers the API: lifecycle, money, validation, two-user ownership, transport edge cases, clock skew in both directions, and concurrent creates, renames, archives and restores against real PostgreSQL.

## `categories`

What transactions are classified by, two levels at most. Introduced by migration `20261113151531_add_categories` and filled with the system categories by `20261113151532_seed_system_categories` (Chapter 1, task 6). The behaviour is in [`02-requirements/ledger-categories.md`](../../02-requirements/ledger-categories.md).

### Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | System categories have fixed ids (see Seeding). |
| `user_id` | `uuid` | yes | — | `NULL` for a system category. References `users.id`, `ON DELETE RESTRICT`. |
| `parent_id` | `uuid` | yes | — | `NULL` at the top level. References `categories.id`, `ON DELETE RESTRICT`. |
| `name` | `text` | no | — | |
| `kind` | `category_kind` enum | no | — | `income`, `expense` |
| `nature` | `category_nature` enum | yes | — | `essential_fixed`, `essential_variable`, `discretionary`; `NULL` exactly for income. |
| `archived_at` | `timestamptz(3)` | yes | — | `NULL` means active. |
| `created_at` | `timestamptz(3)` | no | `CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamptz(3)` | no | `CURRENT_TIMESTAMP` | Also set by Prisma's `@updatedAt`. |

### Constraints and indexes

| Name | Rule | Why |
|---|---|---|
| `categories_name_check`, `categories_name_nfc_check` | the account name rules | Shared with accounts; the API normalizes and validates first. |
| `categories_nature_check` | `(kind = 'expense') = (nature IS NOT NULL)` | Every expense has a nature; income never does. |
| `categories_not_own_parent_check` | `parent_id <> id` | |
| `categories_archived_after_creation_check` | `archived_at IS NULL OR archived_at >= created_at` | As for accounts, archive stores the later of now and `created_at`. |
| `categories_active_name_key` | unique `(user_id, parent_id, kind, lower(name)) NULLS NOT DISTINCT` where `archived_at IS NULL` | One active name per owner, parent and kind. `NULLS NOT DISTINCT` makes the system one owner and the top level one parent. |
| `categories_user_id_id_idx` | `(user_id, id)` | A user's categories in creation order. |
| `categories_parent_id_idx` | `(parent_id)` | Subcategories of a category, checked before archiving it. |

### Trigger `categories_parent_rules`

`BEFORE INSERT OR UPDATE OF user_id, parent_id, kind`. It enforces the rules that span two rows, which a `CHECK` can't express. Each violation is a `check_violation` (SQLSTATE 23514):

| Constraint name | Rule |
|---|---|
| `categories_depth_check` | The parent is a top-level category. |
| `categories_parent_kind_check` | A subcategory has its parent's kind. |
| `categories_parent_owner_check` | The parent is a system category or has the same owner. A system subcategory has a system parent. |
| `categories_immutable_check` | `user_id`, `parent_id` and `kind` never change. |

Immutability is what keeps the other three true after insert, and why the trigger only has to look at the parent on `INSERT`. Whether the parent is **active** is an application rule, because it needs row locks: a request that adds an active child locks the parent `FOR SHARE`, and archiving locks it `FOR UPDATE` before counting active children.

### Seeding

The seed migration inserts the 36 system categories listed in the requirements document. Their ids are `00000000-0000-7000-8000-0000000000NN`, numbered in seed order with parents before their subcategories:
- **Order:** they are UUIDv7-shaped with a zero timestamp, so `ORDER BY id` lists them before every user's categories.
- **Runs once:** Prisma records the migration and never runs it twice; the schema test deploys again to prove it.
- **Changes:** a later change to the set is a new migration.

### Tests

- `apps/api/test/categories.schema.spec.ts` checks the seed, every constraint and every trigger rule by SQLSTATE and message, against a fresh container.
- `apps/api/test/categories.e2e.spec.ts` covers the API.

## `transactions`

Income and expenses, one row each. Introduced by migration `20261119090000_add_transactions` (Chapter 1). The behaviour is in [`02-requirements/ledger-transactions.md`](../../02-requirements/ledger-transactions.md).

### Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `uuidv7()` | Time-ordered; the tie-breaker of the list order. |
| `user_id` | `uuid` | no | — | References `users.id`, `ON DELETE RESTRICT`. Never changes. |
| `account_id` | `uuid` | no | — | With `user_id` and `currency`, references `accounts (id, user_id, currency)`. |
| `category_id` | `uuid` | no | — | References `categories.id`, `ON DELETE RESTRICT`. |
| `type` | `transaction_type` enum | no | — | `income`, `expense`. Transfers will add their values. |
| `amount` | `bigint` | no | — | Minor units (ADR-0002), **always positive**: the type gives the direction. |
| `currency` | `char(3)` | no | — | Always the account's (the composite foreign key). |
| `occurred_on` | `date` | no | — | The business date; analytics groups by it, never by `created_at`. |
| `description` | `text` | yes | — | Optional free text. |
| `created_at` | `timestamptz(3)` | no | `CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamptz(3)` | no | `CURRENT_TIMESTAMP` | Also set by Prisma's `@updatedAt`. |

The technical design's `merchant_id`, `note`, `transfer_group_id`, `recurring_rule_id`, `recurring_occurrence`, `import_id` and `import_hash` arrive with merchants, transfers, recurring rules and imports, each with its own migration.

### Constraints and indexes

| Name | Rule | Why |
|---|---|---|
| `transactions_amount_range_check` | `amount BETWEEN 1 AND 999999999999999` | Positive amounts make every sum a plain `SUM(CASE type …)`, with no sign bugs (technical design). The bound is the accounts' bound. |
| `transactions_currency_format_check` | `^[A-Z]{3}$` | ISO 4217 shape |
| `transactions_occurred_on_check` | `>= 1900-01-01` | "Not in the future" depends on the clock, so the API checks it. |
| `transactions_description_check` | `NULL`, or trimmed, 1–255 characters, NFC, no control characters | The API normalizes first and stores a blank description as `NULL`. |
| `transactions_account_id_user_id_currency_fkey` | `(account_id, user_id, currency)` → `accounts`, `RESTRICT` on delete and update | One key, two guarantees: the account belongs to the owner, and the currency matches. |
| `transactions_category_id_fkey` | → `categories.id`, `ON DELETE RESTRICT` | Categories are archived, never deleted, while rows use them. |
| `transactions_user_id_fkey` | → `users.id`, `ON DELETE RESTRICT` | |
| `transactions_user_id_occurred_on_id_idx` | `(user_id, occurred_on DESC, id DESC)` | The list and its keyset pagination; every analytics date range. |
| `transactions_user_id_category_id_occurred_on_idx` | `(user_id, category_id, occurred_on)` | Category analytics and the category filter. |
| `transactions_account_id_occurred_on_idx` | `(account_id, occurred_on)` | Balances and the account filter. |

Whether each index earns its place is measured in experiment E6, as the technical design plans.

### Trigger `transactions_rules`

`BEFORE INSERT OR UPDATE OF user_id, account_id, category_id, type, occurred_on`. It enforces the rules that span two tables. Each violation is a `check_violation` (SQLSTATE 23514):

| Constraint name | Rule |
|---|---|
| `transactions_category_owner_check` | The category is a system category or the transaction owner's. |
| `transactions_category_kind_check` | The category's kind equals the transaction's type. |
| `transactions_after_opening_check` | `occurred_on` is not before the account's `opening_date`. |
| `transactions_owner_immutable_check` | `user_id` never changes. |

A category's owner and kind and an account's opening date never change, so checking from the transaction's side is enough. Whether the account and the category are **active** is an application rule, protected by row locks: every write locks its account, and a category being assigned, `FOR SHARE`; archiving updates the row and so waits.

### Balance

No table stores a balance. Every account response computes it:

```sql
SELECT account_id,
       SUM(CASE type WHEN 'income' THEN amount WHEN 'expense' THEN -amount END)::bigint AS net
FROM transactions
WHERE user_id = $1 AND account_id = ANY($2)
GROUP BY account_id
```

The balance is `opening_balance + net`, added as `bigint` in the API. `SUM` over `bigint` is an exact `numeric`, and the cast back to `bigint` fails loudly rather than round. The `CASE` has no `ELSE`: transfers must be added to it on purpose.

### How rows change

- **Create, update:** in one database transaction that locks the account (and a newly assigned category) `FOR SHARE`; an update first locks the row itself `FOR UPDATE`.
- **Delete:** a hard delete (technical design), after `SELECT … FOR UPDATE OF t FOR SHARE OF a` checks that the account is active.

### Tests

- `apps/api/test/transactions.schema.spec.ts` checks every constraint, foreign key and trigger rule by SQLSTATE and message, against a fresh container.
- `apps/api/test/transactions.e2e.spec.ts` covers the API: validation, ownership, archived accounts and categories, edits, deletes, filters, keyset pagination, balances (including sums beyond 2^53) and deterministic lock interleavings.
