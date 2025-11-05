#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCS_BUCKET:-}" ]]; then
  echo "GCS_BUCKET environment variable must be set" >&2
  exit 1
fi

CACHE_MAX_AGE="${CACHE_MAX_AGE:-31536000}"
BUILD_DIR="apps/web/.next"
PUBLIC_DIR="apps/web/public"

if [[ ! -f "${BUILD_DIR}/BUILD_ID" ]]; then
  echo "Next.js build artifacts not found: ${BUILD_DIR}/BUILD_ID is missing. Run \"npm run build\" first." >&2
  exit 1
fi

GCS_URI="gs://${GCS_BUCKET}"

if ! gsutil ls -b "${GCS_URI}" >/dev/null 2>&1; then
  if [[ -n "${GCP_PROJECT:-}" ]]; then
    gsutil mb -p "${GCP_PROJECT}" "${GCS_URI}"
  else
    gsutil mb "${GCS_URI}"
  fi
fi

gsutil uniformbucketlevelaccess set on "${GCS_URI}" || true

gsutil versioning set on "${GCS_URI}" || true

# Ensure the bucket is publicly readable so static assets can be fetched by browsers.
if ! gsutil iam get "${GCS_URI}" | grep -q 'roles/storage.objectViewer'; then
  gsutil iam ch allUsers:objectViewer "${GCS_URI}"
fi

gsutil -m rsync -r "${BUILD_DIR}/static" "${GCS_URI}/_next/static"

gsutil -m rsync -r "${PUBLIC_DIR}" "${GCS_URI}/public"

gsutil -m setmeta -h "Cache-Control:public,max-age=${CACHE_MAX_AGE},immutable" "${GCS_URI}/_next/static/**" || true
gsutil -m setmeta -h "Cache-Control:public,max-age=${CACHE_MAX_AGE},immutable" "${GCS_URI}/public/**" || true

echo "Static assets uploaded. Public base URL: https://storage.googleapis.com/${GCS_BUCKET}"
