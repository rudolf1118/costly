import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe';
import { renderApp } from '../test/renderApp';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ status: 'ok', details: {} }))),
  );
  vi.stubGlobal('matchMedia', undefined);
});

const heading = () => screen.getByRole('heading', { level: 1 });

// jsdom applies no media queries, so every layout is in the document at once;
// in a browser only the one for the current width is displayed.
describe('navigation', () => {
  it('names every link in the sidebar, even where only icons are shown', async () => {
    await renderApp('/');
    const sidebar = screen.getByRole('complementary');
    const nav = within(sidebar).getByRole('navigation', { name: 'Main' });

    expect(within(nav).getByRole('link', { name: 'Overview' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('opens the menu drawer, navigates from it and closes it', async () => {
    await renderApp('/');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(menu).getByRole('link', { name: 'Settings' }));

    await waitFor(() => expect(heading().textContent).toBe('Settings'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('marks the current page in the menu drawer', async () => {
    await renderApp('/settings');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('dialog', { name: 'Menu' });

    expect(within(menu).getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('navigates from the bottom tab bar', async () => {
    await renderApp('/settings');
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    const tabs = navs[navs.length - 1]!;

    await userEvent.click(within(tabs).getByRole('link', { name: 'Overview' }));

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
  });

  it('goes to the overview from the logo in the top bar', async () => {
    await renderApp('/settings');

    await userEvent.click(screen.getByRole('link', { name: 'Costly, overview' }));

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
  });

  it('has no accessibility violations with the menu open', async () => {
    await renderApp('/');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(await axeViolations(screen.getByRole('dialog', { name: 'Menu' }))).toEqual([]);
  });
});
