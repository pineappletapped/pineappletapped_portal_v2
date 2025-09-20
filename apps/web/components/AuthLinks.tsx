'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  ROLE_KEYS,
  encodeRolesCookie,
  extractUserRoles,
  getDefaultAdminRoute,
  hasRole,
  UserRoles,
} from '@/lib/roles';

export default function AuthLinks() {
  const [user, setUser] = useState<any>(null);
  const [roles, setRoles] = useState<UserRoles>({});
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid));
        let extracted = extractUserRoles(snap.data());
        if (
          u.uid === 'WK6WCuSueLN5M3Zq6D7WBbHyGPo1' ||
          u.email === 'ryan@pineappletapped.com' ||
          u.email === 'ryanadmin@pineappletapped.com'
        ) {
          extracted = { ...extracted, admin: true };
        }
        setRoles(extracted);
        const token = await u.getIdToken();
        document.cookie = `token=${token}; path=/`;
        document.cookie = `uid=${u.uid}; path=/`;
        document.cookie = `roles=${encodeURIComponent(encodeRolesCookie(extracted))}; path=/`;
      } else {
        setRoles({});
      }
      setChecked(true);
    });
    return () => unsub();
  }, []);

  if (!checked) return null;

  if (user) {
    const canAccessAdmin = hasRole(roles, ROLE_KEYS);
    const adminHref = getDefaultAdminRoute(roles);
    return (
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="btn btn-sm">
          Client Portal
        </Link>
        {canAccessAdmin && (
          <>
            <Link href={adminHref} className="btn btn-sm btn-outline">
              Admin
            </Link>
            <Link href="/contractors" className="btn btn-sm btn-outline">
              Contractor Portal
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <Link href="/login" className="btn btn-sm">
      Portal Login
    </Link>
  );
}
