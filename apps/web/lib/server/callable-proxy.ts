import { firebaseProjectId, functionsBaseUrl } from "@/lib/firebase";
import {
  DEFAULT_FUNCTION_BASE,
  LEGACY_FUNCTION_BASES,
  collectCallableTargets,
  buildCallableEndpointsFromBases,
  normaliseCallableEndpointVariants,
  resolveHostedAppContext,
  type CallableTarget,
  type HostedAppContext,
} from "@/lib/callableEndpoints";

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

const DEFAULT_BASE_ENV_VARS = [
  "NEXT_PUBLIC_FUNCTIONS_BASE_URL",
  "FUNCTIONS_BASE_URL",
  "FIREBASE_FUNCTIONS_URL",
];

export const JSON_CONTENT_TYPE = "application/json";
const MAX_INLINE_DETAILS = 600;

export interface EndpointOptions {
  explicitEndpointEnvVar?: string;
  additionalBaseEnvVars?: string[];
  defaultBaseUrl?: string;
}

export interface CallableEndpointResolution {
  endpoints: string[];
  bases: Array<string | null | undefined>;
  hostContext: HostedAppContext | null;
}

export const buildCallableEndpointCandidates = (
  functionName: string,
  request: Request,
  { explicitEndpointEnvVar, additionalBaseEnvVars, defaultBaseUrl }: EndpointOptions = {},
): CallableEndpointResolution => {
  const explicitEnvNames = [
    explicitEndpointEnvVar,
    explicitEndpointEnvVar ? `NEXT_PUBLIC_${explicitEndpointEnvVar}` : undefined,
  ];

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const hostContext = resolveHostedAppContext(hostHeader);
  const baseEnvVars = [...DEFAULT_BASE_ENV_VARS, ...(additionalBaseEnvVars ?? [])];
  const baseCandidates: Array<string | null | undefined> = [
    functionsBaseUrl,
    ...baseEnvVars.map((name) => process.env[name]),
    ...hostContext.bases,
    defaultBaseUrl ?? DEFAULT_FUNCTION_BASE,
    ...LEGACY_FUNCTION_BASES,
  ];

  for (const envName of explicitEnvNames) {
    if (!envName) {
      continue;
    }
    const explicit = normaliseCallableEndpointVariants(
      process.env[envName],
      functionName,
    );
    if (explicit.length > 0) {
      return { endpoints: explicit, bases: baseCandidates, hostContext };
    }
  }

  const endpoints = buildCallableEndpointsFromBases(functionName, baseCandidates);
  return { endpoints, bases: baseCandidates, hostContext };
};

export const collectCallableApiTargets = (
  bases: Array<string | null | undefined>,
  hostContext: HostedAppContext | null,
  additionalProjects: Array<string | null | undefined> = [],
): CallableTarget[] =>
  collectCallableTargets(bases, {
    hostContext,
    additionalProjects: [
      ...additionalProjects,
      process.env.FIREBASE_ADMIN_PROJECT_ID,
      process.env.GOOGLE_CLOUD_PROJECT,
      process.env.GCLOUD_PROJECT,
      firebaseProjectId,
    ],
  });

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
