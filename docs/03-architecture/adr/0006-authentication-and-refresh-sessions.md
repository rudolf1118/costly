# ADR-0006: Authentication with JWT access tokens and rotating refresh sessions

Status: Accepted
Date: 2026-11-06

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

**Reuse detection.** Presenting a token that has already been rotated revokes every token of its
family and answers 401. Concurrent refreshes with the same token count as reuse: one wins, the
others revoke the family, including the winner's new token. Clients must therefore send one
refresh at a time.

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

**Client IP.** Express's `req.ip` with `trust proxy` set from `TRUST_PROXY`: the number of proxy
hops, default 0. With 0, `X-Forwarded-For` is ignored and the socket address is used. Behind one
reverse proxy that overwrites `X-Forwarded-For`, production sets `TRUST_PROXY=1`.

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
  only failures lets the real user log in after other people's attempts.
- **Fail closed when Redis is down:** an outage must not turn into unlimited password hashing.
  Costly needs Redis for jobs anyway, and readiness already reports it.

## Consequences

- Revoking a session stops refreshes immediately, but its last access token keeps working for up to
  15 minutes.
- Rotating `JWT_ACCESS_SECRET` invalidates all access tokens at once. Clients recover through
  refresh; refresh tokens are unaffected.
- The web client must serialize refreshes (one in flight at a time), or reuse detection logs it out.
- An attacker who knows a victim's email can lock that account out of login for 15 minutes with
  10 failed attempts. This is accepted for a single-user application, and the per-IP limit bounds
  the attacker's own rate.
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

**A grace period for concurrent refreshes.** Friendlier to clients that race, but it reintroduces
"several successful uses of one credential". Clients serializing refresh is cheaper and safer.

**`@nestjs/throttler` with a Redis storage adapter.** A third-party storage package for something
that is one atomic Lua script here, and it doesn't fit the account-level failure counter.
