'use client';

import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';

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
        const services = await ensureFirebase();
        const { auth, functions } = services;
        if (cancelled) {
          return;
        }
        if (!auth || (auth as any)?.__isPlaceholder) {
          console.warn('Login telemetry skipped: Firebase auth unavailable');
          return;
        }
        if (!functions || (functions as any)?.__isPlaceholder) {
          console.warn('Login telemetry skipped: Firebase functions unavailable');
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

        const recordLoginCallable = httpsCallable(functions, 'recordLogin');

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
            await recordLoginCallable({ timestamp: isoTimestamp });
            lastRecordedSessionRef.current = sessionKey;
          } catch (error) {
            console.warn('Failed to record login telemetry', error);
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
