import { google, type drive_v3 } from 'googleapis';
import type { JWT } from 'google-auth-library';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

export type DriveClient = drive_v3.Drive;
export type DriveFile = drive_v3.Schema$File;
export type DrivePermissionInput = Pick<
  drive_v3.Schema$Permission,
  'type' | 'role' | 'emailAddress' | 'domain' | 'allowFileDiscovery'
>;

function sanitiseDriveName(name: string | null | undefined, fallback: string): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  const base = raw.length > 0 ? raw : fallback;
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 120);
}

let driveClientPromise: Promise<DriveClient> | null = null;
let authClientPromise: Promise<JWT> | null = null;
let cachedCredentials: Record<string, any> | null = null;

function parseServiceAccount(): Record<string, any> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const raw = process.env.GDRIVE_SA_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 || '';
  if (!raw) {
    throw new Error('GDRIVE_SA_JSON environment variable is not set');
  }

  const attempts: string[] = [raw];
  if (!raw.trim().startsWith('{')) {
    try {
      attempts.push(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (error) {
      console.warn('Failed to decode base64 service account credentials', error);
    }
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      cachedCredentials = parsed;
      return parsed;
    } catch {
      continue;
    }
  }

  throw new Error('GDRIVE_SA_JSON does not contain valid JSON credentials');
}

function resolveDelegatedUser(): string | null {
  const candidates = [
    process.env.GDRIVE_DELEGATED_USER,
    process.env.GOOGLE_SERVICE_ACCOUNT_DELEGATED_USER,
  ];

  for (const value of candidates) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

async function getAuthClient() {
  if (!authClientPromise) {
    const credentials = parseServiceAccount();
    const delegatedUser = resolveDelegatedUser();
    const googleAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: DRIVE_SCOPES,
      clientOptions: delegatedUser ? { subject: delegatedUser } : undefined,
    });
    authClientPromise = googleAuth.getClient() as Promise<JWT>;
  }

  return authClientPromise;
}

export async function getDriveClient(): Promise<DriveClient> {
  if (!driveClientPromise) {
    driveClientPromise = getAuthClient().then((auth) =>
      google.drive({ version: 'v3', auth })
    );
  }

  return driveClientPromise;
}

export async function tryGetDriveClient(): Promise<DriveClient | null> {
  try {
    return await getDriveClient();
  } catch (error) {
    console.error('Failed to initialise Google Drive client', error);
    return null;
  }
}

function normaliseParentId(parentId?: string | null): string | null {
  if (!parentId) {
    return null;
  }
  const trimmed = parentId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createFolder(
  name: string,
  parentId?: string | null,
  drive?: DriveClient,
): Promise<string | null> {
  const client = drive ?? (await getDriveClient());
  try {
    const metadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    const normalisedParent = normaliseParentId(parentId);
    if (normalisedParent) {
      metadata.parents = [normalisedParent];
    }
    const response = await client.files.create({
      requestBody: metadata,
      fields: 'id',
      supportsAllDrives: true,
    });
    return response.data.id ?? null;
  } catch (error) {
    console.error('Failed to create Drive folder', { name, parentId }, error);
    return null;
  }
}

export async function createClientFolder(
  clientName: string,
  parentId?: string | null,
  drive?: DriveClient,
): Promise<string | null> {
  const explicitParent = normaliseParentId(parentId);
  const fallbackParent = normaliseParentId(process.env.GDRIVE_CLIENT_ROOT_ID ?? null);
  return createFolder(clientName, explicitParent ?? fallbackParent, drive);
}

export async function resolveExistingFolder(
  folderId: string | null,
  drive?: DriveClient,
): Promise<string | null> {
  if (!folderId) {
    return null;
  }
  const client = drive ?? (await getDriveClient());
  try {
    const res = await client.files.get({
      fileId: folderId,
      fields: 'id, trashed',
      supportsAllDrives: true,
    });
    if (res.data?.trashed) {
      return null;
    }
    return res.data?.id ?? folderId;
  } catch {
    return null;
  }
}

export type ListFolderOptions = {
  fields?: string;
  orderBy?: string;
  mimeType?: string;
  pageSize?: number;
};

export async function listFolderContents(
  folderId: string,
  drive?: DriveClient,
  options: ListFolderOptions = {},
): Promise<DriveFile[]> {
  const client = drive ?? (await getDriveClient());
  const files: DriveFile[] = [];
  const filters = [`'${folderId}' in parents`, 'trashed = false'];
  if (options.mimeType) {
    filters.push(`mimeType = '${options.mimeType}'`);
  }
  let pageToken: string | undefined;
  const fields = options.fields || 'id, name, mimeType';
  do {
    const response = await client.files.list({
      q: filters.join(' and '),
      fields: `nextPageToken, files(${fields})`,
      pageSize: options.pageSize ?? 100,
      pageToken,
      orderBy: options.orderBy,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    if (response.data.files) {
      files.push(...response.data.files);
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

export async function listChildFolders(
  folderId: string,
  drive?: DriveClient,
): Promise<DriveFile[]> {
  return listFolderContents(folderId, drive, {
    mimeType: 'application/vnd.google-apps.folder',
    fields: 'id, name, mimeType',
    orderBy: 'name_natural',
  });
}

export async function copyFolderContents(
  sourceFolderId: string,
  destinationFolderId: string,
  drive?: DriveClient,
): Promise<void> {
  const client = drive ?? (await getDriveClient());
  const children = await listFolderContents(sourceFolderId, client);
  for (const child of children) {
    if (!child.id) {
      continue;
    }
    if (child.mimeType === 'application/vnd.google-apps.folder') {
      const folderName = sanitiseDriveName(child.name ?? null, 'Folder');
      const newFolderId = await createFolder(folderName, destinationFolderId, client);
      if (newFolderId) {
        await copyFolderContents(child.id, newFolderId, client);
      }
    } else {
      try {
        await client.files.copy({
          fileId: child.id,
          supportsAllDrives: true,
          requestBody: {
            name: child.name ?? undefined,
            parents: [destinationFolderId],
          },
        });
      } catch (error) {
        console.error('Failed to copy Drive file', child.id, error);
      }
    }
  }
}

export async function ensureChildFolder(
  drive: DriveClient,
  parentId: string,
  desiredName: string,
  existingFolderId?: string | null,
  templateFolderId?: string | null,
): Promise<{ id: string | null; created: boolean }> {
  const existing = await resolveExistingFolder(existingFolderId ?? null, drive);
  if (existing) {
    return { id: existing, created: false };
  }

  try {
    const escapedName = desiredName.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents and name = '${escapedName}'`,
      fields: 'files(id, name)',
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    const matchId = search.data.files?.[0]?.id ?? null;
    if (matchId) {
      return { id: matchId, created: false };
    }
  } catch (error) {
    console.warn('Failed to look up Drive folder by name', error);
  }

  const folderId = await createFolder(desiredName, parentId, drive);
  if (folderId && templateFolderId) {
    try {
      await copyFolderContents(templateFolderId, folderId, drive);
    } catch (error) {
      console.error('Failed to copy Drive template into folder', error);
    }
  }

  return { id: folderId, created: true };
}

export async function setPermissions(
  fileId: string,
  permissions: DrivePermissionInput[],
  drive?: DriveClient,
): Promise<void> {
  const client = drive ?? (await getDriveClient());
  for (const permission of permissions) {
    if (!permission.type || !permission.role) {
      continue;
    }
    try {
      await client.permissions.create({
        fileId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: permission,
      });
    } catch (error: any) {
      if (error?.code === 409) {
        continue;
      }
      console.warn('Failed to apply Drive permission', fileId, permission, error);
    }
  }
}

export async function shareFolder(
  drive: DriveClient,
  folderId: string,
  emails: string[],
): Promise<void> {
  const seen = new Set<string>();
  const permissions: DrivePermissionInput[] = [];
  for (const email of emails) {
    const trimmed = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    permissions.push({ type: 'user', role: 'writer', emailAddress: trimmed });
  }
  if (permissions.length === 0) {
    return;
  }
  await setPermissions(folderId, permissions, drive);
}

export async function getUploadUrl(
  folderId: string | null,
  fileName: string,
  mimeType = 'application/octet-stream',
): Promise<string> {
  const authClient = await getAuthClient();
  const token = await authClient.getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain Google Drive access token');
  }

  const url = new URL('https://www.googleapis.com/upload/drive/v3/files');
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id');

  const body: Record<string, any> = { name: fileName };
  const parent = normaliseParentId(folderId);
  if (parent) {
    body.parents = [parent];
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to create Drive upload session (${response.status}): ${text}`);
  }

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) {
    throw new Error('Drive upload session did not return a Location header');
  }

  return uploadUrl;
}
