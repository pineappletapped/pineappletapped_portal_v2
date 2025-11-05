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

interface ApiErrorResponse {
  error: true;
  message: string;
  code?: string;
}

type CreateClientFolderResult = CreateClientFolderResponse | ApiErrorResponse;

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

const respondWithError = (
  res: NextApiResponse<ApiErrorResponse>,
  status: number,
  message: string,
  code?: string,
) => {
  const payload = code ? { error: true as const, message, code } : { error: true as const, message };
  res.status(status).json(payload);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateClientFolderResult>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    respondWithError(res, 405, 'Method Not Allowed', 'method-not-allowed');
    return;
  }

  const { clientName, parentFolderId, orderId, hqEmails, franchiseEmails, clientEmails } =
    (req.body ?? {}) as CreateClientFolderRequest;

  if (!clientName || typeof clientName !== 'string' || !clientName.trim()) {
    respondWithError(res, 400, 'Client name must be provided.', 'invalid-client');
    return;
  }

  const context = {
    clientName,
    parentFolderId: parentFolderId ?? null,
    orderId: orderId ?? null,
  };

  let folderId: string;
  try {
    folderId = await createClientFolder(clientName, parentFolderId ?? undefined);
  } catch (error) {
    console.error('create-client-folder: failed to create Drive folder', { ...context, error });
    respondWithError(
      res,
      500,
      'Unable to create Drive folder. Please try again later.',
      'drive-folder-create-failed',
    );
    return;
  }

  const permissions = buildPermissions(
    normaliseEmailList(hqEmails),
    normaliseEmailList(franchiseEmails),
    normaliseEmailList(clientEmails),
  );

  if (permissions.length > 0) {
    try {
      await setPermissions(folderId, permissions);
    } catch (error) {
      console.error('create-client-folder: failed to assign Drive permissions', {
        ...context,
        folderId,
        error,
      });
      respondWithError(
        res,
        500,
        'Drive folder created but permissions could not be updated. Please try again later.',
        'drive-folder-permissions-failed',
      );
      return;
    }
  }

  try {
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
    console.error('create-client-folder: failed to fetch Drive folder metadata', {
      ...context,
      folderId,
      error,
    });
    respondWithError(
      res,
      500,
      'Drive folder was created but details could not be retrieved. Please try again later.',
      'drive-folder-metadata-failed',
    );
  }
}
