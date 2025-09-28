'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import TrainingModuleForm, {
  type TrainingModuleFormValues,
} from '@/components/training/TrainingModuleForm';
import { db } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';

export default function AdminTrainingModuleCreatePage() {
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (guardLoading) {
    return (
      <PortalContainer>
        <p>Checking permissions…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p>You do not have permission to create training modules.</p>
      </PortalContainer>
    );
  }

  const handleSubmit = async (values: TrainingModuleFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, 'trainingModules'), {
        ...values,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        publishedAt: serverTimestamp(),
      });
      router.push(`/admin/training/${ref.id}`);
    } catch (err) {
      console.error('Failed to create training module', err);
      setError('Unable to save this module. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Create a training module</h1>
          <p className="text-sm text-slate-600">
            Outline lessons with video, text, and visual resources to help onboard new franchisees, team members, and clients.
          </p>
        </header>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <TrainingModuleForm
          onSubmit={handleSubmit}
          onCancel={() => router.push('/admin/training')}
          submitting={submitting}
          submitLabel="Create module"
        />
      </div>
    </PortalContainer>
  );
}
