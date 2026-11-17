import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeRedirect } from '../app/router';
import { axeViolations } from '../test/axe';
import { accessToken, fakeApi, problem, renderApp, TEST_USER } from '../test/renderApp';

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

const heading = () => screen.getByRole('heading', { level: 1 });
const field = (name: string) => screen.getByLabelText(name, { selector: 'input,select' });

async function signIn(email = TEST_USER.email, password = 'correct horse battery staple') {
  await userEvent.type(field('Email'), email);
  await userEvent.type(field('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('protected pages', () => {
  it('restores a session from the cookie and shows the page asked for', async () => {
    const { history } = await renderApp('/settings', fakeApi({ signedIn: true }));

    expect(heading().textContent).toBe('Settings');
    expect(history.location.pathname).toBe('/settings');
    expect(screen.getByText(TEST_USER.email)).toBeTruthy();
  });

  it('sends a signed-out visitor to sign-in, and back after signing in', async () => {
    const { history } = await renderApp('/settings', fakeApi({ signedIn: false }));

    expect(heading().textContent).toBe('Welcome back');
    expect(history.location.pathname).toBe('/login');

    await signIn();

    await waitFor(() => expect(heading().textContent).toBe('Settings'));
    expect(history.location.pathname).toBe('/settings');
  });

  it('sends a signed-in visitor away from the sign-in page', async () => {
    const { history } = await renderApp('/login', fakeApi({ signedIn: true }));

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
    expect(history.location.pathname).toBe('/');
  });

  it.each([
    ['/settings', '/settings'],
    ['/settings?tab=x', '/settings?tab=x'],
    ['//evil.example/path', undefined],
    ['/\\evil.example', undefined],
    ['https://evil.example', undefined],
    [42, undefined],
  ])('accepts only a local path as the redirect (%j)', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it('ignores an off-site redirect in the address', async () => {
    const { history } = await renderApp(
      '/login?redirect=%2F%2Fevil.example',
      fakeApi({ signedIn: false }),
    );

    await signIn();

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
    expect(history.location.pathname).toBe('/');
  });
});

describe('sign-in', () => {
  it('checks that both fields are filled before sending anything', async () => {
    const api = fakeApi({ signedIn: false });
    await renderApp('/login', api);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(field('Email').getAttribute('aria-invalid')).toBe('true');
    expect(api.calls).not.toContain('POST /auth/login');
  });

  it('says the credentials are wrong, without saying which one', async () => {
    await renderApp(
      '/login',
      fakeApi({
        signedIn: false,
        routes: {
          'POST /auth/login': () => problem(401, { detail: 'Invalid email or password.' }),
        },
      }),
    );

    await signIn(TEST_USER.email, 'wrong password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Email or password is incorrect.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('says how long to wait when rate-limited', async () => {
    await renderApp(
      '/login',
      fakeApi({
        signedIn: false,
        routes: { 'POST /auth/login': () => problem(429, {}, { 'Retry-After': '840' }) },
      }),
    );

    await signIn();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Try again in 14 minutes.',
    );
  });

  it('can show the password it hides', async () => {
    await renderApp('/login', fakeApi({ signedIn: false }));
    const password = field('Password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(password.getAttribute('type')).toBe('text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.getAttribute('type')).toBe('password');
  });

  it('explains why sign-in is shown after a session expired', async () => {
    await renderApp('/login?reason=expired', fakeApi({ signedIn: false }));

    expect(screen.getByRole('status').textContent).toContain('Your session has ended');
  });
});

describe('registration', () => {
  it('creates the account, signs in and opens the app', async () => {
    const api = fakeApi({
      signedIn: false,
      routes: {
        'POST /auth/register': () =>
          new Response(JSON.stringify(TEST_USER), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    });
    await renderApp('/register', api);

    await userEvent.type(field('Email'), TEST_USER.email);
    await userEvent.type(field('Password'), 'correct horse battery staple');
    await userEvent.selectOptions(field('Time zone'), 'Asia/Yerevan');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
    const body = JSON.parse(
      api.fetch.mock.calls.find(([url]) => String(url).endsWith('/auth/register'))?.[1]
        ?.body as string,
    );
    expect(body).toEqual({
      email: TEST_USER.email,
      password: 'correct horse battery staple',
      timezone: 'Asia/Yerevan',
    });
  });

  it('starts from the browser’s time zone', async () => {
    await renderApp('/register', fakeApi({ signedIn: false }));

    expect((field('Time zone') as HTMLSelectElement).value).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it('applies the password rule before sending, counting characters as the API does', async () => {
    const api = fakeApi({ signedIn: false });
    await renderApp('/register', api);

    await userEvent.type(field('Email'), TEST_USER.email);
    // Seven characters; eight UTF-16 units because of the emoji.
    await userEvent.type(field('Password'), 'abcdef😀');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(api.calls).not.toContain('POST /auth/register');
  });

  it('puts "already registered" on the email field with a way to sign in', async () => {
    await renderApp(
      '/register',
      fakeApi({
        signedIn: false,
        routes: { 'POST /auth/register': () => problem(409) },
      }),
    );

    await userEvent.type(field('Email'), TEST_USER.email);
    await userEvent.type(field('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const email = field('Email');
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    const message = document.getElementById(email.getAttribute('aria-describedby')!)!;
    expect(message.textContent).toContain('An account with this email already exists.');
    expect(within(message).getByRole('link', { name: 'Sign in instead' })).toBeTruthy();
  });

  it('maps the API’s field errors onto the form', async () => {
    await renderApp(
      '/register',
      fakeApi({
        signedIn: false,
        routes: {
          'POST /auth/register': () =>
            problem(400, {
              detail: 'The request body is invalid.',
              errors: [{ path: 'timezone', message: 'Unknown time zone' }],
            }),
        },
      }),
    );

    await userEvent.type(field('Email'), TEST_USER.email);
    await userEvent.type(field('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Unknown time zone')).toBeTruthy();
    expect(field('Time zone').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('signing out', () => {
  it('ends the session and returns to sign-in', async () => {
    const api = fakeApi({ signedIn: true });
    const { history } = await renderApp('/settings', api);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(heading().textContent).toBe('Welcome back'));
    expect(history.location.pathname).toBe('/login');
    expect(screen.getByRole('status').textContent).toContain('You’ve signed out.');
    expect(api.calls).toContain('POST /auth/logout');
  });
});

describe('when the API is unreachable on start', () => {
  it('says so instead of pretending the user is signed out, and can retry', async () => {
    let up = false;
    const api = fakeApi({
      signedIn: true,
      routes: {
        'POST /auth/refresh': () => {
          if (!up) throw new TypeError('Failed to fetch');
          return accessToken();
        },
      },
    });
    await renderApp('/', api);
    expect(heading().textContent).toBe('Costly can’t be reached');

    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(heading().textContent).toBe('Overview'));
  });
});

describe('accessibility', () => {
  it.each(['/login', '/register', '/login?reason=expired'])(
    'has no violations at %s',
    async (path) => {
      const { container } = await renderApp(path, fakeApi({ signedIn: false }));

      expect(await axeViolations(container.ownerDocument.body, { page: true })).toEqual([]);
    },
  );
});
