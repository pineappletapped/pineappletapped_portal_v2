import type { NextApiRequest, NextApiResponse } from 'next';
import { getUploadUrl } from '@backend/googleDrive';

interface UploadTokenRequest {
  folderId?: string | null;
  fileName?: string;
  mimeType?: string;
}

interface UploadTokenResponse {
  uploadUrl: string;
}

interface ApiErrorResponse {
  error: true;
  message: string;
  code?: string;
}

type UploadTokenResult = UploadTokenResponse | ApiErrorResponse;

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
  res: NextApiResponse<UploadTokenResult>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    respondWithError(res, 405, 'Method Not Allowed', 'method-not-allowed');
    return;
  }

  const { folderId, fileName, mimeType } = (req.body ?? {}) as UploadTokenRequest;

  if (!fileName || typeof fileName !== 'string') {
    respondWithError(res, 400, 'A file name is required.', 'invalid-filename');
    return;
  }

  if (folderId != null && typeof folderId !== 'string') {
    respondWithError(res, 400, 'folderId must be a string when provided.', 'invalid-folder-id');
    return;
  }

  try {
    const uploadUrl = await getUploadUrl(
      folderId ?? null,
      fileName,
      typeof mimeType === 'string' ? mimeType : undefined,
    );
    res.status(200).json({ uploadUrl });
  } catch (error) {
    console.error('upload-token: failed to issue Drive upload URL', {
      folderId: folderId ?? null,
      fileName,
      mimeType,
      error,
    });
    respondWithError(
      res,
      500,
      'Unable to prepare Drive upload. Please try again later.',
      'drive-upload-token-failed',
    );
  }
}
