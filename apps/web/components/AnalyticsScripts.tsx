'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { db, getDb } from '@/lib/firebase';

export default function AnalyticsScripts() {
  const [metaPixelId, setMetaPixelId] = useState<string | null>(null);
  const [linkedinId, setLinkedinId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const database = await getDb();
        if (!database) return;
        const snap = await getDoc(doc(database, 'settings', 'branding'));
        const data = snap.data() as any;
        if (data?.metaPixelId) setMetaPixelId(data.metaPixelId);
        if (data?.linkedinPartnerId) setLinkedinId(data.linkedinPartnerId);
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <>
      {metaPixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${metaPixelId}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}
      {linkedinId && (
        <>
          <Script id="linkedin-insight" strategy="afterInteractive">
            {`
              _linkedin_partner_id = '${linkedinId}';
              window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
              window._linkedin_data_partner_ids.push(_linkedin_partner_id);
            `}
          </Script>
          <Script
            id="linkedin-insight-src"
            strategy="afterInteractive"
            src="https://snap.licdn.com/li.lms-analytics/insight.min.js"
          />
        </>
      )}
    </>
  );
}
