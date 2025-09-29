import React from 'react';
import Breadcrumbs from './Breadcrumbs';

/**
 * Frames portal content within a centered card for consistent aesthetic.
 */
export default function PortalContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl my-4 sm:my-6 bg-white px-4 py-4 rounded-none sm:rounded-lg sm:px-6 sm:py-5 shadow overflow-x-auto">
      <Breadcrumbs />
      {children}
    </div>
  );
}
