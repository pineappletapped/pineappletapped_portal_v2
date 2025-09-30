"use client";

import AffiliateManager from "@/components/admin/marketing/AffiliateManager";
import Breadcrumbs from "@/components/Breadcrumbs";

export default function AdminAffiliateClientPage() {
  return (
    <div className="grid gap-6">
      <Breadcrumbs />
      <AffiliateManager />
    </div>
  );
}
