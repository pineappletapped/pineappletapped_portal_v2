'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import TrainingContentRenderer from '@/components/training/TrainingContentRenderer';
import { db } from '@/lib/firebase';
import { useTrainingAudiences } from '@/hooks/useTrainingAudiences';
import {
  formatTrainingAudienceList,
  normaliseTrainingModule,
  type TrainingModuleRecord,
} from '@/lib/training';

interface TrainingModuleDetailPageProps {
  moduleId: string;
}

export default function TrainingModuleDetailPage({ moduleId }: TrainingModuleDetailPageProps) {
  const { loading: audienceLoading, user, audiences, userData } = useTrainingAudiences();
  const [module, setModule] = useState<TrainingModuleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastViewedAt, setLastViewedAt] = useState<Date | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);

  const hasAccess = useMemo(() => {
    if (!module) return false;
    if (!audiences || audiences.length === 0) return false;
    return module.audiences.some((audience) => audiences.includes(audience));
  }, [module, audiences]);

  useEffect(() => {
    if (audienceLoading) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const ref = doc(db, 'trainingModules', moduleId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          throw new Error('Module not found');
        }
        if (!active) return;
        const parsed = normaliseTrainingModule(snap.id, snap.data());
        setModule(parsed);
      } catch (err) {
        console.error('Failed to load training module', err);
        if (active) {
          setError('Unable to load this training module. It may have been removed.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [audienceLoading, moduleId]);

  useEffect(() => {
    if (!module || !user || !hasAccess) {
      return;
    }

    const logEngagement = async () => {
      try {
        const engagementRef = doc(db, 'trainingModuleEngagements', `${moduleId}_${user.uid}`);
        const engagementSnap = await getDoc(engagementRef);
        const displayName =
          (typeof userData?.displayName === 'string' && userData.displayName.trim()) ||
          user.displayName ||
          user.email ||
          'Unknown viewer';
        const email = user.email ?? (typeof userData?.email === 'string' ? userData.email : null);
        if (engagementSnap.exists()) {
          const data = engagementSnap.data();
          const previousCount = typeof data.viewCount === 'number' ? data.viewCount : 0;
          setLastViewedAt(new Date());
          setViewCount(previousCount + 1);
          await setDoc(
            engagementRef,
            {
              moduleId,
              userId: user.uid,
              displayName,
              email,
              lastViewedAt: serverTimestamp(),
              viewCount: increment(1),
            },
            { merge: true }
          );
        } else {
          await setDoc(engagementRef, {
            moduleId,
            userId: user.uid,
            displayName,
            email,
            firstViewedAt: serverTimestamp(),
            lastViewedAt: serverTimestamp(),
            viewCount: 1,
          });
          setLastViewedAt(new Date());
          setViewCount(1);
        }
      } catch (err) {
        console.error('Failed to log training engagement', err);
      }
    };

    logEngagement().catch((err) => console.error('Unhandled training engagement error', err));
  }, [module, user, userData, moduleId, hasAccess]);

  if (audienceLoading || loading) {
    return (
      <PortalContainer>
        <p>Loading training module…</p>
      </PortalContainer>
    );
  }

  if (!module || error) {
    return (
      <PortalContainer>
        <div className="space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">Module unavailable</h1>
          <p className="text-sm text-slate-600">{error ?? 'We could not load this training module.'}</p>
          <Link href="/training" className="btn">
            Back to training library
          </Link>
        </div>
      </PortalContainer>
    );
  }

  if (!user) {
    return (
      <PortalContainer>
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">Sign in required</h1>
          <p className="text-sm text-slate-600">Log in to view this training module.</p>
          <Link href="/login" className="btn">
            Sign in
          </Link>
        </div>
      </PortalContainer>
    );
  }

  if (!hasAccess) {
    return (
      <PortalContainer>
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">Access restricted</h1>
          <p className="text-sm text-slate-600">
            This module is targeted at {formatTrainingAudienceList(module.audiences)}. If you should have access, please contact
            Pineapple Tapped.
          </p>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="space-y-6">
        <TrainingContentRenderer module={module} />
        {(lastViewedAt || viewCount) && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {lastViewedAt && <p>Last viewed on {lastViewedAt.toLocaleString()}.</p>}
            {viewCount && viewCount > 1 && <p>Total views recorded: {viewCount}.</p>}
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
