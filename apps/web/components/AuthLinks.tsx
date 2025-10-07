'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { signOut, type Auth, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { ADMIN_ROLE_KEYS, extractUserRoles, getDefaultAdminRoute, hasRole, UserRoles } from '@/lib/roles';

type AuthLinksProps = {
  size?: 'xs' | 'sm' | 'md';
  className?: string;
};

const SIZE_CLASSNAMES: Record<Required<AuthLinksProps>['size'], string> = {
  xs: 'h-8 px-3 text-xs',
  sm: 'h-9 px-4 text-sm',
  md: 'h-10 px-5 text-sm',
};

const BUTTON_VARIANTS = {
  solid: 'border-orange bg-orange text-white hover:bg-orange/90 focus-visible:outline-orange',
  outline:
    'border-orange bg-white text-orange hover:bg-orange hover:text-white focus-visible:outline-orange',
  ghost:
    'border-transparent text-slate-600 hover:border-orange/60 hover:bg-orange/10 hover:text-orange focus-visible:outline-orange',
} as const;

type ButtonVariant = keyof typeof BUTTON_VARIANTS;

type ProfileFlags = {
  contractor: boolean;
  crmStatus?: string;
  isStaff: boolean;
};

const deriveFranchiseIds = (data: any): string[] => {
  const ids = new Set<string>();
  const pushValue = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) ids.add(trimmed);
    }
  };
  pushValue(data?.primaryFranchiseId);
  pushValue(data?.franchiseId);
  if (Array.isArray(data?.franchiseIds)) {
    data.franchiseIds.forEach((value: unknown) => pushValue(value));
  }
  const roles = data?.franchiseRoles;
  if (roles && typeof roles === 'object') {
    Object.values(roles).forEach((value) => pushValue(value));
  }
  return Array.from(ids);
};

export default function AuthLinks({ size = 'sm', className }: AuthLinksProps = {}) {
  const [user, setUser] = useState<any>(null);
  const [roles, setRoles] = useState<UserRoles>({});
  const [checked, setChecked] = useState(false);
  const [profile, setProfile] = useState<ProfileFlags | null>(null);
  const [hasClientMembership, setHasClientMembership] = useState(false);
  const [hasClientOrders, setHasClientOrders] = useState(false);
  const [franchiseIds, setFranchiseIds] = useState<string[]>([]);
  const [hasFranchiseMembership, setHasFranchiseMembership] = useState(false);
  const authRef = useRef<Auth | null>(null);
  const dbRef = useRef<Firestore | null>(null);
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
        dbRef.current = db;

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
          setProfile(null);
          setHasClientMembership(false);
          setHasClientOrders(false);
          setFranchiseIds([]);
          setHasFranchiseMembership(false);
          if (u) {
            try {
              const snap = await getDoc(doc(db, 'users', u.uid));
              const rawData = (snap.data() as any) || {};
              const docData = {
                ...rawData,
                id: snap.id,
                uid: u.uid,
                email: rawData?.email ?? u.email ?? null,
              };
              const extracted = extractUserRoles(docData);
              const nextProfile: ProfileFlags = {
                contractor: docData?.contractor === true || Boolean(docData?.contractorInfo),
                crmStatus: typeof docData?.crmStatus === 'string' ? docData.crmStatus : undefined,
                isStaff: docData?.isStaff === true || extracted.admin === true,
              };
              setProfile(nextProfile);
              setRoles(extracted);
              const franchiseList = deriveFranchiseIds(docData);
              setFranchiseIds(franchiseList);
              setHasFranchiseMembership(franchiseList.length > 0);
            } catch (error) {
              console.error('Failed to derive user roles', error);
              setRoles({});
              setProfile({ contractor: false, isStaff: false });
            }
          } else {
            setRoles({});
            setProfile(null);
            setHasClientMembership(false);
            setHasClientOrders(false);
            setFranchiseIds([]);
            setHasFranchiseMembership(false);
          }
          setChecked(true);
        });
      } catch (error) {
        console.error('Failed to subscribe to auth changes', error);
        if (!cancelled) {
          setUser(null);
          setRoles({});
          setProfile(null);
          setHasClientMembership(false);
          setHasClientOrders(false);
          setFranchiseIds([]);
          setHasFranchiseMembership(false);
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

  const sizeClass = SIZE_CLASSNAMES[size] ?? SIZE_CLASSNAMES.sm;
  const wrapperClass = useMemo(
    () => clsx('flex flex-wrap items-center gap-2', className),
    [className]
  );
  const profileLoaded = profile !== null;
  const isProfileContractor = profile?.contractor === true;

  useEffect(() => {
    const db = dbRef.current;
    if (!user || !db) {
      setHasClientMembership(false);
      return;
    }

    if (!profileLoaded) {
      return;
    }

    if (!isProfileContractor) {
      setHasClientMembership(true);
      return;
    }

    let cancelled = false;
    setHasClientMembership(false);

    (async () => {
      try {
        const membershipSnap = await getDocs(
          query(collection(db, 'memberships'), where('userId', '==', user.uid), limit(1))
        );
        if (!cancelled) {
          setHasClientMembership(!membershipSnap.empty);
        }
      } catch (error) {
        console.error('Failed to verify client memberships', error);
        if (!cancelled) {
          setHasClientMembership(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isProfileContractor, profileLoaded, user]);

  useEffect(() => {
    const db = dbRef.current;
    if (!user || !db) {
      setHasClientOrders(false);
      return;
    }

    if (!profileLoaded) {
      return;
    }

    if (!isProfileContractor) {
      setHasClientOrders(true);
      return;
    }

    let cancelled = false;
    setHasClientOrders(false);

    (async () => {
      try {
        let hasOrders = false;
        const direct = await getDocs(
          query(collection(db, 'orders'), where('userId', '==', user.uid), limit(1))
        );
        if (!direct.empty) {
          hasOrders = true;
        } else {
          const legacy = await getDocs(
            query(collection(db, 'orders'), where('uid', '==', user.uid), limit(1))
          );
          hasOrders = !legacy.empty;
        }
        if (!cancelled) {
          setHasClientOrders(hasOrders);
        }
      } catch (error) {
        console.error('Failed to verify client orders', error);
        if (!cancelled) {
          setHasClientOrders(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isProfileContractor, profileLoaded, user]);

  useEffect(() => {
    const db = dbRef.current;
    if (!user || !db) {
      setHasFranchiseMembership(false);
      return;
    }

    if (franchiseIds.length > 0) {
      setHasFranchiseMembership(true);
      return;
    }

    let cancelled = false;
    setHasFranchiseMembership(false);

    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'franchiseMembers'), where('userId', '==', user.uid), limit(1))
        );
        if (!cancelled) {
          setHasFranchiseMembership(!snap.empty);
        }
      } catch (error) {
        console.error('Failed to verify franchise membership', error);
        if (!cancelled) {
          setHasFranchiseMembership(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [franchiseIds, user]);

  const makeButtonClass = (variant: ButtonVariant) =>
    clsx(
      'inline-flex items-center justify-center rounded-full border font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
      sizeClass,
      BUTTON_VARIANTS[variant]
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
    }

    try {
      await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Failed to clear server session', error);
    }
  };

  if (!checked) return null;

  if (user) {
    const canAccessAdmin = hasRole(roles, ADMIN_ROLE_KEYS);
    const isGodAdmin = hasRole(roles, 'admin');
    const isContractor = isProfileContractor;
    const clientStatus = (profile?.crmStatus || 'client') === 'client';
    const showClientPortal =
      isGodAdmin ||
      (!isContractor && clientStatus) ||
      (isContractor && clientStatus && (hasClientMembership || hasClientOrders));
    const showFranchisePortal = isGodAdmin || hasFranchiseMembership;
    const showTeamPortal = isGodAdmin || isContractor;
    const showAffiliatePortal = hasRole(roles, 'affiliate');
    const showOrganiserPortal = hasRole(roles, 'organiser');
    const adminHref = getDefaultAdminRoute(roles);
    return (
      <div className={wrapperClass}>
        {showClientPortal && (
          <Link href="/dashboard" className={makeButtonClass('solid')}>
            Client Portal
          </Link>
        )}
        {showFranchisePortal && (
          <Link href="/franchise" className={makeButtonClass('outline')}>
            Franchise Portal
          </Link>
        )}
        {showOrganiserPortal && (
          <Link href="/organiser" className={makeButtonClass('outline')}>
            Organiser Portal
          </Link>
        )}
        {showAffiliatePortal && (
          <Link href="/affiliate" className={makeButtonClass('outline')}>
            Affiliate Portal
          </Link>
        )}
        {canAccessAdmin && (
          <Link href={adminHref} className={makeButtonClass('outline')}>
            Admin
          </Link>
        )}
        {showTeamPortal && (
          <Link href="/contractors" className={makeButtonClass('outline')}>
            Team Portal
          </Link>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          className={makeButtonClass('ghost')}
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <Link href="/login" className={makeButtonClass('solid')}>
        Client Portal
      </Link>
    </div>
  );
}
