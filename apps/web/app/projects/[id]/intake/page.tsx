"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage, auth } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Link from 'next/link';

/**
 * Project Intake Form page.
 *
 * After an order is paid and a project is created, clients complete an intake
 * form defined by the service's `intakeSchema`. Each schema entry may define
 * a text, textarea, date, select or file input. On submission, answers and
 * uploaded files are stored in an `intakeSubmissions` document keyed by the
 * project id. The project status is updated to `intake_submitted`.
 */
export default function ProjectIntakePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<any>(null);
  const [service, setService] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fileData, setFileData] = useState<Record<string, File | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const projId = params?.id;
    if (!projId) return;
    (async () => {
      try {
        const pSnap = await getDoc(doc(db, 'projects', projId));
        if (!pSnap.exists()) return;
        const pData = { id: pSnap.id, ...pSnap.data() } as any;
        setProject(pData);
        // load service for intake schema
        const sSnap = await getDoc(doc(db, 'products', pData.serviceId));
        if (sSnap.exists()) setService({ id: sSnap.id, ...sSnap.data() });
      } catch (err) {
        console.error(err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [params]);

  const handleChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  const handleFileChange = (name: string, file: File | null) => {
    setFileData((prev) => ({ ...prev, [name]: file }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !service) return;
    setSubmitting(true);
    try {
      const answers: Record<string, any> = {};
      // Upload files if present
      for (const field of service.intakeSchema || []) {
        const fname = field.name;
        if (field.type === 'file') {
          const file = fileData[fname];
          if (file) {
            const storagePath = `orgs/${project.orgId}/projects/${project.id}/intake/${fname}/${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            answers[fname] = { name: file.name, path: storagePath, url };
          } else if (field.required) {
            alert(`Please upload required file for ${field.label || fname}`);
            setSubmitting(false);
            return;
          }
        } else {
          const val = formData[fname] || '';
          if (field.required && !val) {
            alert(`Please provide a value for ${field.label || fname}`);
            setSubmitting(false);
            return;
          }
          answers[fname] = val;
        }
      }
      // Save intake submission
      const user = auth.currentUser;
      await setDoc(doc(db, 'intakeSubmissions', project.id), {
        projectId: project.id,
        serviceId: project.serviceId,
        orgId: project.orgId,
        userId: user?.uid || null,
        answers,
        createdAt: serverTimestamp(),
      }, { merge: true });
      // Update project status
      await updateDoc(doc(db, 'projects', project.id), {
        status: 'intake_submitted',
        intakeSubmittedAt: serverTimestamp(),
      });
      router.push(`/projects/${project.id}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error submitting intake');
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded) return <p>Loading…</p>;
  if (!project || !service) return <p>Project or service not found.</p>;
  // If project already submitted intake
  if (project.status && project.status !== 'intake') {
    return (
      <div>
        <h1 className="text-xl font-semibold">Intake Submitted</h1>
        <p>The intake form has already been completed for this project.</p>
        <Link href={`/projects/${project.id}`} className="btn mt-4">Back to Project</Link>
      </div>
    );
  }
  const schema = service.intakeSchema || [];
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Project Intake</h1>
      <form onSubmit={handleSubmit} className="grid gap-4">
        {schema.length === 0 && <p>No intake questions defined for this service.</p>}
        {schema.map((field: any) => {
          const fname = field.name;
          const label = field.label || fname;
          const type = field.type || 'text';
          const required = field.required || false;
          if (type === 'textarea') {
            return (
              <div key={fname}>
                <label className="block mb-1 font-medium text-sm" htmlFor={fname}>{label}{required && ' *'}</label>
                <textarea
                  id={fname}
                  className="input w-full h-28"
                  value={formData[fname] || ''}
                  onChange={e => handleChange(fname, e.target.value)}
                />
              </div>
            );
          }
          if (type === 'select' && Array.isArray(field.options)) {
            return (
              <div key={fname}>
                <label className="block mb-1 font-medium text-sm" htmlFor={fname}>{label}{required && ' *'}</label>
                <select
                  id={fname}
                  className="input w-full"
                  value={formData[fname] || ''}
                  onChange={e => handleChange(fname, e.target.value)}
                >
                  <option value="">Select…</option>
                  {field.options.map((opt: any) => (
                    <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>
                  ))}
                </select>
              </div>
            );
          }
          if (type === 'date') {
            return (
              <div key={fname}>
                <label className="block mb-1 font-medium text-sm" htmlFor={fname}>{label}{required && ' *'}</label>
                <input
                  type="date"
                  id={fname}
                  className="input w-full"
                  value={formData[fname] || ''}
                  onChange={e => handleChange(fname, e.target.value)}
                />
              </div>
            );
          }
          if (type === 'file') {
            return (
              <div key={fname}>
                <label className="block mb-1 font-medium text-sm" htmlFor={fname}>{label}{required && ' *'}</label>
                <input
                  type="file"
                  id={fname}
                  className="input w-full"
                  accept={field.accept || '*/*'}
                  onChange={e => handleFileChange(fname, e.target.files?.[0] || null)}
                />
              </div>
            );
          }
          // default to text
          return (
            <div key={fname}>
              <label className="block mb-1 font-medium text-sm" htmlFor={fname}>{label}{required && ' *'}</label>
              <input
                type="text"
                id={fname}
                className="input w-full"
                value={formData[fname] || ''}
                onChange={e => handleChange(fname, e.target.value)}
              />
            </div>
          );
        })}
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit Intake'}
        </button>
      </form>
    </div>
  );
}