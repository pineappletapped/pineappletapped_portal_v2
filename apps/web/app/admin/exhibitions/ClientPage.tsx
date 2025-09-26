"use client";

import { useState } from "react";
import ExpoLeadCaptureManager from "@/components/admin/expo/ExpoLeadCaptureManager";
import ExpoSupportRequestManager from "@/components/admin/expo/ExpoSupportRequestManager";
import { useRoleGate } from "@/hooks/useRoleGate";

type TabKey = "capture" | "support";

const tabs: { id: TabKey; label: string; description: string }[] = [
  {
    id: "capture",
    label: "Lead capture",
    description:
      "Create exhibition landing pages and iPad-ready forms that sync prospects into the CRM with automatic event tagging.",
  },
  {
    id: "support",
    label: "Franchise support",
    description:
      "Review and approve franchise expo support requests so the right team and budget are assigned ahead of each event.",
  },
];

export default function AdminExhibitionsPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "marketing", "operations", "sales"]);
  const [activeTab, setActiveTab] = useState<TabKey>("capture");

  if (guardLoading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage exhibitions.</p>;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Exhibitions</h1>
        <p className="mt-2 text-sm text-gray-600">
          Plan exhibition activity end-to-end: build the lead capture experience and coordinate franchise support
          in one workspace.
        </p>
      </div>

      <div className="rounded border bg-base-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`btn btn-sm ${isActive ? "btn-primary" : "btn-ghost"}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {tabs.find((tab) => tab.id === activeTab)?.description ?? ""}
        </p>
      </div>

      {activeTab === "capture" ? (
        <ExpoLeadCaptureManager
          heading="Lead capture & landing pages"
          headingLevel="h2"
          description={
            <p className="text-sm text-gray-600">
              Build exhibition microsites with configurable forms, follow-up emails and CRM tagging so every lead is
              tracked against its event.
            </p>
          }
        />
      ) : (
        <ExpoSupportRequestManager
          heading="Franchise expo support"
          headingLevel="h2"
          description={
            <p className="text-sm text-gray-600">
              Keep on top of franchise support needs, capture stand budgets and confirm staffing so events run
              smoothly.
            </p>
          }
        />
      )}
    </div>
  );
}
