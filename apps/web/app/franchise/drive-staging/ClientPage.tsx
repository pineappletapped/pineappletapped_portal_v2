"use client";

import DriveAssetStager from "@/components/storage/DriveAssetStager";
import PortalContainer from "@/components/PortalContainer";

export default function FranchiseDriveStagingClientPage() {
  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Drive deliverable staging</h1>
          <p className="text-sm text-gray-600">
            Browse the shared Drive folders provisioned for your projects and push files straight
            into the client review queue without uploading duplicates. Staged assets respect the
            existing payment gate and create review tasks automatically.
          </p>
        </header>
        <DriveAssetStager />
      </div>
    </PortalContainer>
  );
}
