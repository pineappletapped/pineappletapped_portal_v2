'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const COOKIE_NAME = 'cookieConsent';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hasConsent = document.cookie
      .split('; ')
      .find((row) => row.startsWith(COOKIE_NAME + '='));
    if (!hasConsent) {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    // Set cookie for one year
    document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 365}`;
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-white border-t shadow p-4 flex flex-col sm:flex-row items-center justify-between gap-2">
      <p className="text-sm text-charcoal">
        We use cookies to improve your experience. Read our{' '}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
      <button onClick={accept} className="btn btn-sm">
        Accept
      </button>
    </div>
  );
}
