"use client";

import PortalContainer from "@/components/PortalContainer";
import EmailTemplatesWorkspace from "@/components/admin/email/EmailTemplatesWorkspace";
import { useRoleGate } from "@/hooks/useRoleGate";

export default function EmailTemplatesClientPage() {
  const { allowed, loading } = useRoleGate("admin");

  if (loading) {
    return (
      <PortalContainer>
        <p className="text-sm text-gray-600">Checking permissions…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Access required</h1>
          <p className="text-sm text-gray-600">
            This workspace is reserved for admin users. Contact HQ if you believe you should have access.
          </p>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <EmailTemplatesWorkspace />
    </PortalContainer>
  );
}
