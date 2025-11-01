import { auth } from './firebase';

const FUNCTIONS_BASE_URL =
  process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://europe-west2-pineapple-tapped---portal.cloudfunctions.app';

const USE_LEGACY_ONLY = process.env.NEXT_PUBLIC_USE_LEGACY_FUNCTIONS === '1';

async function callLegacy(path: string, options: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE_URL}/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function callLocal(path: string, options: RequestInit) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function adminListUsers() {
  if (!USE_LEGACY_ONLY) {
    try {
      return await callLocal('/users', { method: 'GET' });
    } catch (error) {
      console.warn('Local admin users API failed, falling back to Cloud Functions', error);
    }
  }
  return callLegacy('admin_listUsers', { method: 'GET' });
}

export async function adminUpdateUser(payload: any) {
  if (!USE_LEGACY_ONLY) {
    try {
      return await callLocal('/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn('Local admin user update failed, falling back to Cloud Functions', error);
    }
  }
  return callLegacy('admin_updateUser', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
