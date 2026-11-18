import { formatAmd } from '@costly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test/axe';
import { fakeApi, problem, renderApp } from '../../test/renderApp';
import { OLD_CARD, SAVINGS, wireAccount } from './test-accounts';

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

function apiWith(active: unknown[], archived: unknown[] = []) {
  const api = fakeApi({ signedIn: true });
  return fakeApi({
    signedIn: true,
    routes: {
      'GET /accounts?status=active': () => api.json(200, { items: active }),
      'GET /accounts?status=archived': () => api.json(200, { items: archived }),
    },
  });
}

const list = (name: string) => screen.findByRole('region', { name });

describe('accounts page', () => {
  it('lists active accounts with their current balance', async () => {
    await renderApp('/accounts', apiWith([wireAccount({ balance: '-150000' }), SAVINGS]));

    const rows = within(await list('Active accounts')).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Ameriabank card');
    expect(rows[0]!.textContent).toContain('Checking · Spendable');
    expect(rows[0]!.textContent).toContain('Current balance');
    expect(rows[0]!.textContent).toContain(formatAmd(-150000n));
    expect(rows[0]!.textContent).not.toContain(formatAmd(25000050n));
    expect(rows[1]!.textContent).toContain('Savings');
    expect(rows[1]!.textContent).not.toContain('Spendable');
    expect(rows[1]!.textContent).toContain(formatAmd(120000000n));
    expect(document.title).toBe('Accounts · Costly');
  });

  it('shows no total: net worth is analytics, a later chapter', async () => {
    await renderApp('/accounts', apiWith([wireAccount(), SAVINGS]));
    await list('Active accounts');

    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it('switches to archived accounts and keeps the choice in the address', async () => {
    const { history } = await renderApp('/accounts', apiWith([wireAccount()], [OLD_CARD]));
    await list('Active accounts');

    await userEvent.click(screen.getByRole('radio', { name: 'Archived' }));

    const rows = within(await list('Archived accounts')).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Old Visa');
    expect(rows[0]!.textContent).toContain(formatAmd(-4500000n));
    expect(history.location.search).toBe('?view=archived');
  });

  it('opens the archived view from its address', async () => {
    await renderApp('/accounts?view=archived', apiWith([], [OLD_CARD]));

    expect(within(await list('Archived accounts')).getByText('Old Visa')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Archived' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('explains an empty list', async () => {
    await renderApp('/accounts', apiWith([]));

    expect(await screen.findByRole('heading', { name: 'No accounts yet' })).toBeTruthy();
  });

  it('says when the accounts could not be loaded, and tries again', async () => {
    let fail = true;
    const base = fakeApi({ signedIn: true });
    const api = fakeApi({
      signedIn: true,
      routes: {
        'GET /accounts?status=active': () =>
          fail ? problem(404) : base.json(200, { items: [wireAccount()] }),
      },
    });
    await renderApp('/accounts', api);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('couldn’t be loaded');

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Ameriabank card')).toBeTruthy());
  });

  it('is reachable from the main navigation', async () => {
    await renderApp('/', apiWith([wireAccount()]));
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;

    await userEvent.click(within(nav).getByRole('link', { name: 'Accounts' }));

    expect(await list('Active accounts')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    await renderApp('/accounts', apiWith([wireAccount(), SAVINGS]));
    await list('Active accounts');

    // jsdom shows every layout's navigation at once; landmark-unique is checked in a browser.
    expect(await axeViolations(document.body, { page: true, skip: ['landmark-unique'] })).toEqual(
      [],
    );
  });
});
