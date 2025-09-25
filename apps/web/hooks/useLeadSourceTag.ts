'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  defaultLeadSourceState,
  deriveLeadSourceFromParams,
  encodeLeadSourceValue,
  isDefaultLeadSourceState,
  type LeadSourceState,
} from '@/lib/lead-source';

const STORAGE_KEY = 'pt:lead-source-tag';

const loadStoredLeadSource = (): LeadSourceState | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LeadSourceState> | null;
    if (!parsed || typeof parsed.kind !== 'string') {
      return null;
    }
    return {
      kind: parsed.kind,
      detail: typeof parsed.detail === 'string' ? parsed.detail : '',
    };
  } catch {
    return null;
  }
};

const saveLeadSource = (state: LeadSourceState): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage failures */
  }
};

export const useLeadSourceTag = (voucher?: string | null) => {
  const searchParams = useSearchParams();
  const [state, setStateInternal] = useState<LeadSourceState>(
    () => loadStoredLeadSource() ?? { ...defaultLeadSourceState }
  );
  const userOverrideRef = useRef(false);
  const lastVoucherRef = useRef<string | null>(null);

  const setState = useCallback(
    (value: LeadSourceState | ((prev: LeadSourceState) => LeadSourceState)) => {
      userOverrideRef.current = true;
      setStateInternal((prev) =>
        typeof value === 'function' ? (value as (arg: LeadSourceState) => LeadSourceState)(prev) : value
      );
    },
    []
  );

  useEffect(() => {
    const derived = deriveLeadSourceFromParams(searchParams);
    if (!derived) {
      return;
    }
    setStateInternal((prev) => {
      if (userOverrideRef.current && !isDefaultLeadSourceState(prev)) {
        return prev;
      }
      if (isDefaultLeadSourceState(prev)) {
        return derived;
      }
      return prev;
    });
  }, [searchParams]);

  useEffect(() => {
    saveLeadSource(state);
  }, [state]);

  useEffect(() => {
    const trimmedVoucher = (voucher ?? '').trim();
    if (!trimmedVoucher) {
      lastVoucherRef.current = null;
      return;
    }
    setStateInternal((prev) => {
      const detail = prev.detail.trim();
      const shouldAdoptDetail =
        prev.kind === 'franchise_voucher' &&
        (!detail || detail === lastVoucherRef.current);
      if (shouldAdoptDetail) {
        lastVoucherRef.current = trimmedVoucher;
        return { ...prev, detail: trimmedVoucher };
      }
      if (!userOverrideRef.current && isDefaultLeadSourceState(prev)) {
        lastVoucherRef.current = trimmedVoucher;
        return { kind: 'franchise_voucher', detail: trimmedVoucher };
      }
      lastVoucherRef.current = trimmedVoucher;
      return prev;
    });
  }, [voucher]);

  const value = useMemo(() => encodeLeadSourceValue(state, voucher), [state, voucher]);

  const reset = useCallback(() => {
    userOverrideRef.current = true;
    setStateInternal({ ...defaultLeadSourceState });
  }, []);

  return {
    state,
    setState,
    value,
    reset,
  };
};

