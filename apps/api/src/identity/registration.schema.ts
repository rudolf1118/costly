import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLength } from './password';

/** The longest address SMTP accepts; the users table enforces the same limit. */
const EMAIL_MAX_LENGTH = 254;

/** Only IANA region names such as Asia/Yerevan or UTC, never offsets like +04:00. */
const TIME_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * The canonical IANA name for a time zone, or undefined if the runtime's time
 * zone database doesn't know it. Accepts any casing: asia/yerevan becomes
 * Asia/Yerevan.
 */
export function canonicalTimeZone(name: string): string | undefined {
  if (!TIME_ZONE_NAME.test(name)) return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export const registerSchema = z.strictObject({
  // citext makes uniqueness case-insensitive, so the casing is kept as typed.
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
  // Never trimmed: spaces are legitimate password characters.
  password: z
    .string()
    .refine((password) => passwordLength(password) >= PASSWORD_MIN_LENGTH, {
      error: `Must be at least ${PASSWORD_MIN_LENGTH} characters`,
    })
    .refine((password) => passwordLength(password) <= PASSWORD_MAX_LENGTH, {
      error: `Must be at most ${PASSWORD_MAX_LENGTH} characters`,
    }),
  timezone: z
    .string()
    .trim()
    .transform((name, context) => {
      const canonical = canonicalTimeZone(name);
      if (canonical === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Must be an IANA time zone name, e.g. Asia/Yerevan',
        });
        return z.NEVER;
      }
      return canonical;
    }),
  // v1 has a single currency (ADR-0002); the field exists so clients don't change later.
  baseCurrency: z.literal('AMD', { error: 'Only AMD is supported' }).default('AMD'),
});

export type RegisterInput = z.output<typeof registerSchema>;
