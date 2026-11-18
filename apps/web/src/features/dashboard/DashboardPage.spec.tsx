import { formatAmd } from '@costly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test/axe';
import { fakeApi, problem, renderApp, TEST_USER } from '../../test/renderApp';
import { currentMonth, formatMonth, shiftMonth } from './month';
import { emptySummary, wireSummary } from './test-dashboard';

/** Charts measure their container; jsdom has no layout, so a no-op observer is enough. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

const THIS_MONTH = currentMonth(TEST_USER.timezone);
const LAST_MONTH = shiftMonth(THIS_MONTH, -1);
/** formatAmd keeps sign, number and ֏ together with no-break spaces; Testing Library reads them as spaces. */
const shown = (text: string) => text.replace(/\u00a0/g, ' ');
const path = (month: string) => `GET /dashboard/summary?month=${month}`;

function apiWith(routes: Record<string, () => Response>) {
  return fakeApi({ signedIn: true, routes });
}

const region = (name: string) => screen.findByRole('region', { name });
const monthShown = () =>
  within(screen.getByRole('group', { name: 'Month' })).getByText(/\d{4}$/).textContent;

describe('dashboard', () => {
  it('shows the month’s balance, income, expenses and net from the API', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)) }),
    );

    expect(await screen.findByRole('heading', { name: 'Total balance' })).toBeTruthy();
    const summary = screen.getByRole('heading', { name: 'Summary' }).parentElement!;
    expect(summary.textContent).toContain(formatAmd(190500000n));
    expect(summary.textContent).toContain(formatAmd(65000000n));
    expect(summary.textContent).toContain(formatAmd(24500000n));
    expect(summary.textContent).toContain(formatAmd(40500000n, { sign: 'always' }));
    // 650,000 after 600,000 is +8 %; 245,000 after 200,000 is +23 %.
    expect(summary.textContent).toContain('+8% vs');
    expect(summary.textContent).toContain('+23% vs');
    expect(summary.textContent).toContain(
      `${formatAmd(40500000n, { sign: 'always' })} since end of`,
    );
    expect(monthShown()).toBe(formatMonth(THIS_MONTH));
    expect(document.title).toBe('Overview · Costly');
  });

  it('lists the month’s recent transactions and the accounts with links', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)) }),
    );

    const recent = await region('Recent transactions');
    const rows = within(recent).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Transport › Taxi');
    expect(rows[0]!.textContent).toContain('Ameriabank card');
    expect(rows[0]!.textContent).toContain(`Expense ${formatAmd(-650000n, { sign: 'always' })}`);
    expect(rows[1]!.textContent).toContain(`Income ${formatAmd(65000000n, { sign: 'always' })}`);
    const viewAll = within(recent).getByRole('link', { name: /View all/ });
    expect(viewAll.getAttribute('href')).toBe(
      `/transactions?from=${THIS_MONTH}-01&to=${viewAll.getAttribute('href')!.slice(-10)}`,
    );
    expect(viewAll.getAttribute('href')).toContain(`to=${THIS_MONTH}-`);

    const accounts = await region('Accounts');
    const link = within(accounts).getByRole('link', { name: /Savings/ });
    expect(link.getAttribute('href')).toBe('/accounts/01a1f083-ce4f-7115-a5b7-7c61abcb67c1');
    expect(link.textContent).toContain(formatAmd(120000000n));
  });

  it('breaks the month’s spending down by category, each linking to its transactions', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)) }),
    );

    const breakdown = await region('Spending by category');
    const rows = within(within(breakdown).getByRole('list', { name: 'Categories' })).getAllByRole(
      'link',
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      `Housing › Rent${formatAmd(22000000n)}90%`,
      `Food › Groceries${formatAmd(1850000n)}8%`,
      `Transport › Taxi${formatAmd(650000n)}3%`,
    ]);
    const href = new URL(rows[0]!.getAttribute('href')!, 'http://app.test');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      categoryId: '00000000-0000-7000-8000-000000000007',
      type: 'expense',
      from: `${THIS_MONTH}-01`,
      to: expect.stringMatching(new RegExp(`^${THIS_MONTH}-(28|29|30|31)$`)),
    });
  });

  it('charts income and expenses and offers 6 or 12 months', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)) }),
    );

    const chart = await region('Income vs expenses');
    expect(within(chart).getAllByRole('row')).toHaveLength(1 + 6);
    await userEvent.click(within(chart).getByRole('radio', { name: '12 months' }));
    expect(within(chart).getAllByRole('row')).toHaveLength(1 + 12);
    expect(await region('Daily spending')).toBeTruthy();
  });

  it('shows empty chart panels for a month without transactions', async () => {
    const api = fakeApi({ signedIn: true });
    const accounts = wireSummary(LAST_MONTH).accounts;
    await renderApp(
      `/?month=${LAST_MONTH}`,
      apiWith({
        [path(LAST_MONTH)]: () => api.json(200, emptySummary(LAST_MONTH, { accounts })),
      }),
    );

    expect((await region('Spending by category')).textContent).toContain('No spending in');
    expect((await region('Daily spending')).textContent).toContain('No spending in');
    expect((await region('Income vs expenses')).textContent).toContain(
      'No income or expenses in these months yet.',
    );
  });

  it('shows deterministic insights for the month', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)) }),
    );

    const insights = await region('Monthly insights');
    expect(insights.textContent).toContain('Your spending so far is 23% higher than in');
    expect(insights.textContent).toContain('Rent is your largest spending category');
  });

  it('steps to the previous month, updating every number and the address', async () => {
    const api = fakeApi({ signedIn: true });
    const { history } = await renderApp(
      '/',
      apiWith({
        [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)),
        [path(LAST_MONTH)]: () =>
          api.json(
            200,
            wireSummary(LAST_MONTH, {
              income: '1000000',
              expense: '300000',
              net: '700000',
              balance: { total: '5550000', previousMonthEnd: null, accountCount: 1 },
            }),
          ),
      }),
    );
    await region('Recent transactions');
    expect(screen.queryByRole('button', { name: 'This month' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveProperty('disabled', true);

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));

    await waitFor(() => expect(history.location.search).toBe(`?month=${LAST_MONTH}`));
    expect(await screen.findByText(shown(formatAmd(5550000n)))).toBeTruthy();
    expect(monthShown()).toBe(formatMonth(LAST_MONTH));
    expect(screen.getByText(shown(formatAmd(1000000n)))).toBeTruthy();
    expect(screen.getByText(shown(formatAmd(700000n, { sign: 'always' })))).toBeTruthy();
    // A past month's balance is taken at its end, and with no account a month earlier there is no comparison.
    expect(screen.getByRole('heading', { name: /^Balance on / })).toBeTruthy();
    expect(screen.queryByText(/since end of/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(history.location.search).toBe(''));
    expect(await screen.findByText(shown(formatAmd(190500000n)))).toBeTruthy();
  });

  it('opens a past month from the address', async () => {
    const api = fakeApi({ signedIn: true });
    const fake = apiWith({ [path(LAST_MONTH)]: () => api.json(200, wireSummary(LAST_MONTH)) });
    await renderApp(`/?month=${LAST_MONTH}`, fake);

    await region('Recent transactions');
    expect(fake.calls).toContain(path(LAST_MONTH));
    expect(fake.calls).not.toContain(path(THIS_MONTH));
  });

  it('shows no percentage when the previous month had nothing', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({
        [path(THIS_MONTH)]: () =>
          api.json(
            200,
            wireSummary(THIS_MONTH, { previous: { income: '0', expense: '0', net: '0' } }),
          ),
      }),
    );

    const summary = (await screen.findByRole('heading', { name: 'Summary' })).parentElement!;
    expect(within(summary).getAllByText(/^Nothing in .* to compare$/)).toHaveLength(2);
    expect(summary.textContent).not.toMatch(/\d% vs/);
  });

  it('offers to create an account when there are none', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, emptySummary(THIS_MONTH)) }),
    );

    expect(await screen.findByRole('heading', { name: 'Start with an account' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe(
      '/accounts',
    );
    expect(screen.queryByRole('region', { name: 'Recent transactions' })).toBeNull();
  });

  it('shows the accounts and empty panels when the month has no transactions', async () => {
    const api = fakeApi({ signedIn: true });
    const accounts = wireSummary(THIS_MONTH).accounts;
    await renderApp(
      '/',
      apiWith({
        [path(THIS_MONTH)]: () =>
          api.json(
            200,
            emptySummary(THIS_MONTH, {
              accounts,
              balance: { total: '190500000', previousMonthEnd: '190500000', accountCount: 2 },
            }),
          ),
      }),
    );

    expect(within(await region('Accounts')).getAllByRole('listitem')).toHaveLength(2);
    expect((await region('Recent transactions')).textContent).toContain('No transactions in');
    expect((await region('Monthly insights')).textContent).toContain('Insights appear once');
    expect(screen.getByText(/No change since end of/)).toBeTruthy();
  });

  it('says when the overview can’t be loaded and retries', async () => {
    let attempts = 0;
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({
        [path(THIS_MONTH)]: () => {
          attempts += 1;
          return attempts <= 2 ? problem(500) : api.json(200, wireSummary(THIS_MONTH));
        },
      }),
    );

    // A 500 is retried once, after a second, before the error shows.
    expect(
      await screen.findByText('Your overview couldn’t be loaded.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await region('Recent transactions')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const api = fakeApi({ signedIn: true });
    await renderApp(
      '/',
      apiWith({ [path(THIS_MONTH)]: () => api.json(200, wireSummary(THIS_MONTH)) }),
    );
    await region('Recent transactions');

    // jsdom shows every layout's navigation at once; landmark-unique is checked in a browser.
    expect(await axeViolations(document.body, { page: true, skip: ['landmark-unique'] })).toEqual(
      [],
    );
  });
});
