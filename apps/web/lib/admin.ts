import { auth } from './firebase';

const BASE_URL =
  process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-pineapple-tapped---portal.cloudfunctions.net';

async function call(path: string, options: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${BASE_URL}/${path}`, {
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

export function adminListUsers() {
  return call('admin_listUsers', { method: 'GET' });
}

export function adminUpdateUser(payload: any) {
  return call('admin_updateUser', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
