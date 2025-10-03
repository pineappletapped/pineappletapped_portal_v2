"use client";
import Image from 'next/image';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type: 'postal' | 'radius';
  centerLat: number | null;
  centerLng: number | null;
  postalCodes: string[];
};

type CategoryOption = {
  id: string;
  name: string;
};

const normalisePostalCodeValue = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const deriveOutcodeCandidates = (value: string): string[] => {
  const normalised = normalisePostalCodeValue(value);
  if (!normalised) {
    return [];
  }

  const candidates = new Set<string>();
  for (let length = Math.max(2, normalised.length - 3); length >= 2; length -= 1) {
    const candidate = normalised.slice(0, length);
    if (/^[A-Z]{1,2}\d[A-Z0-9]?$/.test(candidate) || candidate.length >= 3) {
      candidates.add(candidate);
    }
  }

  return Array.from(candidates);
};

const haversineDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = 6371 * c;
  return Number.isFinite(distance) ? distance : Number.NaN;
};

interface MarketerFormState {
  fullName: string;
  email: string;
  phone: string;
  preferredChannel: string;
  company: string;
  vatNumber: string;
  address: string;
  website: string;
  socialProfiles: string;
  niches: string;
  audienceSize: string;
  experience: string;
  notes: string;
  bankAccountName: string;
  bankName: string;
  sortCode: string;
  accountNumber: string;
  proofUrl: string;
}

type VatStatus = 'registered' | 'not_registered' | 'unsure';

interface MarketerConsentState {
  gdpr: boolean;
  terms: boolean;
  marketing: boolean;
  vatStatus: VatStatus;
}

const initialMarketerForm: MarketerFormState = {
  fullName: '',
  email: '',
  phone: '',
  preferredChannel: 'email',
  company: '',
  vatNumber: '',
  address: '',
  website: '',
  socialProfiles: '',
  niches: '',
  audienceSize: '',
  experience: '',
  notes: '',
  bankAccountName: '',
  bankName: '',
  sortCode: '',
  accountNumber: '',
  proofUrl: '',
};

const initialMarketerConsent: MarketerConsentState = {
  gdpr: false,
  terms: false,
  marketing: false,
  vatStatus: 'unsure',
};

export default function JoinTeamPage() {
  const [activeTab, setActiveTab] = useState<'team' | 'franchise' | 'marketer'>('team');
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
  const [postcodeInput, setPostcodeInput] = useState('');
  const [postcodeLookupStatus, setPostcodeLookupStatus] = useState<'idle' | 'loading' | 'success' | 'notfound' | 'error'>('idle');
  const [postcodeLookupError, setPostcodeLookupError] = useState<string | null>(null);
  const [postcodeLookupResult, setPostcodeLookupResult] = useState<
    | {
        raw: string;
        normalised: string;
        resolved: string;
        lat: number | null;
        lng: number | null;
      }
    | null
  >(null);
  const [territorySuggestions, setTerritorySuggestions] = useState<Array<{ id: string; distanceKm: number | null }>>([]);
  const postalCodeLocationCache = useRef(new Map<string, { lat: number | null; lng: number | null; resolved?: string }>());
  const [marketerForm, setMarketerForm] = useState<MarketerFormState>(initialMarketerForm);
  const [marketerConsent, setMarketerConsent] = useState<MarketerConsentState>(initialMarketerConsent);
  const [marketerSubmitting, setMarketerSubmitting] = useState(false);
  const [marketerSent, setMarketerSent] = useState(false);
  const [marketerError, setMarketerError] = useState<string | null>(null);

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
              type: type === 'radius' ? 'radius' : 'postal',
              centerLat: typeof data.centerLat === 'number' ? data.centerLat : null,
              centerLng: typeof data.centerLng === 'number' ? data.centerLng : null,
              postalCodes: Array.isArray(data.postalCodes)
                ? (data.postalCodes as unknown[])
                    .map((value) => (typeof value === 'string' ? value : String(value ?? '')).trim())
                    .filter((value) => value.length > 0)
                : typeof data.postalCodes === 'string'
                ? data.postalCodes
                    .split(/\r?\n|,/)
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0)
                : [],
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
      },
      {
        id: 'marketer' as const,
        label: 'Affiliate Marketer',
        description: 'Earn 50% of HQ commission by referring new Pineapple Tapped clients.'
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

  useEffect(() => {
    setTerritorySuggestions((prev) => prev.filter((suggestion) => territoryMap.has(suggestion.id)));
    setSelectedTerritories((prev) => prev.filter((id) => territoryMap.has(id)));
  }, [territoryMap]);

  const geocodePostalCode = useCallback(
    async (
      postalCode: string
    ): Promise<{ lat: number | null; lng: number | null; normalised: string; resolved: string } | null> => {
      const normalised = normalisePostalCodeValue(postalCode);
      if (!normalised) {
        return null;
      }
      const cached = postalCodeLocationCache.current.get(normalised);
      if (cached) {
        return {
          lat: cached.lat ?? null,
          lng: cached.lng ?? null,
          normalised,
          resolved: cached.resolved ?? normalised,
        };
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(normalised)}`,
          {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            result?: { latitude?: number; longitude?: number; postcode?: string } | null;
          };
          const latitude = typeof payload?.result?.latitude === 'number' ? payload.result.latitude : null;
          const longitude = typeof payload?.result?.longitude === 'number' ? payload.result.longitude : null;
          const resolved = typeof payload?.result?.postcode === 'string' ? payload.result.postcode : normalised;
          postalCodeLocationCache.current.set(normalised, { lat: latitude, lng: longitude, resolved });
          return { lat: latitude, lng: longitude, normalised, resolved };
        }

        if (response.status !== 404) {
          throw new Error(`Lookup failed with status ${response.status}`);
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          throw new Error('Lookup timed out');
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }

      const outcodeCandidates = deriveOutcodeCandidates(normalised);
      for (const candidate of outcodeCandidates) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 7000);
        try {
          const response = await fetch(
            `https://api.postcodes.io/outcodes/${encodeURIComponent(candidate)}`,
            {
              headers: { Accept: 'application/json' },
              signal: controller.signal,
            }
          );
          if (!response.ok) {
            continue;
          }
          const payload = (await response.json()) as {
            result?: { latitude?: number; longitude?: number; outcode?: string } | null;
          };
          const latitude = typeof payload?.result?.latitude === 'number' ? payload.result.latitude : null;
          const longitude = typeof payload?.result?.longitude === 'number' ? payload.result.longitude : null;
          const resolved = typeof payload?.result?.outcode === 'string' ? payload.result.outcode : candidate;
          if (latitude != null && longitude != null) {
            postalCodeLocationCache.current.set(normalised, { lat: latitude, lng: longitude, resolved });
            return { lat: latitude, lng: longitude, normalised, resolved };
          }
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') {
            throw new Error('Lookup timed out');
          }
          throw error;
        } finally {
          window.clearTimeout(timeoutId);
        }
      }

      const resolved = outcodeCandidates.length > 0 ? outcodeCandidates[0] : normalised;
      postalCodeLocationCache.current.set(normalised, { lat: null, lng: null, resolved });
      return { lat: null, lng: null, normalised, resolved };
    },
    []
  );

  const computeTerritoryDistance = useCallback(
    async (
      option: TerritoryOption,
      reference: { lat: number | null; lng: number | null; normalised: string }
    ): Promise<number | null> => {
      if (
        reference.lat != null &&
        reference.lng != null &&
        option.type === 'radius' &&
        option.centerLat != null &&
        option.centerLng != null
      ) {
        const distance = haversineDistanceKm(reference.lat, reference.lng, option.centerLat, option.centerLng);
        return Number.isFinite(distance) ? distance : null;
      }
      if (!option.postalCodes.length) {
        return null;
      }
      let bestDistance: number | null = null;
      for (const rawCode of option.postalCodes) {
        const code = normalisePostalCodeValue(rawCode);
        if (!code) {
          continue;
        }
        let location = postalCodeLocationCache.current.get(code);
        if (!location) {
          const lookup = await geocodePostalCode(code);
          if (!lookup) {
            continue;
          }
          location = { lat: lookup.lat, lng: lookup.lng, resolved: lookup.resolved };
          postalCodeLocationCache.current.set(code, location);
        }
        if (reference.lat != null && reference.lng != null && location.lat != null && location.lng != null) {
          const distance = haversineDistanceKm(reference.lat, reference.lng, location.lat, location.lng);
          if (Number.isFinite(distance)) {
            bestDistance = bestDistance == null ? distance : Math.min(bestDistance, distance);
          }
        }
      }
      if (bestDistance != null) {
        return bestDistance;
      }
      const inputCode = reference.normalised;
      const hasTextMatch = option.postalCodes
        .map((value) => normalisePostalCodeValue(value))
        .filter((value) => value.length > 0)
        .some((code) => code === inputCode || inputCode.startsWith(code) || code.startsWith(inputCode));
      return hasTextMatch ? 0 : null;
    },
    [geocodePostalCode]
  );

  const handlePostcodeLookup = useCallback(async () => {
    if (territoryOptions.length === 0) {
      setPostcodeLookupStatus('error');
      setPostcodeLookupError('We don\'t have any franchise territories open right now.');
      setPostcodeLookupResult(null);
      setTerritorySuggestions([]);
      setSelectedTerritories([]);
      return;
    }
    const trimmed = postcodeInput.trim();
    if (!trimmed) {
      setPostcodeLookupStatus('error');
      setPostcodeLookupError('Please enter a postcode to search for nearby territories.');
      setPostcodeLookupResult(null);
      setTerritorySuggestions([]);
      setSelectedTerritories([]);
      return;
    }
    setPostcodeLookupStatus('loading');
    setPostcodeLookupError(null);
    try {
      const lookup = (await geocodePostalCode(trimmed)) ?? {
        lat: null,
        lng: null,
        normalised: normalisePostalCodeValue(trimmed),
        resolved: normalisePostalCodeValue(trimmed),
      };

      if (!lookup.normalised) {
        setPostcodeLookupStatus('error');
        setPostcodeLookupError('Please enter a valid postcode to search for nearby territories.');
        setPostcodeLookupResult(null);
        setTerritorySuggestions([]);
        setSelectedTerritories([]);
        return;
      }

      setPostcodeLookupResult({
        raw: trimmed,
        normalised: lookup.normalised,
        resolved: lookup.resolved,
        lat: lookup.lat,
        lng: lookup.lng,
      });

      const distanceResults = await Promise.all(
        territoryOptions.map(async (option) => {
          const distanceKm = await computeTerritoryDistance(option, lookup);
          return { id: option.id, distanceKm };
        })
      );

      const withDistance = distanceResults
        .filter((item) => item.distanceKm != null && Number.isFinite(item.distanceKm))
        .map((item) => ({ id: item.id, distanceKm: item.distanceKm as number }))
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const withoutDistance = distanceResults
        .filter((item) => item.distanceKm == null || !Number.isFinite(item.distanceKm))
        .map((item) => ({ id: item.id, distanceKm: null }))
        .sort((a, b) => {
          const aLabel = territoryMap.get(a.id)?.label ?? '';
          const bLabel = territoryMap.get(b.id)?.label ?? '';
          return aLabel.localeCompare(bLabel);
        });

      const combined = [...withDistance, ...withoutDistance].slice(0, 3);
      setTerritorySuggestions(combined);
      setSelectedTerritories((prev) => prev.filter((id) => combined.some((item) => item.id === id)));
      setPostcodeLookupStatus('success');
      setFranchiseValidationError(null);
    } catch (error) {
      console.error('Postcode lookup failed', error);
      setPostcodeLookupStatus('error');
      setPostcodeLookupError('We were unable to search for nearby territories. Please try again.');
      setPostcodeLookupResult(null);
      setTerritorySuggestions([]);
      setSelectedTerritories([]);
    }
  }, [
    computeTerritoryDistance,
    geocodePostalCode,
    postcodeInput,
    territoryMap,
    territoryOptions,
  ]);

  const resetAgreementForTab = (tab: 'team' | 'franchise' | 'marketer') => {
    if (tab === 'team') {
      setTeamAgree(false);
    } else if (tab === 'franchise') {
      setFranchiseAgree(false);
      setFranchiseValidationError(null);
    }
    if (tab === 'marketer') {
      setMarketerError(null);
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
    if (territorySelectionRequired && postcodeLookupStatus === 'idle') {
      setFranchiseValidationError('Enter your postcode so we can suggest territories before submitting.');
      return;
    }
    if (territorySelectionRequired && territorySuggestions.length > 0 && selectedTerritories.length === 0) {
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
      const trimmedPostcode = postcodeInput.trim();
      const normalisedPostcode = trimmedPostcode ? normalisePostalCodeValue(trimmedPostcode) : '';
      const suggestionIds = territorySuggestions.map((item) => item.id);
      const suggestionLabels = territorySuggestions.map((item) => territoryMap.get(item.id)?.label ?? item.id);
      const suggestionDistances = territorySuggestions.map((item) =>
        item.distanceKm != null && Number.isFinite(item.distanceKm) ? item.distanceKm : null
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
        searchPostalCode: postcodeLookupResult?.raw ?? (trimmedPostcode || null),
        searchPostalCodeNormalised:
          postcodeLookupResult?.normalised ?? (normalisedPostcode ? normalisedPostcode : null),
        searchPostalCodeResolved: postcodeLookupResult?.resolved ?? null,
        searchPostalCodeLat: postcodeLookupResult?.lat ?? null,
        searchPostalCodeLng: postcodeLookupResult?.lng ?? null,
        territorySuggestionIds: suggestionIds,
        territorySuggestionLabels: suggestionLabels,
        territorySuggestionDistancesKm: suggestionDistances,
        createdAt: serverTimestamp()
      });
      setFranchiseSent(true);
      setSelectedTerritories([]);
      setSelectedCategories([]);
      setTerritorySuggestions([]);
      setPostcodeLookupResult(null);
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

  const handleMarketerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (marketerSubmitting) return;

    const trimmedName = marketerForm.fullName.trim();
    const trimmedEmail = marketerForm.email.trim().toLowerCase();
    if (!trimmedName) {
      setMarketerError('Please provide your full name.');
      return;
    }
    if (!trimmedEmail) {
      setMarketerError('Please provide an email address so we can respond.');
      return;
    }
    if (!marketerConsent.gdpr || !marketerConsent.terms) {
      setMarketerError('Please confirm consent to GDPR processing and the affiliate agreement.');
      return;
    }

    setMarketerSubmitting(true);
    setMarketerError(null);
    try {
      await addDoc(collection(db, 'affiliateApplications'), {
        fullName: trimmedName,
        email: trimmedEmail,
        phone: marketerForm.phone.trim() || null,
        preferredChannel: marketerForm.preferredChannel,
        company: marketerForm.company.trim() || null,
        vatNumber: marketerForm.vatNumber.trim() || null,
        postalAddress: marketerForm.address.trim() || null,
        website: marketerForm.website.trim() || null,
        socialProfiles: marketerForm.socialProfiles.trim() || null,
        niches: marketerForm.niches.trim() || null,
        audienceSize: marketerForm.audienceSize.trim() || null,
        experience: marketerForm.experience.trim() || null,
        notes: marketerForm.notes.trim() || null,
        proofUrl: marketerForm.proofUrl.trim() || null,
        payoutDetails: {
          accountName: marketerForm.bankAccountName.trim() || null,
          bankName: marketerForm.bankName.trim() || null,
          sortCode: marketerForm.sortCode.trim() || null,
          accountNumber: marketerForm.accountNumber.trim() || null,
        },
        compliance: {
          gdprConsent: marketerConsent.gdpr,
          agreementAccepted: marketerConsent.terms,
          marketingConsent: marketerConsent.marketing,
          vatStatus: marketerConsent.vatStatus,
        },
        locale: 'uk',
        programme: 'affiliate',
        status: 'pending_review',
        stage: 'submitted',
        source: 'join-team-marketer',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setMarketerSent(true);
      setMarketerForm(initialMarketerForm);
      setMarketerConsent(initialMarketerConsent);
    } catch (error) {
      console.error('Failed to submit affiliate application', error);
      setMarketerError('We were unable to submit your details. Please try again.');
    } finally {
      setMarketerSubmitting(false);
    }
  };

  const renderMarketerContent = () => {
    if (marketerSent) {
      return (
        <div className="grid gap-2">
          <p className="font-semibold">Thanks for applying to join the affiliate programme!</p>
          <p className="text-sm text-gray-600">
            Our marketing operations team will review your application within five business days. We&apos;ll reach out via your
            preferred contact channel with next steps and your personalised referral toolkit.
          </p>
        </div>
      );
    }

    return (
      <form className="grid gap-4" onSubmit={handleMarketerSubmit}>
        <section className="card grid gap-3 p-4">
          <header className="grid gap-1">
            <h2 className="text-lg font-semibold">Tell us about you</h2>
            <p className="text-sm text-gray-600">
              We partner with UK-based social media managers and marketers. Share your details so we can tailor the onboarding.
            </p>
          </header>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              value={marketerForm.fullName}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, fullName: event.target.value }))}
              placeholder="Full name *"
              autoComplete="name"
              required
            />
            <input
              className="input"
              value={marketerForm.email}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="Email *"
              autoComplete="email"
              type="email"
              required
            />
            <input
              className="input"
              value={marketerForm.phone}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, phone: event.target.value }))}
              placeholder="Phone"
              autoComplete="tel"
            />
            <div className="grid gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">Preferred contact</label>
              <select
                className="input"
                value={marketerForm.preferredChannel}
                onChange={(event) => setMarketerForm((prev) => ({ ...prev, preferredChannel: event.target.value }))}
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </div>
          <textarea
            className="input"
            value={marketerForm.experience}
            onChange={(event) => setMarketerForm((prev) => ({ ...prev, experience: event.target.value }))}
            placeholder="Tell us about your marketing experience and niche focus *"
            rows={4}
            required
          />
        </section>

        <section className="card grid gap-3 p-4">
          <header className="grid gap-1">
            <h2 className="text-lg font-semibold">Business profile</h2>
            <p className="text-sm text-gray-600">
              Provide optional business and audience context so we can match you with the right campaigns.
            </p>
          </header>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              value={marketerForm.company}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, company: event.target.value }))}
              placeholder="Business or trading name"
              autoComplete="organization"
            />
            <input
              className="input"
              value={marketerForm.vatNumber}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, vatNumber: event.target.value }))}
              placeholder="VAT number (if registered)"
            />
            <input
              className="input"
              value={marketerForm.website}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, website: event.target.value }))}
              placeholder="Website"
              autoComplete="url"
            />
            <input
              className="input"
              value={marketerForm.socialProfiles}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, socialProfiles: event.target.value }))}
              placeholder="Key social profiles"
            />
          </div>
          <textarea
            className="input"
            value={marketerForm.address}
            onChange={(event) => setMarketerForm((prev) => ({ ...prev, address: event.target.value }))}
            placeholder="Business address"
            rows={3}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              value={marketerForm.niches}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, niches: event.target.value }))}
              placeholder="Primary niches or industries"
            />
            <input
              className="input"
              value={marketerForm.audienceSize}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, audienceSize: event.target.value }))}
              placeholder="Audience size or reach"
            />
          </div>
        </section>

        <section className="card grid gap-3 p-4">
          <header className="grid gap-1">
            <h2 className="text-lg font-semibold">Payout details</h2>
            <p className="text-sm text-gray-600">
              We run manual payouts monthly for balances over £50 once orders are delivered. Share where to send your remittance.
            </p>
          </header>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              value={marketerForm.bankAccountName}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, bankAccountName: event.target.value }))}
              placeholder="Account holder name"
            />
            <input
              className="input"
              value={marketerForm.bankName}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, bankName: event.target.value }))}
              placeholder="Bank name"
            />
            <input
              className="input"
              value={marketerForm.sortCode}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, sortCode: event.target.value }))}
              placeholder="Sort code"
              inputMode="numeric"
            />
            <input
              className="input"
              value={marketerForm.accountNumber}
              onChange={(event) => setMarketerForm((prev) => ({ ...prev, accountNumber: event.target.value }))}
              placeholder="Account number"
              inputMode="numeric"
            />
          </div>
          <input
            className="input"
            value={marketerForm.proofUrl}
            onChange={(event) => setMarketerForm((prev) => ({ ...prev, proofUrl: event.target.value }))}
            placeholder="Link to proof of identity/business registration (optional)"
            autoComplete="url"
          />
        </section>

        <section className="card grid gap-3 p-4">
          <header className="grid gap-1">
            <h2 className="text-lg font-semibold">Compliance & consent</h2>
            <p className="text-sm text-gray-600">
              We need a few confirmations before we can activate your affiliate dashboard.
            </p>
          </header>
          <div className="grid gap-2">
            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={marketerConsent.gdpr}
                onChange={(event) => setMarketerConsent((prev) => ({ ...prev, gdpr: event.target.checked }))}
                required
              />
              <span>
                I consent to Pineapple Tapped storing my details to run the affiliate programme in line with GDPR.
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={marketerConsent.terms}
                onChange={(event) => setMarketerConsent((prev) => ({ ...prev, terms: event.target.checked }))}
                required
              />
              <span>
                I agree to the affiliate agreement and understand commissions are paid on net HQ commission with a £50 threshold.
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={marketerConsent.marketing}
                onChange={(event) => setMarketerConsent((prev) => ({ ...prev, marketing: event.target.checked }))}
              />
              <span>
                Keep me posted on new campaigns, creative assets, and programme updates by email.
              </span>
            </label>
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                VAT registration status
              </span>
              <div className="grid gap-2 sm:grid-cols-3">
                {[{ value: 'registered', label: 'Registered' }, { value: 'not_registered', label: 'Not registered' }, { value: 'unsure', label: 'Unsure' }].map((option) => (
                  <label key={option.value} className="flex items-center gap-2 rounded border border-neutral-200 p-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="vat-status"
                      value={option.value}
                      checked={marketerConsent.vatStatus === option.value}
                      onChange={(event) => setMarketerConsent((prev) => ({ ...prev, vatStatus: event.target.value as VatStatus }))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card grid gap-3 p-4">
          <header className="grid gap-1">
            <h2 className="text-lg font-semibold">Anything else?</h2>
            <p className="text-sm text-gray-600">
              Share links to standout campaigns or notes you want the review team to consider.
            </p>
          </header>
          <textarea
            className="input"
            value={marketerForm.notes}
            onChange={(event) => setMarketerForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes, campaign highlights, or expectations"
            rows={4}
          />
        </section>

        {marketerError ? <p className="text-sm text-red-600">{marketerError}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="submit" className="btn" disabled={marketerSubmitting}>
            {marketerSubmitting ? 'Submitting…' : 'Apply as affiliate'}
          </button>
          <p className="text-xs text-gray-500">
            We review applications within five business days and pay monthly once your balance reaches £50.
          </p>
        </div>
      </form>
    );
  };

  const renderContent = () => {
    if (activeTab === 'marketer') {
      return renderMarketerContent();
    }

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
    const submitEnabled =
      !territorySelectionRequired || territorySuggestions.length === 0 || selectedTerritories.length > 0;

    const territoryCard = (
      <section className="card grid gap-3 p-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Tell us where you&apos;d like to operate</h2>
          <p className="text-sm text-gray-600">
            Enter your postcode so we can recommend the closest franchise territories and prioritise them during review.
          </p>
        </div>
        {territoryOptions.length === 0 ? (
          <p className="text-sm text-gray-500">
            We don&apos;t have any open territories right now. Submit your application and we&apos;ll reach out as new regions
            launch.
          </p>
        ) : (
          <div className="grid gap-2">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePostcodeLookup();
              }}
            >
              <input
                className="input flex-1"
                value={postcodeInput}
                onChange={(event) => setPostcodeInput(event.target.value)}
                placeholder="Enter your postcode"
                autoComplete="postal-code"
                aria-label="Postcode"
              />
              <button
                type="submit"
                className="btn"
                disabled={postcodeLookupStatus === 'loading' || territoryOptions.length === 0}
              >
                {postcodeLookupStatus === 'loading' ? 'Searching…' : 'Find nearby territories'}
              </button>
            </form>
            {postcodeLookupStatus === 'notfound' && (
              <p className="text-sm text-amber-600">
                We couldn&apos;t find that postcode. Please double-check it and try again.
              </p>
            )}
            {postcodeLookupStatus === 'error' && postcodeLookupError && (
              <p className="text-sm text-red-600">{postcodeLookupError}</p>
            )}
            {postcodeLookupStatus === 'success' && postcodeLookupResult && (
              <p className="text-xs text-gray-500">
                Showing territories near {postcodeLookupResult.resolved}.
              </p>
            )}
            {territorySuggestions.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm text-gray-600">
                  Select the locations you&apos;d like us to prioritise when we review your application.
                </p>
                {territorySuggestions.map((suggestion) => {
                  const option = territoryMap.get(suggestion.id);
                  if (!option) {
                    return null;
                  }
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
                        {Number.isFinite(suggestion.distanceKm) && suggestion.distanceKm != null && (
                          <span className="text-[11px] uppercase tracking-wide text-gray-500">
                            {suggestion.distanceKm < 1
                              ? 'Less than 1km away'
                              : `${suggestion.distanceKm.toFixed(1)}km away`}
                          </span>
                        )}
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
            ) : (
              <div className="grid gap-1 text-sm text-gray-500">
                {postcodeLookupStatus === 'success' && postcodeLookupResult ? (
                  <p>
                    We couldn&apos;t find franchise territories near {postcodeLookupResult.resolved}. Submit your
                    application and we&apos;ll reach out as new locations launch.
                  </p>
                ) : (
                  <p>
                    Enter your postcode above and we&apos;ll recommend the three closest franchise locations that currently
                    have availability.
                  </p>
                )}
              </div>
            )}
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
