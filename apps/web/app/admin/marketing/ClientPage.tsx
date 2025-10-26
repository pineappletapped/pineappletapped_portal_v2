"use client";

export default function ClientPage() {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Marketing toolkit</h1>
        <p className="text-muted-foreground">
          Plan campaign assets, coordinate launches, and review performance insights. A new control centre will be
          available shortly.
        </p>
      </header>
      <article className="rounded-lg border border-dashed border-slate-300/80 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Under construction</h2>
        <p className="mt-2 text-sm text-slate-600">
          We are consolidating the marketing dashboards into a streamlined experience. Until the update ships, please
          continue to use the existing analytics and campaign tools. This placeholder keeps deep links working and
          prevents 404 errors in the admin navigation.
        </p>
      </article>
    </section>
  );
}
