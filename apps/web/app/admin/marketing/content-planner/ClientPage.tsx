"use client";

import Breadcrumbs from "@/components/Breadcrumbs";
import ContentPlannerManager from "@/components/admin/marketing/ContentPlannerManager";

export default function AdminContentPlannerPage() {
  return (
    <div className="grid gap-6">
      <Breadcrumbs />
      <ContentPlannerManager />
    </div>
  );
}
