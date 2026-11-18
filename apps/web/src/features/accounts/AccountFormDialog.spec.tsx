import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '../../lib/dates';
import { axeViolations } from '../../test/axe';
import { fakeApi, problem, renderApp, type Route, TEST_USER } from '../../test/renderApp';
import { OLD_CARD, wireAccount } from './test-accounts';

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

const json = fakeApi({ signedIn: true }).json;

/** An API whose account list changes with each write, like the real one. */
function accountsApi(routes: Record<string, Route> = {}) {
  const active: Record<string, unknown>[] = [wireAccount()];
  const sent: unknown[] = [];
  const api = fakeApi({
    signedIn: true,
    routes: {
      'GET /accounts?status=active': () => json(200, { items: active }),
      'GET /accounts?status=archived': () => json(200, { items: [OLD_CARD] }),
      'POST /accounts': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        sent.push(body);
        const created = wireAccount({ ...body, id: '0193a1b2-0000-7000-8000-0000000000aa' });
        active.push(created);
        return json(201, created);
      },
      [`PATCH /accounts/${wireAccount().id}`]: (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        sent.push(body);
        Object.assign(active[0]!, body);
        return json(200, active[0]);
      },
      ...routes,
    },
  });
  return { ...api, sent };
}

async function openNewAccount() {
  await screen.findByRole('region', { name: 'Active accounts' });
  await userEvent.click(screen.getAllByRole('button', { name: 'New account' })[0]!);
  return screen.getByRole('dialog', { name: 'New account' });
}

describe('adding an account', () => {
  it('sends exact minor units and the chosen date, then lists the account', async () => {
    const api = accountsApi();
    await renderApp('/accounts', api);
    const dialog = await openNewAccount();

    await userEvent.type(within(dialog).getByLabelText('Name'), '  Rainy day ');
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'savings');
    await userEvent.type(within(dialog).getByLabelText('Opening balance'), '1,500,000.50');
    await userEvent.clear(within(dialog).getByLabelText('Opening date'));
    await userEvent.type(within(dialog).getByLabelText('Opening date'), '2026-01-15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent).toEqual([
      {
        name: 'Rainy day',
        type: 'savings',
        isLiquid: false,
        openingBalance: '150000050',
        openingDate: '2026-01-15',
      },
    ]);
    const list = screen.getByRole('region', { name: 'Active accounts' });
    await waitFor(() => expect(within(list).getByText('Rainy day')).toBeTruthy());
    expect(await screen.findByText('Account added')).toBeTruthy();
  });

  it('starts on today in the user’s time zone and refuses a later day', async () => {
    await renderApp('/accounts', accountsApi());
    const dialog = await openNewAccount();
    const date = within(dialog).getByLabelText<HTMLInputElement>('Opening date');

    expect(date.value).toBe(todayIn(TEST_USER.timezone));
    expect(date.max).toBe(todayIn(TEST_USER.timezone));
  });

  it('presets “spendable” from the type until the user sets it', async () => {
    await renderApp('/accounts', accountsApi());
    const dialog = await openNewAccount();
    const type = within(dialog).getByLabelText('Type');
    const spendable = within(dialog).getByLabelText<HTMLInputElement>('Spendable money');

    expect(spendable.checked).toBe(true);
    await userEvent.selectOptions(type, 'savings');
    expect(spendable.checked).toBe(false);
    await userEvent.selectOptions(type, 'cash');
    expect(spendable.checked).toBe(true);

    await userEvent.click(spendable);
    await userEvent.selectOptions(type, 'checking');
    expect(spendable.checked).toBe(false);
  });

  it('explains what is wrong before sending anything', async () => {
    const api = accountsApi();
    await renderApp('/accounts', api);
    const dialog = await openNewAccount();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(within(dialog).getByText('Enter a name for the account.')).toBeTruthy();
    expect(within(dialog).getByText(/Enter the opening balance/)).toBeTruthy();

    await userEvent.type(within(dialog).getByLabelText('Opening balance'), '12.345');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(within(dialog).getByText('Use at most two decimals.')).toBeTruthy();
    expect(api.sent).toEqual([]);
  });

  it('accepts a negative opening balance for debt', async () => {
    const api = accountsApi();
    await renderApp('/accounts', api);
    const dialog = await openNewAccount();

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Visa');
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'credit_card');
    await userEvent.type(within(dialog).getByLabelText('Opening balance'), '-45000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    await waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]).toMatchObject({ openingBalance: '-4500000', isLiquid: true });
  });

  it('puts a taken name on the name field', async () => {
    await renderApp(
      '/accounts',
      accountsApi({
        'POST /accounts': () =>
          problem(409, { detail: 'An active account with this name already exists.' }),
      }),
    );
    const dialog = await openNewAccount();

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Ameriabank card');
    await userEvent.type(within(dialog).getByLabelText('Opening balance'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    const name = within(dialog).getByLabelText('Name');
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('You already have an account with this name.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    await renderApp('/accounts', accountsApi());
    const dialog = await openNewAccount();

    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('editing an account', () => {
  async function openEdit() {
    await screen.findByRole('region', { name: 'Active accounts' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ameriabank card' }));
    return screen.getByRole('dialog', { name: 'Edit account' });
  }

  it('sends only what changed', async () => {
    const api = accountsApi();
    await renderApp('/accounts', api);
    const dialog = await openEdit();

    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ameria salary card');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent).toEqual([{ name: 'Ameria salary card' }]);
    expect(await screen.findByText('Ameria salary card')).toBeTruthy();
  });

  it('shows the opening balance without letting it change', async () => {
    await renderApp('/accounts', accountsApi());
    const dialog = await openEdit();

    expect(within(dialog).queryByLabelText('Opening balance')).toBeNull();
    expect(within(dialog).queryByLabelText('Opening date')).toBeNull();
    expect(within(dialog).getByText('Opening balance, 1 Nov 2026')).toBeTruthy();
    expect(within(dialog).getByText(/can’t be changed/)).toBeTruthy();
  });

  it('keeps “spendable” as it is when the type changes', async () => {
    const api = accountsApi();
    await renderApp('/accounts', api);
    const dialog = await openEdit();

    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'savings');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Spendable money').checked).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.sent).toEqual([{ type: 'savings' }]));
  });

  it('shows the API’s explanation when the account was archived meanwhile', async () => {
    await renderApp(
      '/accounts',
      accountsApi({
        [`PATCH /accounts/${wireAccount().id}`]: () =>
          problem(409, { detail: 'The account is archived. Restore it before changing it.' }),
      }),
    );
    const dialog = await openEdit();

    await userEvent.type(within(dialog).getByLabelText('Name'), ' 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The account is archived. Restore it before changing it.',
    );
  });

  it('is not offered for archived accounts', async () => {
    await renderApp('/accounts?view=archived', accountsApi());
    await screen.findByRole('region', { name: 'Archived accounts' });

    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  });
});
