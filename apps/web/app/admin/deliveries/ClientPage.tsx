"use client";

export default function ClientPage() {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Deliveries pipeline</h1>
        <p className="text-muted-foreground">
          Track outgoing media packages and confirm fulfilment milestones. The detailed delivery manager is being
          rebuilt with new automation features.
        </p>
      </header>
      <article className="rounded-lg border border-dashed border-slate-300/80 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Placeholder module</h2>
        <p className="mt-2 text-sm text-slate-600">
          Logistics tracking for asset deliveries is currently in development. For now, continue to process handovers
          through the Projects area or your usual Drive workflows. Keeping this page online ensures admin shortcuts and
          bookmarks remain valid while we finish the new experience.
        </p>
      </article>
    </section>
  );
}
