import assert from 'node:assert/strict';

import { auth } from '../lib/firebase';

function ensureFunction(value: unknown, description: string): asserts value is (...args: any[]) => any {
  assert.strictEqual(typeof value, 'function', `${description} should be a function`);
}

(async () => {
  assert.ok(auth, 'Auth export should be defined');
  assert.strictEqual(auth.currentUser ?? null, null, 'auth.currentUser should default to null');

  ensureFunction((auth as any).onAuthStateChanged, 'auth.onAuthStateChanged');

  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = (auth as any).onAuthStateChanged(() => {
      throw new Error('Placeholder onAuthStateChanged should not invoke callbacks.');
    });
  } catch (error) {
    console.error('auth.onAuthStateChanged threw before initialisation:', error);
    process.exitCode = 1;
    return;
  }

  if (typeof unsubscribe === 'function') {
    unsubscribe();
  }

  console.log('Firebase auth placeholder exports are safe to access before initialisation.');
})();
