"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';

/**
 * Project Task History
 *
 * Shows an audit trail of task actions for a project. Each entry records who moved a task,
 * what the action was (create/update), and any status transitions. This page is available
 * to project members. Staff see all entries; others see only entries within their org/project.
 */
export default function ProjectHistoryPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const projectId = params.id;
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setAllowed(false);
        setLoading(false);
        return;
      }
      // Check user membership or staff
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      const me = uSnap.data() as any;
      const roles = extractUserRoles(me);
      const isPrivileged = hasRole(roles, ['admin', 'projects']);
      if (!isPrivileged) {
        // Ensure user is member of project org
        const projSnap = await getDoc(doc(db, 'projects', projectId));
        if (!projSnap.exists) {
          setAllowed(false);
          setLoading(false);
          return;
        }
        const proj = projSnap.data() as any;
        // Check membership: user must belong to org
        const memSnap = await getDocs(query(collection(db, 'memberships'), where('orgId', '==', proj.orgId), where('userId', '==', user.uid)));
        if (memSnap.empty) {
          setAllowed(false);
          setLoading(false);
          return;
        }
      }
      setAllowed(true);
      // Fetch history entries
      const hq = query(collection(db, 'taskHistory'), where('projectId', '==', projectId), orderBy('timestamp', 'desc'));
      const hSnap = await getDocs(hq);
      const entries: any[] = [];
      for (const docSnap of hSnap.docs) {
        const data = docSnap.data() as any;
        // Fetch user email
        let email: string | null = null;
        try {
          const uS = await getDoc(doc(db, 'users', data.uid));
          email = uS.exists() ? (uS.data() as any).email : data.uid;
        } catch {
          email = data.uid;
        }
        entries.push({ id: docSnap.id, ...data, email, ts: data.timestamp?.toDate?.() });
      }
      setHistory(entries);
      setLoading(false);
    })();
  }, [projectId]);

  if (loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this project history.</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Project History</h1>
      {history.length === 0 ? <p>No history entries.</p> : (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">Timestamp</th>
              <th className="p-2">User</th>
              <th className="p-2">Action</th>
              <th className="p-2">From</th>
              <th className="p-2">To</th>
              <th className="p-2">Task</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{h.ts ? h.ts.toLocaleString() : '-'}</td>
                <td className="p-2 whitespace-nowrap">{h.email}</td>
                <td className="p-2 whitespace-nowrap">{h.action}</td>
                <td className="p-2 whitespace-nowrap">{h.fromStatus || '-'}</td>
                <td className="p-2 whitespace-nowrap">{h.toStatus || '-'}</td>
                <td className="p-2 whitespace-nowrap">{h.taskId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}