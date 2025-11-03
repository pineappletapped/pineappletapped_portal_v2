# Next.js ChunkLoadError Audit

## Deployment Surface
- Firebase App Hosting backend `ptfbportalbackend` configured in `firebase.json` pointing at repo root, indicating container build for Cloud Run with App Hosting. Configuration is further detailed in `apphosting.yaml` specifying Cloud Run runtime parameters and build-time environment variables for the Next.js frontend.
- Dockerfile drives deployment: two-stage build (`npm run build`) followed by runtime stage executing `apps/web/.next/standalone/server.js` from the built bundle.

## Build Artifacts
- `npm run build` generates `.next` output under `apps/web/.next`, including `standalone`, `static`, and build metadata such as `BUILD_ID` and `app-build-manifest.json`.
- Build identifier: `MGrJYZMEXaukfeR-gpOS6`.
- Sample chunk files:
  - `apps/web/.next/static/chunks/7023-e0159908f7725915.js`
  - `apps/web/.next/static/chunks/app/admin/storage/integration/page-67a981e56b431cc0.js`
  - `apps/web/.next/static/chunks/1357-341e1e296aefe47c.js`
- `public/` assets (logos, placeholder image) exist both at `apps/web/public` and copied into `apps/web/.next/standalone/public` by the sync script.

## Packaging & Sync Scripts
- `scripts/sync-next-standalone-assets.mjs` copies `.next/static` and `apps/web/public` into the standalone bundle (`apps/web/.next/standalone/_next/static` and `/public`).
- `scripts/verify-next-build.mjs` asserts `BUILD_ID`, `standalone/server.js`, and `standalone/_next/static` exist post-build.

## Potential Mismatch Areas
- Docker runtime copies entire `/app` from the build stage, so stale chunk errors are likely caused by CDN caching or deployment pipelines skipping the `sync` step rather than missing artifacts in the image.
- No Firebase Hosting headers or service-worker config observed; App Hosting relies on Next's server response headers.

## Notes
- Build logs during audit show external fetch/Firestore credential failures due to local environment; these shouldn't affect static chunk delivery but confirm runtime code executes during build.
- Repository lacks a top-level `.firebaseignore`; App Hosting ignore list excludes `node_modules`, `.git`, logs, and `functions/` only.
