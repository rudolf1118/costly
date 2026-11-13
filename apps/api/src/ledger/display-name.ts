import { z } from 'zod';

const MAX_LENGTH = 64;

/**
 * A user-visible ledger name, such as an account's or a category's.
 * NFC-normalized, so "Café" typed with a combining accent is the same name as
 * the precomposed one (and unique indexes see them as equal). Trimmed, 1-64
 * characters counted as PostgreSQL's char_length does (code points), with no
 * control characters and no unpaired surrogates, which would otherwise be
 * stored silently as U+FFFD. The tables enforce the same rules with CHECKs.
 */
export const displayName = z
  .string()
  .normalize('NFC')
  .trim()
  .min(1, { error: 'Must not be empty' })
  .refine((name) => [...name].length <= MAX_LENGTH, {
    error: `Must be at most ${MAX_LENGTH} characters`,
  })
  .refine((name) => !/[\p{Cc}\p{Cs}]/u.test(name), {
    error: 'Must not contain control characters or invalid Unicode',
  });
