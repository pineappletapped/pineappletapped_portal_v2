
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

// Defer all Firebase imports to the browser to avoid issues during SSR builds
let app: any;
let auth: any = { currentUser: null };
let db: any = null;
let storage: any = {};
let functions: any = {};
let httpsCallable: any;
let sendSignInLinkToEmail: any;
let isSignInWithEmailLink: any;
let signInWithEmailLink: any;
let signInWithEmailAndPassword: any;
let createUserWithEmailAndPassword: any;

let initPromise: Promise<void> | null = null;
async function initFirebase() {
  const appMod = await import('firebase/app');
  const firestoreMod = await import('firebase/firestore');

  app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config);
  db = firestoreMod.getFirestore(app);

  if (typeof window !== 'undefined') {
    const authMod = await import('firebase/auth');
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
    } = authMod);
  }
}

async function ensureFirebase() {
  if (!initPromise) {
    initPromise = initFirebase().catch((error) => {
      console.error('Failed to initialise Firebase', error);
      throw error;
    });
  }
  await initPromise;
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

  return {
    auth,
    db,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
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
  ensureFirebase,
};
