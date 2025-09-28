'use client';

import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { ensureFirebase, httpsCallable, loadAuthModule } from '@/lib/firebase';

const DEFAULT_LOGIN_TELEMETRY_ALLOWED_ORIGINS = ['http://localhost:3000'];

const parseAllowedOrigins = () => {
  const raw = process.env.NEXT_PUBLIC_LOGIN_TELEMETRY_ALLOWED_ORIGINS;
  if (typeof raw !== 'string' || !raw.trim()) {
    return DEFAULT_LOGIN_TELEMETRY_ALLOWED_ORIGINS;
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const LOGIN_TELEMETRY_ALLOWED_ORIGINS = new Set(parseAllowedOrigins());

const shouldEnableLoginTelemetry = () => {
  if (process.env.NEXT_PUBLIC_ENABLE_LOGIN_TELEMETRY === 'true') {
    return true;
  }

  if (process.env.NEXT_PUBLIC_DISABLE_LOGIN_TELEMETRY === 'true') {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if (LOGIN_TELEMETRY_ALLOWED_ORIGINS.size === 0) {
    return false;
  }

  const origin = window.location.origin;
  if (!LOGIN_TELEMETRY_ALLOWED_ORIGINS.has(origin)) {
    return false;
  }

  return true;
};

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
    if (!shouldEnableLoginTelemetry()) {
      return;
    }

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
