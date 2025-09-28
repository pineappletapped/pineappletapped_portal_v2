'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getClientFirebaseAuth } from '@/lib/firebase';
import { setPersistence, browserLocalPersistence } from 'firebase/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [resetEmail, setResetEmail] = useState<string | null>(null);
  const [isResetFormVisible, setIsResetFormVisible] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const resetInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (isResetFormVisible) {
      requestAnimationFrame(() => {
        resetInputRef.current?.focus();
      });
    }
  }, [isResetFormVisible]);

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
        let message = 'Unable to sign in right now. Please try again later.';
        try {
          const payload: unknown = await response.json();
          const extracted =
            payload && typeof payload === 'object' && 'error' in payload && typeof (payload as any).error === 'string'
              ? (payload as any).error.trim()
              : '';
          if (extracted) {
            message = extracted;
          } else if (response.status === 401) {
            message = 'We could not establish a secure session for your account. Please contact an administrator.';
          }
        } catch (parseError) {
          console.warn('Failed to parse session creation error response', parseError);
        }

        try {
          await credential.user.reload();
        } catch (reloadError) {
          console.warn('Failed to reload user after session failure', reloadError);
        }

        try {
          await auth.signOut();
        } catch (signOutError) {
          console.warn('Failed to clear Firebase session after session creation error', signOutError);
        }

        setError(message);
        return;
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
      try {
        const { auth } = await getClientFirebaseAuth();
        await auth.signOut();
      } catch (cleanupError) {
        console.warn('Failed to ensure Firebase session cleared after login error', cleanupError);
      }
    }
  };

  const openResetForm = () => {
    setError('');
    setResetEmail(null);
    const defaultIdentifier = username.trim();
    const defaultValue = defaultIdentifier
      ? defaultIdentifier.includes('@')
        ? defaultIdentifier
        : `${defaultIdentifier}@pineappletapped.com`
      : '';
    setResetIdentifier(defaultValue);
    setIsResetFormVisible(true);
  };

  const cancelReset = () => {
    setIsResetFormVisible(false);
    setResetIdentifier('');
  };

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setResetEmail(null);

    const trimmedInput = resetIdentifier.trim();
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
      setIsResetFormVisible(false);
      setResetIdentifier('');
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
      {error && (
        <p className="text-sm text-red-600" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {resetEmail && (
        <p className="text-sm text-green-600" role="status" aria-live="polite">
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
      <form onSubmit={login} className="grid gap-3" noValidate>
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
      <div className="grid gap-2">
        <button
          type="button"
          className="btn btn-link justify-start px-0"
          onClick={openResetForm}
          aria-expanded={isResetFormVisible}
          aria-controls="password-reset-panel"
        >
          Forgot password?
        </button>
        {isResetFormVisible && (
          <div
            id="password-reset-panel"
            className="rounded-md border border-base-300 p-3 bg-base-100"
            role="region"
            aria-labelledby="password-reset-heading"
          >
            <h2 id="password-reset-heading" className="text-sm font-medium">
              Reset your password
            </h2>
            <p id="password-reset-instructions" className="text-xs text-base-content/70">
              Enter the email associated with your account and we will send you a link to reset your password.
            </p>
            <form className="mt-2 grid gap-2" onSubmit={handlePasswordReset} noValidate>
              <label htmlFor="reset-email" className="text-xs font-medium">
                Email address
              </label>
              <input
                id="reset-email"
                ref={resetInputRef}
                className="input input-sm"
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-describedby="password-reset-instructions"
                value={resetIdentifier}
                onChange={event => setResetIdentifier(event.target.value)}
                required
              />
              <div className="flex gap-2">
                <button type="submit" className="btn btn-sm">
                  Send reset link
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelReset}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
