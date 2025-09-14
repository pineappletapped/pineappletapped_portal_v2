"use client";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

/**
 * Signature page for a project. Loads any pending signature request for the current user
 * on this project and allows them to sign. Once signed, the status is updated and
 * timestamped. Assumes signatures collection documents contain projectId, orgId,
 * docAssetId (PDF to sign) and signerUid.
 */
export default function SignaturePage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  const [loading, setLoading] = useState(true);
  const [signature, setSignature] = useState<any | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user || !projectId) {
        setLoading(false);
        return;
      }
      const qSig = query(collection(db, 'signatures'), where('projectId', '==', projectId), where('signerUid', '==', user.uid));
      const snap = await getDocs(qSig);
      if (!snap.empty) {
        setSignature({ id: snap.docs[0].id, ...snap.docs[0].data() });
      }
      setLoading(false);
    })();
  }, [projectId]);

  const signDocument = async () => {
    if (!signature) return;
    setSigning(true);
    try {
      await updateDoc(doc(db, 'signatures', signature.id), {
        status: 'signed',
        signedAt: new Date(),
      });
      setSignature({ ...signature, status: 'signed', signedAt: new Date() });
      alert('Signature recorded');
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error signing');
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!signature) return <p>No signature request for this project.</p>;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Signature Request</h1>
      {signature.docAssetId ? (
        <p className="text-sm text-gray-600">Please review the document before signing. Document Asset ID: {signature.docAssetId}</p>
      ) : (
        <p className="text-sm text-gray-600">No document attached.</p>
      )}
      {signature.status === 'signed' ? (
        <p className="text-green-600">You have signed this document on {signature.signedAt?.toDate?.().toLocaleString() || new Date(signature.signedAt).toLocaleString()}</p>
      ) : (
        <button className="btn" disabled={signing} onClick={signDocument}>{signing ? 'Signing…' : 'Sign Document'}</button>
      )}
    </div>
  );
}