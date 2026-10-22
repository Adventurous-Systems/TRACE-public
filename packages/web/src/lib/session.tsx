'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { auth, SESSION_ENDED_EVENT } from './api-client';
import { clearLegacySession, type StoredUser } from './auth';

/**
 * Who is signed in (M3a). The session is an httpOnly cookie, so the page
 * cannot read it; it asks the API (`GET /auth/session`, which answers null
 * rather than 401 for an anonymous visitor):
 *   - on every navigation, so a role change shows on the next page opened;
 *   - whenever the API refuses a call for want of a session
 *     (SESSION_ENDED_EVENT), so an expired or revoked session signs out.
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

/** Retries for a check the API never answered (a slot swap, a dropped connection). */
const RETRY_DELAYS_MS = [1_000, 3_000];

/** Whether two answers describe the same signed-in user (or both nobody). */
export function sameUser(a: StoredUser | null, b: StoredUser | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.id === b.id &&
      a.email === b.email &&
      a.role === b.role &&
      a.organisationId === b.organisationId)
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  // Each check, sign-in and sign-out takes the next number. A check's answer
  // is used only if nothing has happened since it was asked: an answer sent
  // before a sign-in set the cookie must not sign the page back out.
  const generation = useRef(0);

  const apply = useCallback((next: StoredUser | null) => {
    // The same user keeps the same object, so pages whose effects depend on
    // it don't reload (and an edit form doesn't reset) on every check.
    setUser((previous) => (sameUser(previous, next) ? previous : next));
    setStatus(next ? 'signed-in' : 'signed-out');
  }, []);

  const check = useCallback(async () => {
    const asked = ++generation.current;
    for (let attempt = 0; ; attempt++) {
      try {
        const current = await auth.session();
        if (asked === generation.current) apply(current);
        return;
      } catch {
        // No answer says nothing about the session: keep what is known and
        // ask again. Only a first check that never gets one gives up, as
        // signed out, so a page is not left blank.
        if (asked !== generation.current) return;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          setStatus((known) => (known === 'loading' ? 'signed-out' : known));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (asked !== generation.current) return;
      }
    }
  }, [apply]);

  useEffect(() => {
    clearLegacySession();
    const onEnded = () => void check();
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [check]);

  // The first load, then every navigation.
  useEffect(() => {
    void check();
  }, [pathname, check]);

  const signedIn = useCallback(
    (next: StoredUser) => {
      generation.current++;
      apply(next);
    },
    [apply],
  );

  const signOut = useCallback(async () => {
    generation.current++;
    try {
      await auth.logout();
    } catch {
      // The API unreachable: the page signs out anyway. The cookie may
      // outlive this tab, until it expires or the next sign-out reaches it.
    }
    apply(null);
  }, [apply]);

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
