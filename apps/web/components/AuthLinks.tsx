'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export default function AuthLinks() {
  const [user, setUser] = useState<any>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid));
        let staff = snap.exists() && !!snap.data()?.isStaff;
        if (u.uid === 'WK6WCuSueLN5M3Zq6D7WBbHyGPo1' || u.email === 'ryan@pineappletapped.com') {
          staff = true;
        }
        setIsStaff(staff);
        const token = await u.getIdToken();
        document.cookie = `token=${token}; path=/`;
        document.cookie = `uid=${u.uid}; path=/`;
        document.cookie = `isStaff=${staff ? '1' : '0'}; path=/`;
      } else {
        setIsStaff(false);
      }
      setChecked(true);
    });
    return () => unsub();
  }, []);

  if (!checked) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="btn btn-sm">
          Client Portal
        </Link>
        {isStaff && (
          <>
            <Link href="/admin" className="btn btn-sm btn-outline">
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
