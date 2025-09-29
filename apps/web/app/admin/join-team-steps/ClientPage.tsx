"use client";

import WorkflowStepsEditor from "@/components/admin/WorkflowStepsEditor";

export default function JoinTeamStepsAdmin() {
  return (
    <WorkflowStepsEditor
      collectionPath="joinTeamSteps"
      title="Configure Join Team Steps"
      description="Design the contractor application journey shown on the Join Our Team page."
      addButtonLabel="Add step"
      emptyHelp="No join team steps configured yet. Add steps to start collecting applications."
    />
  );
}
