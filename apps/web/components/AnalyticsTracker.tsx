'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { initialiseAnalyticsClient, trackPageView } from '@/lib/analytics';

const SUPPRESSED_PREFIXES = ['/admin', '/crm', '/dashboard', '/contractors'];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const epochNow = () => Date.now();

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const viewRef = useRef<{
    path: string;
    startedAt: number;
    startedAtEpoch: number;
    referrer: string | null;
  } | null>(null);
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    initialiseAnalyticsClient();
  }, []);

  useEffect(() => {
    if (!pathname) {
      return;
    }

    const commitView = () => {
      if (!viewRef.current) {
        return;
      }
      const elapsed = Math.max(0, now() - viewRef.current.startedAt);
      trackPageView(viewRef.current.path, {
        durationMs: elapsed,
        startedAtMs: viewRef.current.startedAtEpoch,
        referrer: viewRef.current.referrer,
      });
      viewRef.current = null;
    };

    const previousPath = lastPathRef.current;
    if (viewRef.current && viewRef.current.path !== pathname) {
      commitView();
    }

    if (SUPPRESSED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      viewRef.current = null;
      lastPathRef.current = pathname;
      return;
    }

    const referrer = previousPath
      ? previousPath
      : typeof document !== 'undefined' && document.referrer
        ? document.referrer
        : null;

    viewRef.current = {
      path: pathname,
      startedAt: now(),
      startedAtEpoch: epochNow(),
      referrer,
    };
    lastPathRef.current = pathname;

    return () => {
      commitView();
    };
  }, [pathname]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!viewRef.current) {
        return;
      }
      const elapsed = Math.max(0, now() - viewRef.current.startedAt);
      trackPageView(viewRef.current.path, {
        durationMs: elapsed,
        startedAtMs: viewRef.current.startedAtEpoch,
        referrer: viewRef.current.referrer,
      });
      viewRef.current = null;
    };

    window.addEventListener('pagehide', handleBeforeUnload);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', handleBeforeUnload);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return null;
}
