import { hash, verify } from '@node-rs/argon2';

/**
 * Password rules (decided for task 3, following NIST SP 800-63B): length only,
 * no composition rules, any characters including spaces. Length is counted in
 * Unicode code points after normalization, so an emoji counts as one.
 */
export const PASSWORD_MIN_LENGTH = 8;
/** An upper bound so a megabyte-long "password" cannot be used to burn CPU. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * @node-rs/argon2 declares Algorithm as a const enum. SWC (used by the test
 * runner) cannot inline const enums from declaration files, and at runtime the
 * package exports Algorithm as {}, so the numeric value is used: 2 = Argon2id.
 */
const ARGON2ID = 2;

/**
 * RFC 9106's second recommended configuration: 64 MiB, 3 passes, 4 lanes.
 * The parameters are stored in every hash, so they can be raised later and old
 * hashes upgraded at the next login.
 */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
};

/**
 * NFKC, as NIST recommends, so the same password typed on different keyboards
 * or devices produces the same bytes. Login must apply the same normalization.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, normalizePassword(password));
}
