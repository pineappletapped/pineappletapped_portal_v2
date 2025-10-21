"use client";

export default function ClientPage() {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Bookings overview</h1>
        <p className="text-muted-foreground">
          Monitor upcoming shoots and keep booking requests organised. A dedicated workspace is on the way.
        </p>
      </header>
      <article className="rounded-lg border border-dashed border-slate-300/80 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Coming soon</h2>
        <p className="mt-2 text-sm text-slate-600">
          The refreshed bookings dashboard is currently under construction. In the meantime you can continue to
          manage events from the existing CRM and calendar tools. This placeholder keeps the admin route active so
          bookmarked links remain valid.
        </p>
      </article>
    </section>
  );
}
