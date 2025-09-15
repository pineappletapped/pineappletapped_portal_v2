
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ptfbportalbackend',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    'pineapple-tapped---portal.appspot.com',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
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
    initPromise = initFirebase().catch(() => {});
  }
  await initPromise;
  return { app, auth, db, storage, functions };
}

export async function getDb() {
  await ensureFirebase();
  return db;
}

if (
  typeof window !== 'undefined' &&
  config.apiKey &&
  !config.apiKey.startsWith('REPLACE_WITH')
) {
  ensureFirebase();
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
