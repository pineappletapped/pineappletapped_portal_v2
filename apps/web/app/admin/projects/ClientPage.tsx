"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

export default function AdminProjectsPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setIsStaff(false); return; }
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      const me = uSnap.data() as any;
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        const snap = await getDocs(collection(db, 'projects'));
        setProjects(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }
    })();
  }, []);

  const updateStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, 'projects', id), { status });
    setProjects(projects.map(p => p.id === id ? { ...p, status } : p));
  };

  if (isStaff === null) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to view projects.</p>;

  const statuses = ['intake','in_progress','review','completed'];
  const filtered = projects.filter(p => {
    const matchesText = filter
      ? (p.userEmail || '').toLowerCase().includes(filter.toLowerCase()) || (p.userId || '').includes(filter)
      : true;
    const matchesStatus = statusFilter ? p.status === statusFilter : true;
    return matchesText && matchesStatus;
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Project Management</h1>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Filter by client email"
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
          {statuses.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <button className="btn-outline btn-sm" onClick={() => setView(view === 'kanban' ? 'list' : 'kanban')}>
          {view === 'kanban' ? 'List View' : 'Kanban View'}
        </button>
      </div>
      {view === 'list' ? (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">Title</th>
              <th className="p-2">Client</th>
              <th className="p-2">Created</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.title || 'Untitled'}</td>
                <td className="p-2">{p.userEmail || '-'}</td>
                <td className="p-2">{p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : ''}</td>
                <td className="p-2">
                  <select value={p.status} onChange={(e) => updateStatus(p.id, e.target.value)} className="input">
                    {statuses.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                  </select>
                </td>
                <td className="p-2 flex gap-2">
                  <Link href={`/projects/${p.id}`} className="btn-sm">View</Link>
                  {p.orderId && (
                    <Link href={`/orders/${p.orderId}`} className="btn-sm btn-outline">Order</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {statuses.map(s => (
            <div
              key={s}
              className="border rounded-md p-3 min-h-[200px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) updateStatus(id, s);
              }}
            >
              <h3 className="font-semibold mb-2 capitalize">{s.replace('_',' ')}</h3>
              {filtered.filter(p => p.status === s).length === 0 ? (
                <p className="text-sm text-gray-500">No projects</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {filtered.filter(p => p.status === s).map(p => (
                    <div
                      key={p.id}
                      className="card p-2 grid gap-1"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', p.id);
                      }}
                    >
                      <p className="font-medium text-sm">{p.title || 'Untitled'}</p>
                      <p className="text-xs text-gray-600">{p.userEmail || ''}</p>
                      <Link href={`/projects/${p.id}`} className="btn-sm w-fit">Open</Link>
                      <select
                        value={p.status}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        className="input text-xs mt-1"
                      >
                        {statuses.map(opt => <option key={opt} value={opt}>{opt.replace('_',' ')}</option>)}
                      </select>
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
