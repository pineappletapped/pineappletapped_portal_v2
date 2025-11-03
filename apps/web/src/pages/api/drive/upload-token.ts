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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadTokenResponse | { error: string }>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { folderId, fileName, mimeType } = (req.body ?? {}) as UploadTokenRequest;

  if (!fileName || typeof fileName !== 'string') {
    res.status(400).json({ error: 'fileName must be provided' });
    return;
  }

  if (folderId != null && typeof folderId !== 'string') {
    res.status(400).json({ error: 'folderId must be a string when provided' });
    return;
  }

  try {
    const uploadUrl = await getUploadUrl(folderId ?? null, fileName, typeof mimeType === 'string' ? mimeType : undefined);
    res.status(200).json({ uploadUrl });
  } catch (error) {
    console.error('upload-token handler failed', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'internal_error' });
  }
}
