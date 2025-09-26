"use client";
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  orderBy,
  query,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';

type StepField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  profileFieldKey?: string | null;
};

interface Step {
  id: string;
  order: number;
  title: string;
  description: string;
  mediaUrl?: string;
  fields?: StepField[];
  agreementText?: string;
}

export default function JoinTeamPage() {
  const [activeTab, setActiveTab] = useState<'team' | 'franchise'>('team');
  const [teamSteps, setTeamSteps] = useState<Step[]>([]);
  const [franchiseSteps, setFranchiseSteps] = useState<Step[]>([]);
  const [teamCurrent, setTeamCurrent] = useState(0);
  const [franchiseCurrent, setFranchiseCurrent] = useState(0);
  const [teamForm, setTeamForm] = useState<Record<string, string>>({});
  const [franchiseForm, setFranchiseForm] = useState<Record<string, string>>({});
  const [teamAgree, setTeamAgree] = useState(false);
  const [franchiseAgree, setFranchiseAgree] = useState(false);
  const [teamSent, setTeamSent] = useState(false);
  const [franchiseSent, setFranchiseSent] = useState(false);
  const [teamLoading, setTeamLoading] = useState(true);
  const [franchiseLoading, setFranchiseLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [franchiseError, setFranchiseError] = useState<string | null>(null);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [franchiseSubmitting, setFranchiseSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [teamSnap, franchiseSnap] = await Promise.all([
          getDocs(query(collection(db, 'joinTeamSteps'), orderBy('order'))),
          getDocs(query(collection(db, 'franchiseOnboardingSteps'), orderBy('order')))
        ]);

        if (!isMounted) return;

        const mapSteps = (snap: typeof teamSnap) =>
          snap.docs.map((docSnap) => {
            const data = docSnap.data() as Omit<Step, 'id'>;
            return { id: docSnap.id, ...data } satisfies Step;
          });

        setTeamSteps(mapSteps(teamSnap));
        setFranchiseSteps(mapSteps(franchiseSnap));
      } catch (error) {
        console.error('Failed to load application steps', error);
        if (!isMounted) return;
        setTeamError('Unable to load application steps. Please try again later.');
        setFranchiseError('Unable to load franchise onboarding steps. Please try again later.');
      } finally {
        if (isMounted) {
          setTeamLoading(false);
          setFranchiseLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const teamStep = teamSteps[teamCurrent];
  const teamIsLast = teamCurrent === teamSteps.length - 1;
  const franchiseStep = franchiseSteps[franchiseCurrent];
  const franchiseIsLast = franchiseCurrent === franchiseSteps.length - 1;

  const navItems = useMemo(
    () => [
      {
        id: 'team' as const,
        label: 'Apply to Join Team',
        description: 'Start the contractor onboarding process and share your experience.'
      },
      {
        id: 'franchise' as const,
        label: 'Apply for Franchise',
        description: 'Begin the franchise discovery process and complete the onboarding checklist.'
      }
    ],
    []
  );

  const resetAgreementForTab = (tab: 'team' | 'franchise') => {
    if (tab === 'team') {
      setTeamAgree(false);
    } else {
      setFranchiseAgree(false);
    }
  };

  const renderStepFields = (step?: Step, formState?: Record<string, string>, onChange?: (key: string, value: string) => void) => {
    if (!step || !formState || !onChange) return null;
    if (!Array.isArray(step.fields) || step.fields.length === 0) return null;

    return step.fields.map((field) => {
      const handleChange = (value: string) => {
        onChange(field.key, value);
      };

      if (field.type === 'textarea') {
        return (
          <textarea
            key={field.key}
            className="input"
            placeholder={field.label}
            required={field.required}
            value={formState[field.key] || ''}
            onChange={(event) => handleChange(event.target.value)}
          />
        );
      }

      return (
        <input
          key={field.key}
          type={field.type}
          className="input"
          placeholder={field.label}
          required={field.required}
          value={formState[field.key] || ''}
          onChange={(event) => handleChange(event.target.value)}
        />
      );
    });
  };

  const handleTeamSubmit = async () => {
    if (teamSubmitting) return;
    setTeamSubmitting(true);
    try {
      await addDoc(collection(db, 'contractorApplications'), {
        ...teamForm,
        stepIds: teamSteps.map((item) => item.id),
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setTeamSent(true);
    } catch (error) {
      console.error('Failed to submit team application', error);
      setTeamError('We were unable to submit your application. Please try again.');
    } finally {
      setTeamSubmitting(false);
    }
  };

  const handleFranchiseSubmit = async () => {
    if (franchiseSubmitting) return;
    setFranchiseSubmitting(true);
    try {
      await addDoc(collection(db, 'franchiseApplications'), {
        ...franchiseForm,
        stepIds: franchiseSteps.map((item) => item.id),
        status: 'pending',
        onboardingStage: 'discovery',
        createdAt: serverTimestamp()
      });
      setFranchiseSent(true);
    } catch (error) {
      console.error('Failed to submit franchise application', error);
      setFranchiseError('We were unable to submit your franchise application. Please try again.');
    } finally {
      setFranchiseSubmitting(false);
    }
  };

  const renderStep = (
    step: Step | undefined,
    isLast: boolean,
    formState: Record<string, string>,
    onFormChange: (key: string, value: string) => void,
    agree: boolean,
    onAgreeChange: (value: boolean) => void,
    onNext: () => void,
    onBack: () => void,
    onSubmit: () => Promise<void> | void,
    submitting: boolean,
    canGoBack: boolean
  ) => {
    if (!step) return null;

    return (
      <div className="card p-4 grid gap-4">
        <h2 className="text-lg font-semibold">{step.title}</h2>
        {step.mediaUrl && (
          <Image
            src={step.mediaUrl}
            alt={step.title}
            width={640}
            height={360}
            className="h-auto w-full max-h-48 rounded object-cover"
          />
        )}
        <p>{step.description}</p>
        {renderStepFields(step, formState, onFormChange)}
        {step.agreementText && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={agree}
              onChange={(event) => onAgreeChange(event.target.checked)}
              required
            />
            <span>{step.agreementText}</span>
          </label>
        )}
        <div className="flex justify-between">
          <div>
            {canGoBack && (
              <button className="btn btn-outline" onClick={onBack} type="button">
                Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {!isLast && (
              <button className="btn" onClick={onNext} type="button">
                Next
              </button>
            )}
            {isLast && (
              <button
                className="btn"
                disabled={submitting || (step.agreementText ? !agree : false)}
                onClick={async () => {
                  await onSubmit();
                }}
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (activeTab === 'team') {
      if (teamSent) {
        return <p>Thank you for your application. We&apos;ll be in touch!</p>;
      }

      if (teamLoading) {
        return <p>Loading…</p>;
      }

      if (teamError) {
        return <p className="text-red-600">{teamError}</p>;
      }

      if (!teamSteps.length) {
        return <p>No team onboarding steps are configured yet. Please check back soon.</p>;
      }

      return renderStep(
        teamStep,
        teamIsLast,
        teamForm,
        (key, value) => setTeamForm((prev) => ({ ...prev, [key]: value })),
        teamAgree,
        (value) => setTeamAgree(value),
        () => {
          setTeamCurrent((index) => Math.min(teamSteps.length - 1, index + 1));
          resetAgreementForTab('team');
        },
        () => {
          setTeamCurrent((index) => Math.max(0, index - 1));
          resetAgreementForTab('team');
        },
        handleTeamSubmit,
        teamSubmitting,
        teamCurrent > 0
      );
    }

    if (franchiseSent) {
      return (
        <p>
          Thank you for starting your franchise onboarding. We&apos;ve created your request and will follow up with
          next steps shortly.
        </p>
      );
    }

    if (franchiseLoading) {
      return <p>Loading…</p>;
    }

    if (franchiseError) {
      return <p className="text-red-600">{franchiseError}</p>;
    }

    if (!franchiseSteps.length) {
      return (
        <p>
          Franchise onboarding isn&apos;t configured yet. Please contact our team at{' '}
          <a className="link" href="mailto:hello@pineappletapped.com">hello@pineappletapped.com</a> to get started.
        </p>
      );
    }

    return renderStep(
      franchiseStep,
      franchiseIsLast,
      franchiseForm,
      (key, value) => setFranchiseForm((prev) => ({ ...prev, [key]: value })),
      franchiseAgree,
      (value) => setFranchiseAgree(value),
      () => {
        setFranchiseCurrent((index) => Math.min(franchiseSteps.length - 1, index + 1));
        resetAgreementForTab('franchise');
      },
      () => {
        setFranchiseCurrent((index) => Math.max(0, index - 1));
        resetAgreementForTab('franchise');
      },
      handleFranchiseSubmit,
      franchiseSubmitting,
      franchiseCurrent > 0
    );
  };

  return (
    <div className="max-w-2xl mx-auto grid gap-4">
      <h1 className="text-xl font-semibold">Join Pineapple Tapped</h1>
      <nav className="flex flex-wrap gap-2" aria-label="Join team options">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`btn btn-sm ${activeTab === item.id ? '' : 'btn-outline'}`}
            type="button"
            onClick={() => {
              setActiveTab(item.id);
              resetAgreementForTab(item.id);
            }}
            aria-pressed={activeTab === item.id}
          >
            <div className="text-left">
              <div className="font-semibold">{item.label}</div>
              <div className="text-xs font-normal opacity-75">{item.description}</div>
            </div>
          </button>
        ))}
      </nav>
      {renderContent()}
    </div>
  );
}
