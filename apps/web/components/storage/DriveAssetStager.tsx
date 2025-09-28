"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable, type Functions } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";

interface ProjectSummary {
  id: string;
  name: string | null;
  orderId: string | null;
  orgId: string | null;
  franchiseId: string | null;
  status: string | null;
}

interface DriveItem {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  kind: "folder" | "file";
}

interface Breadcrumb {
  id: string;
  name: string;
}

interface DriveMetadata {
  orderFolderId: string | null;
  orderFolderName: string | null;
  productFolders: Array<{ folderId: string; productId: string | null; folderName: string | null }>;
}

interface UserContextState {
  loading: boolean;
  isStaff: boolean;
  franchiseIds: string[];
}

const deriveFranchiseIdsFromUser = (data: any): string[] => {
  const ids = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) ids.add(trimmed);
    }
  };
  push(data?.primaryFranchiseId);
  push(data?.franchiseId);
  if (Array.isArray(data?.franchiseIds)) {
    data.franchiseIds.forEach(push);
  }
  if (data?.franchiseRoles && typeof data.franchiseRoles === "object") {
    Object.values(data.franchiseRoles).forEach(push);
  }
  return Array.from(ids);
};

const formatBytes = (size: number | null): string => {
  if (size === null || size === undefined) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatIsoDate = (value: string | null): string => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

interface DriveAssetStagerProps {
  className?: string;
}

export default function DriveAssetStager({ className }: DriveAssetStagerProps) {
  const [services, setServices] = useState<{ db: Firestore; functions: Functions } | null>(null);
  const [userContext, setUserContext] = useState<UserContextState>({
    loading: true,
    isStaff: false,
    franchiseIds: [],
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [driveMeta, setDriveMeta] = useState<DriveMetadata | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState<{
    id: string;
    assetType: "deliverable" | "flight_plan";
  } | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db, functions } = await ensureFirebase();
        if (cancelled) return;
        setServices({ db, functions });

        const { onAuthStateChanged } = await loadAuthModule();
        unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
          if (!user) {
            setUserContext({ loading: false, isStaff: false, franchiseIds: [] });
            return;
          }
          try {
            const profileSnap = await getDoc(doc(db, "users", user.uid));
            const profile = profileSnap.exists() ? (profileSnap.data() as DocumentData) : {};
            const roles = profile?.roles || {};
            const isStaff =
              profile?.isStaff === true ||
              roles.admin === true ||
              roles.operations === true ||
              roles.projects === true;
            setUserContext({
              loading: false,
              isStaff,
              franchiseIds: deriveFranchiseIdsFromUser(profile),
            });
          } catch (error) {
            console.error("DriveAssetStager failed to load user context", error);
            setUserContext({ loading: false, isStaff: false, franchiseIds: [] });
          }
        });
      } catch (error) {
        console.error("DriveAssetStager failed to initialise Firebase", error);
        setProjectError("Unable to initialise Drive staging. Please refresh and try again.");
        setUserContext({ loading: false, isStaff: false, franchiseIds: [] });
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!services?.db) return;
    setProjectsLoading(true);
    setProjectError(null);
    try {
      let snapshot;
      if (!userContext.isStaff && userContext.franchiseIds.length > 0) {
        const ids = userContext.franchiseIds.slice(0, 10);
        const baseQuery = query(
          collection(services.db, "projects"),
          where("franchiseId", "in", ids),
          limit(25)
        );
        snapshot = await getDocs(baseQuery);
      } else {
        try {
          snapshot = await getDocs(
            query(collection(services.db, "projects"), orderBy("createdAt", "desc"), limit(25))
          );
        } catch (error: any) {
          if (error?.code === "failed-precondition") {
            snapshot = await getDocs(query(collection(services.db, "projects"), limit(25)));
          } else {
            throw error;
          }
        }
      }

      const records: ProjectSummary[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, any>;
        return {
          id: docSnap.id,
          name: typeof data.name === "string" ? data.name : null,
          orderId: typeof data.orderId === "string" ? data.orderId : null,
          orgId: typeof data.orgId === "string" ? data.orgId : null,
          franchiseId: typeof data.franchiseId === "string" ? data.franchiseId : null,
          status: typeof data.status === "string" ? data.status : null,
        };
      });
      setProjects(records);
      if (records.every((project) => project.id !== selectedProjectId)) {
        setSelectedProjectId("");
        setDriveItems([]);
        setBreadcrumbs([]);
        setDriveMeta(null);
      }
    } catch (error) {
      console.error("DriveAssetStager project lookup failed", error);
      setProjectError("Unable to load projects. Please try again.");
    } finally {
      setProjectsLoading(false);
    }
  }, [services?.db, selectedProjectId, userContext.franchiseIds, userContext.isStaff]);

  useEffect(() => {
    if (!services?.db || userContext.loading) return;
    void refreshProjects();
  }, [services?.db, userContext.loading, refreshProjects]);

  const listFolder = useCallback(
    async (project: ProjectSummary, folderId?: string, folderLabel?: string, nextBreadcrumbs?: Breadcrumb[]) => {
      if (!services?.functions) return;
      setDriveLoading(true);
      setDriveError(null);
      setNotice(null);
      try {
        const callable = httpsCallable(services.functions, "drive_listProjectFolder");
        const response = await callable({ projectId: project.id, folderId: folderId || null });
        const payload = response.data as any;
        const items: DriveItem[] = Array.isArray(payload?.items)
          ? (payload.items as Array<Record<string, any>>).map((item) => ({
              id: typeof item.id === "string" ? item.id : String(item.id || ""),
              name:
                typeof item.name === "string" && item.name.trim().length > 0
                  ? item.name
                  : "Untitled",
              mimeType: typeof item.mimeType === "string" ? item.mimeType : null,
              size: typeof item.size === "number" ? item.size : null,
              modifiedTime:
                typeof item.modifiedTime === "string" ? item.modifiedTime : null,
              webViewLink:
                typeof item.webViewLink === "string" ? item.webViewLink : null,
              kind: item.kind === "folder" ? "folder" : "file",
            }))
          : [];
        setDriveItems(items);
        setOrderStatus(typeof payload?.order?.status === "string" ? payload.order.status : null);
        setDriveMeta({
          orderFolderId: typeof payload?.drive?.orderFolderId === "string" ? payload.drive.orderFolderId : null,
          orderFolderName: typeof payload?.drive?.orderFolderName === "string" ? payload.drive.orderFolderName : null,
          productFolders: Array.isArray(payload?.drive?.productFolders)
            ? payload.drive.productFolders
            : [],
        });
        if (nextBreadcrumbs) {
          setBreadcrumbs(nextBreadcrumbs);
        } else {
          const rootName =
            folderLabel ||
            payload?.folderName ||
            (typeof payload?.drive?.orderFolderName === "string"
              ? payload.drive.orderFolderName
              : "Order folder");
          setBreadcrumbs([{ id: payload?.folderId || folderId || project.id, name: rootName }]);
        }
      } catch (error) {
        console.error("DriveAssetStager folder listing failed", error);
        setDriveError("Unable to load the requested Drive folder. Please try again.");
      } finally {
        setDriveLoading(false);
      }
    },
    [services?.functions]
  );

  const handleProjectChange = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      setDriveItems([]);
      setDriveMeta(null);
      setBreadcrumbs([]);
      setOrderStatus(null);
      setNotice(null);
      setDriveError(null);
      if (projectId) {
        const project = projects.find((item) => item.id === projectId);
        if (project) {
          void listFolder(project);
        }
      }
    },
    [listFolder, projects]
  );

  const openFolder = useCallback(
    (item: DriveItem) => {
      if (!selectedProject) return;
      const next = [...breadcrumbs, { id: item.id, name: item.name }];
      void listFolder(selectedProject, item.id, item.name, next);
    },
    [breadcrumbs, listFolder, selectedProject]
  );

  const jumpToBreadcrumb = useCallback(
    (index: number) => {
      if (!selectedProject) return;
      const target = breadcrumbs[index];
      if (!target) return;
      const next = breadcrumbs.slice(0, index + 1);
      void listFolder(selectedProject, target.id, target.name, next);
    },
    [breadcrumbs, listFolder, selectedProject]
  );

  const stageFile = useCallback(
    async (
      item: DriveItem,
      options: { assetType?: "flight_plan" | "deliverable" } = {}
    ) => {
      if (!selectedProject || !services?.functions) return;
      setNotice(null);
      setDriveError(null);
      const targetType =
        options.assetType === "flight_plan" ? "flight_plan" : "deliverable";
      setIngesting({ id: item.id, assetType: targetType });
      try {
        const callable = httpsCallable(services.functions, "drive_stageAssetFromFile");
        const payload: Record<string, unknown> = {
          projectId: selectedProject.id,
          fileId: item.id,
        };
        if (targetType === "flight_plan") {
          payload.assetType = "flight_plan";
        }
        await callable(payload);
        setNotice(
          targetType === "flight_plan"
            ? `${item.name} staged as a flight plan.`
            : `${item.name} staged into the asset library.`
        );
      } catch (error: any) {
        console.error("DriveAssetStager staging failed", error);
        const message = error?.message || error?.code || "Failed to ingest the Drive file.";
        setDriveError(typeof message === "string" ? message : "Failed to ingest the Drive file.");
      } finally {
        setIngesting(null);
      }
    },
    [selectedProject, services?.functions]
  );

  const productFolders = driveMeta?.productFolders || [];

  return (
    <section className={className}>
      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Drive deliverable staging</h2>
            <p className="text-sm text-gray-600">
              Pick files from the shared Drive order folders and publish them straight into the
              client review queue without uploading duplicates.
            </p>
          </div>
          {userContext.loading ? (
            <p className="text-sm text-gray-600">Loading your project access…</p>
          ) : null}
          {!userContext.loading && !userContext.isStaff && userContext.franchiseIds.length === 0 ? (
            <p className="text-sm text-red-600">
              Your account does not belong to a franchise yet. Ask HQ to link your profile before staging deliverables from Drive.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Select a project</span>
              <select
                className="input"
                value={selectedProjectId}
                onChange={(event) => handleProjectChange(event.target.value)}
                disabled={projectsLoading || userContext.loading}
              >
                <option value="">Choose a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || project.id}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end justify-end gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void refreshProjects()}
                disabled={projectsLoading || userContext.loading}
              >
                {projectsLoading ? "Refreshing…" : "Refresh projects"}
              </button>
            </div>
          </div>
          {projectError ? <p className="text-sm text-red-600">{projectError}</p> : null}
        </div>

        {selectedProject ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-gray-900">
                  {selectedProject.name || selectedProject.id}
                </h3>
                <p className="text-xs text-gray-500">
                  Order status: {orderStatus ? orderStatus.replace(/_/g, " ") : "Unknown"}
                </p>
                {driveMeta?.orderFolderName ? (
                  <p className="text-xs text-gray-500">
                    Order folder: {driveMeta.orderFolderName}
                  </p>
                ) : null}
              </div>
              {productFolders.length ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  {productFolders.map((folder) => (
                    <button
                      key={`${folder.folderId}-${folder.productId || "root"}`}
                      type="button"
                      className="btn btn-xs"
                      onClick={() =>
                        void listFolder(
                          selectedProject,
                          folder.folderId,
                          folder.folderName || folder.productId || "Product folder",
                          [
                            {
                              id: driveMeta?.orderFolderId || folder.folderId,
                              name:
                                driveMeta?.orderFolderName || selectedProject.name || "Order folder",
                            },
                            { id: folder.folderId, name: folder.folderName || folder.productId || "Product folder" },
                          ]
                        )
                      }
                    >
                      {folder.folderName || folder.productId || "Product folder"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <nav aria-label="Drive breadcrumbs" className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
              {breadcrumbs.map((crumb, index) => (
                <button
                  key={crumb.id}
                  type="button"
                  className="flex items-center gap-1 hover:text-gray-900"
                  onClick={() => jumpToBreadcrumb(index)}
                  disabled={driveLoading}
                >
                  <span>{crumb.name}</span>
                  {index < breadcrumbs.length - 1 ? <span className="text-gray-400">/</span> : null}
                </button>
              ))}
            </nav>

            {notice ? <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p> : null}
            {driveError ? <p className="rounded bg-red-50 p-3 text-sm text-red-700">{driveError}</p> : null}

            {driveLoading ? (
              <p className="text-sm text-gray-600">Loading Drive contents…</p>
            ) : driveItems.length === 0 ? (
              <p className="text-sm text-gray-500">No files found in this folder.</p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {driveItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {item.kind === "folder" ? "Folder" : item.mimeType || "File"} · {formatBytes(item.size)} · {formatIsoDate(item.modifiedTime)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.webViewLink ? (
                        <Link
                          href={item.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-xs btn-outline"
                        >
                          Open in Drive
                        </Link>
                      ) : null}
                      {item.kind === "folder" ? (
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => openFolder(item)}
                          disabled={driveLoading}
                        >
                          Open folder
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => void stageFile(item)}
                            disabled={driveLoading || ingesting?.id === item.id}
                          >
                            {ingesting?.id === item.id && ingesting?.assetType === "deliverable"
                              ? "Staging…"
                              : "Stage asset"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-outline"
                            onClick={() => void stageFile(item, { assetType: "flight_plan" })}
                            disabled={driveLoading || ingesting?.id === item.id}
                          >
                            {ingesting?.id === item.id && ingesting?.assetType === "flight_plan"
                              ? "Staging…"
                              : "Stage as flight plan"}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
