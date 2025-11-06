const assetBase = process.env.NEXT_PUBLIC_ASSET_BASE_URL || '';

function joinAssetPath(relativePath: string): string {
  if (!assetBase) {
    return relativePath;
  }

  const trimmedRelative = relativePath.replace(/^\/+/, '');
  return new URL(trimmedRelative, assetBase).toString();
}

export function getAssetUrl(relativePath: string): string {
  const normalized = relativePath.startsWith('/')
    ? relativePath
    : `/${relativePath}`;

  if (!assetBase) {
    return normalized;
  }

  return joinAssetPath(normalized);
}
