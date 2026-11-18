import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '../../lib/dates';
import { axeViolations } from '../../test/axe';
import { fakeApi, problem, renderApp, TEST_USER } from '../../test/renderApp';
import {
  CARD,
  CATEGORIES,
  GROCERIES,
  OLD_HOBBY,
  SALARY,
  SAVINGS,
  wireTransaction,
} from './test-transactions';

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

type Wire = ReturnType<typeof wireTransaction>;

/**
 * A fake API that keeps transactions in memory, so a write shows up in the
 * next list, and records every write it receives.
 */
function ledgerApi(
  start: Wire[] = [],
  {
    accounts = [CARD, SAVINGS],
    writes = {},
  }: {
    accounts?: unknown[];
    writes?: Partial<Record<'POST' | 'PATCH' | 'DELETE', () => Response>>;
  } = {},
) {
  const items = [...start];
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const base = fakeApi({ signedIn: true });
  const routes: Record<string, (init: RequestInit) => Response> = {
    'GET /accounts?status=all': () => base.json(200, { items: accounts }),
    'GET /categories?status=all': () => base.json(200, { items: CATEGORIES }),
    'GET /transactions?limit=50': () => base.json(200, { items, nextCursor: null }),
    'POST /transactions': (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push({ method: 'POST', path: '/transactions', body });
      if (writes.POST) return writes.POST();
      const created = wireTransaction({ description: null, ...body });
      items.unshift(created);
      return base.json(201, created);
    },
  };
  for (const item of start) {
    routes[`PATCH /transactions/${item.id}`] = (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push({ method: 'PATCH', path: `/transactions/${item.id}`, body });
      if (writes.PATCH) return writes.PATCH();
      Object.assign(item, body);
      return base.json(200, item);
    };
    routes[`DELETE /transactions/${item.id}`] = () => {
      sent.push({ method: 'DELETE', path: `/transactions/${item.id}` });
      if (writes.DELETE) return writes.DELETE();
      items.splice(items.indexOf(item), 1);
      return new Response(null, { status: 204 });
    };
  }
  const api = fakeApi({ signedIn: true, routes });
  return { ...api, sent };
}

const today = () => todayIn(TEST_USER.timezone);
const results = () => screen.findByRole('region', { name: 'Transactions' });

async function openNew(type: 'Income' | 'Expense') {
  await results();
  const button = screen.getByRole('button', { name: type });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  await userEvent.click(button);
  return screen.getByRole('dialog', { name: type === 'Income' ? 'New income' : 'New expense' });
}

describe('recording a transaction', () => {
  it('sends an expense in exact minor units, then lists it and refreshes balances', async () => {
    const api = ledgerApi();
    await renderApp('/transactions', api);
    const dialog = await openNew('Expense');

    await userEvent.type(within(dialog).getByLabelText('Amount'), '4,500.50');
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), GROCERIES.id);
    await userEvent.type(within(dialog).getByLabelText('Description'), '  Corner shop ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add expense' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent).toEqual([
      {
        method: 'POST',
        path: '/transactions',
        body: {
          type: 'expense',
          accountId: CARD.id,
          categoryId: GROCERIES.id,
          amount: '450050',
          occurredOn: today(),
          description: 'Corner shop',
        },
      },
    ]);
    expect(await screen.findByText('Expense added')).toBeTruthy();
    await waitFor(async () =>
      expect(within(await results()).getAllByRole('listitem')).toHaveLength(1),
    );
    // The balances come from the API again, never from arithmetic in the browser.
    expect(api.calls.filter((call) => call === 'GET /accounts?status=all').length).toBe(2);
  });

  it('offers only income categories for income, and leaves out archived ones', async () => {
    await renderApp('/transactions', ledgerApi());
    const dialog = await openNew('Income');

    const options = [...within(dialog).getByLabelText<HTMLSelectElement>('Category').options];

    expect(options.map((option) => option.text)).toEqual(['Choose a category', SALARY.name]);
  });

  it('clears a category of the other kind when the type changes', async () => {
    await renderApp('/transactions', ledgerApi());
    const dialog = await openNew('Expense');
    const category = within(dialog).getByLabelText<HTMLSelectElement>('Category');
    await userEvent.selectOptions(category, GROCERIES.id);

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Income' }));

    await waitFor(() => expect(category.value).toBe(''));
    expect([...category.options].map((option) => option.text)).toContain(SALARY.name);
  });

  it('preselects the account being filtered', async () => {
    const api = ledgerApi();
    const base = fakeApi({ signedIn: true });
    await renderApp(`/transactions?accountId=${SAVINGS.id}`, {
      ...api,
      fetch: vi.fn<typeof fetch>(async (input, init) =>
        String(input).endsWith(`/transactions?accountId=${SAVINGS.id}&limit=50`)
          ? base.json(200, { items: [], nextCursor: null })
          : api.fetch(input, init),
      ),
    });
    const dialog = await openNew('Expense');

    expect(within(dialog).getByLabelText<HTMLSelectElement>('Account').value).toBe(SAVINGS.id);
  });

  it.each([
    ['zero', '0', 'Enter an amount above zero.'],
    ['negative', '-4500', 'Enter the amount without a sign'],
    ['three decimals', '12.345', 'Use at most two decimals.'],
    ['empty', '', 'Enter the amount.'],
  ])('explains a %s amount without sending anything', async (_label, amount, message) => {
    const api = ledgerApi();
    await renderApp('/transactions', api);
    const dialog = await openNew('Expense');

    if (amount) await userEvent.type(within(dialog).getByLabelText('Amount'), amount);
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), GROCERIES.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add expense' }));

    expect(await within(dialog).findByText(new RegExp(message))).toBeTruthy();
    expect(api.sent).toEqual([]);
  });

  it('asks for a category, and for a date on or after the account was opened', async () => {
    const api = ledgerApi();
    await renderApp('/transactions', api);
    const dialog = await openNew('Expense');

    await userEvent.type(within(dialog).getByLabelText('Amount'), '100');
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-10-31');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add expense' }));

    expect(await within(dialog).findByText('Choose a category.')).toBeTruthy();
    expect(within(dialog).getByText(/opened on 1 Nov 2026/)).toBeTruthy();
    expect(api.sent).toEqual([]);
  });

  it('shows the API’s reason when the account was archived meanwhile', async () => {
    const api = ledgerApi([], {
      writes: {
        POST: () =>
          problem(409, {
            detail: 'The account is archived. Restore it before changing its transactions.',
          }),
      },
    });
    await renderApp('/transactions', api);
    const dialog = await openNew('Expense');

    await userEvent.type(within(dialog).getByLabelText('Amount'), '100');
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), GROCERIES.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add expense' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The account is archived.',
    );
  });

  it('can’t start without an active account', async () => {
    await renderApp(
      '/transactions',
      ledgerApi([], { accounts: [{ ...CARD, archivedAt: '2026-11-10T08:00:00.000Z' }] }),
    );
    await results();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expense' }).hasAttribute('disabled')).toBe(true),
    );
  });

  it('has no accessibility violations', async () => {
    await renderApp('/transactions', ledgerApi());
    const dialog = await openNew('Expense');

    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('editing a transaction', () => {
  const editButton = async () =>
    within(await results()).findByRole('button', { name: /^Edit Food › Groceries/ });

  it('starts from the saved values and sends only what changed', async () => {
    const shop = wireTransaction({ amount: '1850000', description: 'Weekly shop' });
    const api = ledgerApi([shop]);
    await renderApp('/transactions', api);
    await userEvent.click(await editButton());
    const dialog = screen.getByRole('dialog', { name: 'Edit transaction' });
    const amount = within(dialog).getByLabelText<HTMLInputElement>('Amount');
    expect(amount.value).toBe('18,500');

    await userEvent.clear(amount);
    await userEvent.type(amount, '19000');
    await userEvent.clear(within(dialog).getByLabelText('Description'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent).toEqual([
      {
        method: 'PATCH',
        path: `/transactions/${shop.id}`,
        body: { amount: '1900000', description: null },
      },
    ]);
    expect(await screen.findByText('Changes saved')).toBeTruthy();
  });

  it('keeps an archived category the transaction already has selectable', async () => {
    const old = wireTransaction({ categoryId: OLD_HOBBY.id });
    await renderApp('/transactions', ledgerApi([old]));

    await userEvent.click(
      await within(await results()).findByRole('button', { name: /^Edit Old hobby/ }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit transaction' });

    const category = within(dialog).getByLabelText<HTMLSelectElement>('Category');
    expect(category.value).toBe(OLD_HOBBY.id);
    expect(category.selectedOptions[0]!.text).toBe('Old hobby (archived)');
  });

  it('offers no changes to transactions of an archived account', async () => {
    const archived = { ...SAVINGS, archivedAt: '2026-11-10T08:00:00.000Z' };
    const old = wireTransaction({ accountId: SAVINGS.id });
    await renderApp('/transactions', ledgerApi([old], { accounts: [CARD, archived] }));

    const row = (await within(await results()).findAllByRole('listitem'))[0]!;
    await waitFor(() => expect(row.textContent).toContain('Rainy day'));

    expect(within(row).queryByRole('button')).toBeNull();
  });
});

describe('deleting a transaction', () => {
  it('asks first, then deletes and refreshes the list', async () => {
    const shop = wireTransaction();
    const api = ledgerApi([shop]);
    await renderApp('/transactions', api);

    await userEvent.click(
      await within(await results()).findByRole('button', { name: /^Delete Food › Groceries/ }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete this transaction?' });
    expect(dialog.textContent).toContain('12 Nov 2026');
    expect(api.sent).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent).toEqual([{ method: 'DELETE', path: `/transactions/${shop.id}` }]);
    expect(await screen.findByText('Transaction deleted')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'No transactions yet' })).toBeTruthy();
  });

  it('keeps the transaction when cancelled', async () => {
    const api = ledgerApi([wireTransaction()]);
    await renderApp('/transactions', api);

    await userEvent.click(
      await within(await results()).findByRole('button', { name: /^Delete Food › Groceries/ }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent).toEqual([]);
  });

  it('explains a refusal and stays open', async () => {
    const api = ledgerApi([wireTransaction()], {
      writes: {
        DELETE: () =>
          problem(409, {
            detail: 'The account is archived. Restore it before changing its transactions.',
          }),
      },
    });
    await renderApp('/transactions', api);

    await userEvent.click(
      await within(await results()).findByRole('button', { name: /^Delete Food › Groceries/ }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('archived');
  });
});
