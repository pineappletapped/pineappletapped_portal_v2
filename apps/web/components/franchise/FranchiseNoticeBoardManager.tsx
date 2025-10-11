"use client";

import { useCallback } from "react";

import NoticeBoardControl, {
  type NoticeBoardSection,
} from "@/components/noticeboard/NoticeBoardControl";

interface FranchiseNoticeBoardManagerProps {
  franchiseIds: string[];
}

const renderFranchiseSection = (section: NoticeBoardSection) => (
  <section
    key={section.key}
    className="rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm"
  >
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-indigo-900">{section.title}</h2>
      {section.description ? (
        <p className="text-sm text-slate-600">{section.description}</p>
      ) : null}
    </div>
    <div className="mt-4 space-y-4">{section.content}</div>
  </section>
);

const deriveFranchiseIdsFromUser = (data: any): string[] => {
  if (!data || typeof data !== "object") return [];
  const ids = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  };

  push(data.primaryFranchiseId);
  push(data.franchiseId);

  if (Array.isArray(data.franchiseIds)) {
    data.franchiseIds.forEach(push);
  }

  const roles = data.franchiseRoles;
  if (roles && typeof roles === "object") {
    Object.values(roles).forEach(push);
  }

  if (Array.isArray(data.managedFranchises)) {
    data.managedFranchises.forEach(push);
  }

  return Array.from(ids);
};

export default function FranchiseNoticeBoardManager({
  franchiseIds,
}: FranchiseNoticeBoardManagerProps) {
  const filterUser = useCallback(
    (userData: any) => {
      if (!franchiseIds || franchiseIds.length === 0) {
        return true;
      }
      const userFranchises = deriveFranchiseIdsFromUser(userData);
      if (userFranchises.length === 0) {
        return false;
      }
      return userFranchises.some((id) => franchiseIds.includes(id));
    },
    [franchiseIds]
  );

  return (
    <NoticeBoardControl
      filterUser={filterUser}
      renderSection={renderFranchiseSection}
      showPermissions={franchiseIds.length > 0}
    />
  );
}

