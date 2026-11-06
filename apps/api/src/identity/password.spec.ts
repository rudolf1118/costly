import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces Argon2id hashes with the ADR-0005 parameters', async () => {
    await expect(hashPassword('correct horse battery staple')).resolves.toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/,
    );
  });

  it('salts every hash, so equal passwords give different hashes', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the password and NFKC-equivalent input, nothing else', async () => {
    const hash = await hashPassword('ﬁnancial plan');

    await expect(verifyPassword(hash, 'ﬁnancial plan')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'financial plan')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'financial plan ')).resolves.toBe(false);
  });

  // Encoding to UTF-8 replaces an unpaired surrogate with U+FFFD, so without a
  // guard "password\uD800", "password\uDBFF" and "password�" share a hash.
  it('never matches a password containing an unpaired surrogate', async () => {
    const hash = await hashPassword('password�');

    await expect(verifyPassword(hash, 'password\uD800')).resolves.toBe(false);
    await expect(verifyPassword(hash, 'password�')).resolves.toBe(true);
  });

  it('accepts characters outside the BMP, whose surrogates come in pairs', async () => {
    const hash = await hashPassword('Ճամփորդություն 🙂 2027');

    await expect(verifyPassword(hash, 'Ճամփորդություն 🙂 2027')).resolves.toBe(true);
  });

  it('refuses to hash a password containing an unpaired surrogate', async () => {
    await expect(hashPassword('password\uDC00')).rejects.toThrow(/unpaired surrogate/);
  });
});
