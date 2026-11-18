import { shiftMonth } from './month';

/** A wire-format GET /dashboard/summary body; amounts are strings as the API sends them. */
export function wireSummary(month: string, overrides: Record<string, unknown> = {}) {
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const daily = Array.from({ length: days }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, '0')}`,
    income: index === 4 ? '65000000' : '0',
    expense: index === 0 ? '22000000' : index === 9 ? '1850000' : index === 11 ? '650000' : '0',
  }));
  const history = Array.from({ length: 12 }, (_, index) => {
    const entry = shiftMonth(month, index - 11);
    return index === 11
      ? { month: entry, income: '65000000', expense: '24500000' }
      : index === 10
        ? { month: entry, income: '60000000', expense: '20000000' }
        : { month: entry, income: '0', expense: '0' };
  });
  return {
    month,
    currency: 'AMD',
    income: '65000000',
    expense: '24500000',
    net: '40500000',
    transactionCount: 4,
    previous: { income: '60000000', expense: '20000000', net: '40000000' },
    balance: { total: '190500000', previousMonthEnd: '150000000', accountCount: 2 },
    history,
    categories: [
      {
        categoryId: '00000000-0000-7000-8000-000000000007',
        name: 'Rent',
        parentName: 'Housing',
        amount: '22000000',
        transactionCount: 1,
      },
      {
        categoryId: '00000000-0000-7000-8000-00000000000b',
        name: 'Groceries',
        parentName: 'Food',
        amount: '1850000',
        transactionCount: 1,
      },
      {
        categoryId: '00000000-0000-7000-8000-000000000010',
        name: 'Taxi',
        parentName: 'Transport',
        amount: '650000',
        transactionCount: 1,
      },
    ],
    daily,
    recentTransactions: [
      {
        id: '01a1f083-ce6a-736d-9190-90f0dc9eab54',
        type: 'expense',
        amount: '650000',
        currency: 'AMD',
        occurredOn: `${month}-12`,
        description: 'Yandex Go',
        account: { id: '01a1f083-ce4f-7115-a5b7-7c61abcb67c0', name: 'Ameriabank card' },
        category: {
          id: '00000000-0000-7000-8000-000000000010',
          name: 'Taxi',
          parentName: 'Transport',
        },
      },
      {
        id: '01a1f083-ce6a-736d-9190-90f0dc9eab53',
        type: 'income',
        amount: '65000000',
        currency: 'AMD',
        occurredOn: `${month}-05`,
        description: null,
        account: { id: '01a1f083-ce4f-7115-a5b7-7c61abcb67c0', name: 'Ameriabank card' },
        category: { id: '00000000-0000-7000-8000-000000000001', name: 'Salary', parentName: null },
      },
    ],
    accounts: [
      {
        id: '01a1f083-ce4f-7115-a5b7-7c61abcb67c0',
        name: 'Ameriabank card',
        type: 'checking',
        currency: 'AMD',
        isLiquid: true,
        balance: '70500000',
      },
      {
        id: '01a1f083-ce4f-7115-a5b7-7c61abcb67c1',
        name: 'Savings',
        type: 'savings',
        currency: 'AMD',
        isLiquid: false,
        balance: '120000000',
      },
    ],
    ...overrides,
  };
}

/** A month with nothing in it, for a user with no transactions that month. */
export function emptySummary(month: string, overrides: Record<string, unknown> = {}) {
  const base = wireSummary(month);
  return {
    ...base,
    income: '0',
    expense: '0',
    net: '0',
    transactionCount: 0,
    previous: { income: '0', expense: '0', net: '0' },
    balance: { total: '0', previousMonthEnd: null, accountCount: 0 },
    history: base.history.map((entry) => ({ ...entry, income: '0', expense: '0' })),
    categories: [],
    daily: base.daily.map((day) => ({ ...day, income: '0', expense: '0' })),
    recentTransactions: [],
    accounts: [],
    ...overrides,
  };
}
