"use client";
import { useEffect, useState } from 'react';
import { db, auth, functions } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

/**
 * Emails page: lists email threads associated with the user's organisations and allows
 * sending a new email. Emails are stored in Firestore and sending is handled by
 * the emails_send callable which should integrate with an SMTP/Gmail provider.
 */
export default function EmailsPage() {
  const [threads, setThreads] = useState<any[]>([]);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      // fetch orgs of user
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgIds = memSnap.docs.map((m) => (m.data() as any).orgId);
      if (orgIds.length > 0) {
        const qEmails = query(collection(db, 'emails'), where('orgId', 'in', orgIds), orderBy('createdAt', 'desc'));
        const es = await getDocs(qEmails);
        setThreads(es.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, []);

  const sendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    setSending(true);
    try {
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgId = memSnap.docs[0]?.data()?.orgId;
      const call = httpsCallable(functions, 'emails_send');
      const res: any = await call({ orgId, to, subject, body });
      // Add to local list
      setThreads([{ id: res.data.id, orgId, from: user.email, to, subject, body, createdAt: new Date(), status: 'sent' }, ...threads]);
      setTo(''); setSubject(''); setBody('');
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error sending email');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Emails</h1>
      {/* Send new email form */}
      <form onSubmit={sendEmail} className="card p-4 grid gap-2 max-w-lg">
        <input
          className="input"
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
        <textarea
          className="input"
          placeholder="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
        />
        <button type="submit" className="btn" disabled={sending}>
          {sending ? 'Sending…' : 'Send Email'}
        </button>
      </form>
      {/* Thread list */}
      <div className="card p-4">
        <h2 className="font-semibold mb-2">Recent Emails</h2>
        {threads.length === 0 ? <p>No emails.</p> : (
          <div className="grid gap-3">
            {threads.map((t) => (
              <div key={t.id} className="border-t pt-2">
                <div className="text-sm text-gray-600 mb-1">{new Date(t.createdAt?.toDate ? t.createdAt.toDate() : t.createdAt).toLocaleString()}</div>
                <div className="font-medium">{t.subject}</div>
                <div className="text-sm">To: {t.to}</div>
                <p className="text-sm mt-1">{t.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}