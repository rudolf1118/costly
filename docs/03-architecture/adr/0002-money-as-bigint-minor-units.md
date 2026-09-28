# ADR-0002: Money stored as integer minor units

Status: Accepted
Date: 2026-09-28

## Context

Money is the central data type. Every balance, baseline, forecast, goal projection and loan
calculation is built by summing and scaling amounts, often over thousands of transactions and a
36-month simulation horizon. Representation errors do not stay small; they accumulate.

JavaScript's `number` is an IEEE-754 double. `0.1 + 0.2 === 0.30000000000000004`, and integer
exactness is lost above 2^53. A ledger whose balance slowly drifts is a correctness bug in the
one thing a finance application must get right.

Costly targets a single currency (AMD) for v1, but the representation should not have to change
if multi-currency is ever added.

## Decision

Every monetary amount is an integer count of the currency's minor units, stored as PostgreSQL
`bigint` and carried in TypeScript as `bigint`, with a `currency char(3)` column beside it.

`amount` is always positive and constrained as such in the database; direction comes from the
transaction `type` (`income`, `expense`, `transfer_out`, `transfer_in`).

AMD has an ISO 4217 exponent of 2, so 1,500 AMD is stored as `150000` and displayed without
decimals. The same rule generalises unchanged: 10.50 USD would be `1050`.

No money library is added.

## Rationale

Integers are exact under addition, subtraction and integer scaling, which covers every ledger
aggregate the system computes. `bigint` rather than a 32-bit integer because `int4` tops out at
2,147,483,647 minor units — about 21.5 million AMD — and a realistic apartment goal of 40 million
AMD is 4,000,000,000 minor units, which already overflows it. `bigint` reaches roughly 9.2×10^18,
far beyond anything a personal ledger accumulates.

PostgreSQL's `numeric` is exact in the database, but it reaches JavaScript as a string or a lossy
number depending on the driver, and once a value is a `number` nothing stops ordinary float
arithmetic from being applied to it. Integer minor units make the unsafe operation impossible
rather than merely discouraged.

**Rounding.** Only division produces non-integers: percentages, averages, allocations, annuity
payments. All of it happens inside `packages/finance-math`, whose functions take and return
integers, so rounding is always an explicit, tested step rather than an accident at a call site.
Where parts must sum exactly to a whole — the goal priority waterfall, spreading a monthly
forecast across days — the largest-remainder method is used so the parts add up, and a property
test asserts it. Percentages and ratios are computed at the edges for display and never stored.

**Serialization.** JSON has no integer type large enough and `JSON.stringify` throws on `bigint`.
Amounts therefore cross the API as decimal **strings of minor units** (`"150000"`), never as JSON
numbers, which would silently reintroduce doubles in the client. A single global serializer
performs the conversion so no endpoint can forget. Formatting into `1,500 ֏` is the web client's
job.

**No library.** `dinero.js` and `big.js` solve arbitrary-precision decimals and multi-currency
arithmetic. With one currency and integer minor units the required operations are addition,
subtraction, comparison and integer scaling, all of which `bigint` does natively. Revisit only if
multi-currency with exchange rates is actually built.

## Consequences

Positive: arithmetic is exact; `CHECK (amount > 0)` enforces the sign convention in the database
rather than in application code; invariants such as "a transfer never changes the sum of all
account balances" become property-testable with no tolerance argument.

Negative: `bigint` does not mix with `number` in TypeScript and has no `Math.*` support, so
conversions must be deliberate; every API boundary needs explicit string conversion; test
fixtures read as `150000` rather than `1500`, which is noisier; and anyone reading raw database
rows must remember the factor of 100.

## Alternatives Considered

**`number` holding major units.** Rejected: float arithmetic on money, for the reasons above.

**PostgreSQL `numeric` with a decimal library in the application.** Rejected: more moving parts
and driver-dependent conversion, to reach a precision that integer minor units already provide
exactly.

**`bigint` minor units plus a money wrapper type carrying the currency.** Deferred rather than
rejected. It would be the right move if multi-currency arrives; today, with a single base
currency, the wrapper would add ceremony to every arithmetic expression for no protection.

## References

- `../../00-planning/03-technical-design.md` §1 — database conventions and the sign convention
- `../../00-planning/01-product-and-feature-analysis.md` §2 — currency scope decision
