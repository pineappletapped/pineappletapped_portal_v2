"use client";

import PortalContainer from "@/components/PortalContainer";
import ContentAssistantWorkspace from "@/components/admin/tools/ContentAssistantWorkspace";
import { useRoleGate } from "@/hooks/useRoleGate";

export default function AdminToolsClientPage() {
  const { allowed, loading } = useRoleGate(["admin", "marketing", "projects"]);

  if (loading) {
    return (
      <PortalContainer>
        <p>Checking permissions…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Access required</h1>
          <p className="text-sm text-gray-600">
            This workspace is available to admin, marketing, or project operations roles. Contact HQ to enable access.
          </p>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <ContentAssistantWorkspace />
    </PortalContainer>
  );
}
