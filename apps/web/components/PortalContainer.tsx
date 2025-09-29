import React from 'react';
import Breadcrumbs from './Breadcrumbs';

/**
 * Frames portal content within a centered card for consistent aesthetic.
 */
export default function PortalContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl my-4 sm:my-6 bg-white px-4 py-4 rounded-none sm:rounded-lg sm:px-6 sm:py-5 lg:px-8 lg:py-6 shadow overflow-x-auto">
      <Breadcrumbs />
      {children}
    </div>
  );
}
