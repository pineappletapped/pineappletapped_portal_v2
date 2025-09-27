'use client';

import useLoginTelemetry from '@/hooks/useLoginTelemetry';

export default function LoginTelemetryListener() {
  useLoginTelemetry();
  return null;
}
