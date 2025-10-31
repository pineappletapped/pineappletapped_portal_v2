declare module '../../shared/config/hosting.js' {
  export const PORTAL_HOSTED_APP_URL: string;
  export const PORTAL_PRIMARY_REGION: string;
  export const PORTAL_ADDITIONAL_REGIONS: readonly string[];
  export const PORTAL_FUNCTION_PROJECTS: readonly string[];
  export const PORTAL_LOCAL_DEVELOPMENT_ORIGINS: readonly string[];
  export const PORTAL_FUNCTION_HOST_SUFFIXES: readonly string[];
  export const PORTAL_FUNCTION_REGIONS: readonly string[];
  export const buildFunctionBaseUrl: (
    region: string,
    project: string,
    suffix?: string,
  ) => string;
  export const PORTAL_FUNCTION_BASE_URLS: readonly string[];
  export const PORTAL_PRIMARY_FUNCTION_BASE: string;
  export const PORTAL_DEFAULT_CORS_ORIGINS: readonly string[];
}
