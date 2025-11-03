import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient } from '@backend/googleDrive';

interface PublishDeliverableRequest {
  fileId?: string;
  targetFolderId?: string;
}

interface PublishDeliverableResponse {
  file: {
    id: string;
    name: string | null | undefined;
    parents: string[] | null | undefined;
    webViewLink: string | null | undefined;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PublishDeliverableResponse | { error: string }>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { fileId, targetFolderId } = (req.body ?? {}) as PublishDeliverableRequest;

  if (!fileId || typeof fileId !== 'string') {
    res.status(400).json({ error: 'fileId must be provided' });
    return;
  }

  if (!targetFolderId || typeof targetFolderId !== 'string') {
    res.status(400).json({ error: 'targetFolderId must be provided' });
    return;
  }

  try {
    const drive = await getDriveClient();
    const currentMetadata = await drive.files.get({
      fileId,
      fields: 'id, name, parents, webViewLink',
      supportsAllDrives: true,
    });

    const removeParents = (currentMetadata.data.parents ?? []).join(',') || undefined;

    const updated = await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents,
      supportsAllDrives: true,
      fields: 'id, name, parents, webViewLink',
    });

    // TODO: Record deliverable publication event in the project/order timeline once persistence is available.

    res.status(200).json({
      file: {
        id: updated.data.id ?? fileId,
        name: updated.data.name,
        parents: updated.data.parents,
        webViewLink: updated.data.webViewLink,
      },
    });
  } catch (error) {
    console.error('publish-deliverable handler failed', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'internal_error' });
  }
}
