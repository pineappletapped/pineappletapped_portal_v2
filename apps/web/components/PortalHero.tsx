import Link from "next/link";
import type { ReactNode } from "react";

type PortalHeroMetric = {
  label: string;
  value: ReactNode;
};

type PortalHeroAction = {
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
};

interface PortalHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  backgroundClass?: string;
  metrics?: PortalHeroMetric[];
  quickActions?: PortalHeroAction[];
}

/**
 * Shared hero header for portal workspaces to keep styling consistent across
 * the client, franchise, contractor, and admin experiences.
 */
export default function PortalHero({
  eyebrow,
  title,
  description,
  backgroundClass = "bg-slate-900",
  metrics = [],
  quickActions = [],
}: PortalHeroProps) {
  return (
    <header
      className={`rounded-3xl ${backgroundClass} text-white p-6 sm:p-8 shadow-sm`}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3 max-w-2xl">
          <p className="text-xs uppercase tracking-[0.35em] text-white/60">
            {eyebrow}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">
            {title}
          </h1>
          <p className="text-sm sm:text-base text-white/80">{description}</p>
        </div>
        {metrics.length > 0 && (
          <dl className="grid grid-cols-2 gap-4 text-left sm:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-2xl bg-white/10 p-4">
                <dt className="text-xs uppercase tracking-wide text-white/70">
                  {metric.label}
                </dt>
                <dd className="mt-2 text-2xl font-semibold text-white">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {quickActions.length > 0 && (
        <nav aria-label="Quick actions" className="mt-6">
          <div className="flex flex-wrap gap-3">
            {quickActions.map((action) => {
              const content = (
                <>
                  <span className="text-sm font-semibold text-white">
                    {action.label}
                  </span>
                  <span className="text-xs text-white/80">
                    {action.description}
                  </span>
                </>
              );

              if (action.href) {
                return (
                  <Link
                    key={`${action.label}-${action.href}`}
                    href={action.href}
                    className="group relative flex min-w-[200px] flex-1 flex-col justify-between gap-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="group relative flex min-w-[200px] flex-1 flex-col justify-between gap-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {content}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
