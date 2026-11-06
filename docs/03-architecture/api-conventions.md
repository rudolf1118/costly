# API conventions

How the HTTP API behaves for every endpoint. Covers what exists so far: errors and request
validation. Pagination, authentication and versioning are added with the first endpoints that
need them.

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

**Not rate-limited yet.** Every accepted request costs one Argon2id hash: 64 MiB for about 30 ms.
The 100 kB body limit and validation, which runs before hashing, bound the cost of a single
request but not the number of requests. Costly runs locally for now, so this is accepted for
registration. Rate limiting is planned together with login (task 4): one Redis-backed limiter for
every `/auth/*` route, since login needs brute-force protection anyway. It must exist before the
API is reachable from any network.
