export const DEFAULT_FUNCTION_BASE =
  "https://us-central1-pineapple-tapped---portal.cloudfunctions.net";

export const normaliseBaseUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

export const resolveHostedAppBase = (
  host: string | null | undefined,
): string | null => {
  if (!host) {
    return null;
  }

  const trimmed = host.trim().toLowerCase();
  if (!trimmed.endsWith(".hosted.app")) {
    return null;
  }

  const [subdomain] = trimmed.split(".");
  if (!subdomain) {
    return null;
  }

  const parts = subdomain.split("--");
  if (parts.length < 2) {
    return null;
  }

  const appIdCandidate = parts[parts.length - 1];
  if (!appIdCandidate) {
    return null;
  }

  return `https://us-central1-${appIdCandidate}.cloudfunctions.net`;
};

export const buildCallableEndpointsFromBases = (
  functionName: string,
  baseUrls: Array<string | null | undefined>,
): string[] => {
  const uniqueBases = new Set<string>();

  for (const base of baseUrls) {
    const normalised = normaliseBaseUrl(base);
    if (normalised) {
      uniqueBases.add(normalised);
    }
  }

  return Array.from(uniqueBases).map((base) => `${base}/${functionName}`);
};
