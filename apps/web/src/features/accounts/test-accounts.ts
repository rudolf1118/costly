/** Accounts as the API sends them, for tests. */
export function wireAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: '0193a1b2-0000-7000-8000-000000000001',
    name: 'Ameriabank card',
    type: 'checking',
    currency: 'AMD',
    isLiquid: true,
    openingBalance: '25000050',
    openingDate: '2026-11-01',
    archivedAt: null,
    createdAt: '2026-11-17T09:00:00.000Z',
    updatedAt: '2026-11-17T09:00:00.000Z',
    ...overrides,
  };
}

export const SAVINGS = wireAccount({
  id: '0193a1b2-0000-7000-8000-000000000002',
  name: 'Rainy day',
  type: 'savings',
  isLiquid: false,
  openingBalance: '120000000',
  openingDate: '2026-01-15',
});

export const OLD_CARD = wireAccount({
  id: '0193a1b2-0000-7000-8000-000000000003',
  name: 'Old Visa',
  type: 'credit_card',
  openingBalance: '-4500000',
  archivedAt: '2026-11-10T08:00:00.000Z',
});
