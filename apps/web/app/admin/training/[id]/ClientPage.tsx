'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import TrainingModuleForm, {
  type TrainingModuleFormValues,
} from '@/components/training/TrainingModuleForm';
import { db } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';
import { normaliseTrainingModule, type TrainingModuleRecord } from '@/lib/training';

interface AdminTrainingModuleEditPageProps {
  moduleId: string;
}

export default function AdminTrainingModuleEditPage({ moduleId }: AdminTrainingModuleEditPageProps) {
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [module, setModule] = useState<TrainingModuleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const ref = doc(db, 'trainingModules', moduleId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          throw new Error('Module not found');
        }
        if (!active) return;
        setModule(normaliseTrainingModule(snap.id, snap.data()));
      } catch (err) {
        console.error('Failed to load training module', err);
        if (active) {
          setError('Unable to load this module. It may have been deleted.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading, moduleId]);

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p>Loading module details…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p>You do not have permission to edit training modules.</p>
      </PortalContainer>
    );
  }

  if (!module) {
    return (
      <PortalContainer>
        <div className="space-y-3">
          <p>We could not find a module with this ID.</p>
          <button type="button" className="btn" onClick={() => router.push('/admin/training')}>
            Back to training list
          </button>
        </div>
      </PortalContainer>
    );
  }

  const handleSubmit = async (values: TrainingModuleFormValues) => {
    setSubmitting(true);
    setSavedMessage(null);
    setError(null);
    try {
      const ref = doc(db, 'trainingModules', moduleId);
      await updateDoc(ref, {
        ...values,
        updatedAt: serverTimestamp(),
      });
      setSavedMessage('Module updated successfully.');
    } catch (err) {
      console.error('Failed to update training module', err);
      setError('Unable to save changes. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Edit training module</h1>
          <p className="text-sm text-slate-600">Update the content and audience targeting for this learning resource.</p>
        </header>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}
        {savedMessage && (
          <div className="alert alert-success">
            <span>{savedMessage}</span>
          </div>
        )}

        <TrainingModuleForm
          initialValues={module}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/admin/training')}
          submitting={submitting}
          submitLabel="Save changes"
        />
      </div>
    </PortalContainer>
  );
}
