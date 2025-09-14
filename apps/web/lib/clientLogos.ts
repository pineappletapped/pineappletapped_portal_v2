import { db, getDb } from './firebase';

async function loadFirestore() {
  if (typeof window === 'undefined') return null;
  try {
    const database = await getDb();
    if (!database) return null;
    return await import('firebase/firestore');
  } catch {
    return null;
  }
}

export interface ClientLogo {
  id: string;
  name: string;
  imageUrl: string;
}

const sampleLogos: ClientLogo[] = [
  { id: '1', name: 'Logo 1', imageUrl: '/placeholder.jpg' },
  { id: '2', name: 'Logo 2', imageUrl: '/placeholder.jpg' },
  { id: '3', name: 'Logo 3', imageUrl: '/placeholder.jpg' },
  { id: '4', name: 'Logo 4', imageUrl: '/placeholder.jpg' },
];

export async function getClientLogos(): Promise<ClientLogo[]> {
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error('unavailable');
    const snap = await fs.getDocs(fs.collection(db, 'clientLogos'));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  } catch {
    return sampleLogos;
  }
}
