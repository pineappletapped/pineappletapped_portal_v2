
# Storage Adapters

Select backend via env `STORAGE_ADAPTER`:
- `firebase` — upload to Firebase Storage
- `gdrive` — upload via Cloud Function to a Google Drive folder (Service Account)
- `local` — upload to a local disk server (signed URLs)

Each adapter exposes:
```ts
export interface StorageAdapter {
  getUploadUrl(params: { key: string; contentType: string }): Promise<{ url: string; key: string }>;
  getDownloadUrl(params: { key: string, expiresIn?: number }): Promise<string>;
}
```
