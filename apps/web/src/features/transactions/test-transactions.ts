import { SAVINGS, wireAccount } from '../accounts/test-accounts';

/** Transactions, categories and their accounts as the API sends them, for tests. */

export const CARD = wireAccount();
export { SAVINGS };

export const SALARY = {
  id: '00000000-0000-7000-8000-000000000001',
  name: 'Salary',
  kind: 'income',
  nature: null,
  parentId: null,
  isSystem: true,
  archivedAt: null,
  createdAt: '2026-11-13T09:30:00.000Z',
  updatedAt: '2026-11-13T09:30:00.000Z',
};

export const FOOD = {
  ...SALARY,
  id: '00000000-0000-7000-8000-00000000000a',
  name: 'Food',
  kind: 'expense',
  nature: 'essential_variable',
};

export const GROCERIES = {
  ...FOOD,
  id: '00000000-0000-7000-8000-00000000000b',
  name: 'Groceries',
  parentId: FOOD.id,
};

export const OLD_HOBBY = {
  ...FOOD,
  id: '0193a1b2-0000-7000-8000-0000000000c1',
  name: 'Old hobby',
  nature: 'discretionary',
  isSystem: false,
  archivedAt: '2026-11-15T08:00:00.000Z',
};

export const CATEGORIES = [SALARY, FOOD, GROCERIES, OLD_HOBBY];

let sequence = 0;

export function wireTransaction(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    id: `0193a1b2-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    type: 'expense',
    accountId: CARD.id,
    categoryId: GROCERIES.id,
    amount: '1850000',
    currency: 'AMD',
    occurredOn: '2026-11-12',
    description: 'Weekly shop',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}
