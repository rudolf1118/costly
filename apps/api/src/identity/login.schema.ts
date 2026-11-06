import { z } from 'zod';

/**
 * Login only checks the shape. The password policy applies when a password is
 * chosen (registration), not when it is checked: a mismatch is a 401, never a
 * 400 that would hint at the rules. The bounds only cap the work per request.
 */
export const loginSchema = z.strictObject({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export type LoginInput = z.output<typeof loginSchema>;
