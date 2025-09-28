'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { extractUserRoles, hasRole } from '@/lib/roles';
import type { TrainingAudience } from '@/lib/training';

interface TrainingAudienceState {
  loading: boolean;
  user: User | null;
  userData: Record<string, any> | null;
  audiences: TrainingAudience[];
}

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

const uniqueAudiences = (audiences: TrainingAudience[]): TrainingAudience[] => {
  const seen = new Set<TrainingAudience>();
  audiences.forEach((audience) => {
    if (!seen.has(audience)) {
      seen.add(audience);
    }
  });
  return Array.from(seen);
};

export function useTrainingAudiences(): TrainingAudienceState {
  const [state, setState] = useState<TrainingAudienceState>({
    loading: true,
    user: null,
    userData: null,
    audiences: [],
  });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (!auth || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }
        const { onAuthStateChanged } = await loadAuthModule();
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
          if (cancelled) return;

          if (!user) {
            setState({ loading: false, user: null, userData: null, audiences: [] });
            return;
          }

          try {
            const userSnap = await getDoc(doc(db, 'users', user.uid));
            const raw = (userSnap.data() ?? {}) as Record<string, any>;
            const userData: Record<string, any> = {
              ...raw,
              id: userSnap.id,
              uid: user.uid,
              email: raw?.email ?? user.email ?? null,
            };
            const roles = extractUserRoles(userData);
            const isGodAdmin = hasRole(roles, 'admin');
            const isContractor = userData?.contractor === true || Boolean(userData?.contractorInfo);
            const isStaff = userData?.isStaff === true || roles.admin === true;
            const franchiseIds = deriveFranchiseIds(userData);

            let hasFranchiseMembership = franchiseIds.length > 0;
            let hasClientMembership = !isContractor;
            let hasClientOrders = !isContractor;

            if (!hasFranchiseMembership) {
              try {
                const franchiseSnap = await getDocs(
                  query(collection(db, 'franchiseMembers'), where('userId', '==', user.uid), limit(1))
                );
                hasFranchiseMembership = !franchiseSnap.empty;
              } catch (error) {
                console.error('Failed to verify franchise membership for training audiences', error);
              }
            }

            if (isContractor) {
              try {
                const [membershipSnap, orderSnap, legacyOrderSnap] = await Promise.all([
                  getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid), limit(1))),
                  getDocs(query(collection(db, 'orders'), where('userId', '==', user.uid), limit(1))),
                  getDocs(query(collection(db, 'orders'), where('uid', '==', user.uid), limit(1))),
                ]);
                hasClientMembership = !membershipSnap.empty;
                hasClientOrders = !orderSnap.empty || !legacyOrderSnap.empty;
              } catch (error) {
                console.error('Failed to verify client membership/order access for training audiences', error);
                hasClientMembership = false;
                hasClientOrders = false;
              }
            }

            const clientStatus = (userData?.crmStatus || 'client') === 'client';

            const audiences: TrainingAudience[] = [];
            if (isGodAdmin || hasFranchiseMembership) {
              audiences.push('franchisees');
            }
            if (isGodAdmin || isStaff || isContractor) {
              audiences.push('teamMembers');
            }
            if (
              isGodAdmin ||
              (!isContractor && clientStatus) ||
              (isContractor && clientStatus && (hasClientMembership || hasClientOrders))
            ) {
              audiences.push('clients');
            }

            setState({
              loading: false,
              user,
              userData,
              audiences: uniqueAudiences(audiences),
            });
          } catch (error) {
            console.error('Failed to resolve training audiences', error);
            setState({ loading: false, user, userData: null, audiences: [] });
          }
        });
      } catch (error) {
        console.error('Failed to initialise training audience hook', error);
        if (!cancelled) {
          setState({ loading: false, user: null, userData: null, audiences: [] });
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

  return state;
}
