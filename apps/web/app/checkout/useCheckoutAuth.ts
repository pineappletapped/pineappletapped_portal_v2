"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { ensureFirebase, loadAuthModule } from "@/lib/firebase";

export const MIN_ACCOUNT_PASSWORD_LENGTH = 8;

type AuthStatus = "idle" | "loading" | "ready" | "error";

export interface CheckoutAuthState {
  status: AuthStatus;
  user: User | null;
  discount: number;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<User | null>;
  ensureUser: (
    email: string,
    password: string,
    displayName?: string,
    confirmPassword?: string,
  ) => Promise<User | null>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const normaliseEmail = (value: string) => value.trim().toLowerCase();

export function useCheckoutAuth(
  {
    onKnownEmail,
    onKnownName,
  }: { onKnownEmail?: (email: string) => void; onKnownName?: (name: string) => void } = {},
): CheckoutAuthState {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const authRef = useRef<Auth | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!auth || !db) {
          throw new Error("Firebase auth or database is unavailable.");
        }

        authRef.current = auth;
        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== "function") {
          throw new Error("Firebase auth listener helper is unavailable.");
        }

        unsubscribeRef.current = onAuthStateChanged(auth, async (nextUser: User | null) => {
          if (cancelled) {
            return;
          }

          setUser(nextUser);
          if (!nextUser) {
            setDiscount(0);
            setStatus("ready");
            return;
          }

          const email = nextUser.email || "";
          if (email && onKnownEmail) {
            onKnownEmail(email);
          }

          const displayName = nextUser.displayName || "";
          if (displayName && onKnownName) {
            onKnownName(displayName);
          }

          try {
            const { db: database } = await ensureFirebase();
            if (!database) {
              throw new Error("Firestore is unavailable.");
            }
            const snap = await getDoc(doc(database, "users", nextUser.uid));
            const rawDiscount = snap.data()?.discount;
            setDiscount(typeof rawDiscount === "number" ? rawDiscount : 0);
          } catch (fetchError) {
            console.warn("Failed to load user discount", fetchError);
            setDiscount(0);
          }

          setStatus("ready");
        });

        setStatus("ready");
      } catch (initialiseError) {
        if (cancelled) {
          return;
        }
        console.error("Failed to initialise Firebase auth", initialiseError);
        setUser(null);
        setDiscount(0);
        setStatus("error");
        setError(
          initialiseError instanceof Error
            ? initialiseError.message
            : "We couldn't connect to the account service. Try again later.",
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
    };
  }, [onKnownEmail, onKnownName]);

  const ensureAuth = useCallback(async () => {
    if (authRef.current) {
      return authRef.current;
    }

    const { auth } = await ensureFirebase();
    if (!auth) {
      throw new Error("Firebase auth has not been initialised.");
    }
    authRef.current = auth;
    return auth;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const auth = await ensureAuth();
      await signInWithEmailAndPassword(auth, normaliseEmail(email), password);
    },
    [ensureAuth],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const trimmedEmail = normaliseEmail(email);
      const auth = await ensureAuth();
      const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const createdUser = credential.user ?? null;
      if (!createdUser) {
        throw new Error("Account was created without a user session.");
      }

      if (displayName && displayName.trim().length > 0) {
        try {
          await updateProfile(createdUser, { displayName: displayName.trim() });
        } catch (profileError) {
          console.warn("Failed to update profile after registration", profileError);
        }
      }

      if (onKnownEmail) {
        onKnownEmail(createdUser.email || trimmedEmail);
      }
      if (displayName && onKnownName) {
        onKnownName(displayName);
      }

      setError(null);
      return createdUser;
    },
    [ensureAuth, onKnownEmail, onKnownName],
  );

  const ensureUser = useCallback(
    async (
      email: string,
      password: string,
      displayName?: string,
      confirmPassword?: string,
    ): Promise<User | null> => {
      if (user) {
        return user;
      }

      const trimmedEmail = normaliseEmail(email);
      if (!trimmedEmail) {
        setError("Enter your email to continue.");
        return null;
      }
      if (password.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
        setError(`Create a password with at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters.`);
        return null;
      }
      if (confirmPassword !== undefined && confirmPassword !== password) {
        setError("Passwords do not match. Check and try again.");
        return null;
      }

      try {
        const created = await register(trimmedEmail, password, displayName);
        return created;
      } catch (registerError) {
        const firebaseError = registerError as Partial<FirebaseError> | null;
        if (firebaseError && typeof firebaseError === "object" && "code" in firebaseError) {
          switch (firebaseError.code) {
            case "auth/email-already-in-use":
              setError("An account already exists for that email. Sign in instead.");
              break;
            case "auth/invalid-email":
              setError("Enter a valid email address.");
              break;
            case "auth/weak-password":
              setError(
                firebaseError.message ||
                  `Password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters long.`,
              );
              break;
            default:
              setError(firebaseError.message || "We couldn't create your account. Try again.");
              break;
          }
        } else if (registerError instanceof Error && registerError.message) {
          setError(registerError.message);
        } else {
          setError("We couldn't create your account. Try again.");
        }
        return null;
      }
    },
    [register, user],
  );

  const signOutOfAuth = useCallback(async () => {
    const auth = await ensureAuth();
    await signOut(auth);
  }, [ensureAuth]);

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      status,
      user,
      discount,
      error,
      login,
      register,
      ensureUser,
      signOut: signOutOfAuth,
      clearError,
    }),
    [status, user, discount, error, login, register, ensureUser, signOutOfAuth, clearError],
  );
}
