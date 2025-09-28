import { auth } from './firebase';

const rawProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const projectId =
  rawProjectId && rawProjectId !== 'undefined'
    ? rawProjectId
    : 'ptfbportalbackend';
const ANALYTICS_ENDPOINT = `https://us-central1-${projectId}.cloudfunctions.net/analytics_track`;

const DEFAULT_ANALYTICS_ALLOWED_ORIGINS = [
  'https://pineapple--pineapple-tapped---portal.europe-west4.hosted.app',
  'https://ptfbportalbackend--pineapple-tapped---portal.us-central1.hosted.app',
  'http://localhost:3000',
];

const parseAllowedAnalyticsOrigins = () => {
  const raw = process.env.NEXT_PUBLIC_ANALYTICS_ALLOWED_ORIGINS;
  if (typeof raw !== 'string' || !raw.trim()) {
    return DEFAULT_ANALYTICS_ALLOWED_ORIGINS;
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const ANALYTICS_ALLOWED_ORIGINS = new Set(parseAllowedAnalyticsOrigins());

function isAnalyticsOriginAllowed() {
  if (process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_TRACKING === 'true') {
    return true;
  }

  if (process.env.NEXT_PUBLIC_DISABLE_ANALYTICS_TRACKING === 'true') {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const origin = window.location.origin;
  return ANALYTICS_ALLOWED_ORIGINS.has(origin);
}

let analyticsDisabled = false;
let hasLoggedFailure = false;

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
  if (analyticsDisabled || typeof window === 'undefined') return;

  if (!isAnalyticsOriginAllowed()) {
    return;
  }

  try {
    const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
    const response = await fetch(ANALYTICS_ENDPOINT, {
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

    if (!response.ok) {
      throw new Error(`Analytics request failed with status ${response.status}`);
    }
  } catch (err) {
    analyticsDisabled = true;
    if (!hasLoggedFailure) {
      hasLoggedFailure = true;
      // eslint-disable-next-line no-console
      console.warn('trackPageView disabled after error', err);
    }
  }
}
