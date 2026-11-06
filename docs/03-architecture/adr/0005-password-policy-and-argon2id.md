# ADR-0005: Password policy and Argon2id hashing

Status: Accepted
Date: 2026-11-06

## Context

Registration (Chapter 1, task 3) is the first code that handles passwords. The specification
says only "email + password" authentication and a `password_hash` column. It sets no rules for
what a valid password is or how it's stored. Passwords are Costly's only authentication factor;
no second factor is planned.

## Decision

- **Policy:** 8 to 128 characters, counted in Unicode code points after normalization. No
  composition rules (no required digits, symbols or cases). Any character is allowed, spaces
  included, and passwords are never trimmed.
- **Normalization:** NFKC before length checks, hashing and verification.
- **Storage:** Argon2id with m = 64 MiB, t = 3, p = 4, in PHC string format, via
  `@node-rs/argon2`.

## Rationale

The rules follow NIST SP 800-63B: length is what makes a password strong, composition rules push
people towards predictable patterns, and every printable character, spaces included, should be
accepted. The minimum of 8 is the project owner's choice. It's the OWASP ASVS minimum. NIST's
current revision asks for 15 for single-factor passwords. The upper bound of 128 keeps a
megabyte-long body from being fed to a deliberately expensive hash function.

NFKC, which NIST recommends, makes the same password typed on different keyboards produce the
same bytes. That matters for Armenian and other non-ASCII input. Counting code points means an
emoji counts as one character, not two UTF-16 units.

Argon2id is RFC 9106's recommended algorithm and OWASP's first choice. The parameters are RFC
9106's second recommended configuration, for systems with less memory than the first's 2 GiB.
They take about 27 ms per hash on the development machine, against 17 ms for OWASP's minimum
(19 MiB, t = 2, p = 1). The parameters are stored in every hash, so they can be raised later and
existing hashes upgraded at the next successful login.

`@node-rs/argon2` ships prebuilt native binaries with no install script. The `argon2` package
needs a `node-gyp` build that pnpm would have to be allowed to run.

## Consequences

- Login (task 4) must normalize with NFKC before verifying, or non-ASCII passwords stop matching.
  `normalizePassword` and `verifyPassword` in `apps/api/src/identity/password.ts` are the single
  implementation for both.
- Each registration or login holds 64 MiB for about 30 ms. Ten simultaneous attempts need about
  640 MiB, which is fine for a single-user local deployment. Auth endpoints should be rate-limited
  before anything public. Nothing rate-limits them yet.
- `@node-rs/argon2` declares `Algorithm` as a `const enum`, which is empty at runtime under SWC.
  The numeric id `2` (Argon2id) is passed explicitly, and the tests assert the `$argon2id$` prefix.
- Raising the minimum length later doesn't invalidate existing accounts. It applies at the next
  password change.

## Alternatives Considered

**A 15-character minimum (NIST SP 800-63B-4 for single-factor passwords).** Stronger. The owner
chose 8 for this version. Revisiting it needs a new ADR.

**bcrypt.** Widely available, but it truncates input at 72 bytes, isn't memory-hard, and isn't
the current OWASP or RFC recommendation.

**scrypt from `node:crypto`.** Needs no dependency and is memory-hard, but Argon2id is the
standardised successor, and OWASP lists scrypt only as the fallback when Argon2id isn't available.
