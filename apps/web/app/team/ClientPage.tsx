'use client';

import PortalContainer from '@/components/PortalContainer';

const teamHighlights = [
  {
    label: 'Assign collaborators',
    detail:
      'Invite marketing, product, and leadership teammates to manage organisations, approve deliverables, and receive updates.',
  },
  {
    label: 'Role-based access',
    detail:
      'Set who can brief new projects, view budgets, or download assets so sensitive material stays controlled.',
  },
  {
    label: 'Coverage insights',
    detail:
      'See which organisations have owners and where Pineapple Tapped should recommend backup contacts.',
  },
];

export default function TeamClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Team</h1>
          <p className="text-sm leading-6 text-slate-600">
            Manage who inside your organisation collaborates with Pineapple Tapped. The refreshed team manager will
            launch alongside organisation-level permissions so you can delegate confidently.
          </p>
        </header>
        <section className="grid gap-4 md:grid-cols-2">
          {teamHighlights.map((item) => (
            <article key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">{item.label}</h2>
              <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
            </article>
          ))}
        </section>
        <footer className="rounded-lg border border-dashed border-blue-300 bg-blue-50 p-4 text-sm text-blue-900">
          Until the new controls are live, email your account manager with any access changes so we can update our
          internal roster immediately.
        </footer>
      </div>
    </PortalContainer>
  );
}
