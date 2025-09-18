'use client';
import { useState } from 'react';
import { getClientFirebaseAuth } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { setPersistence, browserLocalPersistence, type UserCredential } from 'firebase/auth';

const TEMP_ADMIN_PASSWORD = 'DDp42km9TT!!Campion02';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedUsername = username.trim();
    const normalizedUsername = trimmedUsername.toLowerCase();
    const isTempAdmin =
      normalizedUsername === 'ryanadmin' || normalizedUsername === 'ryanadmin@pineappletapped.com';
    if (isTempAdmin && password !== TEMP_ADMIN_PASSWORD) {
      setError('Invalid admin password');
      return;
    }

    const email = isTempAdmin
      ? 'ryanadmin@pineappletapped.com'
      : trimmedUsername.includes('@')
        ? trimmedUsername
        : `${trimmedUsername}@pineappletapped.com`;
    try {
      const { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword } =
        await getClientFirebaseAuth();
      await setPersistence(auth, browserLocalPersistence);
      let credential: UserCredential;
      try {
        credential = await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        if (isTempAdmin && err?.code === 'auth/user-not-found') {
          credential = await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
      const userRef = doc(db, 'users', credential.user.uid);
      let isStaff = false;
      if (
        credential.user.uid === 'WK6WCuSueLN5M3Zq6D7WBbHyGPo1' ||
        credential.user.email === 'ryan@pineappletapped.com' ||
        credential.user.email === 'ryanadmin@pineappletapped.com'
      ) {
        await setDoc(userRef, { isStaff: true }, { merge: true });
        isStaff = true;
      } else {
        const userDoc = await getDoc(userRef);
        isStaff = userDoc.exists() && !!userDoc.data()?.isStaff;
      }
      const token = await credential.user.getIdToken();
      const maxAge = 60 * 60 * 24 * 7; // 7 days
      const secureAttr = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
      const baseAttrs = `Path=/; Max-Age=${maxAge}; SameSite=Strict${secureAttr}`;
      document.cookie = `token=${encodeURIComponent(token)}; ${baseAttrs}`;
      document.cookie = `uid=${encodeURIComponent(credential.user.uid)}; ${baseAttrs}`;
      document.cookie = `isStaff=${isStaff ? '1' : '0'}; ${baseAttrs}`;
      window.location.href = isStaff ? '/admin' : '/dashboard';
    } catch (err) {
      console.error('Failed to sign in with Firebase', err);
      setError('Invalid credentials');
    }
  };

  return (
    <div className="max-w-md mx-auto card grid gap-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <form onSubmit={login} className="grid gap-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input
          className="input"
          type="text"
          placeholder="Username or Email"
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="btn">
          Login
        </button>
      </form>
    </div>
  );
}
