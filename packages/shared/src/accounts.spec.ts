import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  accountListSchema,
  accountSchema,
  checkDisplayName,
  DEFAULT_LIQUIDITY,
} from './accounts';

const wire = {
  id: '0193a1b2-0000-7000-8000-000000000001',
  name: 'Ameriabank card',
  type: 'checking',
  currency: 'AMD',
  isLiquid: true,
  openingBalance: '-1250050',
  openingDate: '2026-11-01',
  archivedAt: null,
  createdAt: '2026-11-17T09:00:00.000Z',
  updatedAt: '2026-11-17T09:00:00.000Z',
};

describe('accountSchema', () => {
  it('reads the opening balance as exact minor units', () => {
    expect(accountSchema.parse(wire).openingBalance).toBe(-1250050n);
  });

  it('keeps fields it does not know about out of the way', () => {
    expect(accountSchema.parse({ ...wire, balance: 'later' })).not.toHaveProperty('balance');
  });

  it.each([
    ['a number for the opening balance', { openingBalance: 1250050 }],
    ['a decimal opening balance', { openingBalance: '12500.50' }],
    ['an unknown type', { type: 'loan' }],
    ['a timestamp for the opening date', { openingDate: '2026-11-01T00:00:00Z' }],
  ])('rejects %s', (_case, change) => {
    expect(accountSchema.safeParse({ ...wire, ...change }).success).toBe(false);
  });

  it('reads a list', () => {
    expect(accountListSchema.parse({ items: [wire] }).items).toHaveLength(1);
  });
});

describe('account types', () => {
  it('labels and defaults every type the API knows', () => {
    for (const type of ACCOUNT_TYPES) {
      expect(ACCOUNT_TYPE_LABELS[type]).toBeTruthy();
      expect(typeof DEFAULT_LIQUIDITY[type]).toBe('boolean');
    }
    expect(DEFAULT_LIQUIDITY.savings).toBe(false);
  });
});

describe('checkDisplayName', () => {
  it('normalizes and trims', () => {
    expect(checkDisplayName('  Café  ')).toEqual({ ok: true, name: 'Café' });
  });

  it('counts code points, so 64 emoji fit', () => {
    expect(checkDisplayName('💳'.repeat(64)).ok).toBe(true);
    expect(checkDisplayName('💳'.repeat(65))).toEqual({ ok: false, error: 'length' });
  });

  it.each([
    ['   ', 'empty'],
    ['Tab\there', 'characters'],
    ['Lone \ud800', 'characters'],
  ])('refuses %j', (input, error) => {
    expect(checkDisplayName(input)).toEqual({ ok: false, error });
  });
});
