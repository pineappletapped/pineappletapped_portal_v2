export const DEFAULT_FUNCTION_BASE =
  "https://us-central1-pineapple-tapped---portal.cloudfunctions.net";

export const LEGACY_FUNCTION_BASES = [
  "https://us-central1-ptfbportalbackend.cloudfunctions.net",
];

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

const sanitiseProjectFragment = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/^[-]+/, "");
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

export const resolveHostedAppBases = (
  host: string | null | undefined,
): string[] => {
  if (!host) {
    return [];
  }

  const trimmed = host.trim().toLowerCase();
  if (!trimmed.endsWith(".hosted.app")) {
    return [];
  }

  const segments = trimmed.split(".");
  if (segments.length < 3) {
    return [];
  }

  const subdomain = segments[0];
  const regionSegment = segments[1];
  if (!subdomain) {
    return [];
  }

  const regionCandidate =
    typeof regionSegment === "string" && /^[a-z0-9-]+$/.test(regionSegment)
      ? regionSegment
      : "us-central1";

  const bases = new Set<string>();

  let separatorIndex = -1;
  let searchIndex = 0;
  while (searchIndex >= 0) {
    const candidate = subdomain.indexOf("--", searchIndex);
    if (candidate < 0) {
      break;
    }

    const nextChar = subdomain.charAt(candidate + 2);
    if (nextChar && nextChar !== "-") {
      separatorIndex = candidate;
      break;
    }

    searchIndex = candidate + 2;
  }

  const addBaseForFragment = (fragment: string | null | undefined) => {
    const sanitised = sanitiseProjectFragment(fragment);
    if (!sanitised) {
      return;
    }

    bases.add(`https://${regionCandidate}-${sanitised}.cloudfunctions.net`);
  };

  if (separatorIndex >= 0) {
    addBaseForFragment(subdomain.slice(separatorIndex + 2));
    addBaseForFragment(subdomain.slice(0, separatorIndex));
  } else {
    addBaseForFragment(subdomain);
  }

  return Array.from(bases);
};

export const resolveHostedAppBase = (
  host: string | null | undefined,
): string | null => {
  const [base] = resolveHostedAppBases(host);
  return base ?? null;
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
