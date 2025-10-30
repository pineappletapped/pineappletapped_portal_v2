'use client';

import PortalContainer from '@/components/PortalContainer';

const goalWorkflow = [
  {
    title: 'Organisation roll-up',
    detail:
      'Review every organisation you collaborate with, the audiences they serve, and the current quarterly focus areas in one list.',
  },
  {
    title: 'Content objectives',
    detail:
      'Capture the number of hero videos, campaigns, or nurture sequences you want to deliver so Pineapple Tapped can suggest supporting work.',
  },
  {
    title: 'Budget checkpoints',
    detail:
      'Log planned spend and approvals to keep teams honest about resources before they hit production.',
  },
];

export default function GoalsClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Goals</h1>
          <p className="text-sm leading-6 text-slate-600">
            Align your organisations, content targets, and budgets so we can recommend the right mix of shoots,
            edits, and campaigns for the quarter. The workspace below outlines the fields that will appear when the
            goals module goes live.
          </p>
        </header>
        <section className="space-y-4">
          {goalWorkflow.map((step) => (
            <article key={step.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">{step.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{step.detail}</p>
            </article>
          ))}
        </section>
        <footer className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          We are migrating existing planner spreadsheets into the portal. Expect the interactive goals tracker to be
          available once the import completes.
        </footer>
      </div>
    </PortalContainer>
  );
}
