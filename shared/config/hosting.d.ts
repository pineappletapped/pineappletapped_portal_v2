export declare const PORTAL_HOSTED_APP_URL: string;
export declare const PORTAL_PRIMARY_REGION: string;
export declare const PORTAL_ADDITIONAL_REGIONS: readonly string[];
export declare const PORTAL_FUNCTION_PROJECTS: readonly string[];
export declare const PORTAL_LOCAL_DEVELOPMENT_ORIGINS: readonly string[];
export declare const PORTAL_FUNCTION_HOST_SUFFIXES: readonly string[];
export declare const PORTAL_FUNCTION_REGIONS: readonly string[];
export declare const buildFunctionBaseUrl: (
  region: string,
  project: string,
  suffix?: string,
) => string;
export declare const PORTAL_FUNCTION_BASE_URLS: readonly string[];
export declare const PORTAL_PRIMARY_FUNCTION_BASE: string;
export declare const PORTAL_DEFAULT_CORS_ORIGINS: readonly string[];
