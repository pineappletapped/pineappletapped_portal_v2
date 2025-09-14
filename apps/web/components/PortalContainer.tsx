import React from 'react';
import Breadcrumbs from './Breadcrumbs';

/**
 * Frames portal content within a centered card for consistent aesthetic.
 */
export default function PortalContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl my-4 p-4 sm:my-6 sm:p-6 bg-white rounded-none sm:rounded-lg shadow overflow-x-auto">
      <Breadcrumbs />
      {children}
    </div>
  );
}
