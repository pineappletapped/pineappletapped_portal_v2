"use client";

import ContentAssistantWorkspace from "@/components/admin/tools/ContentAssistantWorkspace";
import PortalContainer from "@/components/PortalContainer";

export default function FranchiseToolsClientPage() {
  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">Campaign copy assistant</h1>
          <p className="text-sm text-gray-600">
            Turn event transcripts into ready-to-post social content, align with HQ deliverables, and push approved copy to the client portal without leaving the franchise workspace.
          </p>
        </header>
        <ContentAssistantWorkspace />
      </div>
    </PortalContainer>
  );
}
