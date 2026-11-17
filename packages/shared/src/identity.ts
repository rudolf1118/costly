import { z } from 'zod';

/**
 * Response bodies of the identity endpoints, as `api-conventions.md`
 * documents them. Objects are not strict: a field the API adds later must
 * not break a client that doesn't use it yet.
 */

/** `POST /auth/login` and `POST /auth/refresh`. */
export const accessTokenSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type AccessToken = z.infer<typeof accessTokenSchema>;

/** `GET /auth/me` and `POST /auth/register`. */
export const userProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  baseCurrency: z.string().length(3),
  timezone: z.string().min(1),
  createdAt: z.string().min(1),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** The password rule of ADR-0005, checked before sending: 8–128 code points after NFKC. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function passwordLength(password: string): number {
  return [...password.normalize('NFKC')].length;
}
