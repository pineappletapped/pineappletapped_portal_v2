'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getClientFirebaseAuth } from '@/lib/firebase';
import { setPersistence, browserLocalPersistence } from 'firebase/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [resetEmail, setResetEmail] = useState<string | null>(null);
  const router = useRouter();

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResetEmail(null);

    const trimmedUsername = username.trim();
    const normalizedUsername = trimmedUsername.toLowerCase();
    const email = trimmedUsername.includes('@')
      ? trimmedUsername
      : `${normalizedUsername}@pineappletapped.com`;

    try {
      const { auth, signInWithEmailAndPassword } = await getClientFirebaseAuth();
      await setPersistence(auth, browserLocalPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const token = await credential.user.getIdToken();
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ idToken: token }),
      });

      if (!response.ok) {
        throw new Error('SESSION_CREATION_FAILED');
      }

      const data: { destination?: string | null } = await response.json();
      const destination = data.destination && typeof data.destination === 'string'
        ? data.destination
        : '/dashboard';
      window.location.href = destination;
    } catch (err: any) {
      console.error('Failed to sign in with Firebase', err);
      if (err?.code === 'auth/user-not-found') {
        setError('No account exists for that username or email. Please contact an administrator.');
      } else if (err?.code === 'auth/wrong-password') {
        setError('Invalid email or password. Please try again.');
      } else if (err?.code === 'auth/too-many-requests') {
        setError('Too many unsuccessful attempts. Reset your password or try again later.');
      } else {
        setError('Unable to sign in right now. Please try again later.');
      }
      setResetEmail(null);
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    setResetEmail(null);

    const defaultIdentifier = username.trim();
    const defaultEmail = defaultIdentifier
      ? defaultIdentifier.includes('@')
        ? defaultIdentifier
        : `${defaultIdentifier}@pineappletapped.com`
      : '';

    const input =
      typeof window === 'undefined'
        ? ''
        : window.prompt('Enter the email address for your account', defaultEmail);

    if (!input) {
      return;
    }

    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setError('Please enter an email address to reset your password.');
      return;
    }

    const email = trimmedInput.includes('@')
      ? trimmedInput
      : `${trimmedInput}@pineappletapped.com`;

    try {
      const { auth, sendPasswordResetEmail } = await getClientFirebaseAuth();
      await sendPasswordResetEmail(auth, email);
      setResetEmail(email);
      router.prefetch(`/auth/reset?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      console.error('Failed to send password reset email', err);
      if (err?.code === 'auth/invalid-email') {
        setError('That email address is not valid.');
      } else if (err?.code === 'auth/user-not-found') {
        setError('No account found with that email address.');
      } else {
        setError('Unable to send a password reset email right now. Please try again later.');
      }
      setResetEmail(null);
    }
  };

  return (
    <div className="max-w-md mx-auto card grid gap-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <form onSubmit={login} className="grid gap-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {resetEmail && (
          <p className="text-sm text-green-600">
            Password reset email sent to <span className="font-medium">{resetEmail}</span>.{' '}
            <Link
              href={`/auth/reset?email=${encodeURIComponent(resetEmail)}`}
              className="underline"
            >
              View next steps
            </Link>
            .
          </p>
        )}
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
        <button
          type="button"
          className="btn btn-link justify-start px-0"
          onClick={handlePasswordReset}
        >
          Forgot password?
        </button>
      </form>
    </div>
  );
}
