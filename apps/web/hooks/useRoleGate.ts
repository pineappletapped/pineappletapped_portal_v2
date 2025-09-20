'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';
import { onAuthStateChanged } from 'firebase/auth';

export function useRoleGate(required: RoleKey | RoleKey[]) {
  const [roles, setRoles] = useState<UserRoles | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = onAuthStateChanged(auth, async (user) => {
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
        setLoading(false);
      }
    });

    return () => unsub();
  }, [required]);

  return { roles, allowed, loading };
}
