"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { ensureFirebase } from "@/lib/firebase";

export interface DriveFolderBreadcrumb {
  id: string;
  name: string | null;
}

export interface DriveFolderSelection {
  id: string;
  name: string | null;
  breadcrumbs: DriveFolderBreadcrumb[];
}

interface DriveFolderPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (selection: DriveFolderSelection) => void;
  initialPath?: string[] | string | null;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

interface DriveFolderListItem {
  id: string;
  name: string;
}

interface FolderListingResponse {
  folderId?: string | null;
  folderName?: string | null;
  breadcrumbs?: Array<{ id?: string | null; folderId?: string | null; name?: string | null }>;
  folders?: Array<{ id?: string | null; folderId?: string | null; name?: string | null }>;
  items?: Array<{ id?: string | null; folderId?: string | null; name?: string | null }>;
}

const DEFAULT_CONFIRM_LABEL = "Use current folder";
const DEFAULT_TITLE = "Select a Drive folder";

const normaliseSegments = (input?: string[] | string | null): string[] => {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input
      .map((segment) => (typeof segment === "string" ? segment.trim() : ""))
      .filter((segment) => segment.length > 0);
  }
  if (typeof input === "string") {
    return input
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }
  return [];
};

export default function DriveFolderPicker({
  open,
  onClose,
  onConfirm,
  initialPath = null,
  title = DEFAULT_TITLE,
  description,
  confirmLabel,
}: DriveFolderPickerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const initialSegments = useMemo(() => normaliseSegments(initialPath), [initialPath]);
  const confirmButtonLabel = confirmLabel && confirmLabel.trim().length > 0 ? confirmLabel : DEFAULT_CONFIRM_LABEL;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolderListItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<DriveFolderBreadcrumb[]>([]);
  const [activeFolder, setActiveFolder] = useState<DriveFolderBreadcrumb | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }

      if (event.key === "Tab" && dialogRef.current) {
        const node = dialogRef.current;
        const focusable = Array.from(
          node.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((element) => !element.hasAttribute("data-focus-guard"));

        if (focusable.length === 0) {
          event.preventDefault();
          node.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
          return;
        }

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const fetchFolder = useCallback(
    async (options: {
      folderId?: string | null;
      breadcrumbs?: DriveFolderBreadcrumb[] | null;
      pathSegments?: string[] | null;
    } = {}) => {
      setLoading(true);
      setError(null);

      try {
        const { functions } = await ensureFirebase();
        if (!functions || (functions as any).__isPlaceholder) {
          throw new Error("Firebase Functions is unavailable.");
        }

        const callable = httpsCallable(functions, "drive_listTemplateFolders");
        const payload: Record<string, unknown> = {};
        if (options.folderId) {
          payload.folderId = options.folderId;
        } else if (options.pathSegments && options.pathSegments.length > 0) {
          payload.path = options.pathSegments;
        }

        const response = await callable(payload);
        const data = (response?.data as FolderListingResponse) || {};

        const folderId =
          typeof data.folderId === "string" && data.folderId.trim().length > 0
            ? data.folderId.trim()
            : options.folderId || null;
        const folderName =
          typeof data.folderName === "string" && data.folderName.trim().length > 0
            ? data.folderName.trim()
            : null;

        const responseBreadcrumbs = Array.isArray(data.breadcrumbs)
          ? data.breadcrumbs
              .map((crumb) => {
                const crumbId =
                  typeof crumb.id === "string"
                    ? crumb.id
                    : typeof crumb.folderId === "string"
                      ? crumb.folderId
                      : null;
                if (!crumbId) {
                  return null;
                }
                const crumbName =
                  typeof crumb.name === "string" && crumb.name.trim().length > 0
                    ? crumb.name.trim()
                    : null;
                return { id: crumbId, name: crumbName };
              })
              .filter((crumb): crumb is DriveFolderBreadcrumb => Boolean(crumb))
          : null;

        const nextBreadcrumbs =
          options.breadcrumbs && options.breadcrumbs.length > 0
            ? options.breadcrumbs
            : responseBreadcrumbs && responseBreadcrumbs.length > 0
              ? responseBreadcrumbs
              : folderId
                ? [{ id: folderId, name: folderName }]
                : [];

        setBreadcrumbs(nextBreadcrumbs);
        setActiveFolder(folderId ? { id: folderId, name: folderName } : null);

        const foldersSource = Array.isArray(data.folders)
          ? data.folders
          : Array.isArray(data.items)
            ? data.items
            : [];

        const mapped = foldersSource
          .map((item): DriveFolderListItem | null => {
            const itemId =
              typeof item.id === "string"
                ? item.id
                : typeof item.folderId === "string"
                  ? item.folderId
                  : null;
            if (!itemId) {
              return null;
            }
            const itemName =
              typeof item.name === "string" && item.name.trim().length > 0
                ? item.name.trim()
                : "Untitled folder";
            return { id: itemId, name: itemName };
          })
          .filter((value): value is DriveFolderListItem => Boolean(value));

        setFolders(mapped);
      } catch (err) {
        console.error("DriveFolderPicker failed to fetch folders", err);
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Failed to load Drive folders. Please try again."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) {
      setFolders([]);
      setError(null);
      setBreadcrumbs([]);
      setActiveFolder(null);
      setLoading(false);
      return;
    }

    void fetchFolder(
      initialSegments.length > 0
        ? { pathSegments: initialSegments }
        : {}
    );
  }, [open, fetchFolder, initialSegments]);

  const handleOpenFolder = useCallback(
    (folder: DriveFolderListItem) => {
      const next = [...breadcrumbs, { id: folder.id, name: folder.name }];
      void fetchFolder({ folderId: folder.id, breadcrumbs: next });
    },
    [breadcrumbs, fetchFolder]
  );

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const target = breadcrumbs[index];
      if (!target) return;
      const next = breadcrumbs.slice(0, index + 1);
      void fetchFolder({ folderId: target.id, breadcrumbs: next });
    },
    [breadcrumbs, fetchFolder]
  );

  const handleUseCurrentFolder = useCallback(() => {
    if (!activeFolder) {
      return;
    }
    const selectionBreadcrumbs =
      breadcrumbs.length > 0 ? breadcrumbs : [{ id: activeFolder.id, name: activeFolder.name }];
    onConfirm({ id: activeFolder.id, name: activeFolder.name ?? null, breadcrumbs: selectionBreadcrumbs });
    onClose();
  }, [activeFolder, breadcrumbs, onClose, onConfirm]);

  const handleUseFolder = useCallback(
    (folder: DriveFolderListItem) => {
      const next = [...breadcrumbs, { id: folder.id, name: folder.name }];
      onConfirm({ id: folder.id, name: folder.name, breadcrumbs: next });
      onClose();
    },
    [breadcrumbs, onClose, onConfirm]
  );

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-folder-picker-title"
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl focus:outline-none"
        tabIndex={-1}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div className="space-y-1">
            <h2 id="drive-folder-picker-title" className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            {description ? <p className="text-xs text-gray-600">{description}</p> : null}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {activeFolder ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-gray-600">
              <p className="font-medium text-gray-700">Currently viewing</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {activeFolder.name || "Untitled folder"}
              </p>
              <a
                className="mt-2 inline-flex text-xs font-medium text-blue-600 underline"
                href={`https://drive.google.com/drive/folders/${encodeURIComponent(activeFolder.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open this folder in Drive
              </a>
            </div>
          ) : null}

          <nav aria-label="Drive breadcrumbs" className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
            {breadcrumbs.map((crumb, index) => (
              <button
                key={crumb.id}
                type="button"
                className="flex items-center gap-1 hover:text-gray-900"
                onClick={() => handleBreadcrumbClick(index)}
                disabled={loading}
              >
                <span>{crumb.name || "Untitled folder"}</span>
                {index < breadcrumbs.length - 1 ? <span className="text-gray-400">/</span> : null}
              </button>
            ))}
          </nav>

          {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

          {loading ? (
            <p className="text-sm text-gray-600">Loading folders…</p>
          ) : folders.length === 0 ? (
            <p className="text-sm text-gray-500">No sub-folders found in this folder.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {folders.map((folder) => (
                <li key={folder.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <p className="text-sm font-semibold text-gray-900">{folder.name}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => handleOpenFolder(folder)}
                      disabled={loading}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-outline"
                      onClick={() => handleUseFolder(folder)}
                      disabled={loading}
                    >
                      Use this folder
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <button type="button" className="btn btn-sm btn-outline" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          {activeFolder ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleUseCurrentFolder}
              disabled={loading}
            >
              {confirmButtonLabel}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

