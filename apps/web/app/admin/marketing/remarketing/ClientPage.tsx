"use client";

import RemarketingManager from "@/components/admin/marketing/RemarketingManager";
import Breadcrumbs from "@/components/Breadcrumbs";

export default function AdminRemarketingPage() {
  return (
    <div className="grid gap-6">
      <Breadcrumbs />
      <RemarketingManager />
    </div>
  );
}
