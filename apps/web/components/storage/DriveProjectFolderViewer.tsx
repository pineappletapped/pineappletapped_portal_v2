"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { ensureFirebase } from "@/lib/firebase";

interface DriveProjectFolderItem {
  id: string;
  name: string;
  kind: "file" | "folder";
  mimeType: string | null;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
}

interface DriveBreadcrumb {
  id: string;
  name: string | null;
}

interface DriveMetadata {
  projectName: string | null;
  orderId: string;
  orderStatus: string | null;
  driveOrderFolderId: string | null;
  driveOrderFolderName: string | null;
}

interface DriveListProjectFolderResponse {
  folderId?: string | null;
  folderName?: string | null;
  items?: Array<{
    id?: string | null;
    name?: string | null;
    mimeType?: string | null;
    size?: number | string | null;
    modifiedTime?: string | null;
    webViewLink?: string | null;
    kind?: string | null;
  }>;
  project?: {
    id?: string | null;
    name?: string | null;
  } | null;
  order?: {
    id?: string | null;
    status?: string | null;
  } | null;
  drive?: {
    orderFolderId?: string | null;
    orderFolderName?: string | null;
  } | null;
}

interface DriveProjectFolderViewerProps {
  projectId: string;
  initialFolderId?: string | null;
  className?: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatSize = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
};

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return dateFormatter.format(date);
};

export default function DriveProjectFolderViewer({
  projectId,
  initialFolderId = null,
  className,
}: DriveProjectFolderViewerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DriveProjectFolderItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<DriveBreadcrumb[]>([]);
  const [currentFolder, setCurrentFolder] = useState<{ id: string | null; name: string | null }>({
    id: null,
    name: null,
  });
  const [metadata, setMetadata] = useState<DriveMetadata | null>(null);

  const fetchFolder = useCallback(
    async (options: { folderId?: string | null; breadcrumbs?: DriveBreadcrumb[] | null } = {}) => {
      if (!projectId) {
        return;
      }
      setLoading(true);
      setError(null);

      try {
        const { functions } = await ensureFirebase();
        if (!functions || (functions as any).__isPlaceholder) {
          throw new Error("Firebase Functions is unavailable.");
        }

        const callable = httpsCallable(functions, "drive_listProjectFolder");
        const payload: Record<string, unknown> = { projectId };
        if (options.folderId) {
          payload.folderId = options.folderId;
        }

        const response = await callable(payload);
        const data = (response?.data as DriveListProjectFolderResponse) || {};

        const resolvedFolderId =
          typeof data.folderId === "string" && data.folderId.trim().length > 0
            ? data.folderId.trim()
            : options.folderId || null;
        const resolvedFolderName =
          typeof data.folderName === "string" && data.folderName.trim().length > 0
            ? data.folderName.trim()
            : options.breadcrumbs && options.breadcrumbs.length > 0
              ? options.breadcrumbs[options.breadcrumbs.length - 1]?.name ?? null
              : null;

        const parsedItems = Array.isArray(data.items)
          ? data.items
              .map((item) => {
                const id = typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : null;
                if (!id) {
                  return null;
                }
                const name = typeof item.name === "string" && item.name.trim().length > 0 ? item.name.trim() : "Untitled";
                const mimeType = typeof item.mimeType === "string" && item.mimeType.trim().length > 0 ? item.mimeType.trim() : null;
                const sizeValue =
                  typeof item.size === "number"
                    ? item.size
                    : typeof item.size === "string"
                      ? Number.parseInt(item.size, 10)
                      : null;
                const safeSize = Number.isFinite(sizeValue) ? Number(sizeValue) : null;
                const modifiedTime = typeof item.modifiedTime === "string" ? item.modifiedTime : null;
                const webViewLink = typeof item.webViewLink === "string" ? item.webViewLink : null;
                const kind = item.kind === "folder" || item.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file";
                return {
                  id,
                  name,
                  mimeType,
                  size: safeSize,
                  modifiedTime,
                  webViewLink,
                  kind,
                } satisfies DriveProjectFolderItem;
              })
              .filter((entry): entry is DriveProjectFolderItem => Boolean(entry))
          : [];

        const nextBreadcrumbs = options.breadcrumbs && options.breadcrumbs.length > 0
          ? options.breadcrumbs
          : resolvedFolderId
            ? [{ id: resolvedFolderId, name: resolvedFolderName }]
            : [];

        setItems(parsedItems);
        setCurrentFolder({ id: resolvedFolderId, name: resolvedFolderName || null });
        setBreadcrumbs(nextBreadcrumbs);
        setMetadata({
          projectName:
            data.project && typeof data.project.name === "string" && data.project.name.trim().length > 0
              ? data.project.name.trim()
              : null,
          orderId:
            data.order && typeof data.order.id === "string" && data.order.id.trim().length > 0
              ? data.order.id.trim()
              : projectId,
          orderStatus:
            data.order && typeof data.order.status === "string" && data.order.status.trim().length > 0
              ? data.order.status.trim()
              : null,
          driveOrderFolderId:
            data.drive && typeof data.drive.orderFolderId === "string" && data.drive.orderFolderId.trim().length > 0
              ? data.drive.orderFolderId.trim()
              : null,
          driveOrderFolderName:
            data.drive && typeof data.drive.orderFolderName === "string" && data.drive.orderFolderName.trim().length > 0
              ? data.drive.orderFolderName.trim()
              : null,
        });
      } catch (err) {
        console.error("DriveProjectFolderViewer failed to load folder", err);
        setError(err instanceof Error ? err.message : "Failed to load Drive folder.");
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void fetchFolder({ folderId: initialFolderId || undefined });
  }, [fetchFolder, initialFolderId]);

  const heading = useMemo(() => {
    if (currentFolder.name) {
      return currentFolder.name;
    }
    if (metadata?.driveOrderFolderName) {
      return metadata.driveOrderFolderName;
    }
    return "Shared Drive";
  }, [currentFolder.name, metadata?.driveOrderFolderName]);

  const handleFolderOpen = useCallback(
    (item: DriveProjectFolderItem) => {
      if (item.kind !== "folder") {
        return;
      }
      const nextBreadcrumbs = [...breadcrumbs, { id: item.id, name: item.name }];
      void fetchFolder({ folderId: item.id, breadcrumbs: nextBreadcrumbs });
    },
    [breadcrumbs, fetchFolder]
  );

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const crumb = breadcrumbs[index];
      if (!crumb) {
        return;
      }
      const nextBreadcrumbs = breadcrumbs.slice(0, index + 1);
      void fetchFolder({ folderId: crumb.id, breadcrumbs: nextBreadcrumbs });
    },
    [breadcrumbs, fetchFolder]
  );

  return (
    <div className={className ? `grid gap-4 ${className}` : "grid gap-4"}>
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Only Pineapple Tapped staff and approved client team members can access these shared files. Downloads are read-only, and
        upload or delete actions are disabled for client accounts.
      </div>

      <div className="grid gap-1">
        <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
        {metadata?.projectName && (
          <p className="text-sm text-gray-600">Project: {metadata.projectName}</p>
        )}
        {metadata?.orderStatus && (
          <p className="text-xs text-gray-500">Order status: {metadata.orderStatus}</p>
        )}
      </div>

      {breadcrumbs.length > 0 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm text-gray-600" aria-label="Drive breadcrumbs">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <button
                key={crumb.id}
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${
                  isLast ? "bg-orange text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
                onClick={() => handleBreadcrumbClick(index)}
                disabled={isLast || loading}
              >
                <span className="truncate max-w-[12rem]" title={crumb.name || crumb.id}>
                  {crumb.name || crumb.id}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Last modified</th>
              <th className="px-3 py-2 text-right">Size</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  Loading files…
                </td>
              </tr>
            ) : null}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  This folder is empty.
                </td>
              </tr>
            ) : null}
            {items.map((item) => (
              <tr key={item.id}>
                <td className="max-w-xs truncate px-3 py-2 align-middle" title={item.name}>
                  {item.kind === "folder" ? (
                    <button
                      type="button"
                      className="text-orange hover:underline disabled:opacity-60"
                      onClick={() => handleFolderOpen(item)}
                      disabled={loading}
                    >
                      {item.name}
                    </button>
                  ) : item.webViewLink ? (
                    <a href={item.webViewLink} target="_blank" rel="noopener noreferrer" className="text-orange hover:underline">
                      {item.name}
                    </a>
                  ) : (
                    <span>{item.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle text-gray-600">
                  {item.kind === "folder" ? "Folder" : item.mimeType || "File"}
                </td>
                <td className="px-3 py-2 align-middle text-gray-600">{formatTimestamp(item.modifiedTime)}</td>
                <td className="px-3 py-2 align-middle text-right tabular-nums text-gray-600">{formatSize(item.size)}</td>
                <td className="px-3 py-2 align-middle text-right">
                  {item.kind === "file" && item.webViewLink ? (
                    <a
                      href={item.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-xs btn-outline"
                    >
                      Open
                    </a>
                  ) : item.kind === "folder" ? (
                    <button
                      type="button"
                      className="btn btn-xs btn-outline"
                      onClick={() => handleFolderOpen(item)}
                      disabled={loading}
                    >
                      View folder
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">No link</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
