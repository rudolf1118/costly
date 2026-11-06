import { describe, expect, it } from 'vitest';
import { EXAMPLE_JWT_ACCESS_SECRET, validateEnv } from './env.schema';

const required = {
  DATABASE_URL: 'postgresql://costly:costly@localhost:5432/costly',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a-test-secret-that-is-long-enough-for-hs256',
};

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv(required)).toEqual({
      NODE_ENV: 'development',
      PORT: 3100,
      LOG_LEVEL: 'info',
      CORS_ORIGIN: 'http://localhost:5173',
      ...required,
    });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('requires connection URLs and the access token secret', () => {
    expect(() => validateEnv({})).toThrowError(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*JWT_ACCESS_SECRET/,
    );
  });

  it('rejects an access token secret shorter than 32 characters', () => {
    expect(() => validateEnv({ ...required, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET: Must be at least 32 characters/,
    );
  });

  it('accepts the example secret in development but refuses it in production', () => {
    const withExample = { ...required, JWT_ACCESS_SECRET: EXAMPLE_JWT_ACCESS_SECRET };

    expect(validateEnv(withExample).JWT_ACCESS_SECRET).toBe(EXAMPLE_JWT_ACCESS_SECRET);
    expect(() => validateEnv({ ...withExample, NODE_ENV: 'production' })).toThrow(
      /JWT_ACCESS_SECRET: The example secret/,
    );
  });

  it('rejects a CORS origin that is not an http(s) URL', () => {
    expect(() => validateEnv({ ...required, CORS_ORIGIN: 'localhost:5173' })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it('rejects a connection URL with the wrong protocol', () => {
    expect(() => validateEnv({ ...required, DATABASE_URL: 'mysql://localhost/costly' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('lists every invalid variable in one error', () => {
    expect(() => validateEnv({ ...required, PORT: 'abc', LOG_LEVEL: 'loud' })).toThrowError(
      /PORT[\s\S]*LOG_LEVEL/,
    );
  });
});
