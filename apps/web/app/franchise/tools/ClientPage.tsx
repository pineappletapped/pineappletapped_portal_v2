"use client";

import { useMemo, useState } from "react";

import ContentAssistantWorkspace from "@/components/admin/tools/ContentAssistantWorkspace";
import SocialSchedulerWorkspace from "@/components/admin/tools/SocialSchedulerWorkspace";
import PortalContainer from "@/components/PortalContainer";

const TOOL_OPTIONS = [
  {
    id: "copy",
    label: "Copy assistant",
    description:
      "Turn event transcripts into platform-ready copy packs, link deliverables, and hand finished kits back to your clients.",
  },
  {
    id: "scheduler",
    label: "Scheduler queue",
    description:
      "Log connected accounts, capture approvals, and export ready-made calendars while HQ enables automated publishing.",
  },
];

export default function FranchiseToolsClientPage() {
  const [activeTool, setActiveTool] = useState<string>("copy");

  const activeDescription = useMemo(() => {
    const current = TOOL_OPTIONS.find((tool) => tool.id === activeTool);
    return current?.description ?? "";
  }, [activeTool]);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">Franchise tools</h1>
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

        {activeTool === "copy" ? (
          <ContentAssistantWorkspace />
        ) : (
          <SocialSchedulerWorkspace emphasisePilotNote />
        )}
      </div>
    </PortalContainer>
  );
}
