import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe';
import { renderApp } from '../test/renderApp';

beforeEach(() => {
  // The settings page checks the API's health; keep it from reaching the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ status: 'ok', details: {} }))),
  );
  vi.stubGlobal('matchMedia', undefined);
});

const heading = () => screen.getByRole('heading', { level: 1 });

describe('routing', () => {
  it('opens the overview at /', async () => {
    await renderApp('/');

    expect(heading().textContent).toBe('Overview');
    expect(document.title).toBe('Overview · Costly');
  });

  it('opens a page from its address', async () => {
    await renderApp('/settings');

    expect(heading().textContent).toBe('Settings');
    expect(document.title).toBe('Settings · Costly');
  });

  it('shows a not-found page for an unknown address, with a way back', async () => {
    await renderApp('/no-such-page');

    expect(heading().textContent).toBe('Page not found');
    expect(document.title).toBe('Page not found · Costly');

    await userEvent.click(screen.getByRole('link', { name: 'Go to the overview' }));

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
  });

  it('navigates from the main navigation and marks the current page', async () => {
    const { history } = await renderApp('/');
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;

    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }));

    await waitFor(() => expect(heading().textContent).toBe('Settings'));
    expect(history.location.pathname).toBe('/settings');
    expect(within(nav).getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      null,
    );
  });

  it('moves focus to the page after navigating', async () => {
    await renderApp('/');
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;

    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }));

    await waitFor(() => expect(document.activeElement?.id).toBe('main'));
  });

  it('offers a skip link to the page content', async () => {
    await renderApp('/');

    const skip = screen.getByRole('link', { name: 'Skip to content' });

    expect(skip.getAttribute('href')).toBe('#main');
    expect(document.getElementById('main')?.tagName).toBe('MAIN');
  });

  it('changes the theme from settings', async () => {
    await renderApp('/settings');

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it.each(['/', '/settings', '/missing'])('has no accessibility violations at %s', async (path) => {
    const { container } = await renderApp(path);

    // jsdom loads no CSS, so the sidebar and the bottom tab bar, each a
    // "Main" navigation, are both present; a browser displays only one at
    // any width. Landmark uniqueness is checked in the browser instead.
    expect(
      await axeViolations(container.ownerDocument.body, {
        page: true,
        skip: ['landmark-unique'],
      }),
    ).toEqual([]);
  });
});
