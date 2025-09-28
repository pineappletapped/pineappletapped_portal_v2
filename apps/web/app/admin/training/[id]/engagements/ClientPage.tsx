'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import { db } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';
import {
  normaliseTrainingModule,
  timestampToDate,
  type TrainingModuleRecord,
  formatTrainingAudienceList,
} from '@/lib/training';

interface EngagementRecord {
  id: string;
  userId: string;
  displayName?: string | null;
  email?: string | null;
  firstViewedAt?: Date | null;
  lastViewedAt?: Date | null;
  viewCount?: number;
}

interface AdminTrainingEngagementLogProps {
  moduleId: string;
}

export default function AdminTrainingEngagementLog({ moduleId }: AdminTrainingEngagementLogProps) {
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [module, setModule] = useState<TrainingModuleRecord | null>(null);
  const [engagements, setEngagements] = useState<EngagementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const moduleRef = doc(db, 'trainingModules', moduleId);
        const snap = await getDoc(moduleRef);
        if (!snap.exists()) {
          throw new Error('Module not found');
        }
        if (!active) return;
        setModule(normaliseTrainingModule(snap.id, snap.data()));

        const engagementSnap = await getDocs(
          query(
            collection(db, 'trainingModuleEngagements'),
            where('moduleId', '==', moduleId),
            orderBy('lastViewedAt', 'desc')
          )
        );
        if (!active) return;
        setEngagements(
          engagementSnap.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              userId: data.userId,
              displayName: data.displayName ?? null,
              email: data.email ?? null,
              firstViewedAt: timestampToDate(data.firstViewedAt),
              lastViewedAt: timestampToDate(data.lastViewedAt),
              viewCount: typeof data.viewCount === 'number' ? data.viewCount : undefined,
            };
          })
        );
      } catch (err) {
        console.error('Failed to load engagement log', err);
        if (active) {
          setError('Unable to load engagement data. Please try again later.');
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
  }, [allowed, guardLoading, moduleId]);

  const totalViews = useMemo(
    () =>
      engagements.reduce((acc, engagement) => acc + (typeof engagement.viewCount === 'number' ? engagement.viewCount : 1), 0),
    [engagements]
  );

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p>Loading engagement log…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p>You do not have permission to review training engagement.</p>
      </PortalContainer>
    );
  }

  if (!module) {
    return (
      <PortalContainer>
        <div className="space-y-3">
          <p>We could not find a training module with this ID.</p>
          <Link href="/admin/training" className="btn">
            Back to training list
          </Link>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.25em] text-orange-500">Engagement log</p>
          <h1 className="text-2xl font-semibold text-slate-900">{module.title}</h1>
          <p className="text-sm text-slate-600">{module.summary}</p>
          <dl className="flex flex-wrap gap-4 text-xs text-slate-500">
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Audience</dt>
              <dd className="mt-1 text-sm text-slate-700">{formatTrainingAudienceList(module.audiences)}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Unique viewers</dt>
              <dd className="mt-1 text-sm text-slate-700">{engagements.length}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Total views</dt>
              <dd className="mt-1 text-sm text-slate-700">{totalViews}</dd>
            </div>
          </dl>
        </header>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-600">Viewer</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Email</th>
                <th className="px-4 py-3 font-semibold text-slate-600">First viewed</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Last viewed</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Views</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {engagements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No one has viewed this module yet.
                  </td>
                </tr>
              ) : (
                engagements.map((engagement) => (
                  <tr key={engagement.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-900">{engagement.displayName ?? 'Unknown viewer'}</p>
                        <p className="text-xs text-slate-500">{engagement.userId}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{engagement.email ?? '—'}</td>
                    <td className="px-4 py-4 text-slate-600">
                      {engagement.firstViewedAt ? engagement.firstViewedAt.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {engagement.lastViewedAt ? engagement.lastViewedAt.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-4 text-slate-600">{engagement.viewCount ?? 1}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PortalContainer>
  );
}
