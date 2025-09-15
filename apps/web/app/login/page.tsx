'use client';
import { useState } from 'react';
import { auth, db, signInWithEmailAndPassword } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, type UserCredential } from 'firebase/auth';
import { setPersistence, browserLocalPersistence } from 'firebase/auth';

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
    const email = isTempAdmin
      ? 'ryanadmin@pineappletapped.com'
      : trimmedUsername.includes('@')
        ? trimmedUsername
        : `${trimmedUsername}@pineappletapped.com`;
    try {
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
      document.cookie = `token=${token}; path=/`;
      document.cookie = `uid=${credential.user.uid}; path=/`;
      document.cookie = `isStaff=${isStaff ? '1' : '0'}; path=/`;
      window.location.href = isStaff ? '/admin' : '/dashboard';
    } catch (err) {
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
