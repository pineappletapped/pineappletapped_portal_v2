"use client";

import { useCallback, useEffect, useState } from "react";

import { ensureFirebase } from "@/lib/firebase";
import {
  parseInsuranceAcknowledgementDoc,
  parseInsuranceAssignmentDoc,
  parseInsurancePolicyDoc,
  type InsuranceAcknowledgementRecord,
  type InsuranceAssignmentRecord,
  type InsurancePolicyRecord,
} from "@/lib/insurance";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

interface InsuranceRecordsState {
  loading: boolean;
  error: string | null;
  policies: InsurancePolicyRecord[];
  assignments: InsuranceAssignmentRecord[];
  acknowledgements: InsuranceAcknowledgementRecord[];
  reload: () => Promise<void>;
}

const defaultState: InsuranceRecordsState = {
  loading: true,
  error: null,
  policies: [],
  assignments: [],
  acknowledgements: [],
  reload: async () => {},
};

export function useInsuranceRecords(): InsuranceRecordsState {
  const [state, setState] = useState<InsuranceRecordsState>(defaultState);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore is not available.");
      }

      const [policySnap, assignmentSnap, acknowledgementSnap] = await Promise.all([
        getDocs(query(collection(db, "insurancePolicies"), orderBy("name"))),
        getDocs(collection(db, "insuranceAssignments")),
        getDocs(collection(db, "insuranceAcknowledgements")),
      ]);

      const policies = policySnap.docs.map((docSnap) =>
        parseInsurancePolicyDoc(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      const assignments = assignmentSnap.docs.map((docSnap) =>
        parseInsuranceAssignmentDoc(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      const acknowledgements = acknowledgementSnap.docs.map((docSnap) =>
        parseInsuranceAcknowledgementDoc(docSnap.id, docSnap.data() as Record<string, unknown>)
      );

      setState({
        loading: false,
        error: null,
        policies,
        assignments,
        acknowledgements,
        reload: load,
      });
    } catch (error) {
      console.error("Failed to load insurance records", error);
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load insurance records.",
        policies: [],
        assignments: [],
        acknowledgements: [],
        reload: load,
      });
    }
  }, []);

  useEffect(() => {
    load().catch((error) => console.error("Failed to bootstrap insurance records", error));
  }, [load]);

  return state;
}

