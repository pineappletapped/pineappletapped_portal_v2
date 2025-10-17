'use client';

import type { ReactNode } from 'react';

import PortalContainer from '@/components/PortalContainer';
import clsx from 'clsx';

export interface AdminWorkspaceLayoutProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  hero?: ReactNode;
  children: ReactNode;
  headerAdornment?: ReactNode;
  inset?: boolean;
}

type SectionTone = 'default' | 'info' | 'danger' | 'success' | 'muted';

export default function AdminWorkspaceLayout({
  title,
  description,
  actions,
  hero,
  children,
  headerAdornment,
  inset = false,
}: AdminWorkspaceLayoutProps) {
  return (
    <PortalContainer>
      <div className={clsx('space-y-10', inset && 'lg:px-4 xl:px-6')}>
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue/60">Admin workspace</p>
              <h1 className="text-3xl font-semibold text-charcoal">{title}</h1>
              {description ? (
                <div className="text-sm text-slate-600 [&>p]:mt-2 first:[&>p]:mt-0">{description}</div>
              ) : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
          {headerAdornment ? <div className="mt-6">{headerAdornment}</div> : null}
        </header>
        {hero ? (
          <section className="rounded-3xl border border-orange/40 bg-gradient-to-r from-orange/10 via-blue/5 to-white p-6 shadow-sm lg:p-8">
            {hero}
          </section>
        ) : null}
        <div className="space-y-6">{children}</div>
      </div>
    </PortalContainer>
  );
}

export function AdminSection({
  title,
  description,
  children,
  footer,
  tone = 'default',
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: SectionTone;
}) {
  const toneClasses: Record<SectionTone, string> = {
    default: 'border-slate-200 bg-white/95',
    info: 'border-blue/40 bg-blue/5',
    danger: 'border-rose-200 bg-rose-50',
    success: 'border-emerald-200 bg-emerald-50',
    muted: 'border-slate-200 bg-slate-50',
  };

  return (
    <section
      className={clsx(
        'rounded-3xl border p-6 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md',
        toneClasses[tone] ?? toneClasses.default
      )}
    >
      <div className="space-y-4">
        {title ? (
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-charcoal">{title}</h2>
            {description ? <p className="text-sm text-slate-600">{description}</p> : null}
          </div>
        ) : null}
        <div className="space-y-4">{children}</div>
        {footer ? <div className="border-t border-slate-200 pt-4 text-sm text-slate-600">{footer}</div> : null}
      </div>
    </section>
  );
}
