import React from 'react';
import PortalContainer from '@/components/PortalContainer';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <PortalContainer>{children}</PortalContainer>;
}
