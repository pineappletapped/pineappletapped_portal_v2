export const PORTAL_HOSTED_APP_URL =
  "https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app";

export const PORTAL_PRIMARY_REGION = "europe-west2";
export const PORTAL_ADDITIONAL_REGIONS = ["europe-west4", "us-central1"];

export const PORTAL_FUNCTION_PROJECTS = [
  "pineapple-tapped---portal",
  "ptfbportalbackend",
];

export const PORTAL_LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
];

export const PORTAL_FUNCTION_HOST_SUFFIXES = [
  "cloudfunctions.net",
  "cloudfunctions.app",
];

const unique = (values) => Array.from(new Set(values));

export const PORTAL_FUNCTION_REGIONS = unique([
  PORTAL_PRIMARY_REGION,
  ...PORTAL_ADDITIONAL_REGIONS,
]);

export const buildFunctionBaseUrl = (
  region,
  project,
  suffix = "cloudfunctions.net",
) => `https://${region}-${project}.${suffix}`;

export const PORTAL_FUNCTION_BASE_URLS = unique(
  PORTAL_FUNCTION_PROJECTS.flatMap((project) =>
    PORTAL_FUNCTION_REGIONS.flatMap((region) =>
      PORTAL_FUNCTION_HOST_SUFFIXES.map((suffix) =>
        buildFunctionBaseUrl(region, project, suffix),
      ),
    ),
  ),
);

export const PORTAL_PRIMARY_FUNCTION_BASE = buildFunctionBaseUrl(
  PORTAL_PRIMARY_REGION,
  PORTAL_FUNCTION_PROJECTS[0],
  "cloudfunctions.net",
);

export const PORTAL_DEFAULT_CORS_ORIGINS = unique([
  PORTAL_HOSTED_APP_URL,
  ...PORTAL_FUNCTION_BASE_URLS,
  ...PORTAL_LOCAL_DEVELOPMENT_ORIGINS,
]);
