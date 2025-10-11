"use client";

import { useRoleGate } from "@/hooks/useRoleGate";
import InsuranceWorkspace from "@/components/admin/insurance/InsuranceWorkspace";

export default function AdminInsuranceClientPage() {
  const { allowed, loading } = useRoleGate("admin");

  if (loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to view this page.</p>;
  }

  return <InsuranceWorkspace />;
}

