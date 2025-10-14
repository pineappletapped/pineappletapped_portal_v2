'use client';

import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { ensureFirebase, httpsCallable, loadAuthModule } from '@/lib/firebase';

const makeSessionKey = (user: User) => {
  const lastSignIn =
    typeof user.metadata?.lastSignInTime === 'string' ? user.metadata.lastSignInTime : '';
  return `${user.uid}:${lastSignIn}`;
};

const isCallableAvailable = (callable: unknown): callable is typeof httpsCallable =>
  typeof callable === 'function';

export function useLoginTelemetry() {
  const lastRecordedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    let callable: ((payload: Record<string, unknown>) => Promise<unknown>) | null = null;

    (async () => {
      try {
        const { auth, functions } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!auth || !functions || (functions as any)?.__isPlaceholder) {
          console.warn('Login telemetry skipped: Firebase auth/functions unavailable');
          return;
        }

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          console.warn('Login telemetry skipped: onAuthStateChanged unavailable');
          return;
        }

        if (!isCallableAvailable(httpsCallable)) {
          console.warn('Login telemetry skipped: httpsCallable unavailable');
          return;
        }

        callable = httpsCallable(functions, 'recordLogin');

        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!user) {
            lastRecordedSessionRef.current = null;
            return;
          }

          const sessionKey = makeSessionKey(user);
          if (lastRecordedSessionRef.current === sessionKey) {
            return;
          }

          const isoTimestamp = new Date().toISOString();
          try {
            if (!callable) {
              if (!functions || (functions as any).__isPlaceholder) {
                throw new Error('Firebase functions unavailable');
              }
              if (!isCallableAvailable(httpsCallable)) {
                throw new Error('httpsCallable unavailable');
              }
              callable = httpsCallable(functions, 'recordLogin');
            }

            if (!callable) {
              throw new Error('Callable function not initialised');
            }

            await callable({ timestamp: isoTimestamp });
            lastRecordedSessionRef.current = sessionKey;
          } catch (error) {
            console.warn('Failed to record login telemetry via callable', error);
            lastRecordedSessionRef.current = null;
          }
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('Login telemetry initialisation failed', error);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);
}

export default useLoginTelemetry;
