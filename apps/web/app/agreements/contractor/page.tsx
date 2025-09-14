"use client";

import { useEffect, useState } from 'react';
import { auth, db, functions } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, doc, updateDoc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'next/navigation';

/**
 * Contractor Agreement Review
 *
 * Displays the most recent agreement for contractors and allows them to indicate
 * acceptance. When accepted, the user's agreedVersion is updated and a signature
 * request is created via the esign_request callable. Contractors must be signed in.
 */
export default function ContractorAgreementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState<any | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setLoading(false); return; }
      // Get latest agreement by createdAt
      const agSnap = await getDocs(query(collection(db, 'agreements'), orderBy('createdAt', 'desc')));
      if (!agSnap.empty) {
        setAgreement({ id: agSnap.docs[0].id, ...agSnap.docs[0].data() });
      }
      setLoading(false);
    })();
  }, []);
  // We'll fetch user again once we have agreement to check agreedVersion
  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user || !agreement) return;
      const uRef = doc(db, 'users', user.uid);
      const uSnap = await getDoc(uRef);
      const data: any = uSnap.data();
      if (data?.agreedVersion === agreement.version) {
        setAccepted(true);
      }
    })();
  }, [agreement]);

  const handleAccept = async () => {
    const user = auth.currentUser;
    if (!user || !agreement) return;
    try {
      // Update user's agreedVersion
      await updateDoc(doc(db, 'users', user.uid), { agreedVersion: agreement.version, agreedAt: new Date().toISOString() });
      // Create signature request (so admin can track)
      const callable = httpsCallable(functions, 'esign_request');
      await callable({ projectId: null, orgId: null, docAssetId: agreement.id, signerUid: user.uid });
      setAccepted(true);
      alert('Thank you for agreeing to the terms.');
      router.push('/dashboard');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error recording agreement');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!agreement) return <p>No agreement found.</p>;
  if (accepted) return <p>You have already accepted the latest agreement.</p>;
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Contractor Agreement (Version {agreement.version})</h1>
      <div className="prose max-w-none mb-6" dangerouslySetInnerHTML={{ __html: agreement.content }} />
      <button className="btn" onClick={handleAccept}>I Agree</button>
    </div>
  );
}