import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('applies defaults when variables are missing', () => {
    expect(validateEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('lists every invalid variable in one error', () => {
    expect(() => validateEnv({ PORT: 'abc', LOG_LEVEL: 'loud' })).toThrowError(
      /PORT[\s\S]*LOG_LEVEL/,
    );
  });
});
