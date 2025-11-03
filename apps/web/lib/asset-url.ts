const assetBase = process.env.NEXT_PUBLIC_ASSET_BASE_URL || '';

export function getAssetUrl(relativePath: string): string {
  const normalized = relativePath.startsWith('/')
    ? relativePath
    : `/${relativePath}`;

  if (!assetBase) {
    return normalized;
  }

  return new URL(normalized, assetBase).toString();
}
