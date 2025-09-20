"use client";

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, getDoc, doc, where } from 'firebase/firestore';
import { useRoleGate } from '@/hooks/useRoleGate';

/**
 * Admin Login History
 *
 * Displays a log of user login events recorded via the recordLogin callable. Only staff
 * (isStaff === true) can view all login events. Regular users can view only their
 * own login history. Each entry shows the user's email and the timestamp.
 */
export default function AdminLoginHistoryPage() {
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      const logSnap = await getDocs(
        query(collection(db, 'loginHistory'), orderBy('timestamp', 'desc'))
      );
      const entries: any[] = [];
      for (const docSnap of logSnap.docs) {
        const data = docSnap.data() as any;
        let email: string | null = null;
        try {
          const uSnap = await getDoc(doc(db, 'users', data.uid));
          email = (uSnap.exists() ? (uSnap.data() as any).email : data.uid) || data.uid;
        } catch (err) {
          email = data.uid;
        }
        entries.push({ id: docSnap.id, uid: data.uid, email, timestamp: data.timestamp?.toDate?.() });
      }
      setLogs(entries);
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) {
    return <p>You do not have permission to view login history.</p>;
  }
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Login History</h1>
      {logs.length === 0 ? <p>No login events recorded.</p> : (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">User</th>
              <th className="p-2">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="p-2">{log.email}</td>
                <td className="p-2">{log.timestamp ? log.timestamp.toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
