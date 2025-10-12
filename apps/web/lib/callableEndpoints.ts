export const DEFAULT_FUNCTION_BASE =
  "https://us-central1-pineapple-tapped---portal.cloudfunctions.net";

const CLOUD_FUNCTION_REGION_HOST_PATTERN =
  /^https:\/\/([a-z0-9-]+)-([a-z0-9-]+)\.cloudfunctions\.net$/i;

const REGION_FALLBACKS = ["us-central1", "europe-west2"];

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

const looksLikeExplicitEndpoint = (
  value: string,
  functionName: string,
) => {
  if (value.includes("?")) {
    return true;
  }

  const lowerValue = value.toLowerCase();
  const suffix = `/${functionName.toLowerCase()}`;
  return lowerValue.endsWith(suffix);
};

export const normaliseCallableEndpoint = (
  value: string | null | undefined,
  functionName: string,
): string | null => {
  const normalised = normaliseBaseUrl(value);
  if (!normalised) {
    return null;
  }

  if (looksLikeExplicitEndpoint(normalised, functionName)) {
    return normalised;
  }

  return `${normalised}/${functionName}`;
};

const expandRegionalBases = (baseUrls: Array<string | null | undefined>) => {
  const expanded: string[] = [];

  for (const base of baseUrls) {
    const normalised = normaliseBaseUrl(base);
    if (!normalised) {
      continue;
    }

    expanded.push(normalised);

    const match = normalised.match(CLOUD_FUNCTION_REGION_HOST_PATTERN);
    if (!match) {
      continue;
    }

    const [, region, project] = match;
    for (const fallbackRegion of REGION_FALLBACKS) {
      if (fallbackRegion === region) {
        continue;
      }

      expanded.push(`https://${fallbackRegion}-${project}.cloudfunctions.net`);
    }
  }

  return expanded;
};

export const buildCallableEndpointsFromBases = (
  functionName: string,
  baseUrls: Array<string | null | undefined>,
): string[] => {
  const uniqueEndpoints = new Set<string>();

  for (const base of expandRegionalBases(baseUrls)) {
    const endpoint = normaliseCallableEndpoint(base, functionName);
    if (endpoint) {
      uniqueEndpoints.add(endpoint);
    }
  }

  return Array.from(uniqueEndpoints);
};
