import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient, listFolderContents, type DriveFile } from '@backend/googleDrive';

interface ListClientFoldersResponse {
  folders: DriveFile[];
}

interface ApiErrorResponse {
  error: true;
  message: string;
  code?: string;
}

type ListClientFoldersResult = ListClientFoldersResponse | ApiErrorResponse;

const asString = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
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
  res: NextApiResponse<ListClientFoldersResult>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    respondWithError(res, 405, 'Method Not Allowed', 'method-not-allowed');
    return;
  }

  const rootFolderOverride = asString(req.query.rootFolderId as string | string[] | undefined);
  const clientId = asString(req.query.clientId as string | string[] | undefined);
  const parentFolderId = rootFolderOverride ?? process.env.GDRIVE_CLIENT_ROOT_ID ?? null;

  if (!parentFolderId) {
    respondWithError(
      res,
      400,
      'Drive client root folder is not configured.',
      'missing-root-folder',
    );
    return;
  }

  try {
    const drive = await getDriveClient();
    const folders = await listFolderContents(parentFolderId, drive, {
      mimeType: 'application/vnd.google-apps.folder',
      fields: 'id, name, parents, webViewLink, createdTime, modifiedTime',
    });

    const filtered = clientId
      ? folders.filter((folder) => folder.id === clientId || folder.name === clientId)
      : folders;

    res.status(200).json({ folders: filtered });
  } catch (error) {
    console.error('list-client-folders: failed to load Drive folders', {
      parentFolderId,
      clientId,
      error,
    });
    respondWithError(
      res,
      500,
      'Unable to load Drive folders. Please try again later.',
      'drive-folder-list-failed',
    );
  }
}
