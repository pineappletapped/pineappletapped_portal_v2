import { Suspense } from 'react';
import ClientPage from './ClientPage';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Loading request form…</div>}>
      <ClientPage />
    </Suspense>
  );
}
