
const cleanEnv = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed && trimmed !== 'undefined' ? trimmed : undefined;
};

const apiKey = cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
const authDomain = cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN);
const projectId =
  cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) || 'ptfbportalbackend';
const storageBucket =
  cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) ||
  'pineapple-tapped---portal.appspot.com';
const appId = cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
const measurementId = cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID);

const config = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  appId,
  measurementId,
};

const missingServiceError = (service: string) =>
  new Error(
    `Firebase ${service} has not been initialised yet. Ensure ensureFirebase() has resolved before accessing ${service}.`
  );

const noop = () => {};

const createAuthPlaceholder = () => ({
  __isPlaceholder: true,
  currentUser: null,
  onAuthStateChanged: () => noop,
  signOut: undefined,
});

const createServicePlaceholder = (service: string) =>
  new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === '__isPlaceholder') {
          return true;
        }
        if (key === 'toString') {
          return () => `[uninitialised Firebase ${service}]`;
        }
        if (typeof key === 'symbol' && key.toString() === 'Symbol.toStringTag') {
          return `Firebase${service}Placeholder`;
        }
        throw missingServiceError(service);
      },
      apply: () => {
        throw missingServiceError(service);
      },
    }
  );

const createHttpsCallablePlaceholder = () => () => {
  throw missingServiceError('functions (httpsCallable)');
};

// Defer all Firebase imports to the browser to avoid issues during SSR builds
let app: any;
let auth: any = createAuthPlaceholder();
let db: any = null;
let storage: any = createServicePlaceholder('storage');
let functions: any = createServicePlaceholder('functions');
let httpsCallable: any = createHttpsCallablePlaceholder();
let sendSignInLinkToEmail: any;
let isSignInWithEmailLink: any;
let signInWithEmailLink: any;
let signInWithEmailAndPassword: any;
let createUserWithEmailAndPassword: any;
let sendPasswordResetEmail: any;

let authModulePromise: Promise<typeof import('firebase/auth')> | null = null;

let coreInitPromise: Promise<void> | null = null;
let browserInitPromise: Promise<void> | null = null;

async function initCoreFirebase() {
  const appMod = await import('firebase/app');
  const firestoreMod = await import('firebase/firestore');

  app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config);
  db = firestoreMod.getFirestore(app);
}

async function loadAuthModule() {
  if (!authModulePromise) {
    authModulePromise = import('firebase/auth').catch((error) => {
      console.error('Failed to load firebase/auth module', error);
      authModulePromise = null;
      throw error;
    });
  }

  return authModulePromise;
}

async function initBrowserFirebase() {
  await initCoreFirebase();

  const authMod = await loadAuthModule();
  const functionsMod = await import('firebase/functions');
  const storageMod = await import('firebase/storage');

  auth = authMod.getAuth(app);
  storage = storageMod.getStorage(app);
  functions = functionsMod.getFunctions(app);
  ({ httpsCallable } = functionsMod);

  ({
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
  } = authMod);
}

async function ensureFirebase() {
  if (!coreInitPromise) {
    coreInitPromise = initCoreFirebase().catch((error) => {
      console.error('Failed to initialise Firebase app', error);
      db = null;
      coreInitPromise = null;
      throw error;
    });
  }

  await coreInitPromise;

  if (typeof window !== 'undefined') {
    if (!browserInitPromise) {
      browserInitPromise = initBrowserFirebase().catch((error) => {
        console.error('Failed to initialise browser Firebase services', error);
        auth = createAuthPlaceholder();
        storage = createServicePlaceholder('storage');
        functions = createServicePlaceholder('functions');
        httpsCallable = createHttpsCallablePlaceholder();
        browserInitPromise = null;
        throw error;
      });
    }

    await browserInitPromise;
  }

  return { app, auth, db, storage, functions };
}

export async function getDb() {
  await ensureFirebase();
  return db;
}

export async function getClientFirebaseAuth() {
  await ensureFirebase();

  if (!db) {
    throw new Error('Firestore has not been initialised.');
  }

  if (typeof signInWithEmailAndPassword !== 'function') {
    throw new Error('Firebase auth helpers are unavailable.');
  }

  if (!auth || typeof auth.signOut !== 'function') {
    throw new Error('Firebase auth has not been initialised.');
  }

  if (typeof sendPasswordResetEmail !== 'function') {
    throw new Error('Firebase password reset helper is unavailable.');
  }

  return {
    auth,
    db,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
  };
}

if (
  typeof window !== 'undefined' &&
  config.apiKey &&
  !config.apiKey.startsWith('REPLACE_WITH')
) {
  ensureFirebase().catch((error) => {
    console.error('Eager Firebase initialisation failed', error);
  });
}

export {
  app,
  auth,
  db,
  storage,
  functions,
  httpsCallable,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  ensureFirebase,
  loadAuthModule,
};
