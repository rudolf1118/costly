import { formatAmd } from '@costly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test/axe';
import { fakeApi, problem, renderApp, type Route } from '../../test/renderApp';
import { validateTransactionSearch } from './search';
import { CARD, CATEGORIES, OLD_HOBBY, SALARY, SAVINGS, wireTransaction } from './test-transactions';

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

/** The API with two accounts and the categories; `routes` add transaction pages. */
function apiWith(routes: Record<string, Route>, accounts: unknown[] = [CARD, SAVINGS]) {
  const api = fakeApi({ signedIn: true });
  return fakeApi({
    signedIn: true,
    routes: {
      'GET /accounts?status=all': () => api.json(200, { items: accounts }),
      'GET /categories?status=all': () => api.json(200, { items: CATEGORIES }),
      ...routes,
    },
  });
}

const page = (items: unknown[], nextCursor: string | null = null) => {
  const api = fakeApi({ signedIn: true });
  return () => api.json(200, { items, nextCursor });
};

const results = () => screen.findByRole('region', { name: 'Transactions' });
const rows = async () => within(await results()).findAllByRole('listitem');

describe('transactions page', () => {
  it('lists transactions by day, each with its category, details and signed amount', async () => {
    const salary = wireTransaction({
      type: 'income',
      categoryId: SALARY.id,
      amount: '90000000',
      occurredOn: '2026-11-15',
      description: null,
    });
    const shop = wireTransaction();
    await renderApp(
      '/transactions',
      apiWith({ 'GET /transactions?limit=50': page([salary, shop]) }),
    );

    const items = await rows();

    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Salary');
    expect(items[0]!.textContent).toContain('Ameriabank card');
    expect(items[0]!.textContent).toContain(formatAmd(90000000n, { sign: 'always' }));
    expect(items[1]!.textContent).toContain('Food › Groceries');
    expect(items[1]!.textContent).toContain('Weekly shop · Ameriabank card');
    expect(items[1]!.textContent).toContain(formatAmd(-1850000n, { sign: 'always' }));
    expect(screen.getByRole('heading', { name: '15 Nov 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '12 Nov 2026' })).toBeTruthy();
    expect(document.title).toBe('Transactions · Costly');
  });

  it('loads the next page after the cursor, and stops at the last one', async () => {
    const first = wireTransaction({ occurredOn: '2026-11-12' });
    const second = wireTransaction({ occurredOn: '2026-11-01', description: 'Older' });
    const { api } = await renderApp(
      '/transactions',
      apiWith({
        'GET /transactions?limit=50': page([first], 'next-1'),
        'GET /transactions?limit=50&cursor=next-1': page([second]),
      }),
    );
    expect(await rows()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));

    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(api.calls).toContain('GET /transactions?limit=50&cursor=next-1');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('filters by type, keeping the filter in the address', async () => {
    const salary = wireTransaction({ type: 'income', categoryId: SALARY.id, amount: '1' });
    const { history, api } = await renderApp(
      '/transactions',
      apiWith({
        'GET /transactions?limit=50': page([wireTransaction()]),
        'GET /transactions?type=income&limit=50': page([salary]),
      }),
    );
    await rows();

    await userEvent.click(screen.getByRole('radio', { name: 'Income' }));

    await waitFor(() => expect(history.location.search).toBe('?type=income'));
    await waitFor(async () => expect((await rows())[0]!.textContent).toContain('Salary'));
    expect(api.calls).toContain('GET /transactions?type=income&limit=50');
    // Only income categories are offered with the income filter.
    const category = screen.getByLabelText<HTMLSelectElement>('Category');
    expect([...category.options].map((option) => option.text)).toEqual([
      'All categories',
      'Salary',
    ]);
  });

  it('reads the filters from the address and sends them to the API', async () => {
    const { api } = await renderApp(
      `/transactions?accountId=${SAVINGS.id}&from=2026-11-01&to=2026-11-30`,
      apiWith({
        [`GET /transactions?accountId=${SAVINGS.id}&from=2026-11-01&to=2026-11-30&limit=50`]: page([
          wireTransaction({ accountId: SAVINGS.id }),
        ]),
      }),
    );

    await rows();

    expect(api.calls).toContain(
      `GET /transactions?accountId=${SAVINGS.id}&from=2026-11-01&to=2026-11-30&limit=50`,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Account').value).toBe(SAVINGS.id);
    expect(screen.getByLabelText<HTMLInputElement>('From').value).toBe('2026-11-01');
  });

  it('labels archived accounts and categories in the filters', async () => {
    await renderApp(
      '/transactions',
      apiWith({ 'GET /transactions?limit=50': page([]) }, [
        CARD,
        { ...SAVINGS, archivedAt: '2026-11-10T08:00:00.000Z' },
      ]),
    );
    await results();

    const account = screen.getByLabelText<HTMLSelectElement>('Account');
    await waitFor(() =>
      expect([...account.options].map((option) => option.text)).toContain('Rainy day (archived)'),
    );
    const category = screen.getByLabelText<HTMLSelectElement>('Category');
    expect([...category.options].map((option) => option.text)).toContain(
      `${OLD_HOBBY.name} (archived)`,
    );
  });

  it('asks for a sensible date range instead of sending one the API refuses', async () => {
    const { api } = await renderApp('/transactions?from=2026-11-30&to=2026-11-01', apiWith({}));

    expect(await screen.findByText(/Choose a “From” date on or before/)).toBeTruthy();
    expect(api.calls.some((call) => call.startsWith('GET /transactions'))).toBe(false);
  });

  it('says when nothing matches the filters, and clears them', async () => {
    const { history } = await renderApp(
      '/transactions?type=income',
      apiWith({
        'GET /transactions?type=income&limit=50': page([]),
        'GET /transactions?limit=50': page([wireTransaction()]),
      }),
    );

    const empty = await screen.findByRole('heading', {
      name: 'No transactions match these filters',
    });
    expect(empty).toBeTruthy();
    await userEvent.click(within(await results()).getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(history.location.search).toBe(''));
    expect(await rows()).toHaveLength(1);
  });

  it('explains an empty list', async () => {
    await renderApp('/transactions', apiWith({ 'GET /transactions?limit=50': page([]) }));
    expect(await screen.findByRole('heading', { name: 'No transactions yet' })).toBeTruthy();
  });

  it('asks for an account first when the user has none', async () => {
    await renderApp('/transactions', apiWith({ 'GET /transactions?limit=50': page([]) }, []));

    expect(await screen.findByRole('heading', { name: 'Add an account first' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to accounts' })).toBeTruthy();
  });

  it('offers to try again when the list fails to load', async () => {
    let fail = true;
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/transactions',
      apiWith({
        // A 404 isn't retried automatically, so the failure shows at once.
        'GET /transactions?limit=50': () =>
          fail ? problem(404) : api.json(200, { items: [wireTransaction()], nextCursor: null }),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('couldn’t be loaded');

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await rows()).toHaveLength(1);
  });

  it('is in the main navigation', async () => {
    await renderApp('/transactions', apiWith({ 'GET /transactions?limit=50': page([]) }));

    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    expect(
      within(nav).getByRole('link', { name: 'Transactions' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('has no accessibility violations', async () => {
    await renderApp(
      '/transactions',
      apiWith({ 'GET /transactions?limit=50': page([wireTransaction()]) }),
    );
    await rows();

    // jsdom shows every layout's navigation at once; landmark-unique is checked in a browser.
    expect(await axeViolations(document.body, { page: true, skip: ['landmark-unique'] })).toEqual(
      [],
    );
  });
});

describe('validateTransactionSearch', () => {
  it('keeps well-formed filters and drops everything else', () => {
    expect(
      validateTransactionSearch({
        accountId: CARD.id,
        categoryId: 'not-a-uuid',
        type: 'transfer',
        from: '2026-11-01',
        to: '30.11.2026',
        extra: 'x',
      }),
    ).toEqual({ accountId: CARD.id, from: '2026-11-01' });
  });
});
