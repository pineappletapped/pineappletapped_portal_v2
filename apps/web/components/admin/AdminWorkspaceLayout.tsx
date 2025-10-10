'use client';

import type { ReactNode } from "react";

import PortalContainer from "@/components/PortalContainer";
import clsx from "clsx";

export interface AdminWorkspaceLayoutProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  hero?: ReactNode;
  children: ReactNode;
  headerAdornment?: ReactNode;
  inset?: boolean;
}

type SectionTone = "default" | "info" | "danger" | "success" | "muted";

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
      <div className={clsx("space-y-6", inset && "lg:px-4")}> 
        <header className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-orange-500">Admin workspace</p>
              <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
              {description ? (
                <div className="text-sm text-gray-600 [&>p]:mt-2 first:[&>p]:mt-0">{description}</div>
              ) : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
          {headerAdornment}
        </header>
        {hero ? <div className="rounded-3xl border border-orange-100 bg-orange-50 p-6 shadow-sm">{hero}</div> : null}
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
  tone = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: SectionTone;
}) {
  const toneClasses: Record<SectionTone, string> = {
    default: "border-gray-200 bg-white",
    info: "border-blue-200 bg-blue-50",
    danger: "border-rose-200 bg-rose-50",
    success: "border-emerald-200 bg-emerald-50",
    muted: "border-slate-200 bg-slate-50",
  };

  return (
    <section
      className={clsx(
        "rounded-3xl border p-6 shadow-sm",
        toneClasses[tone] ?? toneClasses.default,
      )}
    >
      <div className="space-y-4">
        {title ? (
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {description ? <p className="text-sm text-gray-600">{description}</p> : null}
          </div>
        ) : null}
        <div className="space-y-4">{children}</div>
        {footer ? <div className="border-t border-black/5 pt-4 text-sm text-gray-600">{footer}</div> : null}
      </div>
    </section>
  );
}
