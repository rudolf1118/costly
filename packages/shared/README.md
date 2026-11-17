# @costly/shared

Framework-free TypeScript shared by Costly's clients (ADR-0010). No React, and no browser- or
Node-only APIs: the one platform API it uses is `fetch`, which browsers, Node and React Native all
have. The web app imports the TypeScript source directly; there is no build step yet.

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

## API errors

`readProblem(response)` reads the error of any non-2xx response as RFC 9457 problem details
(`api-conventions.md`, Errors) and never throws.

- `status` is always the response's status, whatever the body says.
- `errors` lists the invalid fields of a rejected body. An entry whose `path` is `""` belongs to
  the whole body (for example an unknown field), not to one input.
- `retryAfterSeconds` comes from `Retry-After` on a 429.
- A body that isn't problem details (an empty body, a proxy's HTML page, malformed JSON) gives a
  generic problem with the status and a title, so there is always something to show.
- It takes a structural `ResponseLike` rather than the DOM `Response` type, so the package needs
  no browser or Node type definitions.

## API client

`createApiClient({ baseUrl, session })` is the one way a client calls the API.

- **Errors:** every non-2xx answer becomes an `ApiError` with `kind: 'http'`, the status and the
  problem details. No answer at all is `kind: 'network'`; a body that fails its schema is
  `kind: 'invalid-response'`. Messages never contain bodies, tokens or amounts.
- **Responses** are validated with the zod schema passed to `request`, so a drifted contract is an
  error, never a wrong figure. `identity.ts` has the schemas of the identity endpoints.
- **Bodies** are JSON; a `bigint` is written as its exact decimal string (ADR-0002).
- **Authentication:** authenticated requests carry the session's access token. With no token, or
  after a 401, the client asks the session to refresh **once** and replays the request **once**.
  Concurrent refreshes share one request, because the API accepts each refresh token only once
  (ADR-0006).
- **Sessions are platform-specific.** The client takes a `SessionHandler`: the web keeps the refresh
  token in its HttpOnly cookie, a native client would keep it in secure storage (ADR-0011).
  `refresh()` resolves to `null` when the session has ended and rejects for anything else, such as
  the network being down, so an outage never signs the user out.

## Accounts

`accounts.ts` holds the account schemas and request bodies from
`docs/02-requirements/ledger-accounts.md`.

- `accountSchema` reads `openingBalance` as a `bigint`. It is the balance at the start of the
  opening date, never a current balance, and clients label it that way.
- `DEFAULT_LIQUIDITY` matches the API's default for each type, so a form can preset the switch.
- `checkDisplayName` applies the API's name rule (NFC, trimmed, 1–64 code points, no control
  characters) before sending. Category names follow the same rule.
