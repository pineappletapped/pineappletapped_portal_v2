'use client';

import PortalContainer from '@/components/PortalContainer';

const profileTasks = [
  {
    title: 'Personal details',
    text: 'Update your name, contact email, and phone number so production teams can reach you quickly.',
  },
  {
    title: 'Notification preferences',
    text: 'Choose which project, asset, and approval alerts hit your inbox versus the in-portal feed.',
  },
  {
    title: 'Security',
    text: 'Manage password resets and connected sign-in providers to keep your account protected.',
  },
];

export default function ProfileClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>
          <p className="text-sm leading-6 text-slate-600">
            Control the details Pineapple Tapped teams use to collaborate with you. The refreshed profile editor will
            roll out alongside the new messaging hub so your preferences and visibility stay in sync.
          </p>
        </header>
        <section className="grid gap-4 md:grid-cols-2">
          {profileTasks.map((task) => (
            <article key={task.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">{task.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{task.text}</p>
            </article>
          ))}
        </section>
        <footer className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Until the unified editor ships, continue sending profile updates to your account manager so we can adjust
          access and notifications on your behalf.
        </footer>
      </div>
    </PortalContainer>
  );
}
