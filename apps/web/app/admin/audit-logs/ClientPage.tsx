"use client";

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';

interface AuditLogChangeMap {
  [key: string]: { before: unknown; after: unknown };
}

interface AuditLogEntry {
  id: string;
  actorUid: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: AuditLogChangeMap | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | null;
}

const FETCH_LIMIT = 200;

export default function AdminAuditLogsPage() {
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actorLabels, setActorLabels] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState({
    actor: 'all',
    entity: 'all',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }

    (async () => {
      const snapshot = await getDocs(
        query(
          collection(db, 'adminAuditLogs'),
          orderBy('createdAt', 'desc'),
          limit(FETCH_LIMIT)
        )
      );
      const entries: AuditLogEntry[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        let createdAt: Date | null = null;
        if (data.createdAt?.toDate) {
          createdAt = data.createdAt.toDate();
        } else if (typeof data.createdAt === 'string') {
          createdAt = new Date(data.createdAt);
        }
        return {
          id: docSnap.id,
          actorUid: data.actorUid || 'unknown',
          action: data.action || 'unknown',
          entityType: data.entityType || 'unknown',
          entityId: data.entityId ?? null,
          changes: data.changes || null,
          metadata: data.metadata || null,
          createdAt,
        };
      });
      setLogs(entries);

      const uniqueActors = Array.from(
        new Set(entries.map((entry) => entry.actorUid).filter(Boolean))
      );
      if (uniqueActors.length > 0) {
        const labelEntries: [string, string][] = await Promise.all(
          uniqueActors.map(async (uid) => {
            try {
              const userSnap = await getDoc(doc(db, 'users', uid));
              if (userSnap.exists()) {
                const user = userSnap.data() as any;
                const label = user.fullName || user.email || uid;
                return [uid, label] as [string, string];
              }
            } catch (err) {
              // ignore lookup errors
            }
            return [uid, uid] as [string, string];
          })
        );
        setActorLabels(
          labelEntries.reduce((acc, [uid, label]) => {
            acc[uid] = label;
            return acc;
          }, {} as Record<string, string>)
        );
      }

      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const filteredLogs = useMemo(() => {
    const start = filters.startDate ? new Date(filters.startDate) : null;
    const end = filters.endDate ? new Date(filters.endDate) : null;
    if (end) {
      end.setDate(end.getDate() + 1);
    }
    return logs.filter((log) => {
      if (filters.actor !== 'all' && log.actorUid !== filters.actor) {
        return false;
      }
      if (filters.entity !== 'all' && log.entityType !== filters.entity) {
        return false;
      }
      if (start && (!log.createdAt || log.createdAt < start)) {
        return false;
      }
      if (end && (!log.createdAt || log.createdAt >= end)) {
        return false;
      }
      return true;
    });
  }, [logs, filters]);

  const entityOptions = useMemo(() => {
    const options = Array.from(new Set(logs.map((log) => log.entityType))).filter(Boolean);
    return options;
  }, [logs]);

  if (guardLoading || loading) {
    return <p>Loading audit logs…</p>;
  }
  if (!allowed) {
    return <p>You do not have permission to view audit logs.</p>;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Admin Audit Logs</h1>
        <p className="text-sm text-gray-600">
          Track administrative changes across the portal. Use the filters below to narrow by actor,
          entity, or date range.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Actor</span>
          <select
            value={filters.actor}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, actor: event.target.value }))
            }
            className="rounded border px-2 py-1"
          >
            <option value="all">All actors</option>
            {Object.entries(actorLabels)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([uid, label]) => (
                <option key={uid} value={uid}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Entity</span>
          <select
            value={filters.entity}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, entity: event.target.value }))
            }
            className="rounded border px-2 py-1"
          >
            <option value="all">All entities</option>
            {entityOptions.sort().map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Start date</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, startDate: event.target.value }))
            }
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">End date</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, endDate: event.target.value }))
            }
            className="rounded border px-2 py-1"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-2">Timestamp</th>
              <th className="p-2">Actor</th>
              <th className="p-2">Action</th>
              <th className="p-2">Entity</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-500">
                  No audit entries match your filters.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const actorName = actorLabels[log.actorUid] || log.actorUid;
                const hasDetails =
                  (log.changes && Object.keys(log.changes).length > 0) ||
                  (log.metadata && Object.keys(log.metadata).length > 0);
                return (
                  <tr key={log.id} className="border-t">
                    <td className="p-2 align-top whitespace-nowrap">
                      {log.createdAt ? log.createdAt.toLocaleString() : '—'}
                    </td>
                    <td className="p-2 align-top whitespace-nowrap">{actorName}</td>
                    <td className="p-2 align-top">{log.action}</td>
                    <td className="p-2 align-top">
                      <div className="flex flex-col">
                        <span className="font-medium capitalize">{log.entityType}</span>
                        {log.entityId ? (
                          <span className="text-xs text-gray-500">ID: {log.entityId}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-2 align-top">
                      {hasDetails ? (
                        <details>
                          <summary className="cursor-pointer text-orange">View</summary>
                          {log.changes && Object.keys(log.changes).length > 0 ? (
                            <div className="mt-2">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Changes
                              </p>
                              <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">
                                {JSON.stringify(log.changes, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                          {log.metadata && Object.keys(log.metadata).length > 0 ? (
                            <div className="mt-2">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Metadata
                              </p>
                              <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                        </details>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

