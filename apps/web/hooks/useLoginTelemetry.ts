'use client';

import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { ensureFirebase, httpsCallable, loadAuthModule, functionsBaseUrl } from '@/lib/firebase';

const makeSessionKey = (user: User) => {
  const lastSignIn =
    typeof user.metadata?.lastSignInTime === 'string' ? user.metadata.lastSignInTime : '';
  return `${user.uid}:${lastSignIn}`;
};

const isCallableAvailable = (callable: unknown): callable is typeof httpsCallable =>
  typeof callable === 'function';

const normaliseBaseUrl = (baseUrl?: string | null) => {
  if (!baseUrl) {
    return null;
  }
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

const normalisedFunctionsBaseUrl = normaliseBaseUrl(functionsBaseUrl);
const recordLoginUrl = normalisedFunctionsBaseUrl
  ? `${normalisedFunctionsBaseUrl}/recordLoginEvent`
  : null;

async function recordLoginViaHttp(user: User, isoTimestamp: string): Promise<boolean> {
  if (!recordLoginUrl) {
    return false;
  }

  try {
    const token = await user.getIdToken();
    const response = await fetch(recordLoginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ timestamp: isoTimestamp }),
      mode: 'cors',
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    return true;
  } catch (error) {
    console.warn('recordLogin telemetry HTTP call failed', error);
    return false;
  }
}

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

          const isoTimestamp = new Date().toISOString();
          let recorded = await recordLoginViaHttp(user, isoTimestamp);

          if (!recorded) {
            try {
              if (!isCallableAvailable(httpsCallable) || !functions || (functions as any).__isPlaceholder) {
                throw new Error('httpsCallable unavailable');
              }
              const callable = httpsCallable(functions, 'recordLogin');
              await callable({ timestamp: isoTimestamp });
              recorded = true;
            } catch (error) {
              console.warn('Failed to record login telemetry via callable', error);
            }
          }

          if (recorded) {
            lastRecordedSessionRef.current = sessionKey;
          } else {
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
