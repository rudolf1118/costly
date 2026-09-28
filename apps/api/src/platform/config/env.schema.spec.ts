import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const required = {
  DATABASE_URL: 'postgresql://costly:costly@localhost:5432/costly',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv(required)).toEqual({
      NODE_ENV: 'development',
      PORT: 3100,
      LOG_LEVEL: 'info',
      ...required,
    });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('requires connection URLs', () => {
    expect(() => validateEnv({})).toThrowError(/DATABASE_URL[\s\S]*REDIS_URL/);
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
