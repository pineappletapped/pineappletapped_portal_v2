"use client";

import NoticeBoardControl, {
  type NoticeBoardSection,
} from "@/components/noticeboard/NoticeBoardControl";
import AdminWorkspaceLayout, {
  AdminSection,
} from "@/components/admin/AdminWorkspaceLayout";
import { useRoleGate } from "@/hooks/useRoleGate";

const renderAdminSection = (section: NoticeBoardSection) => (
  <AdminSection key={section.key} title={section.title} description={section.description}>
    {section.content}
  </AdminSection>
);

export default function AdminNoticeBoardPage() {
  const { allowed, loading: guardLoading } = useRoleGate("admin");

  if (guardLoading) {
    return <p className="p-6 text-sm text-slate-600">Checking access…</p>;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          You do not have permission to manage the team notice board.
        </p>
      </div>
    );
  }

  return (
    <AdminWorkspaceLayout
      title="Team notice board"
      description="Publish updates for contractors, review earlier posts, and control who can share notices."
    >
      <NoticeBoardControl renderSection={renderAdminSection} />
    </AdminWorkspaceLayout>
  );
}

