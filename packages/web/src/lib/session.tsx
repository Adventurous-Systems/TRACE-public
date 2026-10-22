'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth, SESSION_ENDED_EVENT } from './api-client';
import { clearLegacySession, type StoredUser } from './auth';

/**
 * Who is signed in (M3a). The session is an httpOnly cookie, so the page
 * cannot read it; it asks the API once per load (`GET /auth/session`, which
 * answers null rather than 401 for an anonymous visitor) and again whenever
 * the API refuses a call for want of a session (SESSION_ENDED_EVENT), so an
 * expired or revoked session signs the page out.
 */
export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

export interface SessionValue {
  user: StoredUser | null;
  status: SessionStatus;
  /** After sign-in or registration: the user the API returned, so the next page has it at once. */
  signedIn: (user: StoredUser) => void;
  /** Ends this browser's session (D3) and forgets the user. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  const check = useCallback(async () => {
    try {
      const current = await auth.session();
      setUser(current);
      setStatus(current ? 'signed-in' : 'signed-out');
    } catch {
      // The API is unreachable: nothing signed-in can work, so say signed out.
      setUser(null);
      setStatus('signed-out');
    }
  }, []);

  useEffect(() => {
    clearLegacySession();
    void check();
    const onEnded = () => void check();
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [check]);

  const signedIn = useCallback((next: StoredUser) => {
    setUser(next);
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setUser(null);
      setStatus('signed-out');
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, signedIn, signOut }),
    [user, status, signedIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
