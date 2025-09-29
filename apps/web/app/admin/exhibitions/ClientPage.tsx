"use client";

import { useState } from "react";
import ExpoLeadCaptureManager from "@/components/admin/expo/ExpoLeadCaptureManager";
import ExpoSupportRequestManager from "@/components/admin/expo/ExpoSupportRequestManager";
import { useRoleGate } from "@/hooks/useRoleGate";
import PortalContainer from "@/components/PortalContainer";

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
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading exhibitions…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have permission to manage exhibitions.
        </p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Events</p>
            <h1 className="text-2xl font-semibold text-gray-900">Exhibitions workspace</h1>
            <p className="text-sm text-gray-600">
              Build lead capture experiences, power follow-up sequences and coordinate franchise support for every expo.
            </p>
          </div>
        </header>

        <div className="rounded-xl border border-base-200 bg-base-100 p-5 shadow-sm">
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

        <div className="rounded-xl border border-base-200 bg-base-100 p-5 shadow-sm">
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
      </div>
    </PortalContainer>
  );
}
