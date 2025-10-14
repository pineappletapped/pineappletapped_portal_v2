import { ensureFirebase, httpsCallable } from './firebase';

let analyticsDisabled = false;
let hasLoggedFailure = false;
type CallableHandler = (payload: Record<string, unknown>) => Promise<unknown>;

let analyticsCallable: CallableHandler | null = null;

async function ensureAnalyticsCallable(): Promise<CallableHandler> {
  if (analyticsCallable) {
    return analyticsCallable;
  }

  const { functions } = await ensureFirebase();
  if (!functions || (functions as any).__isPlaceholder) {
    throw new Error('Firebase functions are unavailable');
  }

  if (typeof httpsCallable !== 'function') {
    throw new Error('httpsCallable is unavailable');
  }

  analyticsCallable = httpsCallable(functions, 'analytics_track');

  if (!analyticsCallable) {
    throw new Error('Analytics callable not initialised');
  }

  return analyticsCallable;
}

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

  try {
    const callable = await ensureAnalyticsCallable();
    await callable({
      path,
      referrer: document.referrer || null,
      userAgent: navigator.userAgent,
      visitorId: getVisitorId(),
      duration: duration || 0,
    });
  } catch (err) {
    analyticsDisabled = true;
    if (!hasLoggedFailure) {
      hasLoggedFailure = true;
      // eslint-disable-next-line no-console
      console.warn('trackPageView disabled after error', err);
    }
  }
}
