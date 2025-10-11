"use client";

import Link from "next/link";

import AdminWorkspaceLayout, { AdminSection } from "@/components/admin/AdminWorkspaceLayout";
import WorkflowStepsEditor from "@/components/admin/WorkflowStepsEditor";

export default function JoinTeamStepsAdmin() {
  return (
    <AdminWorkspaceLayout
      title="Join our team workflow"
      description="Control the multi-step experience applicants complete when they express interest in contracting with Pineapple Tapped."
      actions={
        <Link
          href="/join-team"
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline"
        >
          Preview public form
        </Link>
      }
    >
      <AdminSection
        title="Application steps"
        description="Adjust language, media, and required profile details for each stage. Changes are saved in real time and will reflect instantly on the marketing site."
      >
        <WorkflowStepsEditor
          collectionPath="joinTeamSteps"
          title="Step content"
          description="Curate the progression applicants follow, including profile mappings for downstream onboarding."
          addButtonLabel="Add step"
          emptyHelp="No join team steps configured yet. Add steps to start collecting applications."
        />
      </AdminSection>
      <AdminSection
        tone="muted"
        title="Helpful context"
        description="Need a quick reminder of how these fields feed the team CRM?"
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            Each field mapped to a saved profile property will prefill new contractor records. Custom fields remain attached to the
            original application for review and can be copied into notes if required.
          </p>
          <p>
            Keep steps focused and conversational—short paragraphs with a single action per card perform best. Use the media slot to
            add a friendly photo or quick explainer video where it reinforces the ask.
          </p>
        </div>
      </AdminSection>
    </AdminWorkspaceLayout>
  );
}
