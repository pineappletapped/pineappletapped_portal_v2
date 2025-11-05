# Google Drive Integration

This document describes how Pineapple Tapped Portal provisions and manages
client workspaces in Google Drive. It covers the service account
configuration, folder topology, runtime environment variables, and the API
contracts that the Next.js application exposes for administrators and
clients.

## 1. Service account configuration

1. Create a Google Cloud project (or reuse the Firebase project that hosts the
   portal) and enable the **Google Drive API**.
2. Create a **service account** dedicated to Drive automation, for example
   `drive-automation@<project-id>.iam.gserviceaccount.com`.
3. Grant the service account access to the shared Drive that stores client
   folders. We typically add it as a **Content manager** at the root.
4. Generate a JSON key for the service account and store the file securely. The
   contents of this file must be provided to the runtime via the
   `GDRIVE_SA_JSON` environment variable. The value can be raw JSON or a Base64
   encoded version of the JSON payload. For CI/CD the Base64 variant keeps
   multi-line secrets manageable.
5. (Optional) If end users need to see Drive files in audit logs as their own
   identity, configure **domain-wide delegation** for the service account and
   grant it the `https://www.googleapis.com/auth/drive` scope. Then set
   `GDRIVE_DELEGATED_USER` to the email address that should be impersonated
   when Drive automation runs (usually an ops/admin shared inbox).

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `GDRIVE_SA_JSON` | Service account credentials. Accepts raw JSON or a Base64 encoded JSON key. |
| `GDRIVE_CLIENT_ROOT_ID` | The folder ID that acts as the root container for all client folders. |
| `GDRIVE_DELEGATED_USER` *(optional)* | User to impersonate when the service account has domain-wide delegation. |
| `NEXT_ASSET_BASE_URL` | Public origin for immutable `_next/static` and `public` files used during deploy. |

Set these variables in **App Hosting** (`apphosting.yaml`), Firebase Functions,
local `.env` files, and CI secrets (`GCS_BUCKET`, `GDRIVE_SA_JSON`, etc.) so
builds and API routes can authenticate with Drive.

## 2. Folder structure & permissions

When a new client is onboarded the portal provisions a Drive workspace with
this structure:

```
<Client Name> /
├── Deliverables/
├── Uploads/
└── Internal Assets/
```

Additional sub-folders may be copied from templates when configured in the
Firebase Functions settings. The root folder ID is either supplied when the
API is called or defaults to `GDRIVE_CLIENT_ROOT_ID`.

Permissions are applied in three groups:

- **HQ** – Pineapple HQ staff with edit access across the workspace.
- **Franchise** – Regional franchise leads with edit or comment access.
- **Client** – Read-only or comment-level access for the customer.

The portal stores the Drive folder metadata (ID, link, assigned permissions) on
both the client and order records so future automation can reuse it.

## 3. Drive helper module

All Drive automation lives in [`functions/src/googleDrive.ts`](../functions/src/googleDrive.ts).
This module centralises client initialisation, permissions, folder listing, and
resumable upload URL generation. It is used by Firebase Functions as well as
Next.js API routes through the `@backend/googleDrive` alias.

Key helpers:

- `createClientFolder(clientName)` – Creates a root folder for a client under
  `GDRIVE_CLIENT_ROOT_ID` (or a supplied parent).
- `setPermissions(fileId, permissions)` – Applies Drive permissions without
  reinitialising the API client.
- `listFolderContents(folderId)` – Lists files and sub-folders for admin views.
- `getUploadUrl(folderId, fileName)` – Generates a resumable upload session for
  the client upload flow.

Errors are logged with contextual metadata and rethrown to callers so API
routes can surface descriptive responses to UI components.

## 4. Next.js API endpoints

All Drive traffic from the web client flows through server-side API routes in
`apps/web/src/pages/api/drive/`:

| Endpoint | Description |
| --- | --- |
| `POST /api/drive/create-client-folder` | Validates an order, provisions the Drive folder, applies permissions, and returns metadata. |
| `GET /api/drive/list-client-folders` | Lists folders for admin dashboards with optional `clientId` filtering. |
| `POST /api/drive/upload-token` | Issues a resumable upload URL for the client `Uploads` folder. |
| `POST /api/drive/publish-deliverable` | Moves a file into the Deliverables folder once reviewed. |

Each route uses the shared Drive helpers and returns structured errors of the
form `{ error: true, message, code }` when something fails.

## 5. Admin & client flows

### Admins

1. Create or review a new order through the portal UI.
2. The order API validates inputs, calls `/api/drive/create-client-folder`, and
   persists the returned Drive metadata.
3. Admin dashboards call `/api/drive/list-client-folders` to browse client
   workspaces and `/api/drive/publish-deliverable` when assets are ready to
   share.

### Clients

1. Clients receive upload requests via the portal.
2. The upload UI calls `/api/drive/upload-token` to obtain a resumable Drive
   upload URL scoped to their folder.
3. Once uploaded, HQ can move assets to the Deliverables folder, triggering
   notifications in the wider workflow.

### Failure handling

If Drive automation fails at any step the API returns `{ error: true, message }
` payloads. The React UI renders user-friendly toasts such as “Unable to create
folder. Please try again later.” while logging full context for operators.

## 6. Local development & testing

- Populate `.env.local` (web) and `.env` (functions) with the environment
  variables listed above. The same service account can be reused for local
  testing.
- Use the GitHub Action described below or run `npm run lint && npm run build`
  within `apps/web` to ensure type safety.
- Mock the Drive API for unit tests by stubbing the helper module exports. The
  `/src/pages/api/drive/*` routes only depend on the helper interface and can be
  tested independently.

## 7. CI/CD checks

The repository defines two Drive-related workflows:

- `deploy.yml` – Builds the Next.js bundle, uploads immutable assets to Cloud
  Storage, and deploys Firebase App Hosting.
- `drive-integration-tests.yml` – Runs Drive-specific linting, type-checking,
  and mock integration tests. This workflow can skip live Drive calls if
  credentials are not present in CI.

Together these steps help prevent regressions in the Drive provisioning flow
and catch missing environment variables before changes reach production.
