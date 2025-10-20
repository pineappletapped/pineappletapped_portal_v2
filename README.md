
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

## Notes
- Security Rules included in `firestore.rules` and `storage.rules` (tighten per your needs).
- This is a **starter**; production hardening (rate limits, quotas, audit, App Check enforcement everywhere) is recommended.
