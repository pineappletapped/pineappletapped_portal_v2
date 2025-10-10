import { functionsBaseUrl } from "@/lib/firebase";

export type CallableSuccessEnvelope = {
  result?: { data?: unknown } | null;
  data?: unknown;
};

export type CallableErrorEnvelope = {
  error?: {
    message?: string;
    status?: string;
    details?: unknown;
  } | null;
};

export type CallableEnvelope = (CallableSuccessEnvelope & CallableErrorEnvelope) & {
  code?: string;
};

const DEFAULT_FUNCTION_BASE = "https://us-central1-pineapple-tapped---portal.cloudfunctions.net";
const DEFAULT_BASE_ENV_VARS = [
  "NEXT_PUBLIC_FUNCTIONS_BASE_URL",
  "FUNCTIONS_BASE_URL",
  "FIREBASE_FUNCTIONS_URL",
];

export const JSON_CONTENT_TYPE = "application/json";
const MAX_INLINE_DETAILS = 600;

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

export const resolveHostedAppBase = (host: string | null | undefined): string | null => {
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

export interface EndpointOptions {
  explicitEndpointEnvVar?: string;
  additionalBaseEnvVars?: string[];
  defaultBaseUrl?: string;
}

export const buildCallableEndpointCandidates = (
  functionName: string,
  request: Request,
  { explicitEndpointEnvVar, additionalBaseEnvVars, defaultBaseUrl }: EndpointOptions = {},
) => {
  const explicitEndpoint = normaliseBaseUrl(
    explicitEndpointEnvVar ? process.env[explicitEndpointEnvVar] : undefined,
  );

  if (explicitEndpoint) {
    return [explicitEndpoint];
  }

  const baseEnvVars = [...DEFAULT_BASE_ENV_VARS, ...(additionalBaseEnvVars ?? [])];

  const candidateBases = [
    normaliseBaseUrl(functionsBaseUrl),
    ...baseEnvVars.map((name) => normaliseBaseUrl(process.env[name])),
    resolveHostedAppBase(request.headers.get("host")),
    normaliseBaseUrl(defaultBaseUrl ?? DEFAULT_FUNCTION_BASE),
  ];

  const uniqueBases = new Set(candidateBases.filter((value): value is string => Boolean(value)));
  return Array.from(uniqueBases).map((base) => `${base}/${functionName}`);
};

export const summariseDetails = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > MAX_INLINE_DETAILS ? `${trimmed.slice(0, MAX_INLINE_DETAILS)}…` : trimmed;
};

export const createEndpointAttemptLogger = () => {
  const attempts: string[] = [];
  return {
    attempts,
    push: (summary: string) => {
      attempts.push(summary);
    },
  };
};
