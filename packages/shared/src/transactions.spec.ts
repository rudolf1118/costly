import { describe, expect, it } from 'vitest';
import {
  signedAmount,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPES,
  transactionPageSchema,
  transactionSchema,
  transactionsPath,
} from './transactions';

const wire = {
  id: '01a1f083-ce6a-736d-9190-90f0dc9eab54',
  type: 'expense',
  accountId: '01a1f083-ce4f-7115-a5b7-7c61abcb67c0',
  categoryId: '00000000-0000-7000-8000-00000000000b',
  amount: '450050',
  currency: 'AMD',
  occurredOn: '2026-11-18',
  description: 'Weekly shop',
  createdAt: '2026-11-18T21:15:32.330Z',
  updatedAt: '2026-11-18T21:15:32.330Z',
};

describe('transactionSchema', () => {
  it('reads the amount as exact minor units', () => {
    expect(transactionSchema.parse(wire).amount).toBe(450_050n);
  });

  it.each([
    ['a number for the amount', { amount: 450050 }],
    ['a zero amount', { amount: '0' }],
    ['a negative amount', { amount: '-450050' }],
    ['an unknown type', { type: 'transfer_out' }],
    ['a timestamp for the date', { occurredOn: '2026-11-18T00:00:00Z' }],
  ])('rejects %s', (_case, change) => {
    expect(transactionSchema.safeParse({ ...wire, ...change }).success).toBe(false);
  });

  it('reads a page and its cursor', () => {
    const page = transactionPageSchema.parse({ items: [wire], nextCursor: 'abc' });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('abc');
    expect(transactionPageSchema.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
  });
});

describe('signedAmount', () => {
  it('is positive for income and negative for an expense', () => {
    expect(signedAmount({ type: 'income', amount: 100n })).toBe(100n);
    expect(signedAmount({ type: 'expense', amount: 100n })).toBe(-100n);
  });
});

describe('transactionsPath', () => {
  it('is the bare path without filters', () => {
    expect(transactionsPath({})).toBe('/transactions');
  });

  it('includes only the filters that are set, then the page', () => {
    expect(
      transactionsPath(
        { type: 'expense', accountId: 'a1', from: '2026-01-01', to: '', categoryId: undefined },
        { limit: 25, cursor: 'c u' },
      ),
    ).toBe('/transactions?accountId=a1&type=expense&from=2026-01-01&limit=25&cursor=c+u');
  });
});

describe('transaction types', () => {
  it('labels every type', () => {
    for (const type of TRANSACTION_TYPES) expect(TRANSACTION_TYPE_LABELS[type]).toBeTruthy();
  });
});
