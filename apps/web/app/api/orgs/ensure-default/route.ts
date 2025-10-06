import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase-admin";

interface OrganisationRecord {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  isDefault: boolean;
}

function unauthorised() {
  return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
}

export async function POST() {
  const cookieStore = cookies();
  const sessionCookie =
    cookieStore.get("session")?.value ??
    cookieStore.get("__session")?.value ??
    cookieStore.get("firebase-session")?.value ??
    null;

  if (!sessionCookie) {
    return unauthorised();
  }

  try {
    const auth = getFirebaseAdminAuth();
    const firestore = getFirebaseAdminFirestore();
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const uid = decoded.uid;

    if (!uid) {
      return unauthorised();
    }

    const orgsCollection = firestore.collection("orgs");
    const membershipsCollection = firestore.collection("memberships");
    const usersCollection = firestore.collection("users");

    let organisation: OrganisationRecord | null = null;

    await firestore.runTransaction(async (tx) => {
      const existingMembershipSnap = await tx.get(
        membershipsCollection.where("userId", "==", uid).limit(1)
      );

      if (!existingMembershipSnap.empty) {
        const membershipDoc = existingMembershipSnap.docs[0];
        const orgId = membershipDoc.get("orgId");
        if (typeof orgId === "string" && orgId.trim().length > 0) {
          const orgRef = orgsCollection.doc(orgId);
          const orgSnap = await tx.get(orgRef);
          if (orgSnap.exists) {
            const data = orgSnap.data() as Record<string, unknown>;
            organisation = {
              id: orgSnap.id,
              name: typeof data?.name === "string" ? (data.name as string) : "Untitled organisation",
              ownerId: typeof data?.ownerId === "string" ? (data.ownerId as string) : null,
              ownerName: typeof data?.ownerName === "string" ? (data.ownerName as string) : null,
              ownerEmail: typeof data?.ownerEmail === "string" ? (data.ownerEmail as string) : null,
              isDefault: Boolean(data?.isDefault),
            };
          }
        }
        return;
      }

      const userRef = usersCollection.doc(uid);
      const userSnap = await tx.get(userRef);
      const userData = (userSnap.exists ? userSnap.data() : null) ?? {};

      const rawOrgName =
        (typeof userData.organisation === "string" && userData.organisation.trim()) ||
        (typeof userData.company === "string" && userData.company.trim()) ||
        (typeof userData.companyName === "string" && userData.companyName.trim()) ||
        (typeof userData.fullName === "string" && userData.fullName.trim()) ||
        (typeof decoded.email === "string" && decoded.email.trim().split("@")[0]) ||
        "Organisation";

      const defaultOrgName = rawOrgName.length > 60 ? `${rawOrgName.slice(0, 57)}…` : rawOrgName;

      const ownerName =
        (typeof userData.fullName === "string" && userData.fullName.trim()) ||
        (typeof decoded.name === "string" && decoded.name.trim()) ||
        null;
      const ownerEmail =
        (typeof decoded.email === "string" && decoded.email.trim()) ||
        (typeof userData.email === "string" && userData.email.trim()) ||
        null;

      const orgRef = orgsCollection.doc();
      const now = FieldValue.serverTimestamp();
      tx.set(orgRef, {
        name: defaultOrgName,
        ownerId: uid,
        ownerName,
        ownerEmail,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      const membershipRef = membershipsCollection.doc(`${orgRef.id}_${uid}`);
      tx.set(membershipRef, {
        orgId: orgRef.id,
        userId: uid,
        role: "client_admin",
        createdAt: now,
        updatedAt: now,
      });

      organisation = {
        id: orgRef.id,
        name: defaultOrgName,
        ownerId: uid,
        ownerName,
        ownerEmail,
        isDefault: true,
      };
    });

    if (!organisation) {
      return NextResponse.json({ error: "Failed to resolve organisation." }, { status: 500 });
    }

    return NextResponse.json({ organisation });
  } catch (error) {
    console.error("Failed to ensure default organisation", error);
    return NextResponse.json({ error: "Failed to ensure default organisation." }, { status: 500 });
  }
}
