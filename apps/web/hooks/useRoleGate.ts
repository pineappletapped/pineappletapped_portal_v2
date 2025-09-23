'use client';

import { useEffect, useState } from 'react';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';
import type { User } from 'firebase/auth';

export function useRoleGate(required: RoleKey | RoleKey[]) {
  const [roles, setRoles] = useState<UserRoles | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
          if (cancelled) {
            return;
          }

          if (!user) {
            setRoles(null);
            setAllowed(false);
            setLoading(false);
            return;
          }
          try {
            const snap = await getDoc(doc(db, 'users', user.uid));
            const parsed = extractUserRoles(snap.data());
            setRoles(parsed);
            setAllowed(hasRole(parsed, required));
          } catch (error) {
            console.error('Failed to load user roles', error);
            setRoles(null);
            setAllowed(false);
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to subscribe to auth changes for role gate', error);
          setRoles(null);
          setAllowed(false);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [required]);

  return { roles, allowed, loading };
}
