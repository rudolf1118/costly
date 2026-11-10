# ADR-0006: Authentication with JWT access tokens and rotating refresh sessions

Status: Accepted
Date: 2026-11-06 (amended 2026-11-06 by the PR #4 security audit: session lock, concurrent-refresh
grace window, IPv6 /64 client identity, known clients exempt from the account limit, atomic
reservation of the account budget. Each change is marked "Amended".)

## Context

Chapter 1 task 4 adds login, refresh, logout and protected routes. The specification only fixes
the outline: "JWT access + rotating refresh token" (roadmap, Chapter 1) and a `refresh_tokens`
table with `id, user_id, token_hash, expires_at, revoked_at` (technical design §1.1). Costly is a
single NestJS API serving a browser SPA on a different origin (Vite on `localhost:5173` in
development), and passwords are the only factor (ADR-0005). Redis is already running for BullMQ
(ADR-0004).

## Decision

**Access token.** A JWT signed with HS256 using `JWT_ACCESS_SECRET` (validated: at least 32
characters; the example value is rejected in production). Claims: `sub` (user id), `iss` and `aud`
(both `costly-api`), `iat`, `exp`, and nothing else. Lifetime 15 minutes. Verification allows only
HS256 and checks signature, expiry, issuer and audience. Sent as `Authorization: Bearer`.
Verification is stateless: no database query per request.

**Refresh token.** 32 random bytes from the OS CSPRNG, base64url (256 bits). PostgreSQL stores only
its SHA-256 hex digest, in `refresh_tokens.token_hash` (unique). It is opaque, not a JWT, so it
can never pass access-token verification.

**Session = token family.** Login creates a family (`family_id`) whose first token expires 30 days
later. Every rotation inserts a successor with the same `family_id` and the same `expires_at`: the
session lifetime is absolute, not sliding.

**Rotation.** One transaction runs a conditional `UPDATE ... SET rotated_at = now() WHERE
token_hash = $1 AND rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING ...`,
then inserts the successor. Only one request can win the update for a given token. A partial unique
index allows at most one active (unrotated, unrevoked) token per family, so the database itself
refuses two successful rotations.

*Amended:* rotation, reuse revocation and logout each start their transaction by taking the
session's transaction-scoped advisory lock (`pg_advisory_xact_lock` on the family id). Under READ
COMMITTED, a revoking `UPDATE` that waited on the old token's row lock otherwise missed the
successor a concurrent rotation had just inserted. Logout then didn't end the session, and reuse
detection left a thief's fresh token alive. With the lock, writes to one session run one after
another.

**Reuse detection.** Presenting a token that has already been rotated revokes every token of its
family and answers 401.

*Amended:* there is one exception, the concurrent duplicate. A token rotated **less than 10 seconds
ago** in a session that is still live gets 409 "retry with the current cookie", without revoking
anything or clearing the cookie. The access token lives only in memory, so every page load and new
tab refreshes. Two tabs, or a browser restoring several, therefore present the same cookie at once.
Under the original rule that logged the user out everywhere, and the losers' responses even cleared
the shared cookie. A thief replaying within the window gains nothing, because 409 carries no token.
If the thief rotated first, the victim's client keeps presenting the old token, and the first
attempt after the window revokes the session. Two successful rotations of one credential remain
impossible.

**Transport.** The refresh token travels only in an HttpOnly cookie, never in a body:
- name `costly_refresh`;
- `Path=/auth`, `SameSite=Strict`;
- `Secure` when `NODE_ENV=production`;
- `Max-Age` set to the session's remaining lifetime.

The access token is returned in the JSON body, and the client keeps it in memory only. Cookie
endpoints (`login`, `refresh`, `logout`) reject a request whose `Origin` header is present and
isn't `CORS_ORIGIN` (403). CORS allows credentials for that one origin.

**Logout.** `POST /auth/logout` uses the refresh cookie alone, not the access token, so it works
after the access token has expired. It revokes that session's family, clears the cookie and always
answers 204, whether or not the session existed. Other sessions of the same user are untouched.
There is no global logout yet.

**Login errors.** Wrong password and unknown email both answer 401 "Invalid email or password."
For an unknown email the password is still verified against a dummy Argon2id hash with the
ADR-0005 parameters, so response time doesn't reveal whether the account exists.

**Rate limiting.** Fixed-window counters in Redis, incremented and expired in one Lua script so
every key has a TTL. Limits are checked before any Argon2id work:

| Endpoint | Limit |
|---|---|
| `POST /auth/register` | 5 requests per 15 minutes per client IP |
| `POST /auth/login` | 10 requests per 15 minutes per client IP, and 10 failed attempts per 15 minutes per account |
| `POST /auth/refresh` | 30 requests per 15 minutes per client IP |
| `POST /auth/logout` | not limited |

The account key is the SHA-256 of the trimmed, lower-cased email, so no address is stored in Redis,
and no password or token ever is. Exceeding a limit gives 429 with `Retry-After`. If Redis is
unavailable, these endpoints answer 503 instead of running unlimited.

*Amended:* the account budget is **reserved atomically before verification**. Each attempt first
increments the account's failure counter, and a success gives the unit back. Checking the count
and recording the failure only after verification let concurrent guesses all pass the check: 30
simultaneous guesses from 30 IPs were all verified against a cap of 10.

**Client IP.** Express's `req.ip` with `trust proxy` set from `TRUST_PROXY`: the number of proxy
hops, default 0. With 0, `X-Forwarded-For` is ignored and the socket address is used. Behind one
reverse proxy that overwrites `X-Forwarded-For`, production sets `TRUST_PROXY=1`.

*Amended:* the address is reduced to a client identity before it becomes part of a key:
- IPv4 stays as is;
- IPv4-mapped IPv6 becomes its IPv4 address;
- IPv6 becomes its **/64** prefix;
- anything unparsable lands in one shared `invalid` bucket.

Every IPv6 subscriber controls a whole /64, so keying on the full address let one client use a
fresh address, and a fresh budget, for every request.

**Test switch.** `AUTH_RATE_LIMIT=off` disables the limits for test suites about other behaviour.
Configuration validation rejects it in production.

## Rationale

- **HS256:** the same process signs and verifies, so an asymmetric key pair (RS256, EdDSA) would
  add key management with no reader that benefits. If another service ever verifies tokens, a new
  ADR switches to EdDSA.
- **15 minutes:** that is the window in which a stolen or revoked access token stays usable, since
  verification is stateless. Refresh keeps sessions long-lived.
- **SHA-256, not Argon2id, for refresh tokens:** they carry 256 bits of randomness. A fast hash is
  enough to make the stored digest useless, and it allows a direct unique-index lookup.
- **Absolute session lifetime:** this bounds how long a stolen refresh family can live, even if
  the thief keeps refreshing.
- **Strict reuse handling:** this follows the OAuth 2.0 Security BCP (RFC 9700). A replayed token
  means the credential leaked, and the server can't tell which party is legitimate.
- **HttpOnly cookie:** an XSS bug can't read the refresh token, so it can't take over the long-lived
  session; at most it can act while the page is open. SameSite=Strict and the Origin check are the
  CSRF defences. `localhost:5173` and `localhost:3100` are the same site, and production must put
  web and API on the same site (e.g. `app.` and `api.` subdomains of one domain).
- **Account-level failure limit:** stops brute force against one account from many IPs. Counting
  only failures means successful logins never use up the budget.
- *Amended:* **known clients are exempt from the account limit.** A client (rate-limit identity)
  that logged in to the account successfully in the last 30 days skips the per-account failure
  check, though it stays under the per-IP limit. Without this, anyone who knew the owner's email
  could keep the account locked indefinitely with 10 failures every 15 minutes from a single IP.
  The marker key is a SHA-256 of the account digest and the client identity, so Redis stores
  neither the email nor the IP.
- **Fail closed when Redis is down:** an outage must not turn into unlimited password hashing.
  Costly needs Redis for jobs anyway, and readiness already reports it.

## Consequences

- Revoking a session stops refreshes immediately, but its last access token keeps working for up to
  15 minutes.
- Rotating `JWT_ACCESS_SECRET` invalidates all access tokens at once. Clients recover through
  refresh; refresh tokens are unaffected.
- The web client retries a refresh that answers 409 once, after the response that won has updated
  the cookie. Reuse detection is delayed by at most 10 seconds.
- An attacker who knows the owner's email can still block logins to that account from clients
  the account has never been used from. The owner keeps access from any client that logged in
  within 30 days. An attacker on the owner's own network shares that client identity, so they
  skip the account limit but stay under the per-IP limit of 10 per 15 minutes.
- Expired and revoked rows accumulate in `refresh_tokens`. A cleanup job arrives with the
  background-processing work in Chapter 2.
- Redis outages make registration, login and refresh unavailable (503). Already-issued access
  tokens keep working.

## Alternatives Considered

**Refresh token in the JSON body, stored by the client.** Simpler: no cookies, CORS credentials or
CSRF handling. Rejected because the only browser storage that survives a reload, localStorage, is
readable by any script running on the page.

**Server-side sessions only (opaque session cookie, no JWT).** One mechanism and instant
revocation, but every request needs a session lookup. The roadmap specifies JWT access tokens.

**Sliding refresh expiry.** Keeps active users logged in indefinitely, but lets a stolen family
that keeps refreshing live forever.

**A grace period that re-issues tokens to concurrent refreshes.** Friendlier still, but it means
several successful uses of one credential. The amended rule keeps a single success and only
withholds the revocation.

**Requiring clients to serialize refreshes (the original decision).** Correct for one tab, but tabs
can't share an in-flight request without extra browser machinery, and failure meant a lost session.

**`@nestjs/throttler` with a Redis storage adapter.** A third-party storage package for something
that is one atomic Lua script here, and it doesn't fit the account-level failure counter.
