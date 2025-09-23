'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { signOut, type Auth, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import {
  ROLE_KEYS,
  encodeRolesCookie,
  extractUserRoles,
  getDefaultAdminRoute,
  hasRole,
  UserRoles,
} from '@/lib/roles';

type AuthLinksProps = {
  size?: 'xs' | 'sm' | 'md';
  className?: string;
};

const SIZE_CLASSNAMES: Record<Required<AuthLinksProps>['size'], string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: 'btn-md',
};

export default function AuthLinks({ size = 'sm', className }: AuthLinksProps = {}) {
  const [user, setUser] = useState<any>(null);
  const [roles, setRoles] = useState<UserRoles>({});
  const [checked, setChecked] = useState(false);
  const authRef = useRef<Auth | null>(null);

  useEffect(() => {
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

        authRef.current = auth;

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, async (u: User | null) => {
          if (cancelled) {
            return;
          }

          setUser(u);
          if (u) {
            try {
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
            } catch (error) {
              console.error('Failed to derive user roles', error);
              setRoles({});
            }
          } else {
            setRoles({});
          }
          setChecked(true);
        });
      } catch (error) {
        console.error('Failed to subscribe to auth changes', error);
        if (!cancelled) {
          setUser(null);
          setRoles({});
          setChecked(true);
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

  const buttonSizeClass = SIZE_CLASSNAMES[size] ?? SIZE_CLASSNAMES.sm;
  const wrapperClass = useMemo(
    () => ['flex items-center gap-2', className].filter(Boolean).join(' '),
    [className]
  );

  const handleSignOut = async () => {
    let instance = authRef.current;
    try {
      if (!instance) {
        const { auth } = await ensureFirebase();
        instance = auth ?? null;
        authRef.current = instance;
      }
      if (!instance) {
        throw new Error('Firebase auth is unavailable.');
      }
      await signOut(instance);
    } catch (error) {
      console.error('Failed to sign out', error);
    } finally {
      ['token', 'uid', 'roles'].forEach((cookie) => {
        document.cookie = `${cookie}=; path=/; max-age=0`;
      });
    }
  };

  if (!checked) return null;

  if (user) {
    const canAccessAdmin = hasRole(roles, ROLE_KEYS);
    const adminHref = getDefaultAdminRoute(roles);
    return (
      <div className={wrapperClass}>
        <Link href="/dashboard" className={`btn ${buttonSizeClass}`}>
          Client Portal
        </Link>
        {canAccessAdmin && (
          <Link href={adminHref} className={`btn ${buttonSizeClass} btn-outline`}>
            Admin
          </Link>
        )}
        <Link href="/contractors" className={`btn ${buttonSizeClass} btn-outline`}>
          Team Portal
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className={`btn ${buttonSizeClass} btn-ghost`}
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <Link href="/admin" className={`btn ${buttonSizeClass} btn-outline`}>
        Admin
      </Link>
      <Link href="/contractors" className={`btn ${buttonSizeClass} btn-outline`}>
        Team Portal
      </Link>
      <Link href="/dashboard" className={`btn ${buttonSizeClass}`}>
        Client Portal
      </Link>
    </div>
  );
}
