'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { trackPageView } from '@/lib/analytics';

const SUPPRESSED_PREFIXES = ['/admin', '/crm', '/dashboard', '/contractors'];

export default function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    if (SUPPRESSED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return;
    }
    void trackPageView(pathname);
  }, [pathname]);
  return null;
}
