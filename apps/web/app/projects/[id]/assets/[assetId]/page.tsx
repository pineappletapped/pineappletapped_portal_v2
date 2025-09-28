
'use client';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import Link from 'next/link';
import AssetReleaseBadge, { getAssetReleaseMeta } from '@/components/AssetReleaseBadge';

export default function AssetView({ params }: { params: { id: string, assetId: string } }) {
  const [asset, setAsset] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);

  // Allow users to switch between common aspect ratios for the video review. Default to 16:9.
  const [aspect, setAspect] = useState<string>('16:9');
  // Toggle watermark overlay; for now default true. Could be controlled via asset/project settings.
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(true);

  useEffect(()=>{
    (async()=>{
      const a = await getDoc(doc(db, 'assets', params.assetId));
      setAsset({ id: a.id, ...a.data() });
      const cq = query(collection(db,'comments'), where('assetId','==', params.assetId));
      const cs = await getDocs(cq);
      setComments(
        cs.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => (a.timecodeSeconds || 0) - (b.timecodeSeconds || 0))
      );
      // Load thumbnail and proxy if available
      const ad = a.data() as any;
      if (ad?.thumbnailKey) {
        try {
          const url = await getDownloadURL(ref(storage, ad.thumbnailKey));
          setThumbUrl(url);
        } catch (err) {
          console.error('Error loading thumbnail', err);
        }
      }
      if (ad?.proxyKey) {
        try {
          const url = await getDownloadURL(ref(storage, ad.proxyKey));
          setProxyUrl(url);
        } catch (err) {
          console.error('Error loading proxy', err);
        }
      }
    })();
  },[params.assetId]);

  const addComment = async () => {
    const t = videoRef.current?.currentTime || 0;
    await addDoc(collection(db, 'comments'), {
      assetId: params.assetId,
      body: note,
      timecodeSeconds: Math.round(t*1000)/1000,
      createdAt: serverTimestamp()
    });
    setNote('');
    // refresh
    const cq = query(collection(db,'comments'), where('assetId','==', params.assetId));
    const cs = await getDocs(cq);
    setComments(
      cs.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (a.timecodeSeconds || 0) - (b.timecodeSeconds || 0))
    );
  };

  // Send unresolved comments as a revision summary via Cloud Function
  const sendSummary = async () => {
    try {
      const call = httpsCallable(functions, 'sendRevisionSummary');
      await call({ assetId: params.assetId });
      alert('Revision summary packaged and sent');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error packaging revisions');
    }
  };

  // Mark comment as resolved
  const resolveComment = async (commentId: string) => {
    await updateDoc(doc(db, 'comments', commentId), {
      resolved: true,
      resolvedAt: serverTimestamp(),
    });
    // reload comments
    const cq = query(collection(db,'comments'), where('assetId','==', params.assetId));
    const cs = await getDocs(cq);
    setComments(
      cs.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (a.timecodeSeconds || 0) - (b.timecodeSeconds || 0))
    );
  };

  // Update asset status
  const updateStatus = async (newStatus: string) => {
    if (!asset) return;
    setStatusUpdating(true);
    try {
      await updateDoc(doc(db, 'assets', asset.id), {
        status: newStatus,
        statusUpdatedAt: serverTimestamp(),
      });
      setAsset({ ...asset, status: newStatus });
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error updating status');
    } finally {
      setStatusUpdating(false);
    }
  };

  // Upload a license PDF/metadata and link to this asset
  const uploadLicense = async () => {
    if (!licenseFile || !asset) return;
    setLicenseUploading(true);
    try {
      const storagePath = `orgs/${asset.orgId}/projects/${asset.projectId}/licenses/${licenseFile.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, licenseFile);
      const url = await getDownloadURL(storageRef);
      const licRef = await addDoc(collection(db,'licenses'), {
        assetId: asset.id,
        name: licenseFile.name,
        path: storagePath,
        url,
        uploadedAt: serverTimestamp(),
        uploadedBy: auth.currentUser?.uid || null,
      });
      await updateDoc(doc(db, 'assets', asset.id), { licenseId: licRef.id });
      alert('License uploaded');
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error uploading license');
    } finally {
      setLicenseUploading(false);
      setLicenseFile(null);
    }
  };

  const releaseMeta = useMemo(() => (asset ? getAssetReleaseMeta(asset) : null), [asset]);
  const releaseDescription = releaseMeta?.description ||
    (!asset?.deliverablesReleased
      ? 'Downloads will unlock automatically once the asset is approved and the outstanding balance has been marked as paid.'
      : null);

  if (!asset) return <div>Loading…</div>;

  return (
    <div className="grid gap-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{asset.name || 'Asset'}</h1>
          <AssetReleaseBadge asset={asset} />
        </div>
        {/* Status & actions */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <span className="font-medium text-gray-900">Status:</span>
          <span className="font-semibold text-gray-900">{asset.status || 'draft'}</span>
          <div className="flex flex-wrap gap-2 text-xs">
          <button className="btn-sm" disabled={statusUpdating} onClick={() => updateStatus('changes_requested')}>Request Changes</button>
          <button className="btn-sm" disabled={statusUpdating} onClick={() => updateStatus('approved')}>Approve</button>
          <button className="btn-sm" disabled={statusUpdating} onClick={() => updateStatus('final')}>Final Approve</button>
        </div>
        </div>
      </header>
      {/* Media display: handle video with aspect ratio and watermark, or image/pdf link */}
      <div className="flex flex-col gap-2">
        {asset.mime?.startsWith('video/') ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="aspect-select" className="font-medium">Aspect ratio:</label>
              <select id="aspect-select" className="input w-fit" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="2:3">2:3</option>
              </select>
            </div>
            <div className="relative w-full rounded-lg border overflow-hidden" style={{ aspectRatio: aspect.replace(':','/') }}>
              {proxyUrl ? (
                <video ref={videoRef} src={proxyUrl} controls className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <video ref={videoRef} src={asset.url} controls className="absolute inset-0 w-full h-full object-cover" />
              )}
              {watermarkEnabled && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-white text-4xl md:text-5xl font-bold opacity-20 select-none">Pineapple Tapped</span>
                </div>
              )}
            </div>
          </>
        ) : (
          thumbUrl ? (
            <Image
              src={thumbUrl}
              alt="Asset thumbnail"
              width={640}
              height={360}
              className="w-full max-w-md rounded-lg border object-cover"
            />
          ) : (
            <a href={asset.url} className="text-orange underline">Open file</a>
          )
        )}
      </div>

      {/* License upload */}
      <div className="card p-4">
        <h2 className="font-semibold mb-2">License</h2>
        {asset.licenseId ? (
          <p>License attached. <Link href={`/licenses/${asset.licenseId}`}>View</Link></p>
        ) : (
          <div>
            <input type="file" accept="application/pdf" onChange={e => setLicenseFile(e.target.files?.[0] || null)} />
            <button className="btn-sm ml-2" disabled={licenseUploading || !licenseFile} onClick={uploadLicense}>
              {licenseUploading ? 'Uploading…' : 'Upload License'}
            </button>
          </div>
        )}
      </div>

      {/* Final Deliverable Download */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Final Deliverable</h2>
          <AssetReleaseBadge asset={asset} />
        </div>
        {releaseDescription && (
          <p className="text-sm text-gray-600">{releaseDescription}</p>
        )}
        {asset.deliverablesReleased ? (
          <div className="flex flex-wrap gap-2">
            {downloadUrl ? (
              <a href={downloadUrl} target="_blank" rel="noopener" className="btn-sm">
                Download
              </a>
            ) : (
              <button
                className="btn-sm"
                onClick={async () => {
                  try {
                    const call = httpsCallable(functions, 'getDownloadUrl');
                    const res: any = await call({ key: asset.storageKey });
                    setDownloadUrl(res.data.url);
                  } catch (err:any) {
                    console.error(err);
                    alert(err.message || 'Error generating download link');
                  }
                }}
              >
                Get Download Link
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600">Downloads are currently locked.</p>
        )}
      </div>

      <div className="grid gap-2">
        <h2 className="font-semibold">Timecoded Comments</h2>
        <div className="flex gap-2">
          <input className="input" placeholder="Write a note…" value={note} onChange={e=>setNote(e.target.value)} />
          <button className="btn" onClick={addComment}>Add @ current time</button>
        </div>
        <div className="grid gap-2">
          {comments.map(c => (
            <div key={c.id} className="card p-2">
              <div className="text-xs text-gray-500 flex justify-between items-center">
                <span>{(c.timecodeSeconds||0).toFixed(3)}s</span>
                {c.resolved ? (
                  <span className="text-green-600">Resolved</span>
                ) : (
                  <button className="text-blue-600 text-xs underline" onClick={() => resolveComment(c.id)}>Resolve</button>
                )}
              </div>
              <div>{c.body}</div>
            </div>
          ))}
          {/* Button to package unresolved revision requests and send summary */}
          {comments.length > 0 && (
            <button className="btn mt-3 w-fit" onClick={sendSummary}>Send Revision Summary</button>
          )}
        </div>
      </div>
    </div>
  );
}
