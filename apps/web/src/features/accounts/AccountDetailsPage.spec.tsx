import { formatAmd } from '@costly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test/axe';
import { fakeApi, problem, renderApp, type Route } from '../../test/renderApp';
import { OLD_CARD, wireAccount } from './test-accounts';

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

const json = fakeApi({ signedIn: true }).json;
const CARD = wireAccount();
const heading = () => screen.getByRole('heading', { level: 1 });

/** One account that archive and restore change, as the API would. */
function accountApi(start: Record<string, unknown>, routes: Record<string, Route> = {}) {
  const account = { ...start };
  const id = String(account.id);
  const api = fakeApi({
    signedIn: true,
    routes: {
      [`GET /accounts/${id}`]: () => json(200, account),
      'GET /accounts?status=active': () =>
        json(200, { items: account.archivedAt ? [] : [account] }),
      'GET /accounts?status=archived': () =>
        json(200, { items: account.archivedAt ? [account] : [] }),
      [`POST /accounts/${id}/archive`]: () => {
        account.archivedAt = '2026-11-17T10:00:00.000Z';
        return json(200, account);
      },
      [`POST /accounts/${id}/restore`]: () => {
        account.archivedAt = null;
        return json(200, account);
      },
      ...routes,
    },
  });
  return api;
}

describe('account details', () => {
  it('shows the account with its current and opening balances, each labelled', async () => {
    await renderApp(`/accounts/${CARD.id}`, accountApi({ ...CARD, balance: '31000000' }));

    await waitFor(() => expect(heading().textContent).toBe('Ameriabank card'));
    expect(screen.getByText('Current balance')).toBeTruthy();
    expect(screen.getByRole('main').textContent).toContain(formatAmd(31000000n));
    expect(screen.getByText('Opening balance, 1 Nov 2026')).toBeTruthy();
    expect(screen.getByRole('main').textContent).toContain(formatAmd(25000050n));
    expect(screen.getByText('Checking')).toBeTruthy();
    expect(document.title).toBe('Account · Costly');
  });

  it('opens from the list', async () => {
    await renderApp('/accounts', accountApi(CARD));

    await userEvent.click(await screen.findByRole('link', { name: 'Ameriabank card' }));

    await waitFor(() => expect(heading().textContent).toBe('Ameriabank card'));
  });

  it('archives after confirmation, then offers only Restore', async () => {
    const api = accountApi(CARD);
    await renderApp(`/accounts/${CARD.id}`, api);
    await waitFor(() => expect(heading().textContent).toBe('Ameriabank card'));

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive “Ameriabank card”?' });
    expect(api.calls).not.toContain(`POST /accounts/${CARD.id}/archive`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive account' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/Archived on 17 Nov 2026/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(await screen.findByText('Account archived')).toBeTruthy();
  });

  it('cancelling the confirmation archives nothing', async () => {
    const api = accountApi(CARD);
    await renderApp(`/accounts/${CARD.id}`, api);
    await waitFor(() => expect(heading().textContent).toBe('Ameriabank card'));

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls).not.toContain(`POST /accounts/${CARD.id}/archive`);
  });

  it('restores an archived account', async () => {
    await renderApp(`/accounts/${OLD_CARD.id}`, accountApi(OLD_CARD));
    await waitFor(() => expect(heading().textContent).toBe('Old Visa'));
    expect(screen.getByText(/can’t be changed/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByText(/Archived on/)).toBeNull();
  });

  it('explains a restore refused because the name is in use', async () => {
    await renderApp(
      `/accounts/${OLD_CARD.id}`,
      accountApi(OLD_CARD, {
        [`POST /accounts/${OLD_CARD.id}/restore`]: () =>
          problem(409, { detail: 'An active account with this name already exists.' }),
      }),
    );
    await waitFor(() => expect(heading().textContent).toBe('Old Visa'));

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'You already have an active account called “Old Visa”',
    );
  });

  it('edits from the details page', async () => {
    const api = accountApi(CARD, {
      [`PATCH /accounts/${CARD.id}`]: () => json(200, { ...CARD, name: 'Salary card' }),
    });
    await renderApp(`/accounts/${CARD.id}`, api);
    await waitFor(() => expect(heading().textContent).toBe('Ameriabank card'));

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const name = within(screen.getByRole('dialog')).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Salary card');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(heading().textContent).toBe('Salary card'));
  });

  it.each([
    ['a missing account', '0193a1b2-0000-7000-8000-0000000000ff', 404],
    ['a malformed id', 'not-an-id', 400],
  ])('says so for %s', async (_case, id, status) => {
    await renderApp(
      `/accounts/${id}`,
      fakeApi({ signedIn: true, routes: { [`GET /accounts/${id}`]: () => problem(status) } }),
    );

    await waitFor(() => expect(heading().textContent).toBe('Account not found'));
    expect(screen.getByRole('link', { name: 'Go to your accounts' })).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    await renderApp(`/accounts/${OLD_CARD.id}`, accountApi(OLD_CARD));
    await waitFor(() => expect(heading().textContent).toBe('Old Visa'));

    // jsdom shows every layout's navigation at once; landmark-unique is checked in a browser.
    expect(await axeViolations(document.body, { page: true, skip: ['landmark-unique'] })).toEqual(
      [],
    );
  });
});
