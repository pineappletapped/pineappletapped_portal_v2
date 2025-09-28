"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminListUsers } from '@/lib/admin';
import { ensureFirebase } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';
import { extractUserRoles, type UserRoles } from '@/lib/roles';
import { collection, doc, getDoc, getDocs, Timestamp, updateDoc } from 'firebase/firestore';
import { summariseKitItems, type KitSummary } from '@/lib/kit-summary';

interface StaffOption {
  uid: string;
  label: string;
  email?: string | null;
}

interface FranchiseOption {
  id: string;
  name: string;
  code?: string | null;
}

type ProjectPriority = 'low' | 'medium' | 'high' | '';

interface ProjectRecord {
  id: string;
  title?: string | null;
  userEmail?: string | null;
  userId?: string | null;
  createdAt?: any;
  status?: string;
  ownerUid?: string | null;
  ownerName?: string | null;
  kickoffDate?: Timestamp | Date | null;
  dueDate?: Timestamp | Date | null;
  priority?: ProjectPriority | string | null;
  franchiseId?: string | null;
  franchiseTerritoryId?: string | null;
  franchiseAssignment?: {
    territoryLabel?: string | null;
    territoryPostalCode?: string | null;
    [key: string]: any;
  } | null;
  franchiseAssignedUserId?: string | null;
  franchiseAssignedMemberId?: string | null;
  franchiseAssignedRole?: string | null;
  franchiseAssignedIsPrimary?: boolean | null;
  franchiseAssignedUser?: {
    displayName?: string | null;
    email?: string | null;
    [key: string]: any;
  } | null;
  clientPostalCode?: string | null;
  [key: string]: any;
}

const STATUS_ORDER = ['intake', 'in_progress', 'review', 'completed'];

const PRIORITY_OPTIONS: { value: ProjectPriority; label: string }[] = [
  { value: '', label: 'No priority' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const DUE_GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'week', label: 'Due this week' },
  { key: 'month', label: 'Due in 30 days' },
  { key: 'later', label: 'Future' },
  { key: 'none', label: 'No due date' },
] as const;

function coerceDate(value: ProjectRecord['dueDate']): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const candidate: any = value;
  if (candidate && typeof candidate.toDate === 'function') {
    try {
      return candidate.toDate();
    } catch (err) {
      console.error('Failed to parse Firestore timestamp', err);
      return null;
    }
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDateInputValue(value: ProjectRecord['dueDate']): string {
  const date = coerceDate(value);
  if (!date) return '';
  const iso = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    .toISOString()
    .slice(0, 10);
  return iso;
}

function formatDateDisplay(value: any): string {
  const date = coerceDate(value);
  if (!date) return '';
  return date.toLocaleDateString();
}

export default function AdminProjectsPage() {
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'projects']);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [kitSummaries, setKitSummaries] = useState<Record<string, KitSummary>>({});
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [franchises, setFranchises] = useState<FranchiseOption[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'week' | 'month' | 'none'>('all');
  const [franchiseFilter, setFranchiseFilter] = useState<'all' | '__unassigned' | string>('all');
  const [groupBy, setGroupBy] = useState<'status' | 'owner' | 'due'>('status');

  useEffect(() => {
    let active = true;
    (async () => {
      if (guardLoading || !allowed) return;
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable');
        }
        const snap = await getDocs(collection(db, 'projects'));
        if (!active) return;
        const items: ProjectRecord[] = snap.docs.map((d) => {
          const { id: _ignoredId, ...rest } = d.data() as ProjectRecord;
          return {
            ...rest,
            id: d.id,
          };
        });
        setProjects(items);
        setKitSummaries((prev) => {
          const next: Record<string, KitSummary> = {};
          for (const project of items) {
            const summary = project.id ? prev[project.id] : undefined;
            if (summary) {
              next[project.id] = summary;
            }
          }
          return next;
        });
      } catch (err) {
        console.error('Failed to load projects', err);
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (guardLoading || !allowed) return;
      if (projects.length === 0) {
        if (!cancelled) {
          setKitSummaries({});
        }
        return;
      }

      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable');
        }

        const results: Record<string, KitSummary> = {};
        await Promise.all(
          projects
            .filter((project) => typeof project.orderId === 'string' && project.orderId.trim().length > 0)
            .map(async (project) => {
              const orderId = (project.orderId as string).trim();
              try {
                const orderSnap = await getDoc(doc(db, 'orders', orderId));
                if (!orderSnap.exists()) {
                  return;
                }
                const orderData = orderSnap.data() as any;
                const summary = summariseKitItems(orderData?.kitItems ?? []);
                if (summary) {
                  results[project.id] = summary;
                }
              } catch (error) {
                console.warn('Failed to resolve project kit summary', { projectId: project.id, orderId }, error);
              }
            })
        );

        if (!cancelled) {
          setKitSummaries(results);
        }
      } catch (error) {
        console.warn('Failed to load kit assignments for projects', error);
        if (!cancelled) {
          setKitSummaries({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, guardLoading, projects]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await ensureFirebase();
        const result: any = await adminListUsers();
        if (!active) return;
        const options = ((result?.users as any[]) || [])
          .reduce<StaffOption[]>((acc, user: any) => {
            const roles = extractUserRoles(user as { roles?: UserRoles; isStaff?: boolean });
            if (
              roles.admin ||
              roles.sales ||
              roles.operations ||
              roles.projects ||
              roles.marketing ||
              roles.finance
            ) {
              acc.push({
                uid: user.id as string,
                label:
                  user.fullName ||
                  user.displayName ||
                  user.email ||
                  'Unnamed user',
                email: user.email || null,
              });
            }
            return acc;
          }, [])
          .sort((a, b) => a.label.localeCompare(b.label));
        setStaff(options);
      } catch (err) {
        console.error('Failed to load staff directory', err);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      if (guardLoading || !allowed) return;
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable');
        }
        const snap = await getDocs(collection(db, 'franchises'));
        if (!active) return;
        const items = snap.docs
          .map((doc) => {
            const data = doc.data() as Record<string, any>;
            const rawName = typeof data.name === 'string' ? data.name.trim() : '';
            const rawCode = typeof data.code === 'string' ? data.code.trim() : '';
            return {
              id: doc.id,
              name: rawName || rawCode || doc.id,
              code: rawCode || null,
            } satisfies FranchiseOption;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setFranchises(items);
      } catch (err) {
        console.error('Failed to load franchises', err);
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading]);

  const staffMap = useMemo(() => {
    return new Map(staff.map((member) => [member.uid, member] as const));
  }, [staff]);

  const franchiseMap = useMemo(() => {
    return new Map(franchises.map((franchise) => [franchise.id, franchise] as const));
  }, [franchises]);

  const resolveDb = useCallback(async () => {
    const { db } = await ensureFirebase();
    if (!db) {
      throw new Error('Firestore is unavailable');
    }
    return db;
  }, []);

  const updateProject = useCallback(
    async (id: string, updates: Record<string, any>) => {
      try {
        const db = await resolveDb();
        await updateDoc(doc(db, 'projects', id), updates);
        setProjects((prev) =>
          prev.map((project) => (project.id === id ? { ...project, ...updates } : project))
        );
      } catch (err) {
        console.error('Failed to update project', err);
        alert('Failed to update project. Please try again.');
      }
    },
    [resolveDb]
  );

  const updateStatus = useCallback(
    async (id: string, status: string) => {
      await updateProject(id, { status });
    },
    [updateProject]
  );

  const updateOwner = useCallback(
    async (id: string, ownerUid: string | null) => {
      const member = ownerUid ? staffMap.get(ownerUid) : null;
      await updateProject(id, {
        ownerUid: ownerUid || null,
        ownerName: member?.label || null,
      });
    },
    [staffMap, updateProject]
  );

  const updateDateField = useCallback(
    async (id: string, field: 'dueDate' | 'kickoffDate', value: string) => {
      const payload: Record<string, any> = {};
      if (value) {
        const [year, month, day] = value.split('-').map((part) => Number(part));
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
          const date = new Date(year, (month || 1) - 1, day || 1);
          payload[field] = Timestamp.fromDate(date);
        } else {
          alert('Please provide a valid date.');
          return;
        }
      } else {
        payload[field] = null;
      }
      await updateProject(id, payload);
    },
    [updateProject]
  );

  const updatePriority = useCallback(
    async (id: string, priority: ProjectPriority) => {
      await updateProject(id, { priority: priority || null });
    },
    [updateProject]
  );

  const resolveFranchiseContext = useCallback(
    (project: ProjectRecord) => {
      const franchise = project.franchiseId ? franchiseMap.get(project.franchiseId) : undefined;
      const assignment = project.franchiseAssignment || null;
      const territoryLabel =
        assignment && typeof assignment === 'object'
          ? (assignment.territoryLabel as string | undefined) ||
            (assignment.territoryPostalCode as string | undefined) ||
            null
          : null;
      const operator =
        (project.franchiseAssignedUser && typeof project.franchiseAssignedUser === 'object'
          ? (project.franchiseAssignedUser.displayName as string | undefined) ||
            (project.franchiseAssignedUser.email as string | undefined)
          : null) ||
        (typeof project.franchiseAssignedUserId === 'string' ? project.franchiseAssignedUserId : null);
      const franchiseLabel = franchise?.name || (project.franchiseId ? String(project.franchiseId) : null);
      return { franchise, franchiseLabel, territoryLabel, operator };
    },
    [franchiseMap]
  );

  const resolveDueBucket = useCallback((project: ProjectRecord) => {
    const due = coerceDate(project.dueDate);
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekEnd = new Date(startToday);
    weekEnd.setDate(startToday.getDate() + 7);
    const monthEnd = new Date(startToday);
    monthEnd.setDate(startToday.getDate() + 30);

    if (!due) return 'none';
    if (due < startToday) return 'overdue';
    if (due <= weekEnd) return 'week';
    if (due <= monthEnd) return 'month';
    return 'later';
  }, []);

  const statuses = STATUS_ORDER;

  const filtered = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesText = text
        ? (project.userEmail || '').toLowerCase().includes(text) ||
          (project.userId || '').toLowerCase().includes(text) ||
          (project.title || project.name || '')
            .toString()
            .toLowerCase()
            .includes(text)
        : true;
      const matchesStatus = statusFilter ? project.status === statusFilter : true;
      const matchesOwner = ownerFilter
        ? ownerFilter === '__unassigned'
          ? !project.ownerUid
          : project.ownerUid === ownerFilter
        : true;
      let matchesDue = true;
      if (dueFilter !== 'all') {
        const bucket = resolveDueBucket(project);
        if (dueFilter === 'none') {
          matchesDue = bucket === 'none';
        } else if (dueFilter === 'overdue') {
          matchesDue = bucket === 'overdue';
        } else if (dueFilter === 'week') {
          matchesDue = bucket === 'week';
        } else if (dueFilter === 'month') {
          matchesDue = bucket === 'week' || bucket === 'month';
        }
      }
      const matchesFranchise =
        franchiseFilter === 'all'
          ? true
          : franchiseFilter === '__unassigned'
            ? !project.franchiseId
            : project.franchiseId === franchiseFilter;
      return matchesText && matchesStatus && matchesOwner && matchesDue && matchesFranchise;
    });
  }, [projects, filter, statusFilter, ownerFilter, dueFilter, resolveDueBucket, franchiseFilter]);

  const groupedColumns = useMemo(() => {
    if (groupBy === 'owner') {
      const buckets = new Map<string, ProjectRecord[]>();
      filtered.forEach((project) => {
        const key = project.ownerUid || '__unassigned';
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(project);
      });
      const defs = [
        { key: '__unassigned', title: 'Unassigned' },
        ...staff.map((member) => ({ key: member.uid, title: member.label })),
      ];
      return defs.map((def) => ({
        key: def.key,
        title: def.title,
        projects: buckets.get(def.key) || [],
        droppable: true,
        onDrop: (id: string) =>
          updateOwner(id, def.key === '__unassigned' ? null : (def.key as string)),
      }));
    }

    if (groupBy === 'due') {
      const buckets = new Map<string, ProjectRecord[]>();
      filtered.forEach((project) => {
        const bucket = resolveDueBucket(project);
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket)!.push(project);
      });
      return DUE_GROUPS.map((group) => ({
        key: group.key,
        title: group.label,
        projects: buckets.get(group.key) || [],
        droppable: false,
        onDrop: undefined,
      }));
    }

    const buckets = new Map<string, ProjectRecord[]>();
    filtered.forEach((project) => {
      const status = statuses.includes(project.status || '')
        ? (project.status as string)
        : statuses[0];
      if (!buckets.has(status)) buckets.set(status, []);
      buckets.get(status)!.push(project);
    });

    return statuses.map((status) => ({
      key: status,
      title: status.replace('_', ' '),
      projects: buckets.get(status) || [],
      droppable: true,
      onDrop: (id: string) => updateStatus(id, status),
    }));
  }, [filtered, groupBy, resolveDueBucket, staff, updateOwner, updateStatus, statuses]);

  if (guardLoading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view projects.</p>;

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Project Management</h1>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Filter by client or project"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="">All assignees</option>
          <option value="__unassigned">Unassigned</option>
          {staff.map((member) => (
            <option key={member.uid} value={member.uid}>
              {member.label}
            </option>
          ))}
        </select>
        <select
          value={franchiseFilter}
          onChange={(e) => setFranchiseFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="all">All franchises</option>
          <option value="__unassigned">Unassigned</option>
          {franchises.map((franchise) => (
            <option key={franchise.id} value={franchise.id}>
              {franchise.name}
            </option>
          ))}
        </select>
        <select
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)}
          className="input max-w-xs"
        >
          <option value="all">All deadlines</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
          <option value="month">Due in 30 days</option>
          <option value="none">No due date</option>
        </select>
        {view === 'kanban' && (
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            className="input max-w-xs"
          >
            <option value="status">Group by status</option>
            <option value="owner">Group by assignee</option>
            <option value="due">Group by deadline</option>
          </select>
        )}
        <button
          className="btn-outline btn-sm"
          onClick={() => setView(view === 'kanban' ? 'list' : 'kanban')}
        >
          {view === 'kanban' ? 'List View' : 'Kanban View'}
        </button>
      </div>
      {view === 'list' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Title</th>
                <th className="p-2">Client</th>
                <th className="p-2">Franchise</th>
                <th className="p-2">Assignee</th>
                <th className="p-2">Kickoff</th>
                <th className="p-2">Due</th>
                <th className="p-2">Priority</th>
                <th className="p-2">Status</th>
                <th className="p-2">Kit assignments</th>
                <th className="p-2">Created</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 align-top">{p.title || 'Untitled'}</td>
                  <td className="p-2 align-top">{p.userEmail || '-'}</td>
                  <td className="p-2 align-top">
                    {(() => {
                      const { franchiseLabel, territoryLabel, operator } = resolveFranchiseContext(p);
                      if (!franchiseLabel) {
                        return <span className="text-xs text-gray-500">Unassigned</span>;
                      }
                      return (
                        <div className="grid gap-1">
                          <span className="font-medium text-sm">{franchiseLabel}</span>
                          {territoryLabel && (
                            <span className="text-xs text-gray-500">Territory: {territoryLabel}</span>
                          )}
                          {operator && (
                            <span className="text-xs text-gray-500">Operator: {operator}</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-2 align-top">
                    <select
                      value={p.ownerUid || ''}
                      onChange={(e) => updateOwner(p.id, e.target.value || null)}
                      className="input w-full text-sm"
                    >
                      <option value="">Unassigned</option>
                      {staff.map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 align-top">
                    <input
                      type="date"
                      value={toDateInputValue(p.kickoffDate)}
                      onChange={(e) => updateDateField(p.id, 'kickoffDate', e.target.value)}
                      className="input w-full text-sm"
                    />
                  </td>
                  <td className="p-2 align-top">
                    <input
                      type="date"
                      value={toDateInputValue(p.dueDate)}
                      onChange={(e) => updateDateField(p.id, 'dueDate', e.target.value)}
                      className="input w-full text-sm"
                    />
                  </td>
                  <td className="p-2 align-top">
                    <select
                      value={(p.priority as ProjectPriority) || ''}
                      onChange={(e) => updatePriority(p.id, e.target.value as ProjectPriority)}
                      className="input w-full text-sm"
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 align-top">
                    <select
                      value={p.status || statuses[0]}
                      onChange={(e) => updateStatus(p.id, e.target.value)}
                      className="input w-full text-sm"
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 align-top">
                    {(() => {
                      const summary = kitSummaries[p.id];
                      if (!summary) {
                        return <span className="text-xs text-gray-500">—</span>;
                      }
                      return (
                        <div className="grid gap-1">
                          <span className="font-medium text-xs text-gray-700">{summary.label}</span>
                          {summary.window ? (
                            <span className="text-xs text-gray-500">Window: {summary.window}</span>
                          ) : null}
                          {summary.hasDrone ? (
                            <span className="inline-flex w-max items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                              Drone kit
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-2 align-top whitespace-nowrap">
                    {formatDateDisplay(p.createdAt)}
                  </td>
                  <td className="p-2 align-top">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/projects/${p.id}`} className="btn-sm">
                        View
                      </Link>
                      {p.orderId && (
                        <Link href={`/orders/${p.orderId}`} className="btn-sm btn-outline">
                          Order
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {groupedColumns.map((column) => (
            <div
              key={column.key}
              className="border rounded-md p-3 min-h-[220px]"
              onDragOver={(e) => column.droppable && e.preventDefault()}
              onDrop={(e) => {
                if (!column.droppable || !column.onDrop) return;
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) column.onDrop(id);
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="font-semibold text-sm capitalize">{column.title}</h3>
                <span className="text-xs text-gray-500">{column.projects.length}</span>
              </div>
              {column.projects.length === 0 ? (
                <p className="text-sm text-gray-500">No projects</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {column.projects.map((project) => (
                    <div
                      key={project.id}
                      className="card p-2 grid gap-2"
                      draggable={column.droppable}
                      onDragStart={(e) => {
                        if (!column.droppable) return;
                        e.dataTransfer.setData('text/plain', project.id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{project.title || 'Untitled'}</p>
                          <p className="text-xs text-gray-600">{project.userEmail || ''}</p>
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {formatDateDisplay(project.dueDate)}
                        </span>
                      </div>
                      {(() => {
                        const { franchiseLabel, territoryLabel, operator } = resolveFranchiseContext(project);
                        return (
                          <div className="grid gap-1 text-xs text-gray-600">
                            <span className={franchiseLabel ? 'font-medium text-gray-700' : 'text-gray-400'}>
                              Franchise: {franchiseLabel || 'Unassigned'}
                            </span>
                            {territoryLabel && <span>Territory: {territoryLabel}</span>}
                            {operator && <span>Operator: {operator}</span>}
                          </div>
                        );
                      })()}
                      <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                        {project.ownerUid && staffMap.get(project.ownerUid)?.label && (
                          <span className="rounded-full bg-gray-100 px-2 py-1">
                            {staffMap.get(project.ownerUid)?.label}
                          </span>
                        )}
                        {project.priority && (
                          <span className="rounded-full bg-amber-100 px-2 py-1 capitalize">
                            {project.priority}
                          </span>
                        )}
                      </div>
                      {kitSummaries[project.id] ? (
                        <div className="grid gap-1 text-xs text-gray-600">
                          <span className="font-medium text-gray-700">{kitSummaries[project.id].label}</span>
                          {kitSummaries[project.id].window ? (
                            <span>Window: {kitSummaries[project.id].window}</span>
                          ) : null}
                          {kitSummaries[project.id].hasDrone ? (
                            <span className="inline-flex w-max items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                              Drone kit
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="grid gap-1 text-xs">
                        <select
                          value={project.ownerUid || ''}
                          onChange={(e) => updateOwner(project.id, e.target.value || null)}
                          className="input text-xs"
                        >
                          <option value="">Unassigned</option>
                          {staff.map((member) => (
                            <option key={member.uid} value={member.uid}>
                              {member.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          <label className="flex-1">
                            <span className="sr-only">Due date</span>
                            <input
                              type="date"
                              value={toDateInputValue(project.dueDate)}
                              onChange={(e) => updateDateField(project.id, 'dueDate', e.target.value)}
                              className="input text-xs"
                            />
                          </label>
                          <label className="flex-1">
                            <span className="sr-only">Kickoff date</span>
                            <input
                              type="date"
                              value={toDateInputValue(project.kickoffDate)}
                              onChange={(e) => updateDateField(project.id, 'kickoffDate', e.target.value)}
                              className="input text-xs"
                            />
                          </label>
                        </div>
                        <select
                          value={(project.priority as ProjectPriority) || ''}
                          onChange={(e) => updatePriority(project.id, e.target.value as ProjectPriority)}
                          className="input text-xs"
                        >
                          {PRIORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={project.status || statuses[0]}
                          onChange={(e) => updateStatus(project.id, e.target.value)}
                          className="input text-xs"
                        >
                          {statuses.map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                        <Link href={`/projects/${project.id}`} className="btn-sm w-fit">
                          Open
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
