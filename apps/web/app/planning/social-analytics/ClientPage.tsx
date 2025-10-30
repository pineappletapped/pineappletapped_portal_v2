'use client';

import PortalContainer from '@/components/PortalContainer';

const metricHighlights = [
  {
    label: 'Performance snapshots',
    copy:
      'Blend Pineapple Tapped deliverables with native platform metrics so you can see which assets drive reach, engagement, and conversions in one dashboard.',
  },
  {
    label: 'Trend spotting',
    copy:
      'Track rolling 7, 30, and 90-day views to understand when content is cooling off and where your team should double down.',
  },
  {
    label: 'Budget alignment',
    copy:
      'Compare planned spend against results to prove ROI for each organisation and tweak the upcoming calendar before campaigns slip.',
  },
];

export default function SocialAnalyticsClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Social analytics</h1>
          <p className="text-sm leading-6 text-slate-600">
            Understand which platforms and posts are moving the needle. Once connected, we will sync headline metrics
            daily and surface Pineapple Tapped recommendations beside your live performance data.
          </p>
        </header>
        <section className="grid gap-4 md:grid-cols-2">
          {metricHighlights.map((highlight) => (
            <article key={highlight.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">{highlight.label}</h2>
              <p className="mt-2 text-sm text-slate-600">{highlight.copy}</p>
            </article>
          ))}
        </section>
        <footer className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          The analytics pipeline is pausing while we stabilise hosted functions. We will re-enable the sync as soon as
          the error budget is healthy again.
        </footer>
      </div>
    </PortalContainer>
  );
}
