# API conventions

How the HTTP API behaves for every endpoint: errors, request validation, authentication and rate
limiting. Pagination and versioning are added with the first endpoints that need them.

## Errors: RFC 9457 problem details

Every error response has `Content-Type: application/problem+json` and this shape. RFC 9457
replaced the RFC 7807 that the roadmap names.

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "An account with this email already exists."
}
```

- `title` is the standard HTTP reason phrase. `detail` is omitted when it would only repeat it.
- A rejected request body is a 400 with an `errors` extension, one entry per invalid field:

  ```json
  {
    "type": "about:blank",
    "title": "Bad Request",
    "status": 400,
    "detail": "The request body is invalid.",
    "errors": [{ "path": "email", "message": "Invalid email address" }]
  }
  ```

- A body that isn't valid JSON is a 400 with the detail "The request body is not valid JSON."
  The parser's own message is never returned, because it can quote the request body.
- A body the parser refuses outright gets the parser's own client status, with no `detail` (the
  messages repeat header values) and no log entry:
  - 413 for a body over the 100 kB limit;
  - 415 for an unsupported charset or content encoding;
  - 400 for a body it cannot decode, such as corrupt gzip.
- Any unexpected error is a 500 with no `detail`. The cause is logged, not sent. For Prisma errors
  the log keeps the class, the code and the stack frames but not the message, because Prisma's
  messages can contain query arguments.
- The health endpoints are the one exception. `GET /health` returns Terminus' report, with 200 or
  503, in its own format.

Implemented by `ProblemDetailsFilter` in `apps/api/src/platform/http/`, registered globally in
`PlatformModule`. Controllers throw Nest's standard HTTP exceptions; they never build error bodies
themselves.

## Request validation

Request bodies are validated with zod through `ZodValidationPipe`:

```ts
@Post('register')
register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) { ... }
```

- The handler receives the parsed value with the schema's transforms applied, such as trimmed
  strings or canonical names.
- Objects are strict (`z.strictObject`): unknown fields are rejected, not silently dropped, so
  a client can't attempt to set `id` or `passwordHash`.
- Issue messages never contain the submitted values, so a rejected password isn't echoed back.

## Endpoints

### `POST /auth/register`

Creates an account. It doesn't log the user in. Login and tokens come in task 4.

Request:

```json
{
  "email": "anna@example.com",
  "password": "correct horse battery staple",
  "timezone": "Asia/Yerevan",
  "baseCurrency": "AMD"
}
```

| Field | Rule |
|---|---|
| `email` | Trimmed; at most 254 characters; a valid address. Casing is kept and uniqueness ignores it (`citext`). |
| `password` | 8–128 characters, counted in code points after NFKC normalization; must be valid Unicode text (no unpaired surrogates); never trimmed; no composition rules (ADR-0005). |
| `timezone` | A name the IANA time zone database knows, in any casing; stored in canonical form (`asia/yerevan` becomes `Asia/Yerevan`). UTC offsets such as `+04:00` are rejected. |
| `baseCurrency` | Optional; only `AMD` (ADR-0002). |

Responses:

| Status | When | Body |
|---|---|---|
| 201 | Account created | `{ id, email, baseCurrency, timezone, createdAt }`. Never the hash. |
| 400 | Invalid or malformed body, or unknown fields | Problem details (with `errors` for invalid fields) |
| 413, 415 | Body too large, or in an unsupported charset or encoding | Problem details |
| 409 | Email already registered, in any casing | Problem details |

Duplicate emails are decided by the unique index on `users.email`, not by a lookup before the
insert, so concurrent registrations of the same address produce exactly one account.

Limited to 5 requests per 15 minutes per client IP (see [Rate limiting](#rate-limiting)), which
adds 429 and 503 to the responses above.

### `POST /auth/login`

```json
{ "email": "anna@example.com", "password": "correct horse battery staple" }
```

`200`:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Set-Cookie: costly_refresh=<43 characters>; Path=/auth; Expires=<in 30 days>; HttpOnly; SameSite=Strict
Content-Type: application/json

{ "accessToken": "<JWT>", "tokenType": "Bearer", "expiresIn": 900 }
```

- The email is trimmed and matched case-insensitively. The password is NFKC-normalized, as at
  registration.
- Only the body's shape is checked (400). The password policy isn't, so a wrong guess is always a
  401, never a hint about the rules.
- A wrong password and an unknown email both answer `401` "Invalid email or password.", after
  the same Argon2id work.
- Every login starts a new session.

### `POST /auth/refresh`

No body: the refresh token is read only from the `costly_refresh` cookie. `200` has the same
shape as login, with a rotated cookie.

The cookie is cleared and the answer is `401` "The refresh session is invalid or has expired."
when the token is:
- missing, unknown or malformed;
- expired (30 days after login) or revoked;
- already used. That is reuse, and it also ends the session for every token in it (ADR-0006).

`409` "This refresh token was just exchanged by another request. Retry with the current cookie."
means a concurrent request, such as another tab, rotated this token less than 10 seconds ago. The
cookie isn't touched and the session lives on. Retry once.

### `POST /auth/logout`

No body and no access token: it ends the session of the `costly_refresh` cookie and clears the
cookie. It always answers `204`, whether or not there was a session. Other sessions of the same
user keep working. An access token issued before logout stays valid until it expires (at most
15 minutes).

### `GET /auth/me`

Requires `Authorization: Bearer <accessToken>`. `200` returns
`{ id, email, baseCurrency, timezone, createdAt }`.

## Authentication

Protected routes use `AccessTokenGuard` from the identity module and read the caller with
`@CurrentUser()`.

- The user id comes only from the verified token's `sub`, never from a body or query parameter.
- The guard doesn't query the database.
- A missing, malformed, expired or wrongly signed token is `401` "The access token is missing,
  invalid or expired." with `WWW-Authenticate: Bearer realm="costly"` (RFC 6750). That includes
  any algorithm other than HS256, and the wrong issuer or audience.

**Web client contract:**
- Keep the access token in memory only, never in localStorage.
- Send requests to `/auth/login`, `/auth/refresh` and `/auth/logout` with `credentials:
  "include"`.
- Refresh when the access token expires or a request answers 401.
- On a `409` from refresh, retry once. The browser already holds the new cookie.

**CSRF:** the cookie is `SameSite=Strict`. The three cookie endpoints also answer `403` to any
request whose `Origin` header is present and isn't `CORS_ORIGIN`.

## Rate limiting

Redis fixed windows of 15 minutes, checked before validation and before any Argon2id work
(ADR-0006):

| Endpoint | Limit |
|---|---|
| `POST /auth/register` | 5 per client IP |
| `POST /auth/login` | 10 per client IP, and 10 failed attempts per account |
| `POST /auth/refresh` | 30 per client IP |
| `POST /auth/logout`, `GET /auth/me` | not limited |

- **Over the limit:** `429` "Too many requests. Try again later." with `Retry-After` in
  seconds.
- **Redis unavailable** (not connected, or slower than 500 ms): `503` "This service is temporarily
  unavailable. Try again later." The limits fail closed.
- **Unaffected by a Redis outage:** issued access tokens and logout.

## Deployment requirements

| Variable | Development | Production |
|---|---|---|
| `JWT_ACCESS_SECRET` | the value in `.env.example` | required, at least 32 characters, generated with `openssl rand -base64 48`; the example value is refused |
| `CORS_ORIGIN` | `http://localhost:5173` | the web client's exact origin, on the same site as the API (e.g. `app.example.com` and `api.example.com`), so the SameSite=Strict cookie is sent |
| `TRUST_PROXY` | `0` | the number of reverse proxies in front of the API, usually `1`. The proxy must overwrite, not append to, a client-supplied `X-Forwarded-For` |
| `AUTH_RATE_LIMIT` | `on` | `on`; `off` is refused |

`NODE_ENV=production` also makes the refresh cookie `Secure`, so production must be served over
HTTPS.
