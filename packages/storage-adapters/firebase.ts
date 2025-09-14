
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    'pineapple-tapped---portal.appspot.com',
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
const storage = getStorage(app);

export async function putFile(key: string, file: File, onProgress?: (pct:number)=>void) {
  const r = ref(storage, key);
  const task = uploadBytesResumable(r, file, { contentType: file.type });
  return new Promise<string>((resolve, reject) => {
    task.on('state_changed', (snap) => {
      if (onProgress) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
    }, reject, async () => {
      const url = await getDownloadURL(task.snapshot.ref);
      resolve(url);
    });
  });
}
