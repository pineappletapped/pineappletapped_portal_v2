'use client';

import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { postHttpFunctionOrThrow } from '@/lib/httpFunctions';

const makeSessionKey = (user: User) => {
  const lastSignIn =
    typeof user.metadata?.lastSignInTime === 'string' ? user.metadata.lastSignInTime : '';
  return `${user.uid}:${lastSignIn}`;
};

export function useLoginTelemetry() {
  const lastRecordedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { auth } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!auth || (auth as any)?.__isPlaceholder) {
          console.warn('Login telemetry skipped: Firebase auth unavailable');
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
            const token = await user.getIdToken();
            await postHttpFunctionOrThrow('recordLogin', {
              body: { timestamp: isoTimestamp },
              idToken: token,
              allowRelativeFallback: true,
            });
            lastRecordedSessionRef.current = sessionKey;
          } catch (error) {
            console.warn('Failed to record login telemetry via HTTP', error);
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
