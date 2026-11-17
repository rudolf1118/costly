import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import type { SessionState, SessionStore } from './session';

const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

/** The session store, for its actions (login, logout…) and its API client. */
export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSessionStore must be used inside <SessionProvider>');
  return store;
}

/** The current session state; re-renders when it changes. */
export function useSessionState(): SessionState {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
