'use client';

import PortalContainer from '@/components/PortalContainer';

const messageFeatures = [
  'Centralise conversations with Pineapple Tapped producers, editors, and strategists.',
  'Share files and feedback threads alongside your active projects so nothing is lost in email.',
  'Escalate urgent items directly to your account manager without leaving the portal.',
];

export default function MessagesClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
          <p className="text-sm leading-6 text-slate-600">
            All communication with the Pineapple Tapped team will appear here, grouped by project and topic. We are
            finishing the upgrade to replace the shared inbox integration, so hang tight while we prepare the new
            workspace.
          </p>
        </header>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">In the next release</h2>
          <ul className="space-y-3">
            {messageFeatures.map((feature) => (
              <li key={feature} className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
                {feature}
              </li>
            ))}
          </ul>
        </section>
        <footer className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Need to reach us now? Continue using the shared inbox or your account manager&apos;s direct email while we
          migrate historical threads into this view.
        </footer>
      </div>
    </PortalContainer>
  );
}
