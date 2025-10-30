'use client';

import PortalContainer from '@/components/PortalContainer';

const calendarCapabilities = [
  'Link Instagram, Facebook, LinkedIn, TikTok, and more to pull scheduled content and publish windows into one view.',
  'Drag and drop previous deliverables or upcoming briefs onto the calendar to map your pipeline at a glance.',
  'Assign owners to each post so your internal stakeholders know who is responsible for copy, creative, and approvals.',
];

export default function SocialCalendarClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Social calendar</h1>
          <p className="text-sm leading-6 text-slate-600">
            Plan your publishing schedule across every connected platform. The calendar keeps content, captions,
            and approval tasks aligned so teams can spot coverage gaps weeks in advance.
          </p>
        </header>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Coming online next</h2>
          <ul className="space-y-3">
            {calendarCapabilities.map((capability) => (
              <li key={capability} className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
                {capability}
              </li>
            ))}
          </ul>
        </section>
        <footer className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          We are finalising the publishing integrations for hosted app deployments. In the meantime, continue to
          brief upcoming posts through your account manager so nothing falls off the plan.
        </footer>
      </div>
    </PortalContainer>
  );
}
