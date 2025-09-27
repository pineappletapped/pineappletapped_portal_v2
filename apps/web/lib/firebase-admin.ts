import 'server-only';

import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let cachedApp: App | null = null;

function createAdminApp(): App {
  if (cachedApp) {
    return cachedApp;
  }

  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = getApp();
    return cachedApp;
  }

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    if (!projectId) {
      throw new Error('Firebase admin project ID is not configured.');
    }

    const cleanedKey = privateKey.replace(/\\n/g, '\n');

    cachedApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: cleanedKey,
      }),
    });

    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });

  return cachedApp;
}

export function getFirebaseAdminApp(): App {
  return createAdminApp();
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getFirebaseAdminApp());
}
