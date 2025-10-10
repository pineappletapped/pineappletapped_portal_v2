"use client";

import { useMemo, useState } from "react";

import AdminWorkspaceLayout, { AdminSection } from "@/components/admin/AdminWorkspaceLayout";
import ContentAssistantWorkspace from "@/components/admin/tools/ContentAssistantWorkspace";
import SocialSchedulerWorkspace from "@/components/admin/tools/SocialSchedulerWorkspace";
import { useRoleGate } from "@/hooks/useRoleGate";

const TOOL_OPTIONS = [
  {
    id: "copy",
    label: "Campaign copy assistant",
    description:
      "Transform transcripts into ready-to-post copy packs, link deliverables, and push approved kits straight to client portals.",
  },
  {
    id: "scheduler",
    label: "Social scheduler (pilot)",
    description:
      "Connect client channels, capture publishing approvals, and export campaign calendars while the automation workers roll out.",
  },
];

export default function AdminToolsClientPage() {
  const { allowed, loading, roles } = useRoleGate(["admin", "marketing", "projects"]);
  const [activeTool, setActiveTool] = useState<string>("copy");

  const activeDescription = useMemo(() => {
    const current = TOOL_OPTIONS.find((tool) => tool.id === activeTool);
    return current?.description ?? "";
  }, [activeTool]);

  if (loading) {
    return (
      <AdminWorkspaceLayout title="Production tools" description="Loading workspace access permissions">
        <AdminSection>
          <p className="text-sm text-gray-600">Checking permissions…</p>
        </AdminSection>
      </AdminWorkspaceLayout>
    );
  }

  if (!allowed) {
    return (
      <AdminWorkspaceLayout title="Production tools" description="Automation workspaces for marketing and operations teams">
        <AdminSection tone="danger">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold text-gray-900">Access required</h1>
            <p className="text-sm text-gray-600">
              This workspace is available to admin, marketing, or project operations roles. Contact HQ to enable access.
            </p>
          </div>
        </AdminSection>
      </AdminWorkspaceLayout>
    );
  }

  return (
    <AdminWorkspaceLayout
      title="Production tools"
      description="Switch between the content assistant and social scheduler to support campaign fulfilment."
    >
      <AdminSection>
        <header className="space-y-2">
          <p className="text-sm text-gray-600">{activeDescription}</p>
          <div className="flex flex-wrap gap-2">
            {TOOL_OPTIONS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  activeTool === tool.id
                    ? "bg-orange text-white shadow"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tool.label}
              </button>
            ))}
          </div>
        </header>

        <div className="mt-4">
          {activeTool === "copy" ? (
            <ContentAssistantWorkspace />
          ) : (
            <SocialSchedulerWorkspace allowFlagEditing={Boolean(roles?.admin)} roles={roles ?? null} emphasisePilotNote />
          )}
        </div>
      </AdminSection>
    </AdminWorkspaceLayout>
  );
}
