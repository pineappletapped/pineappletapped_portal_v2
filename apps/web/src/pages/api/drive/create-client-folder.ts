import type { NextApiRequest, NextApiResponse } from 'next';
import {
  createClientFolder,
  getDriveClient,
  setPermissions,
  type DrivePermissionInput,
} from '@backend/googleDrive';

interface CreateClientFolderRequest {
  clientName?: string;
  parentFolderId?: string | null;
  orderId?: string | null;
  hqEmails?: string[];
  franchiseEmails?: string[];
  clientEmails?: string[];
}

interface CreateClientFolderResponse {
  folder: {
    id: string;
    name: string | null | undefined;
    webViewLink: string | null | undefined;
    parents: string[] | null | undefined;
  };
  orderId?: string | null;
}

const isStringArray = (value: unknown): value is string[] => {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => typeof item === 'string');
};

const normaliseEmailList = (value: unknown): string[] => {
  if (!isStringArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const raw of value) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return Array.from(seen);
};

const buildPermissions = (
  hqEmails: string[],
  franchiseEmails: string[],
  clientEmails: string[],
): DrivePermissionInput[] => {
  const permissions: DrivePermissionInput[] = [];

  const append = (emails: string[], role: 'organizer' | 'writer' | 'commenter' | 'reader') => {
    for (const email of emails) {
      permissions.push({ type: 'user', role, emailAddress: email });
    }
  };

  append(hqEmails, 'organizer');
  append(franchiseEmails, 'writer');
  append(clientEmails, 'reader');

  return permissions;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateClientFolderResponse | { error: string }>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { clientName, parentFolderId, orderId, hqEmails, franchiseEmails, clientEmails } =
    (req.body ?? {}) as CreateClientFolderRequest;

  if (!clientName || typeof clientName !== 'string') {
    res.status(400).json({ error: 'clientName must be provided' });
    return;
  }

  try {
    const folderId = await createClientFolder(clientName, parentFolderId ?? undefined);
    if (!folderId) {
      res.status(500).json({ error: 'Failed to create Drive folder' });
      return;
    }

    const permissions = buildPermissions(
      normaliseEmailList(hqEmails),
      normaliseEmailList(franchiseEmails),
      normaliseEmailList(clientEmails),
    );

    if (permissions.length > 0) {
      await setPermissions(folderId, permissions);
    }

    const drive = await getDriveClient();
    const metadata = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, parents, webViewLink',
      supportsAllDrives: true,
    });

    // TODO: Persist folder metadata alongside the order/client record once the database schema is ready.

    res.status(200).json({
      folder: {
        id: metadata.data.id ?? folderId,
        name: metadata.data.name,
        webViewLink: metadata.data.webViewLink,
        parents: metadata.data.parents,
      },
      orderId: orderId ?? null,
    });
  } catch (error) {
    console.error('create-client-folder handler failed', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'internal_error' });
  }
}
