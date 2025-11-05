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

interface ApiErrorResponse {
  error: true;
  message: string;
  code?: string;
}

type PublishDeliverableResult = PublishDeliverableResponse | ApiErrorResponse;

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
  res: NextApiResponse<PublishDeliverableResult>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    respondWithError(res, 405, 'Method Not Allowed', 'method-not-allowed');
    return;
  }

  const { fileId, targetFolderId } = (req.body ?? {}) as PublishDeliverableRequest;

  if (!fileId || typeof fileId !== 'string') {
    respondWithError(res, 400, 'A Drive file ID must be provided.', 'invalid-file-id');
    return;
  }

  if (!targetFolderId || typeof targetFolderId !== 'string') {
    respondWithError(res, 400, 'A target folder ID must be provided.', 'invalid-target-folder');
    return;
  }

  const context = { fileId, targetFolderId };

  let drive;
  try {
    drive = await getDriveClient();
  } catch (error) {
    console.error('publish-deliverable: failed to initialise Drive client', {
      ...context,
      error,
    });
    respondWithError(res, 500, 'Drive service is unavailable. Please try again later.', 'drive-client-unavailable');
    return;
  }

  let currentMetadata;
  try {
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, parents, webViewLink',
      supportsAllDrives: true,
    });
    currentMetadata = response.data;
  } catch (error) {
    console.error('publish-deliverable: failed to fetch Drive file metadata', {
      ...context,
      error,
    });
    respondWithError(
      res,
      500,
      'Unable to load the selected Drive file. Please try again later.',
      'drive-file-lookup-failed',
    );
    return;
  }

  const removeParents = (currentMetadata?.parents ?? []).join(',') || undefined;

  try {
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
    console.error('publish-deliverable: failed to move Drive file', {
      ...context,
      removeParents,
      error,
    });
    respondWithError(
      res,
      500,
      'Unable to publish the deliverable to the requested folder. Please try again later.',
      'drive-file-move-failed',
    );
  }
}
