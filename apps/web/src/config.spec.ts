import { describe, expect, it } from 'vitest';
import { readApiBaseUrl } from './config';

describe('readApiBaseUrl', () => {
  it('returns the configured URL', () => {
    expect(readApiBaseUrl({ VITE_API_URL: 'http://localhost:3100' })).toBe('http://localhost:3100');
  });

  it('drops trailing slashes so request paths do not double up', () => {
    expect(readApiBaseUrl({ VITE_API_URL: 'http://localhost:3100/' })).toBe(
      'http://localhost:3100',
    );
  });

  it('throws when the variable is missing or blank', () => {
    expect(() => readApiBaseUrl({})).toThrow(/VITE_API_URL/);
    expect(() => readApiBaseUrl({ VITE_API_URL: '  ' })).toThrow(/VITE_API_URL/);
  });
});
