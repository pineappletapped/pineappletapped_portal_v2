'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import TrainingModuleCard from '@/components/training/TrainingModuleCard';
import { db } from '@/lib/firebase';
import {
  formatTrainingAudienceList,
  normaliseTrainingModule,
  sortTrainingModules,
  timestampToDate,
  type TrainingModuleRecord,
  type TrainingAudience,
  TRAINING_AUDIENCE_OPTIONS,
} from '@/lib/training';
import { useTrainingAudiences } from '@/hooks/useTrainingAudiences';

interface EngagementMap {
  [moduleId: string]: {
    lastViewedAt: Date | null;
    viewCount: number;
  };
}

export default function TrainingLibraryPage() {
  const { loading: audienceLoading, user, audiences } = useTrainingAudiences();
  const [modules, setModules] = useState<TrainingModuleRecord[]>([]);
  const [engagements, setEngagements] = useState<EngagementMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [audienceFilter, setAudienceFilter] = useState<'all' | TrainingAudience>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    if (audienceLoading) {
      return;
    }
    if (!user) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'trainingModules'), orderBy('title')));
        if (!active) return;
        const rawModules = sortTrainingModules(
          snap.docs.map((docSnap) => normaliseTrainingModule(docSnap.id, docSnap.data()))
        );
        setModules(rawModules);
        if (!user) return;
        const engagementSnap = await getDocs(
          query(collection(db, 'trainingModuleEngagements'), where('userId', '==', user.uid))
        );
        if (!active) return;
        const map: EngagementMap = {};
        engagementSnap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const moduleId = data.moduleId;
          if (!moduleId) return;
          map[moduleId] = {
            lastViewedAt: timestampToDate(data.lastViewedAt),
            viewCount: typeof data.viewCount === 'number' ? data.viewCount : 1,
          };
        });
        setEngagements(map);
      } catch (err) {
        console.error('Failed to load training library', err);
        if (active) {
          setError('Unable to load training modules. Please try again later.');
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
  }, [audienceLoading, user]);

  const availableAudiences = useMemo(() => {
    if (!audiences || audiences.length === 0) {
      return [] as TrainingAudience[];
    }
    return audiences;
  }, [audiences]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    modules.forEach((module) => {
      if (module.category) {
        set.add(module.category);
      }
    });
    return Array.from(set).sort();
  }, [modules]);

  const filteredModules = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return modules.filter((module) => {
      const matchesAudience =
        availableAudiences.length === 0
          ? true
          : module.audiences.some((audience) => availableAudiences.includes(audience));
      if (!matchesAudience) {
        return false;
      }
      if (audienceFilter !== 'all' && !module.audiences.includes(audienceFilter)) {
        return false;
      }
      if (categoryFilter !== 'all') {
        if (!module.category || module.category !== categoryFilter) {
          return false;
        }
      }
      if (!lowerSearch) {
        return true;
      }
      const haystack = [
        module.title,
        module.summary,
        module.category ?? '',
        ...module.keywords,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(lowerSearch);
    });
  }, [modules, availableAudiences, audienceFilter, categoryFilter, search]);

  if (audienceLoading || loading) {
    return (
      <PortalContainer>
        <p>Loading training library…</p>
      </PortalContainer>
    );
  }

  if (!user) {
    return (
      <PortalContainer>
        <div className="space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">Please sign in</h1>
          <p className="text-sm text-slate-600">You need to be signed in to access the training library.</p>
          <Link href="/login" className="btn">
            Sign in
          </Link>
        </div>
      </PortalContainer>
    );
  }

  if (availableAudiences.length === 0) {
    return (
      <PortalContainer>
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">Training not available</h1>
          <p className="text-sm text-slate-600">
            Your account does not currently have access to training resources. If you believe this is incorrect, please contact
            Pineapple Tapped support.
          </p>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-orange-500">Training library</p>
          <h1 className="text-3xl font-semibold text-slate-900">Grow your Pineapple Tapped skills</h1>
          <p className="text-sm text-slate-600">
            Browse onboarding and workflow guides curated for {formatTrainingAudienceList(availableAudiences)}.
          </p>
        </header>

        <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</span>
              <input
                className="input"
                placeholder="Search by topic or keyword"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Audience</span>
              <select
                className="input"
                value={audienceFilter}
                onChange={(event) => setAudienceFilter(event.target.value as 'all' | TrainingAudience)}
              >
                <option value="all">All your audiences</option>
                {TRAINING_AUDIENCE_OPTIONS.filter((option) => availableAudiences.includes(option.key)).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</span>
              <select
                className="input"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Showing {filteredModules.length} of {modules.length} modules.
          </p>
        </section>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        {filteredModules.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
            <p>No training modules match your filters yet. Try clearing your search or switching categories.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredModules.map((module) => {
              const engagement = engagements[module.id];
              return (
                <TrainingModuleCard
                  key={module.id}
                  module={module}
                  href={`/training/${module.id}`}
                  viewed={Boolean(engagement)}
                  lastViewedAt={engagement?.lastViewedAt ?? null}
                />
              );
            })}
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
