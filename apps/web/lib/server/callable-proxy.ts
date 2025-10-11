import { functionsBaseUrl } from "@/lib/firebase";
import {
  DEFAULT_FUNCTION_BASE,
  buildCallableEndpointsFromBases,
  normaliseBaseUrl,
  resolveHostedAppBase,
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

export const buildCallableEndpointCandidates = (
  functionName: string,
  request: Request,
  { explicitEndpointEnvVar, additionalBaseEnvVars, defaultBaseUrl }: EndpointOptions = {},
) => {
  const explicitEnvNames = [
    explicitEndpointEnvVar,
    explicitEndpointEnvVar ? `NEXT_PUBLIC_${explicitEndpointEnvVar}` : undefined,
  ];

  for (const envName of explicitEnvNames) {
    if (!envName) {
      continue;
    }
    const explicit = normaliseBaseUrl(process.env[envName]);
    if (explicit) {
      return [`${explicit}/${functionName}`];
    }
  }

  const baseEnvVars = [...DEFAULT_BASE_ENV_VARS, ...(additionalBaseEnvVars ?? [])];
  const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  return buildCallableEndpointsFromBases(functionName, [
    functionsBaseUrl,
    ...baseEnvVars.map((name) => process.env[name]),
    resolveHostedAppBase(hostHeader),
    defaultBaseUrl ?? DEFAULT_FUNCTION_BASE,
  ]);
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
