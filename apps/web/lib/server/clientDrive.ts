import { google, type drive_v3 } from "googleapis";
import { createHash, randomUUID } from "node:crypto";
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export type DriveOrderProductContext = {
  productId: string;
  name: string;
  quantity: number;
  templateFolderId: string | null;
  folderName: string | null;
};

export type DriveSetupContext = {
  orderId: string;
  orderRef: DocumentReference<DocumentData>;
  clientKey: string;
  clientKeyType: "user_id" | "email" | null;
  companyName: string | null;
  customerName: string | null;
  projectName: string | null;
  emails: string[];
  franchise: {
    id: string | null;
    label: string | null;
    emails: string[];
  };
  products: DriveOrderProductContext[];
  affiliate: {
    id: string;
    name: string;
    refCode: string;
    status: string | null;
    commissionRate: number;
  } | null;
};

type DriveAutomationDeps = {
  firestore: Firestore;
  FieldValue: typeof FieldValue;
  Timestamp: typeof Timestamp;
};

type ClientDriveSettingsDoc = {
  clientRootFolderId?: string | null;
  brandingFolderName?: string | null;
  ordersFolderName?: string | null;
  brandingTemplateFolderId?: string | null;
  hqEmails?: string[];
};

const normaliseDriveId = (input: unknown): string | null => {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const folderMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (folderMatch) {
        return folderMatch[1];
      }

      const idParam = url.searchParams.get("id");
      if (idParam) {
        return idParam;
      }

      const documentMatch = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (documentMatch) {
        return documentMatch[1];
      }
    } catch (error) {
      console.warn("Failed to parse Drive URL – falling back to raw value", error);
    }
  }

  return trimmed;
};

const sanitiseDriveName = (name: string | null | undefined, fallback: string): string => {
  const raw = typeof name === "string" ? name.trim() : "";
  const base = raw.length > 0 ? raw : fallback;
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 120);
};

const toClientDocId = (key: string): string => {
  const trimmed = key.trim().toLowerCase();
  if (!trimmed) {
    return `client-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  }
  const slug = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length >= 6 && slug.length <= 100) {
    return slug;
  }
  const hash = createHash("sha1").update(trimmed).digest("hex").slice(0, 24);
  return `client-${hash}`;
};

const buildClientFolderName = (context: DriveSetupContext): string => {
  const fallback = `Client ${context.orderId.slice(-6).toUpperCase()}`;
  if (context.companyName) {
    return sanitiseDriveName(context.companyName, fallback);
  }
  if (context.customerName) {
    return sanitiseDriveName(context.customerName, fallback);
  }
  const firstEmail = context.emails.find((value) => value.length > 0);
  if (firstEmail) {
    const prefix = firstEmail.split("@")[0] || firstEmail;
    return sanitiseDriveName(prefix, fallback);
  }
  return fallback;
};

const buildOrderFolderName = (context: DriveSetupContext): string => {
  const suffix = context.orderId.slice(-6).toUpperCase();
  if (context.projectName) {
    return sanitiseDriveName(`${context.projectName} (${suffix})`, `Order ${suffix}`);
  }
  if (context.products.length === 1) {
    const product = context.products[0];
    const productName = product.name || product.productId || `Product ${suffix}`;
    return sanitiseDriveName(`${productName} (${suffix})`, `Order ${suffix}`);
  }
  return `Order ${suffix}`;
};

const createDriveService = async (): Promise<drive_v3.Drive | null> => {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyB64) {
    console.warn("Missing Google service account credentials for Drive automation");
    return null;
  }
  try {
    const keyJson = JSON.parse(Buffer.from(keyB64, "base64").toString());
    const auth = new google.auth.JWT({
      email: keyJson.client_email,
      key: keyJson.private_key,
      scopes: DRIVE_SCOPES,
    });
    await auth.authorize();
    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Failed to initialise Drive service", error);
    return null;
  }
};

const resolveExistingFolder = async (
  drive: drive_v3.Drive,
  folderId: string | null,
): Promise<string | null> => {
  if (!folderId) {
    return null;
  }
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: "id, trashed",
      supportsAllDrives: true,
    });
    if (res.data?.trashed) {
      return null;
    }
    return res.data?.id ?? folderId;
  } catch {
    return null;
  }
};

const createDriveFolder = async (
  drive: drive_v3.Drive,
  name: string,
  parentId: string | null,
): Promise<string | null> => {
  try {
    const metadata: drive_v3.Schema$File = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    const res = await drive.files.create({
      requestBody: metadata,
      fields: "id",
      supportsAllDrives: true,
    });
    return res.data.id ?? null;
  } catch (error) {
    console.error("Failed to create Drive folder", name, error);
    return null;
  }
};

const listDriveChildren = async (
  drive: drive_v3.Drive,
  parentId: string,
): Promise<drive_v3.Schema$File[]> => {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    if (res.data.files) {
      files.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
};

const copyDriveContents = async (
  drive: drive_v3.Drive,
  sourceFolderId: string,
  destinationFolderId: string,
): Promise<void> => {
  const children = await listDriveChildren(drive, sourceFolderId);
  for (const child of children) {
    if (!child.id) continue;
    if (child.mimeType === "application/vnd.google-apps.folder") {
      const folderName = sanitiseDriveName(child.name ?? "Folder", "Folder");
      const newFolderId = await createDriveFolder(drive, folderName, destinationFolderId);
      if (newFolderId) {
        await copyDriveContents(drive, child.id, newFolderId);
      }
    } else {
      try {
        await drive.files.copy({
          fileId: child.id,
          requestBody: {
            name: child.name ?? undefined,
            parents: [destinationFolderId],
          },
          supportsAllDrives: true,
        });
      } catch (error) {
        console.error("Failed to copy Drive file", child.id, error);
      }
    }
  }
};

const ensureChildFolder = async (
  drive: drive_v3.Drive,
  parentId: string,
  desiredName: string,
  existingFolderId?: string | null,
  templateFolderId?: string | null,
): Promise<{ id: string | null; created: boolean }> => {
  const existing = await resolveExistingFolder(drive, normaliseDriveId(existingFolderId));
  if (existing) {
    return { id: existing, created: false };
  }
  try {
    const escapedName = desiredName.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents and name = '${escapedName}'`,
      fields: "files(id, name)",
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    const matchId = search.data.files?.[0]?.id ?? null;
    if (matchId) {
      return { id: matchId, created: false };
    }
  } catch (error) {
    console.warn("Failed to look up Drive folder by name", error);
  }
  const folderId = await createDriveFolder(drive, desiredName, parentId);
  if (folderId && templateFolderId) {
    try {
      await copyDriveContents(drive, templateFolderId, folderId);
    } catch (error) {
      console.error("Failed to copy Drive template into folder", error);
    }
  }
  return { id: folderId, created: true };
};

const shareDriveFolder = async (
  drive: drive_v3.Drive,
  folderId: string,
  emails: string[],
): Promise<void> => {
  const seen = new Set<string>();
  for (const email of emails) {
    const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    try {
      await drive.permissions.create({
        fileId: folderId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: trimmed,
        },
      });
    } catch (error: any) {
      if (error?.code === 409) {
        continue;
      }
      console.warn("Failed to apply Drive permission", folderId, trimmed, error);
    }
  }
};

export const setupClientDriveStructure = async (
  deps: DriveAutomationDeps,
  context: DriveSetupContext,
): Promise<void> => {
  const drive = await createDriveService();
  if (!drive) {
    await context.orderRef.set(
      {
        drive: {
          status: "pending_credentials",
          updatedAt: deps.FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    return;
  }

  const settingsSnap = await deps.firestore.collection("settings").doc("clientDrive").get();
  const settings = (settingsSnap.data() ?? {}) as ClientDriveSettingsDoc;
  const rootFolderId = normaliseDriveId(settings.clientRootFolderId);
  if (!rootFolderId) {
    await context.orderRef.set(
      {
        drive: {
          status: "pending_configuration",
          updatedAt: deps.FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    return;
  }

  const brandingName = sanitiseDriveName(settings.brandingFolderName ?? null, "Branding Assets");
  const ordersName = sanitiseDriveName(settings.ordersFolderName ?? null, "Projects");
  const brandingTemplateId = normaliseDriveId(settings.brandingTemplateFolderId);

  const clientEmails = Array.from(
    new Set(context.emails.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0)),
  );
  const franchiseEmails = (context.franchise.emails || [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const hqEmails = Array.isArray(settings.hqEmails)
    ? settings.hqEmails
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => value.length > 0)
    : [];
  const shareEmails = [...hqEmails, ...franchiseEmails];

  const clientsCollection = deps.firestore.collection("clients");
  let clientDocRef: DocumentReference<DocumentData> | null = null;
  let existingSnap: DocumentSnapshot<DocumentData> | null = null;

  if (context.clientKey) {
    const candidateRef = clientsCollection.doc(toClientDocId(context.clientKey));
    const candidateSnap = await candidateRef.get();
    if (candidateSnap.exists) {
      clientDocRef = candidateRef;
      existingSnap = candidateSnap;
    } else {
      const keyQuery = await clientsCollection.where("key", "==", context.clientKey).limit(1).get();
      if (!keyQuery.empty) {
        existingSnap = keyQuery.docs[0];
        clientDocRef = existingSnap.ref;
      }
    }
  }

  if (!clientDocRef && clientEmails.length > 0) {
    const emailQuery = await clientsCollection
      .where("emails", "array-contains-any", clientEmails.slice(0, 10))
      .limit(1)
      .get();
    if (!emailQuery.empty) {
      existingSnap = emailQuery.docs[0];
      clientDocRef = existingSnap.ref;
    }
  }

  if (!clientDocRef) {
    clientDocRef = clientsCollection.doc(toClientDocId(`order:${context.orderId}`));
  }

  const existingData = (existingSnap?.data() as Record<string, any> | undefined) ?? {};
  const driveInfo = (existingData.drive as Record<string, any> | undefined) ?? {};

  const clientFolderName = buildClientFolderName(context);
  let clientFolderId =
    (await resolveExistingFolder(
      drive,
      normaliseDriveId((driveInfo.rootFolderId as string | undefined) ?? (driveInfo.clientFolderId as string | undefined)),
    )) ?? null;
  let clientFolderCreated = false;
  if (!clientFolderId) {
    clientFolderId = await createDriveFolder(drive, clientFolderName, rootFolderId);
    clientFolderCreated = Boolean(clientFolderId);
  }
  if (!clientFolderId) {
    throw new Error("Unable to create client Drive folder");
  }

  const branding = await ensureChildFolder(
    drive,
    clientFolderId,
    brandingName,
    (driveInfo.brandingFolderId as string | undefined) ?? null,
    brandingTemplateId,
  );
  const orders = await ensureChildFolder(
    drive,
    clientFolderId,
    ordersName,
    (driveInfo.ordersRootFolderId as string | undefined) ?? null,
  );
  const ordersRootFolderId = orders.id ?? clientFolderId;
  const orderFolderName = buildOrderFolderName(context);
  const orderFolderId = await createDriveFolder(drive, orderFolderName, ordersRootFolderId);
  if (!orderFolderId) {
    throw new Error("Unable to create order Drive folder");
  }

  const productFolders: Array<{
    productId: string;
    folderId: string;
    folderName: string;
    templateFolderId: string | null;
    quantity: number;
    sequence: number;
  }> = [];

  for (const product of context.products) {
    const count = product.quantity > 0 ? product.quantity : 1;
    for (let i = 0; i < count; i += 1) {
      const folderName = sanitiseDriveName(
        product.folderName ?? product.name ?? `Product ${i + 1}`,
        product.name || `Product ${i + 1}`,
      );
      const folderId = await createDriveFolder(drive, folderName, orderFolderId);
      if (!folderId) {
        continue;
      }
      const templateFolderId = normaliseDriveId(product.templateFolderId);
      if (templateFolderId) {
        await copyDriveContents(drive, templateFolderId, folderId);
      }
      productFolders.push({
        productId: product.productId,
        folderId,
        folderName,
        templateFolderId,
        quantity: count,
        sequence: i + 1,
      });
    }
  }

  if (clientFolderCreated || shareEmails.length > 0) {
    await shareDriveFolder(drive, clientFolderId, shareEmails);
  }

  const timestamp = deps.FieldValue.serverTimestamp();
  const clientUpdate: Record<string, any> = {
    key: context.clientKey ?? null,
    keyType: context.clientKeyType ?? null,
    companyName: context.companyName ?? null,
    customerName: context.customerName ?? null,
    updatedAt: timestamp,
    drive: {
      rootFolderId: clientFolderId,
      rootFolderName: clientFolderName,
      brandingFolderId: branding.id ?? null,
      brandingFolderName: brandingName,
      ordersRootFolderId,
      ordersFolderName: ordersName,
      lastOrderId: context.orderId,
      lastUpdatedAt: timestamp,
    },
  };

  if (!existingSnap?.exists) {
    clientUpdate.createdAt = timestamp;
  }
  if (clientEmails.length > 0) {
    clientUpdate.emails = deps.FieldValue.arrayUnion(...clientEmails);
  }
  if (context.franchise.id) {
    clientUpdate.lastFranchiseId = context.franchise.id;
  }
  if (franchiseEmails.length > 0) {
    clientUpdate.franchiseEmails = deps.FieldValue.arrayUnion(...franchiseEmails);
  }
  if (context.affiliate) {
    clientUpdate.affiliate = {
      id: context.affiliate.id,
      name: context.affiliate.name,
      refCode: context.affiliate.refCode,
      status: context.affiliate.status ?? null,
      commissionRate: context.affiliate.commissionRate,
      lastReferralAt: timestamp,
    };
  }

  await clientDocRef.set(clientUpdate, { merge: true });

  await context.orderRef.set(
    {
      clientId: clientDocRef.id,
      drive: {
        status: "ready",
        clientFolderId,
        clientFolderName,
        brandingFolderId: branding.id ?? null,
        brandingFolderName: brandingName,
        ordersRootFolderId,
        ordersFolderName: ordersName,
        orderFolderId,
        orderFolderName,
        productFolders,
        updatedAt: timestamp,
      },
    },
    { merge: true },
  );
};
