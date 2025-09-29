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

type TerritoryOption = {
  id: string;
  label: string;
  summary: string;
  categoryIds: string[];
};

type CategoryOption = {
  id: string;
  name: string;
};

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
  const [territoryOptions, setTerritoryOptions] = useState<TerritoryOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [franchiseValidationError, setFranchiseValidationError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [teamSnap, franchiseSnap, territorySnap, categorySnap] = await Promise.all([
          getDocs(query(collection(db, 'joinTeamSteps'), orderBy('order'))),
          getDocs(query(collection(db, 'franchiseOnboardingSteps'), orderBy('order'))),
          getDocs(collection(db, 'franchiseTerritories')),
          getDocs(collection(db, 'categories'))
        ]);

        if (!isMounted) return;

        const mapSteps = (snap: typeof teamSnap) =>
          snap.docs.map((docSnap) => {
            const data = docSnap.data() as Omit<Step, 'id'>;
            return { id: docSnap.id, ...data } satisfies Step;
          });

        setTeamSteps(mapSteps(teamSnap));
        setFranchiseSteps(mapSteps(franchiseSnap));

        const mappedTerritories = territorySnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            const franchiseId = typeof data.franchiseId === 'string' ? data.franchiseId.trim() : '';
            const acceptingApplications = data.acceptingApplications === true;
            if (!acceptingApplications) {
              return null;
            }
            if (franchiseId.length > 0) {
              return null;
            }
            const label =
              typeof data.label === 'string' && data.label.trim().length > 0
                ? data.label.trim()
                : 'Available territory';
            const type = typeof data.type === 'string' ? data.type : 'postal';
            let summary = '';
            if (type === 'radius') {
              const radius = typeof data.radiusKm === 'number' ? data.radiusKm : null;
              const lat = typeof data.centerLat === 'number' ? data.centerLat : null;
              const lng = typeof data.centerLng === 'number' ? data.centerLng : null;
              const radiusLabel = radius ? `${radius}km radius` : 'Radius pending';
              const centerLabel = lat != null && lng != null ? `${lat.toFixed(3)}, ${lng.toFixed(3)}` : 'centre TBC';
              summary = `${radiusLabel} from ${centerLabel}`;
            } else {
              const postalCodes = Array.isArray(data.postalCodes) ? data.postalCodes : [];
              summary = `${postalCodes.length} postal code${postalCodes.length === 1 ? '' : 's'}`;
            }
            const categoryIds = Array.isArray(data.categories)
              ? (data.categories as unknown[])
                  .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '')).trim())
                  .filter((value) => value.length > 0)
              : [];
            return {
              id: docSnap.id,
              label,
              summary,
              categoryIds,
            } satisfies TerritoryOption;
          })
          .filter((option): option is TerritoryOption => option !== null)
          .sort((a, b) => a.label.localeCompare(b.label));

        const mappedCategories = categorySnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            const name = typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : docSnap.id;
            return { id: docSnap.id, name } satisfies CategoryOption;
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        setTerritoryOptions(mappedTerritories);
        setCategoryOptions(mappedCategories);
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

  useEffect(() => {
    setSelectedTerritories((prev) => prev.filter((id) => territoryOptions.some((option) => option.id === id)));
  }, [territoryOptions]);

  useEffect(() => {
    setSelectedCategories((prev) => prev.filter((id) => categoryOptions.some((option) => option.id === id)));
  }, [categoryOptions]);

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

  const territoryMap = useMemo(() => {
    const map = new Map<string, TerritoryOption>();
    territoryOptions.forEach((option) => map.set(option.id, option));
    return map;
  }, [territoryOptions]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, CategoryOption>();
    categoryOptions.forEach((option) => map.set(option.id, option));
    return map;
  }, [categoryOptions]);

  const resetAgreementForTab = (tab: 'team' | 'franchise') => {
    if (tab === 'team') {
      setTeamAgree(false);
    } else {
      setFranchiseAgree(false);
      setFranchiseValidationError(null);
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
    const territorySelectionRequired = territoryOptions.length > 0;
    if (territorySelectionRequired && selectedTerritories.length === 0) {
      setFranchiseValidationError('Please choose at least one territory you would like to service.');
      return;
    }
    setFranchiseSubmitting(true);
    setFranchiseValidationError(null);
    try {
      const selectedTerritoryLabels = selectedTerritories.map(
        (id) => territoryMap.get(id)?.label ?? id
      );
      const selectedCategoryLabels = selectedCategories.map(
        (id) => categoryMap.get(id)?.name ?? id
      );
      await addDoc(collection(db, 'franchiseApplications'), {
        ...franchiseForm,
        stepIds: franchiseSteps.map((item) => item.id),
        status: 'pending',
        onboardingStage: 'discovery',
        preferredTerritoryIds: selectedTerritories,
        preferredTerritoryLabels: selectedTerritoryLabels,
        preferredCategoryIds: selectedCategories,
        preferredCategoryLabels: selectedCategoryLabels,
        createdAt: serverTimestamp()
      });
      setFranchiseSent(true);
      setSelectedTerritories([]);
      setSelectedCategories([]);
      setFranchiseValidationError(null);
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
    canGoBack: boolean,
    submitEnabled = true
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
                disabled={
                  submitting ||
                  !submitEnabled ||
                  (step.agreementText ? !agree : false)
                }
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

  const toggleTerritory = (id: string) => {
    setSelectedTerritories((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      return [...prev, id];
    });
    setFranchiseValidationError(null);
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      return [...prev, id];
    });
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

    const territorySelectionRequired = territoryOptions.length > 0;
    const submitEnabled = !territorySelectionRequired || selectedTerritories.length > 0;

    const territoryCard = (
      <section className="card grid gap-3 p-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Tell us where you&apos;d like to operate</h2>
          <p className="text-sm text-gray-600">
            Choose the franchise territories you&apos;re interested in so we can prioritise them during review.
          </p>
        </div>
        {territoryOptions.length === 0 ? (
          <p className="text-sm text-gray-500">
            We don&apos;t have any open territories right now. Submit your application and we&apos;ll reach out as new regions
            launch.
          </p>
        ) : (
          <div className="grid gap-2">
            {territoryOptions.map((option) => {
              const selected = selectedTerritories.includes(option.id);
              const territoryCategories = option.categoryIds
                .map((categoryId) => categoryMap.get(categoryId)?.name ?? categoryId)
                .filter((name) => name.length > 0);
              const baseClasses = 'flex items-start gap-3 rounded border p-3 transition';
              const stateClasses = selected
                ? ' border-blue-500 bg-blue-50'
                : ' border-neutral-200 hover:border-blue-300';
              return (
                <label key={option.id} className={`${baseClasses}${stateClasses}`}>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={selected}
                    onChange={() => toggleTerritory(option.id)}
                  />
                  <div className="grid gap-1">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-gray-600">{option.summary}</span>
                    {territoryCategories.length > 0 && (
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Services: {territoryCategories.join(', ')}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>
    );

    const categoryCard = (
      <section className="card grid gap-3 p-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Services you&apos;d like to lead</h2>
          <p className="text-sm text-gray-600">
            Highlight the service areas you want to champion so we can tailor resources and mentoring.
          </p>
        </div>
        {categoryOptions.length === 0 ? (
          <p className="text-sm text-gray-500">
            We&apos;ll cover services during your discovery call so you can tailor the offering to your market.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((option) => {
              const selected = selectedCategories.includes(option.id);
              const baseClasses = 'rounded-full px-3 py-1 text-sm transition';
              const stateClasses = selected
                ? ' bg-blue-600 text-white'
                : ' bg-gray-100 text-gray-700 hover:bg-gray-200';
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`${baseClasses}${stateClasses}`}
                  onClick={() => toggleCategory(option.id)}
                >
                  {option.name}
                </button>
              );
            })}
          </div>
        )}
      </section>
    );

    return (
      <div className="grid gap-4">
        {territoryCard}
        {categoryCard}
        {territorySelectionRequired && franchiseValidationError && (
          <p className="text-sm text-red-600">{franchiseValidationError}</p>
        )}
        {renderStep(
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
          franchiseCurrent > 0,
          submitEnabled
        )}
      </div>
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
