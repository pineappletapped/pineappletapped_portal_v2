import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient, listFolderContents, type DriveFile } from '@backend/googleDrive';

interface ListClientFoldersResponse {
  folders: DriveFile[];
}

const asString = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ListClientFoldersResponse | { error: string }>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const rootFolderOverride = asString(req.query.rootFolderId as string | string[] | undefined);
  const clientId = asString(req.query.clientId as string | string[] | undefined);
  const parentFolderId = rootFolderOverride ?? process.env.GDRIVE_CLIENT_ROOT_ID ?? null;

  if (!parentFolderId) {
    res.status(400).json({ error: 'Missing Drive client root folder' });
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
    console.error('list-client-folders handler failed', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'internal_error' });
  }
}
