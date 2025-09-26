"use client";

import Link from "next/link";

import PortalContainer from "@/components/PortalContainer";
import ContentPlanPanel from "@/components/ContentPlanPanel";

export default function ContentPlannerClientPage() {
  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Annual content planner</h1>
            <p className="text-sm text-gray-600">
              Map campaigns, attach live services, and raise bespoke requests so Pineapple Tapped can orchestrate delivery for the
              year ahead.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/categories" className="btn-xs">
              Explore services
            </Link>
            <Link href="/dashboard" className="btn-xs btn-outline">
              Back to dashboard
            </Link>
          </div>
        </div>
        <ContentPlanPanel />
      </div>
    </PortalContainer>
  );
}
