import { db, getDb } from "./firebase";

async function loadFirestore() {
  try {
    const database = await getDb();
    if (!database) return null;
    return await import("firebase/firestore");
  } catch {
    return null;
  }
}

export interface Equipment {
  id?: string;
  name: string;
  serialNumber: string;
  category: string;
  ownerId: string; // 'company' or user uid
  newValue: number;
  currentValue: number;
  rentalPrice: number;
  description?: string;
  weightKg?: number;
  length?: string;
  photo?: string;
  documents?: string[];
  config?: {
    username?: string;
    password?: string;
    ip?: string;
    firmware?: string;
    lastServiced?: string;
  };
  damage?: string;
  manualUrl?: string;
  notes?: string;
  available?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface EquipmentBooking {
  id?: string;
  start: any;
  end: any;
  projectId: string;
}

export interface ProductKitGroup {
  groupId: string;
  items: Equipment[];
}

export async function getProductKit(productId: string): Promise<ProductKitGroup[]> {
  try {
    const fs = await loadFirestore();
    if (!fs) return [];
    const prod = await fs.getDoc(fs.doc(db, "products", productId));
    if (!prod.exists()) return [];
    const required = (prod.data() as any).requiredKit || [];
    const groups: ProductKitGroup[] = [];
    for (const g of required) {
      const items: Equipment[] = [];
      for (const id of g.items || []) {
        const snap = await fs.getDoc(fs.doc(db, "equipment", id));
        if (snap.exists()) {
          items.push({ id: snap.id, ...(snap.data() as any) } as Equipment);
        }
      }
      groups.push({ groupId: g.groupId, items });
    }
    return groups;
  } catch {
    return [];
  }
}
