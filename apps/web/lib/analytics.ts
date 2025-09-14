import { auth } from './firebase';

const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ptfbportalbackend';
const ANALYTICS_ENDPOINT = `https://us-central1-${projectId}.cloudfunctions.net/analytics_track`;

let visitorId: string | null = null;
function getVisitorId() {
  if (visitorId) return visitorId;
  if (typeof window === 'undefined') return null;
  visitorId = localStorage.getItem('analytics_uid');
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem('analytics_uid', visitorId);
  }
  return visitorId;
}

export async function trackPageView(path: string, duration?: number) {
  if (typeof window === 'undefined') return;
  try {
    const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
    await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        path,
        referrer: document.referrer || null,
        userAgent: navigator.userAgent,
        visitorId: getVisitorId(),
        duration: duration || 0,
      }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('trackPageView failed', err);
  }
}
