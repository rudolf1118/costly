# @costly/shared

Framework-free TypeScript shared by Costly's clients (ADR-0010). No React, no browser APIs, no
Node APIs. The web app imports the TypeScript source directly; there is no build step yet.

## Money

Amounts are integer minor units in a `bigint` from parsing to formatting (ADR-0002). Nothing in
this package turns an amount into a `number`.

| Function | Does |
|---|---|
| `parseMinorUnits(value)` | Reads an amount from an API response. Same grammar the API enforces; anything else throws `InvalidAmountError`. |
| `serializeMinorUnits(minor)` | Writes an amount for a request body. Refuses values outside ±999,999,999,999,999. |
| `formatAmd(minor, { sign, symbol })` | Displays an amount. |
| `parseAmdInput(text, { allowNegative })` | Reads an amount a person typed, in dram. Returns `{ ok, minor }` or `{ ok: false, error }`. |

### Display rule

Decided with the project owner on 2026-11-14, as ADR-0010 left open.

- AMD is shown **without decimals** when the amount is a whole number of dram: `150000` is
  `1,500 ֏`.
- An amount that is **not** a whole number of dram shows **both decimals**, never rounded:
  `150050` is `1,500.50 ֏`, `1` is `0.01 ֏`. Rounding would make the screen disagree with the
  ledger.
- Comma grouping, the dram sign after the number, U+2212 for minus. Sign, number and symbol are
  joined by no-break spaces so a line never breaks inside an amount.
- Signs: `negative` (default, balances) shows only a minus; `always` (transactions, changes) shows
  `+` or `−` on every non-zero amount; `never` shows none. Zero is never signed.

### Input rule

- "." is the decimal separator, with at most two decimals. A third decimal is an error, not
  rounded.
- Commas or spaces may group thousands, but only where a grouping separator belongs. `1,5` and
  `0,500` are rejected rather than guessed, because comma-decimal locales write half a dram that
  way.
- A minus (`-` or `−`) is accepted only when the field allows negative amounts, such as an
  account's opening balance.
- Whatever `formatAmd` displays can be typed back in and reads as the same amount.
