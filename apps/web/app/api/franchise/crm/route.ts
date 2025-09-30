import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { collectCrmFranchiseTokens } from "@/lib/crm";

interface FranchiseContext {
  uid: string;
  email: string | null;
  franchiseIds: string[];
}

function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

function serialiseValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serialiseValue(entry));
  }
  if (typeof value !== "object") {
    return value;
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date.toISOString();
    } catch (error) {
      console.warn("Failed to serialise Firestore timestamp", error);
      return value;
    }
  }
  const proto = Object.getPrototypeOf(value);
  if (!proto || proto === Object.prototype) {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      result[key] = serialiseValue(entry);
    });
    return result;
  }
  return value;
}

function serialiseUserDoc(doc: QueryDocumentSnapshot): Record<string, unknown> {
  const data = doc.data() ?? {};
  const result: Record<string, unknown> = { id: doc.id };
  Object.entries(data).forEach(([key, value]) => {
    result[key] = serialiseValue(value);
  });
  return result;
}

function deriveFranchiseIdsFromUserDoc(data: Record<string, any> | null | undefined): string[] {
  if (!data) {
    return [];
  }
  const ids = new Set<string>();
  const pushValue = (raw: unknown) => {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  };

  pushValue(data.primaryFranchiseId);
  pushValue(data.franchiseId);

  if (Array.isArray(data.franchiseIds)) {
    data.franchiseIds.forEach((value: unknown) => pushValue(value));
  }

  const roles = data.franchiseRoles;
  if (roles && typeof roles === "object") {
    Object.values(roles).forEach((value) => pushValue(value));
  }

  if (Array.isArray(data.territories)) {
    data.territories.forEach((entry: unknown) => {
      if (typeof entry === "string") {
        pushValue(entry);
      } else if (entry && typeof entry === "object") {
        pushValue((entry as Record<string, unknown>).franchiseId);
      }
    });
  }

  return Array.from(ids);
}

async function resolveFranchiseContext(): Promise<FranchiseContext | null> {
  const cookieStore = cookies();
  const sessionCookie =
    cookieStore.get("session")?.value ??
    cookieStore.get("__session")?.value ??
    cookieStore.get("firebase-session")?.value ??
    null;

  if (!sessionCookie) {
    return null;
  }

  try {
    const auth = getFirebaseAdminAuth();
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const firestore = getFirebaseAdminFirestore();
    const userSnap = await firestore.collection("users").doc(decoded.uid).get();
    const userData = userSnap.exists ? (userSnap.data() as Record<string, any>) : {};
    const email =
      typeof decoded.email === "string"
        ? decoded.email
        : typeof userData.email === "string"
        ? userData.email
        : null;

    const franchiseIds = new Set<string>(deriveFranchiseIdsFromUserDoc(userData));

    const memberSnapshot = await firestore
      .collection("franchiseMembers")
      .where("userId", "==", decoded.uid)
      .get();
    memberSnapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      const franchiseId = typeof data.franchiseId === "string" ? data.franchiseId.trim() : "";
      if (franchiseId) {
        franchiseIds.add(franchiseId);
      }
    });

    return {
      uid: decoded.uid,
      email,
      franchiseIds: Array.from(franchiseIds),
    };
  } catch (error) {
    console.warn("Failed to verify franchise session", error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const context = await resolveFranchiseContext();
  if (!context) {
    return unauthorized();
  }

  if (context.franchiseIds.length === 0) {
    return forbidden("No franchise membership found for this account.");
  }

  const url = new URL(req.url);
  const requestedFranchiseId = url.searchParams.get("franchiseId");

  const firestore = getFirebaseAdminFirestore();

  const accessibleIds = new Set(context.franchiseIds.map((id) => id.trim()).filter(Boolean));

  let requestedIds: string[];
  if (!requestedFranchiseId || requestedFranchiseId === "all") {
    requestedIds = Array.from(accessibleIds);
  } else {
    if (!accessibleIds.has(requestedFranchiseId)) {
      return forbidden("You do not have access to this franchise.");
    }
    requestedIds = [requestedFranchiseId];
  }

  try {
    const franchisesSnapshot = await firestore.collection("franchises").get();
    const franchiseIdIndex = new Map<string, string>();
    const franchiseCodeIndex = new Map<string, string>();
    const franchiseNameIndex = new Map<string, string>();

    franchisesSnapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      const id = docSnap.id.trim();
      if (id) {
        franchiseIdIndex.set(id.toLowerCase(), id);
      }
      const code = typeof data.code === "string" ? data.code.trim() : "";
      if (code) {
        franchiseCodeIndex.set(code.toLowerCase(), id);
      }
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (name) {
        franchiseNameIndex.set(name.toLowerCase(), id);
      }
    });

    const usersSnapshot = await firestore.collection("users").get();
    const filtered: Record<string, unknown>[] = [];

    usersSnapshot.docs.forEach((docSnap) => {
      const serialised = serialiseUserDoc(docSnap);
      const tokens = collectCrmFranchiseTokens(serialised);
      const matches = new Set<string>();
      tokens.forEach((token) => {
        const lower = token.trim().toLowerCase();
        if (!lower) {
          return;
        }
        const byId = franchiseIdIndex.get(lower);
        if (byId) {
          matches.add(byId);
        }
        const byCode = franchiseCodeIndex.get(lower);
        if (byCode) {
          matches.add(byCode);
        }
        const byName = franchiseNameIndex.get(lower);
        if (byName) {
          matches.add(byName);
        }
      });

      if (matches.size === 0) {
        return;
      }

      const matchArray = Array.from(matches);
      const isAccessible = matchArray.some((id) => accessibleIds.has(id));
      if (!isAccessible) {
        return;
      }

      const matchesRequested = matchArray.some((id) => requestedIds.includes(id));
      if (!matchesRequested) {
        return;
      }

      (serialised as Record<string, unknown>).matchedFranchiseIds = matchArray;
      filtered.push(serialised);
    });

    return NextResponse.json({ records: filtered });
  } catch (error) {
    console.error("Failed to load franchise CRM records", error);
    return NextResponse.json({ error: "Failed to load CRM records." }, { status: 500 });
  }
}
