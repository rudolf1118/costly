# Financial accounts: behaviour

Chapter 1, task 5: the first ledger table.

**Sources:**
- `03-technical-design.md` §1.1: `accounts: id, user_id, name, type (checking|cash|savings|credit_card), currency, is_liquid, opening_balance, opening_date, archived_at`. Unique `(user_id, name)` where not archived. No `balance` column.
- `01-product-and-feature-analysis.md` §2: four types, and `is_liquid` derived from the type but overridable.
- ADR-0002: money format.

The rules below settle what those sources leave open. Each rule says which it is.

## Fields

| Field | Rule | Source |
|---|---|---|
| `type` | `checking`, `cash`, `savings` or `credit_card` | technical design |
| `name` | Trimmed, 1–64 characters, no control characters. Unique per user among **active** accounts, ignoring case. | uniqueness: technical design; the rest decided here |
| `currency` | `AMD` only in v1. It defaults to `AMD`; anything else is rejected. | product analysis: "schema-ready, single currency implemented" |
| `isLiquid` | Defaults from the type: `checking`, `cash` and `credit_card` are liquid, `savings` isn't. Can be overridden at creation and later. | product analysis |
| `openingBalance` | The balance at the start of `openingDate`, in minor units (see Money). It may be negative, for an overdraft or credit card debt. | sign decided here |
| `openingDate` | Required: a real calendar date (`YYYY-MM-DD`), not before 1900-01-01, and not in the future anywhere on Earth (at most today in UTC+14). | decided here; the field itself is from the technical design |
| `archivedAt` | `null` while active; when it was archived otherwise. | technical design |

**`openingDate` is required, not defaulted.** A sensible default would be "today in the user's time zone", which would make the ledger read the identity module's `users` table. ADR-0001 rules that out, and asking for the date costs the client one field. "Not in the future" uses UTC+14 so that no user, in any time zone, is refused today's date.

## Money

ADR-0002 applies unchanged:
- **Storage:** amounts are `bigint` minor units.
- **API:** amounts travel as **decimal strings** of minor units. AMD's ISO 4217 exponent is 2, so `"150000"` is 1,500 AMD.
- **Accepted input:** `^-?(0|[1-9][0-9]{0,14})$`. That's an optional minus, no leading zeros, no `+`, no decimal point, no exponent, no whitespace, and no `-0`.
- **JSON numbers are rejected, even integral ones.** A number in a request is the format ADR-0002 exists to avoid, and accepting both would make clients unsure which to send.
- **Range:** at most ±999,999,999,999,999 minor units (about ±10 trillion AMD), enforced by the API and by a database `CHECK`.
  - The bound sits below 2^53, so a client can still hold any single balance exactly in a JS `number` for display.
  - It also keeps sums over thousands of accounts far below `bigint`'s limit.
- **No rounding** happens anywhere: an amount that doesn't parse is a 400.

## Lifecycle

```
create ──▶ active ──archive──▶ archived ──restore──▶ active
```

| Operation | Rule |
|---|---|
| Create | `name`, `type`, `openingBalance` and `openingDate` are required; `currency` and `isLiquid` are optional. The owner is always the authenticated user. |
| Update | Only `name`, `type` and `isLiquid`, and only on an **active** account (an archived one gets 409). Changing `type` doesn't change `isLiquid`; send both to change both. |
| Immutable | `openingBalance`, `openingDate`, `currency` and the owner. Changing an opening balance silently rewrites every balance derived from it. Corrections will be explicit adjustment entries in the ledger (a later task); until then, an account with a wrong opening balance can be archived and recreated. |
| Archive | Sets `archivedAt`. Idempotent: archiving an archived account returns it unchanged. Nothing is ever deleted; there is no hard delete. |
| Restore | Clears `archivedAt`. Idempotent for an active account. 409 if an active account already uses the name. |

Archived accounts are read-only, kept for history, listed only on request, and excluded from current totals (see Balance).

## Balance semantics

There is **no balance column** (technical design §1.1) and no transaction ledger yet, so the API exposes only the opening balance, never a "current balance". A current balance would claim knowledge the system doesn't have.

When the ledger arrives (Chapter 1, task 6), an account's balance at the end of day `D` will be:

```
opening_balance + Σ inflows − Σ outflows   over posted transactions with opening_date ≤ occurred_on ≤ D
```

- Inflows are `income` and `transfer_in`; outflows are `expense` and `transfer_out`.
- Transfers are pairs of rows, so they move money between accounts without changing the user's total.
- The ledger will reject transactions dated before the opening date, and new transactions or transfers on archived accounts.
- An archived account's past transactions stay in history and period analytics. Its balance is excluded from current totals, such as net worth, liquid money and the emergency-fund runway.

## Ownership

- **Authentication:** every endpoint requires a valid access token. The user id comes only from that token (ADR-0006); the API accepts no `userId`, and unknown fields are rejected.
- **Scoping:** every read and write is scoped by `(id, user_id)` in the same query. Another user's account and a nonexistent account produce the same 404 "Account not found."
- **Malformed ids:** an id that isn't a UUID is a 400. It reveals nothing about any account.

## Endpoints

| Method and path | Result |
|---|---|
| `POST /accounts` | 201 with the account |
| `GET /accounts?status=active\|archived\|all` | 200 `{ "items": [...] }`. The default is `active`; ordering is by creation (time-ordered UUIDv7 id). |
| `GET /accounts/:id` | 200 with the account, or 404 |
| `PATCH /accounts/:id` | 200 with the account; 404; 409 if archived or the name is taken |
| `POST /accounts/:id/archive` | 200 with the account; 404 |
| `POST /accounts/:id/restore` | 200 with the account; 404; 409 if the name is taken |

There's no pagination: a person has a handful of accounts. It gets added only if a real need appears.
