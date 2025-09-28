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

        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!user) {
            lastRecordedSessionRef.current = null;
            return;
          }

          const sessionKey = makeSessionKey(user);
          if (lastRecordedSessionRef.current === sessionKey) {
            return;
          }
          lastRecordedSessionRef.current = sessionKey;

          try {
            const callable = httpsCallable(functions, 'recordLogin');
            await callable({ timestamp: new Date().toISOString() });
          } catch (error) {
            console.warn('Failed to record login telemetry', error);
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
