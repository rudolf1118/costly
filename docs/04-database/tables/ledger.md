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
| `accounts_name_nfc_check` | `name IS NFC NORMALIZED` | Added by `require_nfc_account_names`. Without it, a composed and a decomposed spelling of the same name ("Café") were two different names to the unique index. The API normalizes to NFC first. |
| `accounts_active_name_key` | unique `(user_id, lower(name))` where `archived_at IS NULL` | A name is unique among a user's active accounts, ignoring case; archived accounts free their names. Concurrent creates can't duplicate a name. |
| `accounts_currency_format_check` | `^[A-Z]{3}$` | ISO 4217 shape |
| `accounts_opening_balance_range_check` | between ±999,999,999,999,999 | Below 2^53 (see the requirements document) |
| `accounts_opening_date_check` | `>= 1900-01-01` | "Not in the future" depends on the clock and the user's time zone, so the API checks it. |
| `accounts_archived_after_creation_check` | `archived_at IS NULL OR archived_at >= created_at` | Prisma sets `created_at` from the clock of the API instance that inserted the row. Another instance, or the same host after NTP steps its clock back, may archive with an earlier clock, so archive stores the later of its own time and `created_at`. |
| `accounts_user_id_id_idx` | index `(user_id, id)` | Every query is scoped by user; listings are ordered by id. |
| `accounts_user_id_fkey` | `ON DELETE RESTRICT` | Accounts carry financial history, so a user who owns accounts can't be deleted by accident. |

### How rows change

- **Create:** inserts an active account for the authenticated user.
- **Update:** changes `name`, `type` and `is_liquid` only, with one conditional `UPDATE ... WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`.
- **Archive and restore:** set or clear `archived_at` with one conditional `UPDATE` scoped by `(id, user_id)`. Archive first reads the account, owner-scoped, to get `created_at`, and stores `max(now, created_at)`. The `UPDATE` also requires `archived_at IS NULL`, so of two concurrent archives only the first sets the time.
- **Never changed:** `opening_balance`, `opening_date`, `currency` and `user_id`.
- **Never deleted:** rows stay forever.

### Future ledger integration

Transactions (task 6) will reference `accounts.id`. A balance at the end of day `D` will be `opening_balance` plus inflows minus outflows over posted transactions with `opening_date <= occurred_on <= D`. The ledger will refuse:
- transactions dated before an account's opening date;
- new transactions on archived accounts.

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
