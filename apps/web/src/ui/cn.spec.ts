import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a text size and a text colour together', () => {
    expect(cn('text-body', 'text-text-secondary')).toBe('text-body text-text-secondary');
    expect(cn('text-label text-negative')).toBe('text-label text-negative');
  });

  it('lets a later class of the same kind win', () => {
    expect(cn('text-body', 'text-label')).toBe('text-label');
    expect(cn('bg-surface', 'bg-subtle')).toBe('bg-subtle');
    expect(cn('rounded-sm', 'rounded-lg')).toBe('rounded-lg');
    expect(cn('shadow-e1', 'shadow-e2')).toBe('shadow-e2');
    expect(cn('text-text', 'text-accent-text')).toBe('text-accent-text');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, '', 'b')).toBe('a b');
  });
});
