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
import { resolveOrderIdentifier } from "@/lib/orders";
import {
  DIGITAL_STATUS_META,
  formatDigitalTimestamp,
  getDigitalStatusMeta,
} from "@/lib/digital-delivery";
import {
  FiClock,
  FiDownload,
  FiExternalLink,
  FiFileText,
} from "react-icons/fi";

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

interface OrderProductSummary {
  productId: string;
  name: string | null;
}

interface OrderSummary {
  id: string | null;
  status: string | null;
  items: OrderProductSummary[];
  orderNumber?: number | null;
  orderNumberFormatted?: string | null;
  orderNumberLabel?: string | null;
  orderNumberDisplay?: string | null;
}

interface DigitalDeliverySummaryEntry {
  productId: string;
  label: string | null;
  description: string | null;
  status: string | null;
  autoRelease: boolean;
  lastReleasedAt: string | null;
  lastReleasedAssetId: string | null;
  lastReleasedVersion: number | null;
  release: {
    status: string | null;
    assetId: string | null;
    assetName: string | null;
    downloadUrl: string | null;
    version: number | null;
    releasedAt: string | null;
    updatedAt: string | null;
    releaseNotes: string | null;
    driveFileName: string | null;
    driveFileId: string | null;
    driveFileWebViewLink: string | null;
    sizeBytes: number | null;
  } | null;
}

interface DigitalSummary {
  status: string | null;
  updatedAt: string | null;
  deliveries: DigitalDeliverySummaryEntry[];
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

const DIGITAL_TONE_CLASSES: Record<string, string> = {
  released: "bg-emerald-100 text-emerald-800",
  processing: "bg-sky-100 text-sky-800",
  archived: "bg-slate-200 text-slate-700",
  partial: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
};

const resolveDigitalToneClass = (tone?: string | null): string => {
  if (!tone) {
    return "bg-amber-100 text-amber-800";
  }
  return DIGITAL_TONE_CLASSES[tone] ?? "bg-amber-100 text-amber-800";
};

interface DriveAssetStagerProps {
  className?: string;
  initialProjectId?: string | null;
  initialOrderId?: string | null;
}

export default function DriveAssetStager({
  className,
  initialProjectId = null,
  initialOrderId = null,
}: DriveAssetStagerProps) {
  const projectHint = (initialProjectId || "").trim();
  const orderHint = (initialOrderId || "").trim();
  const [services, setServices] = useState<{ db: Firestore; functions: Functions } | null>(null);
  const [userContext, setUserContext] = useState<UserContextState>({
    loading: true,
    isStaff: false,
    franchiseIds: [],
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectHint);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [driveMeta, setDriveMeta] = useState<DriveMetadata | null>(null);
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [digitalSummary, setDigitalSummary] = useState<DigitalSummary | null>(null);
  const [selectedDigitalProductId, setSelectedDigitalProductId] = useState<string>("");
  const [digitalReleaseNotes, setDigitalReleaseNotes] = useState<string>("");
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveErrorHelp, setDriveErrorHelp] = useState<"integration" | null>(null);
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

      let records: ProjectSummary[] = snapshot.docs.map((docSnap) => {
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

      const missingProjectHint =
        projectHint && records.every((project) => project.id !== projectHint);
      if (missingProjectHint) {
        try {
          const projectSnap = await getDoc(doc(services.db, "projects", projectHint));
          if (projectSnap.exists()) {
            const data = projectSnap.data() as Record<string, any>;
            const injected: ProjectSummary = {
              id: projectSnap.id,
              name: typeof data.name === "string" ? data.name : null,
              orderId: typeof data.orderId === "string" ? data.orderId : null,
              orgId: typeof data.orgId === "string" ? data.orgId : null,
              franchiseId: typeof data.franchiseId === "string" ? data.franchiseId : null,
              status: typeof data.status === "string" ? data.status : null,
            };
            records = [injected, ...records];
          }
        } catch (error) {
          console.warn("DriveAssetStager failed to fetch hinted project", error);
        }
      } else if (orderHint) {
        const missingOrderMatch = records.every(
          (project) => (project.orderId || "").trim() !== orderHint
        );
        if (missingOrderMatch) {
          try {
            const orderQuery = query(
              collection(services.db, "projects"),
              where("orderId", "==", orderHint),
              limit(1)
            );
            const orderSnap = await getDocs(orderQuery);
            if (!orderSnap.empty) {
              const docSnap = orderSnap.docs[0];
              const data = docSnap.data() as Record<string, any>;
              const injected: ProjectSummary = {
                id: docSnap.id,
                name: typeof data.name === "string" ? data.name : null,
                orderId: typeof data.orderId === "string" ? data.orderId : null,
                orgId: typeof data.orgId === "string" ? data.orgId : null,
                franchiseId: typeof data.franchiseId === "string" ? data.franchiseId : null,
                status: typeof data.status === "string" ? data.status : null,
              };
              records = [injected, ...records];
            }
          } catch (error) {
            console.warn("DriveAssetStager failed to fetch project for hinted order", error);
          }
        }
      }
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
  }, [
    orderHint,
    projectHint,
    services?.db,
    selectedProjectId,
    userContext.franchiseIds,
    userContext.isStaff,
  ]);

  useEffect(() => {
    if (!services?.db || userContext.loading) return;
    void refreshProjects();
  }, [services?.db, userContext.loading, refreshProjects]);

  useEffect(() => {
    if (!digitalSummary) {
      setSelectedDigitalProductId("");
      return;
    }
    if (
      selectedDigitalProductId &&
      digitalSummary.deliveries.some(
        (entry) => entry.productId === selectedDigitalProductId
      )
    ) {
      return;
    }
    setSelectedDigitalProductId("");
  }, [digitalSummary, selectedDigitalProductId]);

  const listFolder = useCallback(
    async (project: ProjectSummary, folderId?: string, folderLabel?: string, nextBreadcrumbs?: Breadcrumb[]) => {
      if (!services?.functions) return;
      setDriveLoading(true);
      setDriveError(null);
      setDriveErrorHelp(null);
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
        if (payload?.order && typeof payload.order === "object") {
          const orderId =
            typeof payload.order.id === "string" && payload.order.id.trim().length > 0
              ? payload.order.id.trim()
              : null;
          const orderStatus =
            typeof payload.order.status === "string" && payload.order.status.trim().length > 0
              ? payload.order.status.trim()
              : null;
          const orderItems: OrderProductSummary[] = Array.isArray(payload.order.items)
            ? (payload.order.items as Array<Record<string, any>>)
                .map((entry) => {
                  const rawId =
                    typeof entry?.productId === "string" && entry.productId.trim().length > 0
                      ? entry.productId.trim()
                      : typeof entry?.id === "string" && entry.id.trim().length > 0
                        ? entry.id.trim()
                        : "";
                  if (!rawId) return null;
                  const name =
                    typeof entry?.name === "string" && entry.name.trim().length > 0
                      ? entry.name.trim()
                      : null;
                  return { productId: rawId, name };
                })
                .filter((entry): entry is OrderProductSummary => entry !== null)
            : [];
          const orderNumber =
            typeof payload.order.number === "number" && Number.isFinite(payload.order.number)
              ? Math.trunc(payload.order.number)
              : null;
          const orderNumberLabel =
            typeof payload.order.numberLabel === "string" && payload.order.numberLabel.trim().length > 0
              ? payload.order.numberLabel.trim()
              : null;
          const orderNumberDisplay =
            typeof payload.order.numberDisplay === "string" && payload.order.numberDisplay.trim().length > 0
              ? payload.order.numberDisplay.trim()
              : orderNumberLabel
                ? `#${orderNumberLabel}`
                : null;
          setOrderSummary({
            id: orderId,
            status: orderStatus,
            items: orderItems,
            orderNumber,
            orderNumberFormatted: orderNumberLabel,
            orderNumberLabel,
            orderNumberDisplay,
          });
        } else {
          setOrderSummary(null);
        }
        if (payload?.digital && typeof payload.digital === "object") {
          const deliveries: DigitalDeliverySummaryEntry[] = Array.isArray(payload.digital.deliveries)
            ? (payload.digital.deliveries as Array<Record<string, any>>)
                .map((entry) => {
                  if (!entry || typeof entry !== "object") return null;
                  const productId =
                    typeof entry.productId === "string" && entry.productId.trim().length > 0
                      ? entry.productId.trim()
                      : "";
                  if (!productId) return null;
                  const releaseRaw = entry.release && typeof entry.release === "object" ? entry.release : null;
                  const release = releaseRaw
                    ? {
                        status:
                          typeof releaseRaw.status === "string" ? releaseRaw.status : null,
                        assetId:
                          typeof releaseRaw.assetId === "string" ? releaseRaw.assetId : null,
                        assetName:
                          typeof releaseRaw.assetName === "string" ? releaseRaw.assetName : null,
                        downloadUrl:
                          typeof releaseRaw.downloadUrl === "string" ? releaseRaw.downloadUrl : null,
                        version:
                          typeof releaseRaw.version === "number" && Number.isFinite(releaseRaw.version)
                            ? releaseRaw.version
                            : null,
                        releasedAt:
                          typeof releaseRaw.releasedAt === "string" ? releaseRaw.releasedAt : null,
                        updatedAt:
                          typeof releaseRaw.updatedAt === "string" ? releaseRaw.updatedAt : null,
                        releaseNotes:
                          typeof releaseRaw.releaseNotes === "string" ? releaseRaw.releaseNotes : null,
                        driveFileName:
                          typeof releaseRaw.driveFileName === "string" ? releaseRaw.driveFileName : null,
                        driveFileId:
                          typeof releaseRaw.driveFileId === "string" ? releaseRaw.driveFileId : null,
                        driveFileWebViewLink:
                          typeof releaseRaw.driveFileWebViewLink === "string"
                            ? releaseRaw.driveFileWebViewLink
                            : null,
                        sizeBytes:
                          typeof releaseRaw.sizeBytes === "number" && Number.isFinite(releaseRaw.sizeBytes)
                            ? releaseRaw.sizeBytes
                            : null,
                      }
                    : null;
                  return {
                    productId,
                    label: typeof entry.label === "string" ? entry.label : null,
                    description: typeof entry.description === "string" ? entry.description : null,
                    status: typeof entry.status === "string" ? entry.status : null,
                    autoRelease: entry.autoRelease === false ? false : true,
                    lastReleasedAt:
                      typeof entry.lastReleasedAt === "string" ? entry.lastReleasedAt : null,
                    lastReleasedAssetId:
                      typeof entry.lastReleasedAssetId === "string" ? entry.lastReleasedAssetId : null,
                    lastReleasedVersion:
                      typeof entry.lastReleasedVersion === "number" && Number.isFinite(entry.lastReleasedVersion)
                        ? entry.lastReleasedVersion
                        : null,
                    release,
                  } satisfies DigitalDeliverySummaryEntry;
                })
                .filter((entry): entry is DigitalDeliverySummaryEntry => entry !== null)
            : [];
          setDigitalSummary({
            status:
              typeof payload.digital.status === "string"
                ? payload.digital.status
                : null,
            updatedAt:
              typeof payload.digital.updatedAt === "string"
                ? payload.digital.updatedAt
                : null,
            deliveries,
          });
        } else {
          setDigitalSummary(null);
        }
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
      } catch (error: any) {
        console.error("DriveAssetStager folder listing failed", error);
        const details = typeof error?.details === "string" ? error.details : "";
        const message = typeof error?.message === "string" ? error.message : "";
        const combined = `${details} ${message}`.toLowerCase();
        if (
          (error?.code === "functions/failed-precondition" &&
            combined.includes("service account credentials are not configured")) ||
          combined.includes("google drive service account credentials are not configured")
        ) {
          setDriveError(
            "Google Drive integration is not configured. Please connect a service account to browse project folders."
          );
          setDriveErrorHelp("integration");
        } else {
          const fallback = details || message || "Unable to load the requested Drive folder. Please try again.";
          setDriveError(
            typeof fallback === "string"
              ? fallback
              : "Unable to load the requested Drive folder. Please try again."
          );
          setDriveErrorHelp(null);
        }
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
      setOrderSummary(null);
      setDigitalSummary(null);
      setSelectedDigitalProductId("");
      setDigitalReleaseNotes("");
      setNotice(null);
      setDriveError(null);
      setDriveErrorHelp(null);
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
      setDriveErrorHelp(null);
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
        } else if (selectedDigitalProductId) {
          payload.digitalProductId = selectedDigitalProductId;
          const notes = digitalReleaseNotes.trim();
          if (notes.length > 0) {
            payload.releaseNotes = notes;
          }
        }
        await callable(payload);
        const stagedAsFlightPlan = targetType === "flight_plan";
        const releasedDigitally =
          !stagedAsFlightPlan && selectedDigitalProductId.length > 0;
        setNotice(
          stagedAsFlightPlan
            ? `${item.name} staged as a flight plan.`
            : releasedDigitally
              ? `${item.name} staged and published to digital downloads.`
              : `${item.name} staged into the asset library.`
        );
        if (releasedDigitally) {
          setDigitalReleaseNotes("");
        }
        const currentBreadcrumb = breadcrumbs[breadcrumbs.length - 1];
        if (selectedProject) {
          void listFolder(
            selectedProject,
            currentBreadcrumb?.id,
            currentBreadcrumb?.name,
            currentBreadcrumb ? breadcrumbs : undefined
          );
        }
      } catch (error: any) {
        console.error("DriveAssetStager staging failed", error);
        const details = typeof error?.details === "string" ? error.details : "";
        const message = typeof error?.message === "string" ? error.message : "";
        const combined = `${details} ${message}`.toLowerCase();
        if (
          (error?.code === "functions/failed-precondition" &&
            combined.includes("service account credentials are not configured")) ||
          combined.includes("google drive service account credentials are not configured")
        ) {
          setDriveError(
            "Google Drive integration is not configured. Please connect a service account to ingest Drive files."
          );
          setDriveErrorHelp("integration");
        } else {
          const fallback = details || message || error?.code || "Failed to ingest the Drive file.";
          setDriveError(
            typeof fallback === "string" ? fallback : "Failed to ingest the Drive file."
          );
          setDriveErrorHelp(null);
        }
      } finally {
        setIngesting(null);
      }
    },
    [
      breadcrumbs,
      digitalReleaseNotes,
      listFolder,
      selectedDigitalProductId,
      selectedProject,
      services?.functions,
    ]
  );

  const productFolders = driveMeta?.productFolders || [];

  const orderIdentifier = useMemo(() => resolveOrderIdentifier(orderSummary), [orderSummary]);

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    (orderSummary?.items || []).forEach((item) => {
      if (item.productId) {
        map.set(item.productId, item.name || item.productId);
      }
    });
    return map;
  }, [orderSummary]);

  const digitalStatusMeta = useMemo(() => {
    if (!digitalSummary) {
      return null;
    }
    const meta = getDigitalStatusMeta(digitalSummary.status ?? null);
    if (meta) {
      return meta;
    }
    return digitalSummary.deliveries.length > 0 ? DIGITAL_STATUS_META.pending : null;
  }, [digitalSummary]);

  const digitalStatusToneClass = useMemo(
    () => resolveDigitalToneClass(digitalStatusMeta?.tone),
    [digitalStatusMeta]
  );

  useEffect(() => {
    if (!projects.length) return;
    if (!projectHint && !orderHint) return;
    let target: ProjectSummary | undefined;
    if (projectHint) {
      target = projects.find((project) => project.id === projectHint);
    }
    if (!target && orderHint) {
      target = projects.find((project) => (project.orderId || "").trim() === orderHint);
    }
    if (!target) return;
    if (target.id === selectedProjectId) {
      if (!driveItems.length) {
        void listFolder(target);
      }
      return;
    }
    setSelectedProjectId(target.id);
    void listFolder(target);
  }, [driveItems, listFolder, orderHint, projectHint, projects, selectedProjectId]);

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
                  Order status: {orderSummary?.status ? orderSummary.status.replace(/_/g, " ") : "Unknown"}
                </p>
                {orderIdentifier.friendlyDisplay ? (
                  <p className="text-xs text-gray-500">Order number: {orderIdentifier.friendlyDisplay}</p>
                ) : orderSummary?.id ? (
                  <p className="text-xs text-gray-500">Order ID: {orderSummary.id}</p>
                ) : null}
                {orderIdentifier.originalId &&
                orderIdentifier.friendlyDisplay &&
                orderIdentifier.friendlyDisplay !== orderIdentifier.originalId ? (
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">
                    Internal ID: {orderIdentifier.originalId}
                  </p>
                ) : null}
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

            {digitalSummary ? (
              <div className="w-full rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <FiDownload className="h-4 w-4" aria-hidden />
                    <span>Digital downloads</span>
                  </div>
                  {digitalStatusMeta ? (
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-semibold ${digitalStatusToneClass}`}
                    >
                      {digitalStatusMeta.label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-emerald-900/80">
                  Last update: {formatDigitalTimestamp(digitalSummary.updatedAt)}
                </p>
                <div className="mt-3 grid gap-3">
                  {digitalSummary.deliveries.length > 0 ? (
                    <ul className="grid gap-2">
                      {digitalSummary.deliveries.map((entry) => {
                        const entryStatusMeta =
                          getDigitalStatusMeta(entry.status ?? null) ??
                          (entry.release ? DIGITAL_STATUS_META.released : DIGITAL_STATUS_META.pending);
                        const chipClass = resolveDigitalToneClass(entryStatusMeta?.tone);
                        const productLabel =
                          entry.label || productNameById.get(entry.productId) || entry.productId;
                        return (
                          <li
                            key={`digital-${entry.productId}`}
                            className="rounded border border-emerald-200 bg-white/60 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-emerald-900">{productLabel}</p>
                                {entry.description ? (
                                  <p className="text-xs text-emerald-900/80">{entry.description}</p>
                                ) : null}
                              </div>
                              {entryStatusMeta ? (
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${chipClass}`}
                                >
                                  {entryStatusMeta.label}
                                </span>
                              ) : null}
                            </div>
                            {entry.release ? (
                              <div className="mt-2 grid gap-2 text-xs text-emerald-900">
                                <div className="flex items-center gap-1 text-emerald-900/80">
                                  <FiClock className="h-3 w-3" aria-hidden />
                                  <span>Released {formatIsoDate(entry.release.releasedAt)}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {entry.release.downloadUrl ? (
                                    <a
                                      href={entry.release.downloadUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-xs btn-primary"
                                    >
                                      Customer download
                                    </a>
                                  ) : null}
                                  {entry.release.driveFileWebViewLink ? (
                                    <a
                                      href={entry.release.driveFileWebViewLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-xs btn-outline"
                                    >
                                      Open in Drive
                                    </a>
                                  ) : null}
                                </div>
                                {entry.release.releaseNotes ? (
                                  <div className="flex items-start gap-1 text-emerald-900/80">
                                    <FiFileText className="mt-0.5 h-3 w-3" aria-hidden />
                                    <p className="whitespace-pre-line">{entry.release.releaseNotes}</p>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-emerald-900/80">
                                We&apos;ll notify customers when this download is published.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-emerald-900/80">
                      No products have digital downloads configured for this order yet.
                    </p>
                  )}
                  {digitalSummary.deliveries.length > 0 ? (
                    <div className="grid gap-2 rounded border border-emerald-200 bg-white/70 p-3 text-xs text-emerald-900">
                      <label className="grid gap-1">
                        <span className="font-semibold text-emerald-900">Publish staged file</span>
                        <select
                          className="input"
                          value={selectedDigitalProductId}
                          onChange={(event) => setSelectedDigitalProductId(event.target.value)}
                        >
                          <option value="">Don&apos;t publish digital download</option>
                          {digitalSummary.deliveries.map((entry) => (
                            <option key={`digital-option-${entry.productId}`} value={entry.productId}>
                              {entry.label || productNameById.get(entry.productId) || entry.productId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="font-semibold text-emerald-900">Release notes (optional)</span>
                        <textarea
                          className="textarea min-h-[72px]"
                          value={digitalReleaseNotes}
                          onChange={(event) => setDigitalReleaseNotes(event.target.value)}
                          placeholder="Share context or highlights for customers."
                        />
                      </label>
                      <p className="text-[11px] text-emerald-900/70">
                        Staging with a selected product publishes the download to all preorder customers.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

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
            {driveError ? (
              <div className="rounded bg-red-50 p-3 text-sm text-red-700">
                <p>{driveError}</p>
                {driveErrorHelp === "integration" ? (
                  <p className="mt-2 text-xs">
                    <Link className="font-semibold underline" href="/admin/storage/integration">
                      Configure Drive integration
                    </Link>
                     to add service account credentials.
                  </p>
                ) : null}
              </div>
            ) : null}

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
