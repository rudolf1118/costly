import { z } from 'zod';

/**
 * The placeholder in .env.example. It is long enough to start a development
 * server, but it's public, so production refuses it.
 */
export const EXAMPLE_JWT_ACCESS_SECRET = 'development-only-secret-replace-for-any-real-deployment';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Origin of the web client. It is served separately, so it needs CORS. */
    CORS_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
    /** HS256 key for access tokens (ADR-0006). Generate with: openssl rand -base64 48 */
    JWT_ACCESS_SECRET: z.string().min(32, 'Must be at least 32 characters'),
    /**
     * How many reverse proxies in front of the API may set X-Forwarded-For.
     * 0 (default) ignores the header and uses the socket address (ADR-0006).
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    /** Authentication rate limits. "off" exists for test suites and is refused in production. */
    AUTH_RATE_LIMIT: z.enum(['on', 'off']).default('on'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === EXAMPLE_JWT_ACCESS_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'The example secret from .env.example cannot be used in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.AUTH_RATE_LIMIT === 'off') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_RATE_LIMIT'],
        message: 'Rate limiting cannot be turned off in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process environment at startup. Fails fast with every problem
 * listed, instead of crashing later on the first missing value.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
