'use client';

import PortalContainer from '@/components/PortalContainer';

const assetLibraryHighlights = [
  {
    title: 'Filter by organisation',
    description:
      'Switch between your linked organisations to view brand-approved deliverables, raw footage, and work-in-progress uploads in a single workspace.',
  },
  {
    title: 'Surface past deliverables',
    description:
      'Quickly find published content, contracts, and briefing assets with search and tag filters to repurpose successful campaigns.',
  },
  {
    title: 'Connect to live drives',
    description:
      'Jump straight into Google Drive folders without leaving the portal so reviewers can download files or leave contextual feedback.',
  },
];

export default function AssetLibraryClientPage() {
  return (
    <PortalContainer>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Asset library</h1>
          <p className="text-sm leading-6 text-slate-600">
            Browse every deliverable Pineapple Tapped has produced for your organisations. Use filters to
            narrow by campaign, media type, or production status, and jump straight into the connected
            storage drives when you need the source files.
          </p>
        </header>
        <section className="grid gap-4 sm:grid-cols-2">
          {assetLibraryHighlights.map((highlight) => (
            <div key={highlight.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">{highlight.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{highlight.description}</p>
            </div>
          ))}
        </section>
        <footer className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Uploads from new projects automatically surface here once production shares deliverables. While we
          finish wiring the filters, use your usual Google Drive links to access urgent files.
        </footer>
      </div>
    </PortalContainer>
  );
}
