# Categories: behaviour

Chapter 1, task 6: what a transaction will be classified by.

**Sources:**
- `03-technical-design.md` §1.1: `categories: id, user_id (null = system default), parent_id (nullable, self-FK), name, kind (income|expense), nature (essential_fixed|essential_variable|discretionary; null for income), archived_at`. Depth ≤ 2: the parent must have `parent_id IS NULL`. Unique `(user_id, parent_id, name)`. Soft delete only (`archived_at`).
- `01-product-and-feature-analysis.md` §2, Categories: two levels at most; system defaults are seeded; users can add, rename and archive, never hard-delete; every category has a `nature`, which drives fixed-vs-discretionary analytics, the emergency fund (essential expenses only) and the rule that recommendations only ever suggest cutting discretionary spend.
- Decisions taken with the project owner for this task (marked **owner** below).

The rules below settle what those sources leave open. Each rule says where it comes from.

## Two kinds of category

| | System category | Custom category |
|---|---|---|
| Owner | none (`user_id IS NULL`) | the user who created it |
| Created by | a migration (see Seeding) | `POST /categories` |
| Visible to | every user | its owner only |
| Changed by | a new migration only | its owner |
| In the API | `"isSystem": true` | `"isSystem": false` |

System categories are **one shared set of rows**, not copied per user (technical design: `user_id` null = system default). Users can't rename, archive or otherwise change them: such a request is a **403**. The category is visible to them, so a 404 would be a lie.

## Fields

| Field | Rule | Source |
|---|---|---|
| `kind` | `income` or `expense`. **Immutable.** A subcategory has its parent's kind. | technical design; immutability decided here |
| `nature` | For `expense`: required, one of `essential_fixed`, `essential_variable`, `discretionary`. For `income`: always `null`, and sending one is a 400. Can be changed on the user's own expense categories. A subcategory's nature is its own: `Food` is `essential_variable`, `Food → Restaurants` is `discretionary`. | technical design, product analysis; changeability decided here |
| `name` | The same rules as account names: normalized to Unicode NFC, trimmed, 1–64 characters, no control characters. | decided here, reusing the accounts rules |
| `parentId` | `null` for a top-level category. Otherwise a **top-level** category (depth ≤ 2) of the same kind that is either a system category or the user's own, and active. Users may add their own subcategory under a system parent, such as `Food → Coffee`. **Immutable.** | depth: technical design; system parents: **owner** |
| `isSystem` | `true` for system categories. | decided here |
| `archivedAt` | `null` while active. | technical design |

There are no icon or colour fields: the specification has none.

### Names are unique per owner, parent and kind

Among **active** categories, a name is unique for one owner (the system counts as one owner), under one parent, within one kind, ignoring case and Unicode form.

- `kind` is part of the key: a top-level income `Gifts` and a top-level expense `Gifts` can both exist. Subcategories always share their parent's kind, so this only matters at the top level.
- **System and custom names don't collide (owner).** A user may have their own top-level `Food` next to the system one. If they didn't, adding a system category in a later migration could clash with existing user data. Clients tell them apart by `isSystem`.
- Archived categories don't hold on to their names, as with accounts.

The technical design's unique `(user_id, parent_id, name)` is kept, extended by `kind`, case and NFC, and by `NULLS NOT DISTINCT` so that system categories and top-level categories are unique too: with plain SQL `NULL`s they wouldn't be.

## Lifecycle

```
create ──▶ active ──archive──▶ archived ──restore──▶ active
```

| Operation | Rule |
|---|---|
| Create | `name` and `kind` are required, `nature` is required for expense, and `parentId` is optional. The owner is always the authenticated user. |
| Update | Only `name` and `nature` (expense only), and only on the user's **active** custom category. An archived one gets 409, a system one 403. |
| Immutable | `kind`, `parentId`, the owner and system status. Changing a kind or a parent would silently reclassify every transaction in the category. The database rejects such changes too. |
| Archive | Sets `archivedAt`. Idempotent. **A top-level category with active subcategories can't be archived (owner):** 409, archive the subcategories first. There is no hard delete. |
| Restore | Clears `archivedAt`. Idempotent for an active category. 409 if an active sibling already has the name, or if the parent is archived (restore the parent first). |

Creating a subcategory under an archived parent is a 409 as well. Together these rules mean an active category never has an archived parent.

### For transactions (a later task)

- A transaction will need an **active** category that is a system category or the user's own, with a kind matching the transaction's type.
- An archived category stays valid on the transactions that already use it. It stays readable through `GET /categories/:id` and `?status=archived`, so history keeps its labels.
- Because kind and parent can't change, a transaction's classification can't be changed under it.

## Errors

| Situation | Status |
|---|---|
| Invalid body or query, unknown field, attempt to send `kind`, `parentId`, `isSystem` or an owner in an update | 400 with field errors |
| `parentId` names no category the user can see (missing or another user's: the same message) | 400 on `parentId` |
| `parentId` names a subcategory | 400 on `parentId` |
| `kind` differs from the parent's | 400 on `kind` |
| `nature` sent for an income category | 400 on `nature` |
| Changing, archiving or restoring a system category | 403 |
| Another user's or a nonexistent category id | 404 "Category not found." |
| Name taken among active siblings | 409 |
| Parent archived (on create or restore); active subcategories (on archive); archived category (on update) | 409 |

## Concurrency

The database decides every race:
- **Names:** the partial unique index decides between concurrent creates, renames and restores.
- **Parent archived vs. child created or restored:** the request that adds an active child locks the parent row `FOR SHARE` and checks that it's active. Archiving a top-level category locks it `FOR UPDATE` and only then counts its active children. The two locks conflict, so one request always sees the other's result.
- **Edits:** updates use a conditional `UPDATE ... WHERE archived_at IS NULL`, as accounts do, so an edit can't land on a category archived in the meantime.
- **Timestamps:** `archivedAt` is never earlier than `createdAt`, even when the API's clocks disagree, as with accounts.

## Seeding

System categories are inserted by a **migration** (`seed_system_categories`) with fixed ids:
- **Exactly once per database:** `prisma migrate deploy` records it like any other migration and never repeats it. No separate seed command has to be remembered, and tests get the same rows automatically.
- **Stable ids:** the ids are hard-coded, so a system category has the same id in every database. Clients, fixtures and the future data generator can rely on it.
- **Ordering:** the ids are UUIDv7-shaped with a zero timestamp, so they sort before every real UUIDv7. Ordering by id therefore lists system categories first, in seed order, then the user's own in creation order.
- **Later changes:** additions, renames and archivals go into a new migration, never into this one.

The default set (**owner**) is 5 income and 12 expense top-level categories, with 19 subcategories:

| Kind | Category | Nature | Subcategories (nature) |
|---|---|---|---|
| income | Salary, Freelance, Investments, Gifts, Other income | — | — |
| expense | Housing | essential_fixed | Rent, Utilities, Internet & phone (all essential_fixed) |
| expense | Food | essential_variable | Groceries (essential_variable), Restaurants (discretionary), Food delivery (discretionary) |
| expense | Transport | essential_variable | Public transport (essential_variable), Taxi (discretionary), Fuel (essential_variable) |
| expense | Health | essential_variable | Pharmacy, Doctors (both essential_variable) |
| expense | Loan payments | essential_fixed | — |
| expense | Education | essential_variable | Courses (essential_variable), Books (discretionary) |
| expense | Shopping | discretionary | Clothing (discretionary), Electronics (discretionary), Household (essential_variable) |
| expense | Entertainment | discretionary | Streaming, Events, Hobbies (all discretionary) |
| expense | Personal care | essential_variable | — |
| expense | Travel | discretionary | — |
| expense | Gifts & donations | discretionary | — |
| expense | Other expense | discretionary | — |

`Loan payments` (`essential_fixed`) is the category the product analysis names for existing loans. There is no `Subscriptions` category: the product analysis defines a subscription as a recurring rule with a discretionary category, so it is a view, not a category.

## Ownership and security

- **Authentication:** every endpoint requires a valid access token. The user comes only from the token; the API accepts no owner field, and unknown fields are rejected.
- **Visibility:** reads return system categories and the user's own. Another user's category is a 404 identical to a missing one.
- **Writes:** every write is scoped by `(id, user_id = me)` in the statement itself, so system rows and other users' rows can never match.
- **Malformed ids:** an id that isn't a UUID is a 400.

## Endpoints

| Method and path | Result |
|---|---|
| `GET /categories?kind=income\|expense&status=active\|archived\|all` | 200 `{ "items": [...] }`: system categories first, then the user's own, flat with `parentId`. The default status is `active`; without `kind`, both kinds are listed. |
| `GET /categories/:id` | 200 or 404 |
| `POST /categories` | 201 with the category and `Location`; 400; 409 |
| `PATCH /categories/:id` | 200; 400; 403; 404; 409 |
| `POST /categories/:id/archive` | 200; 403; 404; 409 |
| `POST /categories/:id/restore` | 200; 403; 404; 409 |

There's no pagination. The list is a few dozen system categories plus the user's own, and clients need all of them to draw the tree.

## Not in this task

- Transactions and the checks they'll make against categories.
- Hiding a system category for one user, or overriding its nature. Both would need per-user settings on shared rows; they'll be added only if a real need appears.
- Merchants and their default category.
