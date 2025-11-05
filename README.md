# Pineapple Portal — Firebase Monorepo Starter

This starter uses **Firebase** (Auth, Firestore, Cloud Functions, optional Storage), with a **Next.js** web app and pluggable **storage adapters**:
- Firebase Storage (default)
- Google Drive (Service Account)
- Local Disk server (Node/Express) for self-hosted storage

It implements early versions of:
- Auth (email link)
- Orgs/Projects/Assets
- **Video review player with timecoded comments**
- Messaging (project thread)
- Bookings (availability + requests)
- Color-coded statuses for workflows
- Cloud Functions stubs (Stripe, email, bookings, downloads, live streams)

> Brand accent: **#FF7A00**.

## Quick start
1) Create a Firebase project and enable **Email Link** sign-in.
2) Copy `firebase/.env.example` to `firebase/.env.local` and fill values.
3) In **apps/web**: `cp .env.example .env.local` and set NEXT_PUBLIC Firebase config.
4) Install root deps then run web:
```bash
npm i -g firebase-tools
cd apps/web && npm i && npm run dev
```
5) (Optional) Set up **Functions**:
```bash
cd functions && npm i
# deploy or run emulator:
npm run serve
```

## Testing
Run the linter across the web app:

```bash
npm test
```

This executes `next lint` inside `apps/web` to catch basic code-quality issues.

## Storage Adapters
Set env `STORAGE_ADAPTER` to one of: `firebase`, `gdrive`, `local`.
- **firebase**: Upload directly to Firebase Storage with Security Rules.
- **gdrive**: Functions upload via Service Account to a Drive folder.
- **local**: Run `services/local-storage-server` to store on disk and use signed PUT/GET URLs.

See `packages/storage-adapters/README.md`.

## Static Assets via GCS (immutable)
Next.js static output (`.next/static/**`) and public assets (`public/**`) are uploaded to a dedicated Cloud Storage bucket on every deploy. The app renders all asset URLs with `NEXT_ASSET_BASE_URL`, which points to `https://storage.googleapis.com/<your-bucket>`, so every hashed chunk is fetched directly from Cloud Storage.

Deployment flow:
1. `npm run build` with `NEXT_ASSET_BASE_URL` exported (CI fills this automatically).
2. `scripts/upload-static.sh` syncs the local `.next/static` and `public` directories to `gs://$GCS_BUCKET`, enables bucket versioning, applies `Cache-Control: public,max-age=31536000,immutable` metadata, and grants public read access (`roles/storage.objectViewer`) so browsers can fetch the assets.
3. `firebase deploy --only apphosting` publishes the updated container image. The runtime also receives `NEXT_ASSET_BASE_URL`, so HTML references always target Cloud Storage.

Because Cloud Storage retains previous objects (via versioning and not deleting old hashes), clients stuck on an older HTML payload can still load matching chunks without 404s, eliminating the `ChunkLoadError` during rollouts.

## Notes
- Security Rules included in `firestore.rules` and `storage.rules` (tighten per your needs).
- This is a **starter**; production hardening (rate limits, quotas, audit, App Check enforcement everywhere) is recommended.
