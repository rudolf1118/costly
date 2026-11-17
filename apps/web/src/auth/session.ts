import {
  accessTokenSchema,
  type ApiClient,
  ApiError,
  createApiClient,
  type SessionHandler,
  type UserProfile,
  userProfileSchema,
} from '@costly/shared';

export type SessionState =
  /** Asking the API whether the refresh cookie still holds a session. */
  | { status: 'restoring' }
  | { status: 'authenticated'; user: UserProfile }
  /** `expired`: a session existed and the API ended it. */
  | { status: 'anonymous'; reason?: 'signed-out' | 'expired' }
  /** The API couldn't be reached, so it's unknown whether a session exists. */
  | { status: 'unavailable' };

export interface RegisterInput {
  email: string;
  password: string;
  timezone: string;
}

/** Refresh slightly before the access token's own expiry, not on the second. */
const EXPIRY_MARGIN_MS = 30_000;
/** ADR-0006: a 409 from refresh means "retry once with the cookie that just changed". */
const CONFLICT_RETRY_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The web client's session (ADR-0006, ADR-0010).
 *
 * - The access token is held in this object only: never in localStorage,
 *   sessionStorage or a script-readable cookie.
 * - The refresh token is the API's HttpOnly cookie. This class never sees
 *   it; it only sends the cookie endpoints with `credentials: "include"`.
 * - On start, `restore()` asks for a new access token: success restores the
 *   session, 401 means signed out, no answer means "unavailable", which is
 *   not the same as signed out.
 */
export class SessionStore implements SessionHandler {
  readonly api: ApiClient;

  private state: SessionState = { status: 'restoring' };
  private token: { value: string; expiresAt: number } | null = null;
  private restoring: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor({
    baseUrl,
    fetch,
    now = Date.now,
  }: {
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
  }) {
    this.now = now;
    this.api = createApiClient({ baseUrl, session: this, ...(fetch ? { fetch } : {}) });
  }

  // For useSyncExternalStore: arrow properties keep `this`.
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SessionState => this.state;

  getAccessToken(): string | null {
    if (!this.token || this.now() >= this.token.expiresAt - EXPIRY_MARGIN_MS) return null;
    return this.token.value;
  }

  /** SessionHandler: a new access token from the refresh cookie, or null if the session ended. */
  async refresh(): Promise<string | null> {
    try {
      return await this.exchangeCookie();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Another tab rotated the cookie a moment ago; the browser now holds the new one.
        await sleep(CONFLICT_RETRY_MS);
        try {
          return await this.exchangeCookie();
        } catch (retryError) {
          return this.endIfRefused(retryError);
        }
      }
      return this.endIfRefused(error);
    }
  }

  /** Restores the session on start. Calling it again while it runs returns the same work. */
  restore(): Promise<void> {
    this.restoring ??= this.doRestore().finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }

  async login(email: string, password: string): Promise<void> {
    const token = await this.api.request('/auth/login', {
      method: 'POST',
      body: { email, password },
      schema: accessTokenSchema,
      auth: false,
      credentials: 'include',
    });
    this.setToken(token.accessToken, token.expiresIn);
    await this.loadUser();
  }

  /** Creates the account, then signs in with it: registration alone doesn't (api-conventions.md). */
  async register(input: RegisterInput): Promise<void> {
    await this.api.request('/auth/register', {
      method: 'POST',
      body: input,
      schema: userProfileSchema,
      auth: false,
    });
    await this.login(input.email, input.password);
  }

  /** Ends the session here even if the API can't be told. */
  async logout(): Promise<void> {
    try {
      await this.api.request('/auth/logout', {
        method: 'POST',
        auth: false,
        credentials: 'include',
      });
    } catch {
      // The cookie expires on its own; signing out locally must not depend on the network.
    } finally {
      this.token = null;
      this.setState({ status: 'anonymous', reason: 'signed-out' });
    }
  }

  private async doRestore(): Promise<void> {
    this.setState({ status: 'restoring' });
    try {
      const token = await this.refresh();
      if (!token) {
        this.setState({ status: 'anonymous' });
        return;
      }
      await this.loadUser();
    } catch {
      this.token = null;
      this.setState({ status: 'unavailable' });
    }
  }

  private async exchangeCookie(): Promise<string> {
    const token = await this.api.request('/auth/refresh', {
      method: 'POST',
      schema: accessTokenSchema,
      auth: false,
      credentials: 'include',
    });
    this.setToken(token.accessToken, token.expiresIn);
    return token.accessToken;
  }

  /** A 401 from refresh ends the session; anything else is rethrown for the caller. */
  private endIfRefused(error: unknown): null {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const wasSignedIn = this.state.status === 'authenticated';
    this.token = null;
    if (this.state.status !== 'restoring') {
      this.setState({ status: 'anonymous', ...(wasSignedIn ? { reason: 'expired' } : {}) });
    }
    return null;
  }

  private async loadUser(): Promise<void> {
    const user = await this.api.request('/auth/me', { schema: userProfileSchema });
    this.setState({ status: 'authenticated', user });
  }

  private setToken(value: string, expiresInSeconds: number) {
    this.token = { value, expiresAt: this.now() + expiresInSeconds * 1000 };
  }

  private setState(state: SessionState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}
