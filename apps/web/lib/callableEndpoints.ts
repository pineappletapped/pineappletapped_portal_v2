export const DEFAULT_FUNCTION_BASE =
  "https://europe-west2-pineapple-tapped---portal.cloudfunctions.net";

export const LEGACY_FUNCTION_BASES = [
  "https://us-central1-ptfbportalbackend.cloudfunctions.net",
  "https://europe-west2-ptfbportalbackend.cloudfunctions.net",
];

const CLOUD_FUNCTION_REGION_HOST_PATTERN =
  /^https:\/\/((?:[a-z]+(?:-[a-z]+)*)[0-9])-([a-z0-9-]+)\.cloudfunctions\.net$/i;

const REGION_FALLBACKS = ["europe-west2", "europe-west4", "us-central1"];
const CODEBASE_ENV_VARS = [
  "FUNCTIONS_CODEBASE",
  "NEXT_PUBLIC_FUNCTIONS_CODEBASE",
  "FUNCTION_CODEBASE",
  "NEXT_PUBLIC_FUNCTION_CODEBASE",
  "FUNCTIONS_CODEBASES",
  "NEXT_PUBLIC_FUNCTIONS_CODEBASES",
  "FUNCTION_CODEBASES",
  "NEXT_PUBLIC_FUNCTION_CODEBASES",
];
const CODEBASE_HINT_ENV_VARS = [
  "FUNCTIONS_CODEBASE_HINTS",
  "NEXT_PUBLIC_FUNCTIONS_CODEBASE_HINTS",
  "FUNCTION_CODEBASE_HINTS",
  "NEXT_PUBLIC_FUNCTION_CODEBASE_HINTS",
  "CREATE_ORDER_FUNCTION_CODEBASE",
  "NEXT_PUBLIC_CREATE_ORDER_FUNCTION_CODEBASE",
];
const PROJECT_ID_ENV_VARS = [
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "FIREBASE_ADMIN_PROJECT_ID",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
];
const CODEBASE_DELIMITER = /[\s,;]+/;
const DEFAULT_CODEBASE_HINTS = ["ptfbportal", "ptfbportalbackend", "pineappletappedportal"];

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

export const sanitiseProjectFragment = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/^[-]+/, "");
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

const sanitiseCodebase = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

const expandCodebaseHint = (value: string | null | undefined): string[] => {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const variants = new Set<string>();
  const record = (candidate: string | null) => {
    const normalised = sanitiseCodebase(candidate);
    if (normalised) {
      variants.add(normalised);
    }
  };

  record(trimmed);
  record(trimmed.replace(/[-_]+/g, "-"));
  record(trimmed.replace(/[^a-z0-9]+/gi, ""));

  return Array.from(variants);
};

const collectCodebaseHints = (
  additional: Array<string | null | undefined> = [],
): string[] => {
  const hints = new Set<string>();

  const capture = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }

    for (const variant of expandCodebaseHint(candidate)) {
      hints.add(variant);
    }
  };

  for (const envName of CODEBASE_HINT_ENV_VARS) {
    const raw = process.env[envName];
    if (!raw) {
      continue;
    }

    for (const part of raw.split(CODEBASE_DELIMITER)) {
      capture(part);
    }
  }

  for (const envName of PROJECT_ID_ENV_VARS) {
    capture(process.env[envName]);
  }

  for (const fallback of DEFAULT_CODEBASE_HINTS) {
    capture(fallback);
  }

  for (const candidate of additional) {
    capture(candidate);
  }

  return Array.from(hints);
};

export const resolveFunctionCodebases = (
  hints: Array<string | null | undefined> = [],
): string[] => {
  const codebases: string[] = [""];
  const unique = new Set(codebases);

  const append = (candidate: string | null) => {
    if (!candidate || unique.has(candidate)) {
      return;
    }
    unique.add(candidate);
    codebases.push(candidate);
  };

  for (const envName of CODEBASE_ENV_VARS) {
    const raw = process.env[envName];
    if (!raw) {
      continue;
    }

    for (const part of raw.split(CODEBASE_DELIMITER)) {
      append(sanitiseCodebase(part));
    }
  }

  for (const hint of collectCodebaseHints(hints)) {
    append(hint);
  }

  append("default");

  return codebases;
};

export interface CallableFunctionIdOptions {
  codebaseHints?: Array<string | null | undefined>;
}

export const resolveCallableFunctionIds = (
  functionName: string,
  { codebaseHints }: CallableFunctionIdOptions = {},
): string[] => {
  const trimmed = typeof functionName === "string" ? functionName.trim() : "";
  if (!trimmed) {
    return [];
  }

  const identifiers = new Set<string>([trimmed]);

  for (const codebase of resolveFunctionCodebases(codebaseHints)) {
    if (!codebase) {
      continue;
    }

    identifiers.add(`${codebase}-${trimmed}`);
  }

  return Array.from(identifiers);
};

export interface HostedAppContext {
  bases: string[];
  projectFragments: string[];
  region: string | null;
}

export const resolveHostedAppContext = (
  host: string | null | undefined,
): HostedAppContext => {
  if (!host) {
    return { bases: [], projectFragments: [], region: null };
  }

  const trimmed = host.trim().toLowerCase();
  if (!trimmed.endsWith(".hosted.app")) {
    return { bases: [], projectFragments: [], region: null };
  }

  const segments = trimmed.split(".");
  if (segments.length < 3) {
    return { bases: [], projectFragments: [], region: null };
  }

  const subdomain = segments[0];
  const regionSegment = segments[1];
  if (!subdomain) {
    return { bases: [], projectFragments: [], region: null };
  }

  const regionCandidate =
    typeof regionSegment === "string" && /^[a-z0-9-]+$/.test(regionSegment)
      ? regionSegment
      : "us-central1";

  const bases = new Set<string>();
  const projectFragments = new Set<string>();

  const addBase = (candidate: string | null | undefined) => {
    const normalised = normaliseBaseUrl(candidate);
    if (normalised) {
      bases.add(normalised);
    }
  };

  const trackProjectFragment = (fragment: string | null | undefined) => {
    const sanitised = sanitiseProjectFragment(fragment);
    if (!sanitised) {
      return null;
    }

    projectFragments.add(sanitised);
    return sanitised;
  };

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

  if (separatorIndex >= 0) {
    const projectFragment = trackProjectFragment(
      subdomain.slice(separatorIndex + 2),
    );
    if (projectFragment) {
      addBase(`https://${regionCandidate}-${projectFragment}.cloudfunctions.net`);
    }

    const legacyFragment = trackProjectFragment(
      subdomain.slice(0, separatorIndex),
    );
    if (legacyFragment) {
      addBase(`https://${regionCandidate}-${legacyFragment}.cloudfunctions.net`);
    }
  } else {
    const fragment = trackProjectFragment(subdomain);
    if (fragment) {
      addBase(`https://${regionCandidate}-${fragment}.cloudfunctions.net`);
    }
  }

  const hostedApiVersions = ["v2", "v1", "v1beta"] as const;

  for (const apiVersion of hostedApiVersions) {
    const versionedBase = `https://${trimmed}/_firebase/functions/${apiVersion}`;
    addBase(versionedBase);
    addBase(`${versionedBase}/${regionCandidate}`);
  }

  if (projectFragments.size > 0) {
    const regionTargets = new Set([regionCandidate, ...REGION_FALLBACKS]);

    for (const projectFragment of projectFragments) {
      for (const region of regionTargets) {
        for (const apiVersion of hostedApiVersions) {
          addBase(
            `https://${trimmed}/_firebase/functions/${apiVersion}/projects/${projectFragment}/locations/${region}/functions`,
          );
        }
      }
    }
  }

  return {
    bases: Array.from(bases),
    projectFragments: Array.from(projectFragments),
    region: regionCandidate,
  };
};

export const resolveHostedAppBases = (
  host: string | null | undefined,
): string[] => resolveHostedAppContext(host).bases;

export const resolveHostedAppBase = (
  host: string | null | undefined,
): string | null => {
  const context = resolveHostedAppContext(host);
  const [base] = context.bases;
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
  const baseSuffix = `/${functionName.toLowerCase()}`;
  if (lowerValue.endsWith(baseSuffix)) {
    return true;
  }

  const callableSuffix = `${baseSuffix}:call`;
  return lowerValue.endsWith(callableSuffix);
};

export const normaliseCallableEndpointVariants = (
  value: string | null | undefined,
  functionName: string,
): string[] => {
  const normalised = normaliseBaseUrl(value);
  if (!normalised) {
    return [];
  }

  if (looksLikeExplicitEndpoint(normalised, functionName)) {
    const variants = new Set<string>([normalised]);
    if (!normalised.includes('?')) {
      if (normalised.endsWith(':call')) {
        variants.add(normalised.slice(0, -5));
      } else {
        variants.add(`${normalised}:call`);
      }
    }
    return Array.from(variants);
  }

  const variants = new Set<string>();
  const baseEndpoint = `${normalised}/${functionName}`;
  variants.add(baseEndpoint);

  variants.add(`${baseEndpoint}:call`);

  return Array.from(variants);
};

export const normaliseCallableEndpoint = (
  value: string | null | undefined,
  functionName: string,
): string | null => normaliseCallableEndpointVariants(value, functionName)[0] ?? null;

const normaliseProjectId = (value: string | null | undefined) =>
  sanitiseProjectFragment(value);

export interface CallableTarget {
  projectId: string;
  location: string;
}

export interface CallableTargetOptions {
  hostContext?: HostedAppContext | null;
  additionalProjects?: Array<string | null | undefined>;
}

export const collectCallableTargets = (
  baseUrls: Array<string | null | undefined>,
  { hostContext, additionalProjects }: CallableTargetOptions = {},
): CallableTarget[] => {
  const targets = new Map<string, CallableTarget>();

  const appendTarget = (
    projectCandidate: string | null | undefined,
    locationCandidate: string | null | undefined,
  ) => {
    const projectId = normaliseProjectId(projectCandidate);
    const location = locationCandidate?.trim();
    if (!projectId || !location) {
      return;
    }

    const key = `${projectId}::${location}`;
    if (!targets.has(key)) {
      targets.set(key, { projectId, location });
    }
  };

  for (const base of baseUrls) {
    const normalised = normaliseBaseUrl(base);
    if (!normalised) {
      continue;
    }

    const match = normalised.match(CLOUD_FUNCTION_REGION_HOST_PATTERN);
    if (!match) {
      continue;
    }

    const [, region, project] = match;
    appendTarget(project, region);
  }

  const context = hostContext ?? null;
  if (context) {
    const regionCandidates = context.region
      ? new Set([context.region, ...REGION_FALLBACKS])
      : new Set(REGION_FALLBACKS);

    for (const project of context.projectFragments) {
      for (const region of regionCandidates) {
        appendTarget(project, region);
      }
    }
  }

  if (additionalProjects?.length) {
    const regions = context?.region
      ? new Set([context.region, ...REGION_FALLBACKS])
      : new Set(REGION_FALLBACKS);

    for (const project of additionalProjects) {
      for (const region of regions) {
        appendTarget(project, region);
      }
    }
  }

  return Array.from(targets.values());
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
  const codebases = resolveFunctionCodebases();
  const functionIds = resolveCallableFunctionIds(functionName);

  for (const base of expandRegionalBases(baseUrls)) {
    for (const endpoint of normaliseCallableEndpointVariants(base, functionName)) {
      uniqueEndpoints.add(endpoint);
    }

    for (const codebase of codebases) {
      if (!codebase) {
        continue;
      }

      const candidateBase = `${base}/${codebase}`;
      for (const endpoint of normaliseCallableEndpointVariants(candidateBase, functionName)) {
        uniqueEndpoints.add(endpoint);
      }
    }

    for (const functionId of functionIds) {
      for (const endpoint of normaliseCallableEndpointVariants(base, functionId)) {
        uniqueEndpoints.add(endpoint);
      }
    }
  }

  return Array.from(uniqueEndpoints);
};
