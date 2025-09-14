"use client";

import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const q = query(
        collection(db, 'messages'),
        where('kind', '==', 'contact'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); 
    })();
  }, []);
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Contact Messages</h1>
      {messages.length === 0 ? (
        <p>No messages.</p>
      ) : (
        <ul className="divide-y rounded border">
          {messages.map((m) => (
            <li key={m.id} className="p-3">
              <p className="font-medium">{m.fromName} &lt;{m.fromEmail}&gt;</p>
              <p className="text-sm text-gray-600 mb-1">{m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : ''}</p>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
