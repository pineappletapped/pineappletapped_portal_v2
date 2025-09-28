'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';
import {
  formatTrainingAudienceList,
  normaliseTrainingModule,
  sortTrainingModules,
  timestampToDate,
  type TrainingModuleRecord,
  type TrainingAudience,
  TRAINING_AUDIENCE_OPTIONS,
} from '@/lib/training';
import PortalContainer from '@/components/PortalContainer';

interface ModuleWithMeta extends TrainingModuleRecord {}

export default function AdminTrainingModulesPage() {
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [modules, setModules] = useState<ModuleWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [audienceFilter, setAudienceFilter] = useState<'all' | TrainingAudience>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
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
        const snap = await getDocs(query(collection(db, 'trainingModules'), orderBy('title')));
        if (!active) return;
        const next = sortTrainingModules(
          snap.docs.map((docSnap) => normaliseTrainingModule(docSnap.id, docSnap.data()))
        );
        setModules(next);
      } catch (err) {
        console.error('Failed to load training modules', err);
        if (active) {
          setError('Unable to load training modules. Please refresh to retry.');
          setModules([]);
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
  }, [allowed, guardLoading]);

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
  }, [modules, audienceFilter, categoryFilter, search]);

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p>Loading training modules…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p>You do not have permission to manage training modules.</p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900">Training modules</h1>
            <p className="text-sm text-slate-600">
              Create, update, and monitor onboarding content for franchisees, team members, and clients.
            </p>
          </div>
          <Link href="/admin/training/new" className="btn">
            Create module
          </Link>
        </header>

        <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</span>
              <input
                className="input"
                placeholder="Search by title, keyword, or summary"
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
                <option value="all">All audiences</option>
                {TRAINING_AUDIENCE_OPTIONS.map((option) => (
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

        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-600">Title</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Category</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Audiences</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Updated</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredModules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No training modules found.
                  </td>
                </tr>
              )}
              {filteredModules.map((module) => {
                const updated = timestampToDate(module.updatedAt ?? module.publishedAt ?? module.createdAt);
                return (
                  <tr key={module.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-900">{module.title}</p>
                        <p className="text-xs text-slate-500">{module.summary}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{module.category ?? '—'}</td>
                    <td className="px-4 py-4 text-slate-600">{formatTrainingAudienceList(module.audiences)}</td>
                    <td className="px-4 py-4 text-slate-600">{updated ? updated.toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/training/${module.id}`} className="link">
                          View module
                        </Link>
                        <Link href={`/admin/training/${module.id}`} className="link">
                          Edit
                        </Link>
                        <Link href={`/admin/training/${module.id}/engagements`} className="link">
                          Engagement log
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PortalContainer>
  );
}
