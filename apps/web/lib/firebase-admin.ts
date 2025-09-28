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

const DEFAULT_APP_KEY = '__default__';
const appCache = new Map<string, App>();

function normalise(value: string | undefined | null) {
  return value?.trim() || undefined;
}

function resolveProjectId(override?: string | null): string | undefined {
  return (
    override?.trim() ||
    normalise(process.env.FIREBASE_ADMIN_PROJECT_ID) ||
    normalise(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) ||
    normalise(process.env.GOOGLE_CLOUD_PROJECT) ||
    normalise(process.env.GCLOUD_PROJECT)
  );
}

function getExistingAppByName(name: string | undefined): App | null {
  if (!name) {
    try {
      return getApp();
    } catch (error) {
      return null;
    }
  }

  const match = getApps().find((app) => app.name === name);
  return match ?? null;
}

function getAppCacheKey(projectIdOverride?: string | null) {
  return projectIdOverride ? `project:${projectIdOverride}` : DEFAULT_APP_KEY;
}

function createAdminApp(projectIdOverride?: string | null): App {
  const trimmedOverride = projectIdOverride?.trim() || undefined;
  const cacheKey = getAppCacheKey(trimmedOverride);
  const cached = appCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const appName = trimmedOverride ? `project-${trimmedOverride}` : undefined;
  const existing = getExistingAppByName(appName);
  if (existing) {
    appCache.set(cacheKey, existing);
    return existing;
  }

  const resolvedProjectId = resolveProjectId(trimmedOverride);
  const clientEmail = normalise(process.env.FIREBASE_ADMIN_CLIENT_EMAIL);
  const privateKey = normalise(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  const hasServiceAccount = Boolean(clientEmail && privateKey);

  if (hasServiceAccount && !resolvedProjectId) {
    throw new Error('Firebase admin project ID is not configured.');
  }

  const initialise = () => {
    if (hasServiceAccount) {
      const cleanedKey = privateKey!.replace(/\\n/g, '\n');
      return initializeApp(
        {
          credential: cert({
            projectId: resolvedProjectId!,
            clientEmail: clientEmail!,
            privateKey: cleanedKey,
          }),
          projectId: resolvedProjectId!,
        },
        appName
      );
    }

    const options: Parameters<typeof initializeApp>[0] = {
      credential: applicationDefault(),
      ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
    };

    return initializeApp(options, appName);
  };

  const app = initialise();
  appCache.set(cacheKey, app);
  return app;
}

export function getFirebaseAdminApp(projectIdOverride?: string | null): App {
  return createAdminApp(projectIdOverride);
}

export function getFirebaseAdminAuth(projectIdOverride?: string | null) {
  return getAuth(getFirebaseAdminApp(projectIdOverride));
}

export function getFirebaseAdminFirestore(projectIdOverride?: string | null) {
  return getFirestore(getFirebaseAdminApp(projectIdOverride));
}
