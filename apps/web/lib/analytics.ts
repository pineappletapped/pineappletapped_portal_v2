import { ensureFirebase } from './firebase';
import { postHttpFunctionOrThrow } from './httpFunctions';

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

  try {
    let idToken: string | null = null;
    try {
      const { auth } = await ensureFirebase();
      const user = auth && !(auth as any).__isPlaceholder ? auth.currentUser : null;
      if (user) {
        idToken = await user.getIdToken();
      }
    } catch (_authError) {
      // Proceed without an auth token if it cannot be resolved.
    }

    await postHttpFunctionOrThrow('analytics_track', {
      body: {
        path,
        referrer: document.referrer || null,
        userAgent: navigator.userAgent,
        visitorId: getVisitorId(),
        duration: duration || 0,
      },
      idToken,
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
