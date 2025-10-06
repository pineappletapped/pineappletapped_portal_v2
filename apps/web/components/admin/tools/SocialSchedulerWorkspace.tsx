"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";

import PortalHero from "@/components/PortalHero";
import SchedulerCalendar from "@/components/admin/tools/SchedulerCalendar";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";
import { hasRole, type RoleKey, type UserRoles } from "@/lib/roles";

interface ClientOrganisation {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
}

interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  organisations: ClientOrganisation[];
  defaultOrganisationId: string | null;
  defaultOrganisationName: string | null;
}

interface ProjectSummary {
  id: string;
  name: string;
  reference: string | null;
  status: string | null;
  dueDate: Date | null;
}

interface ProductRecord {
  id: string;
  name: string;
  status: string | null;
}

interface SchedulerAccount {
  id: string;
  organisationId: string | null;
  organisationName: string | null;
  platform: string;
  displayName: string;
  status: string;
  hqManaged: boolean;
  scopes: { publish: boolean; analytics: boolean };
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerAccountHandle: string | null;
  providerAccountUrl: string | null;
  connection: {
    status: string | null;
    expiresAt: Date | null;
    refreshAvailable: boolean;
    requiresReauth: boolean;
    reauthRecommended: boolean;
    lastAuthorizedAt: Date | null;
    lastAuthorizedBy: string | null;
    updatedAt: Date | null;
  };
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface SchedulerMediaAttachment {
  id: string;
  label: string | null;
  url: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  type: "drive" | "external" | "deliverable";
}

interface SchedulerVariantUtm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

interface SchedulerPostVariant {
  id: string;
  platform: string;
  caption: string;
  firstComment: string | null;
  hashtags: string[];
  linkUrl: string | null;
  utm: SchedulerVariantUtm | null;
  thumbnailAssetId: string | null;
  thumbnailUrl: string | null;
}

interface SchedulerApprovalNote {
  id: string;
  message: string;
  createdBy: string | null;
  createdAt: Date | null;
}

type VariantDraftState = {
  caption: string;
  hashtags: string;
  firstComment: string;
  linkUrl: string;
  utm: SchedulerVariantUtm;
  thumbnailAssetId: string;
  thumbnailUrl: string;
};

interface SchedulerPost {
  id: string;
  organisationId: string | null;
  organisationName: string | null;
  projectId: string | null;
  projectName: string | null;
  deliverableLabel: string | null;
  deliverableProductId: string | null;
  deliverableProductName: string | null;
  baseLinkUrl: string | null;
  status: string;
  approvalState: string;
  scheduledAt: Date | null;
  timezone: string | null;
  notes: string | null;
  variants: SchedulerPostVariant[];
  attachments: SchedulerMediaAttachment[];
  approvalNotes: SchedulerApprovalNote[];
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface AiContentDraft {
  id: string;
  summary: string;
  socialPosts: Array<{
    id: string;
    platform: string;
    headline: string;
    body: string;
    hashtags: string[];
  }>;
  warnings: string[];
  createdAt: Date | null;
  promptName: string | null;
  modelName: string | null;
  requestId: string | null;
}

interface SchedulerFeatureFlags {
  globalEnabled: boolean;
  exportOnlyMode: boolean;
  analyticsEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
  notes: string | null;
}

interface SchedulerScopeFlag {
  id: string;
  name: string;
  enabled: boolean;
  exportOnlyMode: boolean;
  analyticsEnabled: boolean;
  notes: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

interface SocialSchedulerWorkspaceProps {
  allowFlagEditing?: boolean;
  roles?: UserRoles | null;
  emphasisePilotNote?: boolean;
}

const PLATFORM_OPTIONS = [
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitter", label: "X" },
  { value: "vimeo", label: "Vimeo" },
];

const PLATFORM_LABELS = PLATFORM_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {} as Record<string, string>
);

const PLATFORM_VALUE_BY_LABEL = Object.entries(PLATFORM_LABELS).reduce(
  (acc, [value, label]) => {
    acc[label.toLowerCase()] = value;
    return acc;
  },
  {} as Record<string, string>
);

const ACCOUNT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "requires_reauth", label: "Requires re-auth" },
  { value: "revoked", label: "Disconnected" },
];

const POST_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
];

const APPROVAL_STATES = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
];

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Account connections" },
  { id: "composer", label: "Post composer" },
  { id: "exports", label: "Exports" },
];

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp", error);
      return null;
    }
  }
  if (typeof value === "object" && value && "seconds" in (value as any)) {
    try {
      return new Timestamp((value as any).seconds, (value as any).nanoseconds ?? 0).toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp-like object", error);
      return null;
    }
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
}

function formatDateTime(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatIcsDate(value: Date) {
  const pad = (input: number) => `${input}`.padStart(2, "0");
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(
    value.getUTCHours()
  )}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
}

function normaliseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function extractDriveFileId(input: string): { id: string | null; url: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { id: null, url: null };
  }
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    return { id: trimmed, url: `https://drive.google.com/file/d/${trimmed}/view` };
  }
  const idMatch = trimmed.match(/\/d\/([A-Za-z0-9_-]{20,})/) || trimmed.match(/id=([^&]+)/);
  if (idMatch && idMatch[1]) {
    return { id: idMatch[1], url: trimmed };
  }
  return { id: null, url: trimmed };
}

function buildTrackedLink(baseUrl: string | null | undefined, utm?: Partial<SchedulerVariantUtm>): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (utm) {
      if (utm.source) url.searchParams.set("utm_source", utm.source);
      if (utm.medium) url.searchParams.set("utm_medium", utm.medium);
      if (utm.campaign) url.searchParams.set("utm_campaign", utm.campaign);
      if (utm.term) url.searchParams.set("utm_term", utm.term);
      if (utm.content) url.searchParams.set("utm_content", utm.content);
    }
    return url.toString();
  } catch (error) {
    console.warn("Unable to build tracked link", error);
    return baseUrl;
  }
}

function sanitiseUtm(utm: SchedulerVariantUtm): SchedulerVariantUtm | null {
  const cleaned: SchedulerVariantUtm = {
    source: utm.source?.trim() || null,
    medium: utm.medium?.trim() || null,
    campaign: utm.campaign?.trim() || null,
    term: utm.term?.trim() || null,
    content: utm.content?.trim() || null,
  };
  if (cleaned.source || cleaned.medium || cleaned.campaign || cleaned.term || cleaned.content) {
    return cleaned;
  }
  return null;
}

function generateLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return `${prefix}-${crypto.randomUUID()}`;
    } catch (error) {
      // ignore and fallback
    }
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildCsv(posts: SchedulerPost[]): string {
  const headers = [
    "Client",
    "Project",
    "Deliverable",
    "Platform",
    "Status",
    "Approval",
    "Scheduled",
    "Timezone",
    "Caption",
    "Hashtags",
  ];
  const rows = posts.flatMap((post) =>
    post.variants.map((variant) => {
      const hashtags = variant.hashtags.join(" ");
      return [
        post.organisationName ?? post.organisationId ?? "",
        post.projectName ?? post.projectId ?? "",
        post.deliverableProductName ?? post.deliverableLabel ?? "",
        variant.platform,
        post.status,
        post.approvalState,
        post.scheduledAt ? post.scheduledAt.toISOString() : "",
        post.timezone ?? "",
        variant.caption,
        hashtags,
      ];
    })
  );
  const csvLines = [headers.join(",")];
  rows.forEach((row) => {
    csvLines.push(
      row
        .map((cell) => {
          const safe = `${cell ?? ''}`.replace(/"/g, '""');
          return `"${safe}"`;
        })
        .join(",")
    );
  });
  return csvLines.join("\n");
}
function buildIcs(posts: SchedulerPost[]): string {
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pineapple Tapped//Social Scheduler//EN",
    "CALSCALE:GREGORIAN",
  ];
  posts.forEach((post) => {
    const start = post.scheduledAt ?? now;
    const summary =
      [post.deliverableProductName, post.organisationName].filter(Boolean).join(" · ") ||
      post.deliverableLabel ||
      "Scheduled social post";
    const description = post.variants
      .map((variant) => `${variant.platform.toUpperCase()}: ${variant.caption}`)
      .join("\\n\\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${post.id}@pineappletapped.com`);
    lines.push(`DTSTAMP:${formatIcsDate(now)}`);
    lines.push(`DTSTART:${formatIcsDate(start)}`);
    lines.push(`SUMMARY:${summary}`);
    if (description) {
      lines.push(`DESCRIPTION:${description.replace(/\n/g, "\\n")}`);
    }
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\n");
}

function getDefaultTimezone() {
  if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (error) {
      return null;
    }
  }
  return null;
}

function getRoleLabel(role: RoleKey) {
  switch (role) {
    case "admin":
      return "Admin";
    case "marketing":
      return "Marketing";
    case "projects":
      return "Projects";
    case "operations":
      return "Operations";
    case "sales":
      return "Sales";
    case "finance":
      return "Finance";
    case "affiliate":
      return "Affiliate";
    default:
      return role;
  }
}
export default function SocialSchedulerWorkspace({
  allowFlagEditing = false,
  roles = null,
  emphasisePilotNote = false,
}: SocialSchedulerWorkspaceProps) {
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [dbRef, setDbRef] = useState<Firestore | null>(null);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);

  const [activeTab, setActiveTab] = useState<string>("overview");

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<string>("");
  const [manualClientName, setManualClientName] = useState("");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [manualProjectName, setManualProjectName] = useState("");

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedProductName, setSelectedProductName] = useState<string>("");

  const [accounts, setAccounts] = useState<SchedulerAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    displayName: "",
    publishEnabled: true,
    analyticsEnabled: true,
  });

  const [posts, setPosts] = useState<SchedulerPost[]>([]);
  const [postLoading, setPostLoading] = useState(true);
  const [postError, setPostError] = useState<string | null>(null);
  const [postForm, setPostForm] = useState({
    status: "draft",
    approvalState: "draft",
    timezone: getDefaultTimezone(),
    scheduledAtInput: "",
    notes: "",
  });
  const [postCaption, setPostCaption] = useState("");
  const [postHashtags, setPostHashtags] = useState("");
  const [baseLinkUrl, setBaseLinkUrl] = useState("");
  const [platformSelection, setPlatformSelection] = useState<Set<string>>(new Set(["youtube", "linkedin"]));
  const [postSaving, setPostSaving] = useState(false);
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraftState>>({});

  const [featureFlags, setFeatureFlags] = useState<SchedulerFeatureFlags | null>(null);
  const [flagLoading, setFlagLoading] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagSaving, setFlagSaving] = useState(false);
  const [flagNotes, setFlagNotes] = useState("");

  const [franchiseFlags, setFranchiseFlags] = useState<SchedulerScopeFlag[]>([]);
  const [organisationFlags, setOrganisationFlags] = useState<SchedulerScopeFlag[]>([]);
  const [franchiseSearch, setFranchiseSearch] = useState("");
  const [organisationSearch, setOrganisationSearch] = useState("");
  const [scopeSavingKey, setScopeSavingKey] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [mediaAttachments, setMediaAttachments] = useState<SchedulerMediaAttachment[]>([]);
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const [aiDrafts, setAiDrafts] = useState<AiContentDraft[]>([]);
  const [aiDraftsLoading, setAiDraftsLoading] = useState(false);
  const [aiDraftsError, setAiDraftsError] = useState<string | null>(null);

  const getDefaultVariantDraft = useCallback(
    (platform: string): VariantDraftState => ({
      caption: postCaption,
      hashtags: postHashtags,
      firstComment: "",
      linkUrl: baseLinkUrl,
      utm: {
        source: platform,
        medium: "",
        campaign: "",
        term: "",
        content: "",
      },
      thumbnailAssetId: "",
      thumbnailUrl: "",
    }),
    [postCaption, postHashtags, baseLinkUrl]
  );

  const updateVariantDraft = useCallback(
    (platform: string, updates: Partial<VariantDraftState>) => {
      setVariantDrafts((prev) => {
        const current = prev[platform] ?? getDefaultVariantDraft(platform);
        return {
          ...prev,
          [platform]: { ...current, ...updates },
        };
      });
    },
    [getDefaultVariantDraft]
  );

  const applyAiDraftToComposer = useCallback(
    (draft: AiContentDraft, post: AiContentDraft["socialPosts"][number]) => {
      const platformKey = PLATFORM_VALUE_BY_LABEL[post.platform.trim().toLowerCase()] ?? post.platform.trim().toLowerCase();
      const hashtagsText = post.hashtags
        .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
        .join(" ");

      setPlatformSelection((prev) => {
        const next = new Set(prev);
        next.add(platformKey);
        return next;
      });
      setPostCaption(post.body);
      setPostHashtags(hashtagsText);
      setVariantDrafts((prev) => ({
        ...prev,
        [platformKey]: {
          ...getDefaultVariantDraft(platformKey),
          caption: post.body,
          hashtags: hashtagsText,
        },
      }));
      setFeedback(`Loaded ${post.platform} copy from AI draft ${draft.id}. Review before scheduling.`);
    },
    [getDefaultVariantDraft, setFeedback]
  );

  const handlePlatformToggle = useCallback(
    (platform: string, checked: boolean) => {
      setPlatformSelection((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(platform);
        } else {
          next.delete(platform);
        }
        return next;
      });
      setVariantDrafts((prev) => {
        if (checked) {
          if (prev[platform]) {
            return prev;
          }
          return { ...prev, [platform]: getDefaultVariantDraft(platform) };
        }
        if (!prev[platform]) {
          return prev;
        }
        const { [platform]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [getDefaultVariantDraft]
  );

  const handleAddAttachment = useCallback(() => {
    const rawUrl = attachmentUrl.trim();
    const rawLabel = attachmentLabel.trim();
    if (!rawUrl) {
      setAttachmentError("Provide a link or Drive file ID to attach.");
      return;
    }
    const { id: driveId, url } = extractDriveFileId(rawUrl);
    const attachment: SchedulerMediaAttachment = {
      id: generateLocalId("asset"),
      label: rawLabel || null,
      url,
      driveFileId: driveId,
      driveFileUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : url,
      type: driveId ? "drive" : "external",
    };
    setMediaAttachments((prev) => [...prev, attachment]);
    setAttachmentLabel("");
    setAttachmentUrl("");
    setAttachmentError(null);
  }, [attachmentLabel, attachmentUrl]);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setMediaAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  }, []);

  const handleReschedulePost = useCallback(
    async (postId: string, nextDate: Date | null) => {
      if (!dbRef) return;
      try {
        await updateDoc(doc(dbRef, "socialPosts", postId), {
          scheduledAt: nextDate ? Timestamp.fromDate(nextDate) : null,
          status: nextDate ? "scheduled" : "draft",
          updatedAt: serverTimestamp(),
        });
        setFeedback("Post schedule updated.");
      } catch (error) {
        console.error("Failed to reschedule post", error);
        setPostError((error as Error)?.message || "Unable to update schedule");
      }
    },
    [dbRef]
  );

  const handleAddApprovalNote = useCallback(
    async (postId: string) => {
      if (!dbRef) return;
      const draft = noteDrafts[postId]?.trim();
      if (!draft) {
        setPostError("Write a note before submitting.");
        return;
      }
      try {
        await updateDoc(doc(dbRef, "socialPosts", postId), {
          approvalNotes: arrayUnion({
            id: generateLocalId("note"),
            message: draft,
            createdBy: authUser?.uid ?? null,
            createdAt: serverTimestamp(),
          }),
          updatedAt: serverTimestamp(),
        });
        setNoteDrafts((prev) => ({ ...prev, [postId]: "" }));
        setFeedback("Approval note recorded.");
        setPostError(null);
      } catch (error) {
        console.error("Failed to add approval note", error);
        setPostError((error as Error)?.message || "Unable to add note");
      }
    },
    [authUser?.uid, dbRef, noteDrafts]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const current = new URL(window.location.href);
    const status = current.searchParams.get("socialConnection");
    if (!status) {
      return;
    }
    setActiveTab("accounts");
    const message = current.searchParams.get("message");
    if (status === "success") {
      setFeedback(message || "Social account connected.");
      setAccountError(null);
      setAccountForm({ displayName: "", publishEnabled: true, analyticsEnabled: true });
    } else {
      setAccountError(message || "Unable to connect the social account.");
      setFeedback(null);
    }
    [
      "socialConnection",
      "message",
      "accountId",
      "platform",
      "expiresAt",
      "reauth",
      "errorCode",
    ].forEach((param) => current.searchParams.delete(param));
    window.history.replaceState({}, "", `${current.pathname}${current.search}${current.hash}`);
  }, []);

  useEffect(() => {
    if (!dbRef || !selectedProjectId) {
      setAiDrafts([]);
      setAiDraftsLoading(false);
      setAiDraftsError(null);
      return;
    }

    setAiDraftsLoading(true);
    setAiDraftsError(null);

    const q = query(
      collection(dbRef, "contentAssistantDrafts"),
      where("projectId", "==", selectedProjectId),
      orderBy("createdAt", "desc"),
      limit(5)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const drafts: AiContentDraft[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const socialPosts = Array.isArray(data.socialPosts)
            ? data.socialPosts.map((item: any) => ({
                id:
                  typeof item?.id === "string"
                    ? item.id
                    : typeof crypto !== "undefined" && "randomUUID" in crypto
                      ? crypto.randomUUID()
                      : Math.random().toString(36).slice(2, 10),
                platform: typeof item?.platform === "string" ? item.platform : "Social",
                headline: typeof item?.headline === "string" ? item.headline : "",
                body: typeof item?.body === "string" ? item.body : "",
                hashtags: Array.isArray(item?.hashtags)
                  ? item.hashtags.filter((tag: unknown): tag is string => typeof tag === "string")
                  : [],
              }))
            : [];

          const warnings = Array.isArray(data.warnings)
            ? data.warnings
                .map((warning: unknown) => (typeof warning === "string" ? warning.trim() : ""))
                .filter((warning: string) => Boolean(warning))
            : [];

          return {
            id: docSnap.id,
            summary: typeof data.summary === "string" ? data.summary : "",
            socialPosts,
            warnings,
            createdAt: toDate(data.createdAt),
            promptName: typeof data.promptName === "string" ? data.promptName : null,
            modelName: typeof data.modelName === "string" ? data.modelName : null,
            requestId: typeof data.requestId === "string" ? data.requestId : null,
          } satisfies AiContentDraft;
        });

        setAiDrafts(drafts);
        setAiDraftsLoading(false);
      },
      (error) => {
        console.error("Failed to load AI drafts", error);
        setAiDraftsError(error?.message || "Unable to load AI drafts");
        setAiDraftsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [dbRef, selectedProjectId]);

  const loadFeatureFlags = useCallback(async () => {
    setFlagLoading(true);
    setFlagError(null);
    setScopeError(null);
    try {
      const response = await fetch("/api/social-scheduler/feature-flags");
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Failed to load feature flags (${response.status})`);
      }
      const payload = await response.json();
      const globalPayload = payload?.global ?? payload ?? {};
      const globalEnabledValue =
        typeof globalPayload.globalEnabled === "boolean"
          ? globalPayload.globalEnabled
          : globalPayload.enabled === true;
      const exportOnlyValue = globalPayload.exportOnlyMode === true;
      const analyticsValue =
        typeof globalPayload.analyticsEnabled === "boolean"
          ? globalPayload.analyticsEnabled
          : globalPayload.analyticsEnabled !== false;
      const nextFlags: SchedulerFeatureFlags = {
        globalEnabled: Boolean(globalEnabledValue),
        exportOnlyMode: Boolean(exportOnlyValue),
        analyticsEnabled: analyticsValue !== false,
        updatedAt: toDate(globalPayload.updatedAt),
        updatedBy: normaliseText(globalPayload.updatedBy),
        notes: normaliseText(globalPayload.notes),
      };
      setFeatureFlags(nextFlags);
      setFlagNotes(nextFlags.notes ?? "");

      const transformOverrides = (input: unknown): SchedulerScopeFlag[] => {
        if (!Array.isArray(input)) return [];
        return input
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const data = item as Record<string, unknown>;
            const id = typeof data.id === "string" ? data.id : "";
            if (!id) return null;
            const name =
              typeof data.name === "string" && data.name.trim()
                ? data.name.trim()
                : `Scope ${id}`;
            return {
              id,
              name,
              enabled: data.enabled === true,
              exportOnlyMode: data.exportOnlyMode === true,
              analyticsEnabled: data.analyticsEnabled !== false,
              notes: normaliseText(data.notes),
              updatedAt: toDate(data.updatedAt),
              updatedBy: normaliseText(data.updatedBy),
            } satisfies SchedulerScopeFlag;
          })
          .filter((item): item is SchedulerScopeFlag => item !== null)
          .sort((a, b) => a.name.localeCompare(b.name));
      };

      setFranchiseFlags(transformOverrides(payload?.franchiseOverrides ?? []));
      setOrganisationFlags(transformOverrides(payload?.organisationOverrides ?? []));
    } catch (error) {
      console.error("Failed to load scheduler feature flags", error);
      setFlagError((error as Error)?.message || "Unable to load feature flags");
    } finally {
      setFlagLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribeAuth: (() => void) | null = null;
    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (!mounted) return;
        setDbRef(db as Firestore);
        setFirebaseReady(true);
        const authMod = await loadAuthModule();
        if (!mounted) return;
        unsubscribeAuth = authMod.onAuthStateChanged(auth, (user) => {
          if (!mounted) return;
          setAuthUser(user);
        });
      } catch (error) {
        console.error("Failed to initialise Firebase", error);
        if (!mounted) return;
        setFirebaseReady(false);
        setDbRef(null);
      }
    })();
    return () => {
      mounted = false;
      if (unsubscribeAuth) {
        unsubscribeAuth();
      }
    };
  }, []);
  useEffect(() => {
    if (!dbRef || !firebaseReady) return;
    setClientLoading(true);
    setClientError(null);
    getDocs(query(collection(dbRef, "users"), where("crmStatus", "==", "client"), limit(100)))
      .then((snapshot) => {
        const results: ClientRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const name =
            typeof data.fullName === "string" && data.fullName.trim()
              ? data.fullName.trim()
              : typeof data.name === "string" && data.name.trim()
              ? data.name.trim()
              : data.email || `Client ${docSnap.id}`;
          const membershipEntries = Array.isArray(data.memberships)
            ? data.memberships
                .map((entry: any) => {
                  if (!entry || typeof entry !== "object") {
                    return null;
                  }
                  const orgId =
                    typeof entry.orgId === "string" && entry.orgId.trim().length > 0
                      ? entry.orgId.trim()
                      : null;
                  if (!orgId) {
                    return null;
                  }
                  const orgName =
                    typeof entry.orgName === "string" && entry.orgName.trim().length > 0
                      ? entry.orgName.trim()
                      : null;
                  const role =
                    typeof entry.role === "string" && entry.role.trim().length > 0
                      ? entry.role.trim()
                      : null;
                  return { id: orgId, name: orgName, role };
                })
                .filter((entry): entry is { id: string; name: string | null; role: string | null } => entry !== null)
            : [];
          const primaryOrganisationId =
            typeof data.organisationId === "string" && data.organisationId.trim().length > 0
              ? data.organisationId.trim()
              : null;
          const primaryOrganisationName =
            typeof data.organisation === "string" && data.organisation.trim().length > 0
              ? data.organisation.trim()
              : null;
          const organisationsMap = new Map<string, ClientOrganisation>();
          membershipEntries.forEach((entry, index) => {
            organisationsMap.set(entry.id, {
              id: entry.id,
              name: entry.name ?? `Organisation ${index + 1}`,
              role: entry.role,
              isPrimary: entry.id === primaryOrganisationId,
            });
          });
          if (primaryOrganisationId && !organisationsMap.has(primaryOrganisationId)) {
            organisationsMap.set(primaryOrganisationId, {
              id: primaryOrganisationId,
              name: primaryOrganisationName ?? data.company ?? name,
              role: null,
              isPrimary: true,
            });
          } else if (primaryOrganisationId) {
            const existing = organisationsMap.get(primaryOrganisationId);
            if (existing) {
              organisationsMap.set(primaryOrganisationId, {
                ...existing,
                name: existing.name || primaryOrganisationName || data.company || name,
                isPrimary: true,
              });
            }
          }
          const organisations = Array.from(organisationsMap.values()).map((org, index) => ({
            ...org,
            name: org.name || `Organisation ${index + 1}`,
          }));
          const defaultOrganisationId =
            primaryOrganisationId || organisations.find((org) => org.isPrimary)?.id || organisations[0]?.id || null;
          const defaultOrganisationName =
            (defaultOrganisationId && organisationsMap.get(defaultOrganisationId)?.name) ||
            primaryOrganisationName ||
            null;
          return {
            id: docSnap.id,
            name,
            email: typeof data.email === "string" ? data.email : null,
            company: typeof data.company === "string" ? data.company : null,
            organisations,
            defaultOrganisationId,
            defaultOrganisationName,
          } satisfies ClientRecord;
        });
        results.sort((a, b) => a.name.localeCompare(b.name));
        setClients(results);
      })
      .catch((error) => {
        console.error("Failed to load clients", error);
        setClientError(error?.message || "Unable to load clients");
      })
      .finally(() => setClientLoading(false));
  }, [dbRef, firebaseReady]);

  useEffect(() => {
    if (!dbRef || !firebaseReady) return;
    setProductLoading(true);
    getDocs(query(collection(dbRef, "products"), limit(100)))
      .then((snapshot) => {
        const records: ProductRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const name =
            typeof data.name === "string" && data.name.trim() ? data.name.trim() : `Product ${docSnap.id}`;
          return {
            id: docSnap.id,
            name,
            status: typeof data.status === "string" ? data.status : null,
          } satisfies ProductRecord;
        });
        records.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(records);
      })
      .catch((error) => {
        console.error("Failed to load products", error);
      })
      .finally(() => setProductLoading(false));
  }, [dbRef, firebaseReady]);

  useEffect(() => {
    if (!dbRef) {
      return;
    }

    const resolvedClient = selectedClientId
      ? clients.find((client) => client.id === selectedClientId) || null
      : null;

    const orgIds = selectedOrganisationId
      ? [selectedOrganisationId]
      : resolvedClient
      ? resolvedClient.organisations.map((org) => org.id).filter((id): id is string => Boolean(id))
      : [];

    if (orgIds.length === 0 && !selectedClientId) {
      setProjects([]);
      setSelectedProjectId("");
      setManualProjectName("");
      return;
    }

    setProjectLoading(true);

    const fetchByOrganisation = async () => {
      const queries = orgIds.map((orgId) =>
        getDocs(
          query(
            collection(dbRef, "projects"),
            where("organisationId", "==", orgId),
            orderBy("createdAt", "desc"),
            limit(20)
          )
        )
      );
      const snapshots = await Promise.all(queries);
      return snapshots.flatMap((snapshot) => snapshot.docs);
    };

    const fetchFallbackByUser = async () =>
      getDocs(
        query(collection(dbRef, "projects"), where("userId", "==", selectedClientId), orderBy("createdAt", "desc"), limit(50))
      ).then((snapshot) => snapshot.docs);

    (async () => {
      try {
        let docs: QueryDocumentSnapshot<DocumentData>[];
        if (orgIds.length > 0) {
          docs = await fetchByOrganisation();
          if (docs.length === 0 && selectedClientId) {
            docs = await fetchFallbackByUser();
          }
        } else {
          docs = await fetchFallbackByUser();
        }

        const records: ProjectSummary[] = docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const name =
            typeof data.name === "string" && data.name.trim()
              ? data.name.trim()
              : typeof data.reference === "string" && data.reference.trim()
              ? data.reference.trim()
              : `Project ${docSnap.id}`;
          return {
            id: docSnap.id,
            name,
            reference: typeof data.reference === "string" ? data.reference : null,
            status: typeof data.status === "string" ? data.status : null,
            dueDate: toDate(data.dueDate),
          } satisfies ProjectSummary;
        });
        records.sort((a, b) => {
          const aTime = a.dueDate?.getTime() ?? 0;
          const bTime = b.dueDate?.getTime() ?? 0;
          return bTime - aTime;
        });
        setProjects(records);
      } catch (error) {
        console.error("Failed to load projects", error);
      } finally {
        setProjectLoading(false);
      }
    })();
  }, [dbRef, clients, selectedClientId, selectedOrganisationId]);
  useEffect(() => {
    if (!dbRef) return;
    setAccountsLoading(true);
    const q = query(collection(dbRef, "socialAccounts"), orderBy("createdAt", "desc"), limit(100));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const records: SchedulerAccount[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const scopes =
            data.scopes && typeof data.scopes === "object"
              ? {
                  publish: Boolean((data.scopes as any).publish),
                  analytics: Boolean((data.scopes as any).analytics ?? (data.scopes as any).insights),
                }
              : { publish: false, analytics: false };
          const provider = (data.provider ?? {}) as Record<string, unknown>;
          const connectionData = (data.connection ?? {}) as Record<string, unknown>;
          const connectionStatus =
            normaliseText(connectionData.status) ?? normaliseText(data.status) ?? "active";
          const connectionExpiresAt = toDate(connectionData.expiresAt ?? connectionData.expiry ?? null);
          const requiresReauthFlag =
            connectionStatus === "requires_reauth" ||
            Boolean(connectionData.requiresReauth ?? connectionData.reauthRequired);
          const reauthRecommendedFlag =
            requiresReauthFlag ||
            Boolean(
              connectionData.reauthRecommended ??
                connectionData.reauthSoon ??
                connectionData.requiresReauthSoon
            ) ||
            (connectionExpiresAt
              ? connectionExpiresAt.getTime() - Date.now() < 48 * 60 * 60 * 1000
              : false);
          const connection: SchedulerAccount["connection"] = {
            status: connectionStatus,
            expiresAt: connectionExpiresAt,
            refreshAvailable: Boolean(
              connectionData.refreshAvailable ??
                connectionData.canRefresh ??
                (data.refreshAvailable ?? data.refreshable ?? false)
            ),
            requiresReauth: requiresReauthFlag,
            reauthRecommended: reauthRecommendedFlag,
            lastAuthorizedAt: toDate(
              connectionData.lastAuthorizedAt ??
                connectionData.lastLinkedAt ??
                connectionData.authorizedAt ??
                data.lastAuthorizedAt ??
                data.lastLinkedAt ??
                null
            ),
            lastAuthorizedBy:
              normaliseText(
                connectionData.lastAuthorizedBy ??
                  connectionData.authorizedBy ??
                  connectionData.linkedBy ??
                  data.lastAuthorizedBy ??
                  data.authorizedBy ??
                  null
              ) ?? null,
            updatedAt: toDate(connectionData.updatedAt ?? data.updatedAt),
          };
          const hqManaged = data.hqManaged === true;
          return {
            id: docSnap.id,
            organisationId: normaliseText(data.organisationId) ?? null,
            organisationName: normaliseText(data.organisationName) ?? null,
            platform: normaliseText(data.platform) ?? "unknown",
            displayName: normaliseText(data.displayName) ?? `Account ${docSnap.id}`,
            status: normaliseText(data.status) ?? "active",
            hqManaged,
            scopes,
            providerAccountId:
              normaliseText(
                provider.accountId ??
                  provider.id ??
                  data.providerAccountId ??
                  data.channelId ??
                  null
              ) ?? null,
            providerAccountName:
              normaliseText(
                provider.accountName ??
                  provider.name ??
                  data.providerAccountName ??
                  data.channelName ??
                  null
              ) ?? null,
            providerAccountHandle:
              normaliseText(
                provider.accountHandle ??
                  provider.handle ??
                  provider.username ??
                  data.accountHandle ??
                  data.channelHandle ??
                  null
              ) ?? null,
            providerAccountUrl:
              normaliseText(
                provider.accountUrl ??
                  provider.url ??
                  provider.profileUrl ??
                  data.accountUrl ??
                  data.channelUrl ??
                  null
              ) ?? null,
            connection,
            createdBy: normaliseText(data.createdBy),
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
          } satisfies SchedulerAccount;
        });
        setAccounts(records);
        setAccountsLoading(false);
        setAccountError(null);
      },
      (error) => {
        console.error("Failed to subscribe to social accounts", error);
        setAccountError(error?.message || "Unable to load account connections");
        setAccountsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [dbRef]);

  useEffect(() => {
    if (!dbRef) return;
    setPostLoading(true);
    const q = query(collection(dbRef, "socialPosts"), orderBy("createdAt", "desc"), limit(100));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const records: SchedulerPost[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const variants: SchedulerPostVariant[] = Array.isArray(data.variants)
            ? data.variants.map((variant, index) => {
                const variantData = variant as Record<string, unknown>;
                const utmData =
                  variantData?.utm && typeof variantData.utm === "object"
                    ? (variantData.utm as Record<string, unknown>)
                    : null;
                const utm: SchedulerVariantUtm | null = utmData
                  ? {
                      source: normaliseText(utmData.source) ?? null,
                      medium: normaliseText(utmData.medium) ?? null,
                      campaign: normaliseText(utmData.campaign) ?? null,
                      term: normaliseText(utmData.term) ?? null,
                      content: normaliseText(utmData.content) ?? null,
                    }
                  : null;
                return {
                  id: normaliseText(variantData?.id) ?? `${docSnap.id}-v${index}`,
                  platform: normaliseText(variantData?.platform) ?? "unknown",
                  caption: normaliseText(variantData?.caption) ?? "",
                  firstComment: normaliseText(variantData?.firstComment),
                  hashtags: Array.isArray(variantData?.hashtags)
                    ? (variantData.hashtags as unknown[])
                        .map((tag) => normaliseText(tag))
                        .filter((tag): tag is string => Boolean(tag))
                    : [],
                  linkUrl: normaliseText(variantData?.linkUrl),
                  utm,
                  thumbnailAssetId: normaliseText(variantData?.thumbnailAssetId),
                  thumbnailUrl:
                    normaliseText(variantData?.thumbnailUrl) ??
                    (variantData?.thumbnailAssetUrl && typeof variantData.thumbnailAssetUrl === "string"
                      ? variantData.thumbnailAssetUrl
                      : null),
                } satisfies SchedulerPostVariant;
              })
            : [];
          const attachments: SchedulerMediaAttachment[] = Array.isArray(data.attachments)
            ? (data.attachments as unknown[])
                .map((attachment, index) => {
                  const attachmentData = attachment as Record<string, unknown>;
                  const id = normaliseText(attachmentData?.id) ?? `${docSnap.id}-asset-${index}`;
                  const label = normaliseText(attachmentData?.label);
                  const url = normaliseText(attachmentData?.url) ?? normaliseText(attachmentData?.driveFileUrl);
                  const driveFileId = normaliseText(attachmentData?.driveFileId);
                  const driveFileUrl = normaliseText(attachmentData?.driveFileUrl) ?? null;
                  const typeValue = normaliseText(attachmentData?.type);
                  const type: SchedulerMediaAttachment["type"] =
                    typeValue === "drive" || typeValue === "deliverable" ? typeValue : "external";
                  if (!url && !driveFileId) {
                    return null;
                  }
                  return {
                    id,
                    label,
                    url,
                    driveFileId,
                    driveFileUrl,
                    type,
                  } satisfies SchedulerMediaAttachment;
                })
                .filter((item): item is SchedulerMediaAttachment => Boolean(item))
            : [];
          const approvalNotes: SchedulerApprovalNote[] = Array.isArray(data.approvalNotes)
            ? (data.approvalNotes as unknown[])
                .map((note, index) => {
                  const noteData = note as Record<string, unknown>;
                  const message = normaliseText(noteData?.message);
                  if (!message) {
                    return null;
                  }
                  return {
                    id: normaliseText(noteData?.id) ?? `${docSnap.id}-note-${index}`,
                    message,
                    createdBy: normaliseText(noteData?.createdBy),
                    createdAt: toDate(noteData?.createdAt),
                  } satisfies SchedulerApprovalNote;
                })
                .filter((item): item is SchedulerApprovalNote => Boolean(item))
            : [];
          return {
            id: docSnap.id,
            organisationId: normaliseText(data.organisationId) ?? null,
            organisationName: normaliseText(data.organisationName) ?? null,
            projectId: normaliseText(data.projectId) ?? null,
            projectName: normaliseText(data.projectName) ?? null,
            deliverableLabel: normaliseText(data.deliverableLabel) ?? null,
            deliverableProductId: normaliseText(data.deliverableProductId) ?? null,
            deliverableProductName: normaliseText(data.deliverableProductName) ?? null,
            baseLinkUrl: normaliseText(data.baseLinkUrl) ?? null,
            status: normaliseText(data.status) ?? "draft",
            approvalState: normaliseText(data.approvalState) ?? "draft",
            scheduledAt: toDate(data.scheduledAt),
            timezone: normaliseText(data.timezone),
            notes: normaliseText(data.notes),
            variants,
            attachments,
            approvalNotes,
            createdBy: normaliseText(data.createdBy),
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
          } satisfies SchedulerPost;
        });
        setPosts(records);
        setPostError(null);
        setPostLoading(false);
      },
      (error) => {
        console.error("Failed to subscribe to social posts", error);
        setPostError(error?.message || "Unable to load social posts");
        setPostLoading(false);
      }
    );
    return () => unsubscribe();
  }, [dbRef]);

  useEffect(() => {
    setNoteDrafts((prev) => {
      const next: Record<string, string> = {};
      posts.forEach((post) => {
        if (prev[post.id]) {
          next[post.id] = prev[post.id];
        }
      });
      return next;
    });
  }, [posts]);

  useEffect(() => {
    void loadFeatureFlags();
  }, [loadFeatureFlags]);
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const term = clientSearch.trim().toLowerCase();
    return clients.filter((client) => {
      if (client.name.toLowerCase().includes(term)) {
        return true;
      }
      if (client.email && client.email.toLowerCase().includes(term)) {
        return true;
      }
      return client.organisations.some((org) => org.name.toLowerCase().includes(term));
    });
  }, [clients, clientSearch]);

  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId) || null
    : null;

  const selectedOrganisation = selectedOrganisationId && selectedClient
    ? selectedClient.organisations.find((org) => org.id === selectedOrganisationId) || null
    : selectedClient?.organisations.find((org) => org.isPrimary) || null;

  const [organisationOverrideTouched, setOrganisationOverrideTouched] = useState(false);

  const organisationOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ id: string; label: string }> = [];
    clients.forEach((client) => {
      client.organisations.forEach((org) => {
        if (!org.id || seen.has(org.id)) {
          return;
        }
        seen.add(org.id);
        const label = client.name
          ? `${org.name} — ${client.name}`
          : org.name;
        options.push({ id: org.id, label });
      });
    });
    options.sort((a, b) => a.label.localeCompare(b.label));
    if (selectedOrganisationId && !seen.has(selectedOrganisationId)) {
      const fallbackLabel = selectedOrganisation?.name || manualClientName || "Selected organisation";
      options.unshift({ id: selectedOrganisationId, label: fallbackLabel });
    }
    return options;
  }, [clients, selectedOrganisationId, selectedOrganisation, manualClientName]);

  useEffect(() => {
    if (!selectedClient) {
      setSelectedOrganisationId("");
      if (!organisationOverrideTouched) {
        setManualClientName("");
      }
      return;
    }

    const hasSelection =
      selectedOrganisationId && selectedClient.organisations.some((org) => org.id === selectedOrganisationId);
    if (hasSelection) {
      return;
    }

    const fallbackId =
      selectedClient.defaultOrganisationId ||
      selectedClient.organisations.find((org) => org.isPrimary)?.id ||
      selectedClient.organisations[0]?.id ||
      "";
    setSelectedOrganisationId(fallbackId || "");

    if (!organisationOverrideTouched) {
      const fallbackOrg =
        (fallbackId && selectedClient.organisations.find((org) => org.id === fallbackId)) ||
        selectedClient.organisations.find((org) => org.isPrimary) ||
        null;
      if (fallbackOrg?.name) {
        setManualClientName(fallbackOrg.name);
      }
    }
  }, [selectedClient, selectedOrganisationId, organisationOverrideTouched]);

  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId) || null
    : null;

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const term = productSearch.trim().toLowerCase();
    const matches = products.filter((product) => product.name.toLowerCase().includes(term));
    if (selectedProductId && !matches.some((product) => product.id === selectedProductId)) {
      const current = products.find((product) => product.id === selectedProductId);
      if (current) {
        return [current, ...matches];
      }
    }
    return matches;
  }, [productSearch, products, selectedProductId]);

  const selectedProduct = selectedProductId
    ? products.find((product) => product.id === selectedProductId) || null
    : null;

  const canEditFlags = allowFlagEditing && hasRole(roles, "admin");

  const exportablePosts = useMemo(() => {
    if (selectedOrganisationId) {
      return posts.filter((post) => post.organisationId === selectedOrganisationId);
    }
    if (selectedClient) {
      const membershipIds = selectedClient.organisations.map((org) => org.id);
      if (membershipIds.length > 0) {
        return posts.filter((post) => post.organisationId && membershipIds.includes(post.organisationId));
      }
    }
    return posts;
  }, [posts, selectedOrganisationId, selectedClient]);

  const analyticsSummary = useMemo(() => {
    const totals = {
      scheduled: 0,
      awaitingApproval: 0,
      drafts: 0,
      published: 0,
    };
    const platformTotals = new Map<string, number>();
    let upcomingWithinWeek = 0;
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    posts.forEach((post) => {
      if (post.status === "scheduled") totals.scheduled += 1;
      if (post.status === "draft") totals.drafts += 1;
      if (post.approvalState === "awaiting_approval" || post.approvalState === "pending") {
        totals.awaitingApproval += 1;
      }
      if (post.status === "published") totals.published += 1;
      if (post.scheduledAt && post.scheduledAt >= now && post.scheduledAt <= weekAhead) {
        upcomingWithinWeek += 1;
      }
      post.variants.forEach((variant) => {
        platformTotals.set(variant.platform, (platformTotals.get(variant.platform) ?? 0) + 1);
      });
    });
    const breakdown = Array.from(platformTotals.entries()).map(([platform, count]) => ({
      platform,
      count,
    }));
    breakdown.sort((a, b) => b.count - a.count);
    return { totals, upcomingWithinWeek, breakdown };
  }, [posts]);

  const calendarPosts = useMemo(
    () =>
      posts.map((post) => ({
        id: post.id,
        organisationName: post.organisationName,
        deliverableProductName: post.deliverableProductName ?? post.deliverableLabel,
        scheduledAt: post.scheduledAt,
        status: post.status,
        approvalState: post.approvalState,
        variants: post.variants.map((variant) => ({
          platform: variant.platform,
          caption: variant.caption,
        })),
      })),
    [posts]
  );

  const pilotRoles = useMemo(() => {
    if (!roles) return [] as string[];
    const allowed: RoleKey[] = ["admin", "marketing", "projects"];
    return allowed.filter((role) => hasRole(roles, role)).map((role) => getRoleLabel(role));
  }, [roles]);

  const filteredFranchiseFlags = useMemo(() => {
    if (!franchiseSearch.trim()) return franchiseFlags;
    const term = franchiseSearch.trim().toLowerCase();
    return franchiseFlags.filter((flag) => flag.name.toLowerCase().includes(term));
  }, [franchiseFlags, franchiseSearch]);

  const filteredOrganisationFlags = useMemo(() => {
    if (!organisationSearch.trim()) return organisationFlags;
    const term = organisationSearch.trim().toLowerCase();
    return organisationFlags.filter((flag) => flag.name.toLowerCase().includes(term));
  }, [organisationFlags, organisationSearch]);
  function startOAuthFlow(platformKey: string, account?: SchedulerAccount | null) {
    if (typeof window === "undefined") {
      return;
    }

    const targetPlatform = PLATFORM_OPTIONS.find((option) => option.value === platformKey);
    if (!targetPlatform) {
      setAccountError("Unsupported platform selected.");
      return;
    }

    const organisationId = account?.organisationId ?? selectedOrganisation?.id ?? null;
    const organisationName =
      account?.organisationName ??
      selectedOrganisation?.name ??
      (manualClientName.trim() || selectedClient?.company || selectedClient?.name || null);

    if (!organisationId && !organisationName) {
      setAccountError("Select an organisation or provide an override name before connecting an account.");
      return;
    }

    const origin = window.location.origin;
    const redirectUrl = new URL("/admin/tools/social-scheduler", origin);
    redirectUrl.searchParams.set("tab", "accounts");

    const authUrl = new URL(`/api/social-accounts/${platformKey}`, origin);
    if (organisationId) {
      authUrl.searchParams.set("organisationId", organisationId);
    }
    if (organisationName) {
      authUrl.searchParams.set("organisationName", organisationName);
    }

    const displayName =
      account?.displayName ||
      accountForm.displayName.trim() ||
      organisationName ||
      targetPlatform.label;
    authUrl.searchParams.set("displayName", displayName);

    const publishEnabled = account ? account.scopes.publish : accountForm.publishEnabled;
    const analyticsEnabled = account ? account.scopes.analytics : accountForm.analyticsEnabled;
    const requestedScopes: string[] = [];
    if (publishEnabled) requestedScopes.push("publish");
    if (analyticsEnabled) requestedScopes.push("analytics");
    if (requestedScopes.length > 0) {
      authUrl.searchParams.set("scopes", requestedScopes.join(","));
    }

    authUrl.searchParams.set("redirect", redirectUrl.toString());

    if (account?.id) {
      authUrl.searchParams.set("accountId", account.id);
    }

    if (account?.hqManaged) {
      authUrl.searchParams.set("hqManaged", "true");
    }

    setAccountError(null);
    setFeedback(null);
    window.location.href = authUrl.toString();
  }

  async function handleUpdateAccount(accountId: string, updates: Partial<SchedulerAccount>) {
    if (!dbRef) return;
    try {
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (updates.status) {
        payload.status = updates.status;
      }
      if (typeof updates.scopes?.publish === "boolean" || typeof updates.scopes?.analytics === "boolean") {
        payload.scopes = {
          publish:
            typeof updates.scopes?.publish === "boolean"
              ? updates.scopes.publish
              : accounts.find((acc) => acc.id === accountId)?.scopes.publish ?? false,
          analytics:
            typeof updates.scopes?.analytics === "boolean"
              ? updates.scopes.analytics
              : accounts.find((acc) => acc.id === accountId)?.scopes.analytics ?? false,
        };
      }
      await updateDoc(doc(dbRef, "socialAccounts", accountId), payload);
      setFeedback("Account updated.");
    } catch (error) {
      console.error("Failed to update account", error);
      setAccountError((error as Error)?.message || "Unable to update account");
    }
  }

  async function handleDeleteAccount(accountId: string) {
    if (!dbRef) return;
    try {
      await deleteDoc(doc(dbRef, "socialAccounts", accountId));
      setFeedback("Account removed.");
    } catch (error) {
      console.error("Failed to delete account", error);
      setAccountError((error as Error)?.message || "Unable to remove account");
    }
  }
  async function handleCreatePost(event: FormEvent) {
    event.preventDefault();
    if (!dbRef) return;
    const organisationId = selectedOrganisation?.id ?? null;
    const organisationName =
      selectedOrganisation?.name ??
      (manualClientName.trim() || selectedClient?.company || selectedClient?.name || null);
    if (!organisationName) {
      setPostError("Select an organisation or provide an override before drafting a post.");
      return;
    }
    const scheduledAt = postForm.scheduledAtInput ? new Date(postForm.scheduledAtInput) : null;
    if (postForm.scheduledAtInput && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
      setPostError("Provide a valid scheduled date/time or leave it blank.");
      return;
    }
    const platforms = Array.from(platformSelection);
    if (platforms.length === 0) {
      setPostError("Select at least one platform variant to generate.");
      return;
    }
    setPostSaving(true);
    try {
      const variantsPayload = [] as Array<Record<string, unknown>>;
      for (const platform of platforms) {
        const draft = variantDrafts[platform];
        const baseCaption = draft?.caption ?? postCaption;
        const caption = baseCaption.trim();
        if (!caption) {
          setPostError(`Add a caption for ${PLATFORM_LABELS[platform] ?? platform}.`);
          setPostSaving(false);
          return;
        }
        const hashtagsSource = (draft?.hashtags ?? postHashtags).trim();
        const hashtags = hashtagsSource
          ? hashtagsSource
              .split(/[\s,]+/)
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [];
        const utm = draft ? sanitiseUtm(draft.utm) : null;
        const linkBase = draft?.linkUrl?.trim() || baseLinkUrl.trim() || null;
        const trackedLink = buildTrackedLink(linkBase, utm ?? undefined);
        const firstCommentValue = draft?.firstComment?.trim() || null;
        const thumbnailAssetId = draft?.thumbnailAssetId?.trim() || null;
        const thumbnailUrl = draft?.thumbnailUrl?.trim() || null;
        variantsPayload.push({
          id: generateLocalId("variant"),
          platform,
          caption,
          hashtags,
          firstComment: firstCommentValue,
          linkUrl: trackedLink,
          utm,
          thumbnailAssetId,
          thumbnailUrl,
        });
      }
      const attachmentsPayload = mediaAttachments.map((attachment) => ({
        id: attachment.id || generateLocalId("asset"),
        label: attachment.label?.trim() || null,
        url: attachment.url?.trim() || null,
        driveFileId: attachment.driveFileId?.trim() || null,
        driveFileUrl: attachment.driveFileUrl?.trim() || null,
        type: attachment.type,
      }));
      const approvalNotesPayload = postForm.notes.trim()
        ? [
            {
              id: generateLocalId("note"),
              message: postForm.notes.trim(),
              createdBy: authUser?.uid ?? null,
              createdAt: serverTimestamp(),
            },
          ]
        : [];
      const payload: Record<string, unknown> = {
        organisationId,
        organisationName,
        projectId: selectedProject?.id ?? null,
        projectName:
          selectedProject?.name ?? (manualProjectName.trim() || null),
        deliverableLabel: selectedProject?.reference ?? null,
        deliverableProductId: selectedProduct?.id ?? null,
        deliverableProductName:
          selectedProduct?.name ?? (selectedProductName.trim() || null),
        baseLinkUrl: baseLinkUrl.trim() || null,
        status: postForm.status,
        approvalState: postForm.approvalState,
        timezone: postForm.timezone ?? null,
        scheduledAt: scheduledAt ? Timestamp.fromDate(scheduledAt) : null,
        notes: postForm.notes.trim() || null,
        createdBy: authUser?.uid ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        variants: variantsPayload,
        attachments: attachmentsPayload,
        approvalNotes: approvalNotesPayload,
      };
      await addDoc(collection(dbRef, "socialPosts"), payload);
      setFeedback("Draft created and queued for approval.");
      setPostError(null);
      setPostForm({
        status: "draft",
        approvalState: "draft",
        timezone: getDefaultTimezone(),
        scheduledAtInput: "",
        notes: "",
      });
      setPostCaption("");
      setPostHashtags("");
      setBaseLinkUrl("");
      setPlatformSelection(new Set(["youtube", "linkedin"]));
      setVariantDrafts({});
      setMediaAttachments([]);
      setAttachmentLabel("");
      setAttachmentUrl("");
    } catch (error) {
      console.error("Failed to create social post", error);
      setPostError((error as Error)?.message || "Unable to create post");
    } finally {
      setPostSaving(false);
    }
  }

  async function handleFlagUpdate(updates: Partial<SchedulerFeatureFlags>) {
    if (!canEditFlags) return;
    setFlagSaving(true);
    setFlagError(null);
    try {
      const response = await fetch("/api/social-scheduler/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updates, notes: flagNotes }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Failed to update feature flags (${response.status})`);
      }
      await loadFeatureFlags();
      setFeedback("Feature flags updated.");
    } catch (error) {
      console.error("Failed to update scheduler flags", error);
      setFlagError((error as Error)?.message || "Unable to update scheduler settings");
    } finally {
      setFlagSaving(false);
    }
  }

  type ScopeType = "franchise" | "organisation";

  function handleScopeToggle(
    scopeType: ScopeType,
    scopeId: string,
    field: "enabled" | "exportOnlyMode" | "analyticsEnabled",
    value: boolean
  ) {
    const updater = scopeType === "franchise" ? setFranchiseFlags : setOrganisationFlags;
    updater((prev) => prev.map((item) => (item.id === scopeId ? { ...item, [field]: value } : item)));
  }

  function handleScopeNoteChange(scopeType: ScopeType, scopeId: string, value: string) {
    const updater = scopeType === "franchise" ? setFranchiseFlags : setOrganisationFlags;
    updater((prev) => prev.map((item) => (item.id === scopeId ? { ...item, notes: value } : item)));
  }

  async function handleScopeSave(scopeType: ScopeType, scopeId: string) {
    setScopeSavingKey(`${scopeType}:${scopeId}`);
    setScopeError(null);
    const source = scopeType === "franchise" ? franchiseFlags : organisationFlags;
    const target = source.find((item) => item.id === scopeId);
    if (!target) {
      setScopeSavingKey(null);
      return;
    }
    try {
      const response = await fetch("/api/social-scheduler/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeId,
          enabled: target.enabled,
          exportOnlyMode: target.exportOnlyMode,
          analyticsEnabled: target.analyticsEnabled,
          notes: target.notes ? target.notes.trim() : "",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Failed to update feature flags (${response.status})`);
      }
      await loadFeatureFlags();
      setFeedback("Rollout override saved.");
    } catch (error) {
      console.error("Failed to update scheduler scope", error);
      setScopeError((error as Error)?.message || "Unable to update rollout override");
    } finally {
      setScopeSavingKey(null);
    }
  }

  function handleDownloadCsv() {
    const csv = buildCsv(exportablePosts);
    downloadText("social-schedule.csv", csv);
  }

  function handleDownloadIcs() {
    const ics = buildIcs(exportablePosts);
    downloadText("social-schedule.ics", ics);
  }
  return (
    <div className="grid gap-6">
      <PortalHero
        eyebrow="Pilot scheduling toolkit"
        title="Social scheduler control centre"
        description="Connect client channels, draft copy directly from transcripts, and manage staged rollouts before we enable automated publishing."
      />

      {feedback ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      {flagError ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">{flagError}</div>
      ) : null}

      {featureFlags && !featureFlags.globalEnabled ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Scheduling is currently disabled for clients. Admins can toggle the pilot on once QA is complete. Export tools remain
          available.
        </div>
      ) : null}

      {featureFlags?.exportOnlyMode ? (
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Export-only mode is active. Drafts will be saved for CSV/ICS export but publishing workers are paused.
        </div>
      ) : null}

      {emphasisePilotNote ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {pilotRoles.length > 0 ? (
            <p>
              This pilot workspace is shared with {pilotRoles.join(" / ")} teams. Use the approvals column to signal when HQ can
              move a campaign into the publishing queue.
            </p>
          ) : (
            <p>
              This pilot workspace is scoped to your franchise. Connect accounts you manage and coordinate with HQ for
              publishing.
            </p>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="inline-flex rounded border bg-white p-1 shadow-sm">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-3 py-1 text-sm font-medium transition ${
                activeTab === tab.id ? "bg-orange text-white shadow" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {activeTab === "overview" ? (
        <>
          <section className="grid gap-6 rounded border bg-white p-6 shadow-sm">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">Pilot rollout controls</h2>
              <p className="text-sm text-gray-600">
                Use the switches below to decide when social scheduling surfaces to franchises and clients. All changes are
                logged to the admin audit trail.
              </p>
            </header>
            {flagLoading ? <p className="text-sm text-gray-500">Loading scheduler settings…</p> : null}
            {featureFlags ? (
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canEditFlags) {
                    void handleFlagUpdate({
                      globalEnabled: featureFlags.globalEnabled,
                      exportOnlyMode: featureFlags.exportOnlyMode,
                      analyticsEnabled: featureFlags.analyticsEnabled,
                    });
                  }
                }}
              >
                <label className="flex items-center justify-between rounded border p-4">
                  <span>
                    <span className="block text-sm font-semibold">Enable scheduler for pilot orgs</span>
                    <span className="mt-1 block text-xs text-gray-600">
                      When off, clients only see CSV/ICS exports. Franchise and HQ users still access drafts for prep work.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={!canEditFlags || flagSaving}
                    checked={featureFlags.globalEnabled}
                    onChange={(event) =>
                      setFeatureFlags((prev) => (prev ? { ...prev, globalEnabled: event.target.checked } : prev))
                    }
                    className="h-5 w-5"
                  />
                </label>

                <label className="flex items-center justify-between rounded border p-4">
                  <span>
                    <span className="block text-sm font-semibold">Export-only fallback</span>
                    <span className="mt-1 block text-xs text-gray-600">
                      Keep publishing workers paused while allowing internal teams to prepare campaigns and export schedules.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={!canEditFlags || flagSaving}
                    checked={featureFlags.exportOnlyMode}
                    onChange={(event) =>
                      setFeatureFlags((prev) => (prev ? { ...prev, exportOnlyMode: event.target.checked } : prev))
                    }
                    className="h-5 w-5"
                  />
                </label>

                <label className="flex items-center justify-between rounded border p-4">
                  <span>
                    <span className="block text-sm font-semibold">Show analytics widgets to clients</span>
                    <span className="mt-1 block text-xs text-gray-600">
                      Disable if you only want HQ/franchise teams to view performance insights during the pilot.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={!canEditFlags || flagSaving}
                    checked={featureFlags.analyticsEnabled}
                    onChange={(event) =>
                      setFeatureFlags((prev) => (prev ? { ...prev, analyticsEnabled: event.target.checked } : prev))
                    }
                    className="h-5 w-5"
                  />
                </label>

                <label className="md:col-span-2">
                  <span className="block text-sm font-semibold">Pilot notes</span>
                  <textarea
                    value={flagNotes}
                    onChange={(event) => setFlagNotes(event.target.value)}
                    disabled={!canEditFlags || flagSaving}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                    rows={3}
                    placeholder="Record why the toggle changed, impacted franchises, or any QA caveats."
                  />
                </label>

                <div className="md:col-span-2 flex items-center justify-between text-xs text-gray-500">
                  <div>
                    {featureFlags.updatedAt ? `Last updated ${featureFlags.updatedAt.toLocaleString()}` : "Not yet configured"}
                    {featureFlags.updatedBy ? ` by ${featureFlags.updatedBy}` : null}
                  </div>
                  {canEditFlags ? (
                    <button
                      type="submit"
                      disabled={flagSaving}
                      className="rounded bg-orange px-3 py-2 text-sm font-semibold text-white shadow hover:bg-orange/90"
                    >
                      {flagSaving ? "Saving…" : "Save rollout settings"}
                    </button>
                  ) : (
                    <span className="italic">Contact an admin to adjust rollout state.</span>
                  )}
                </div>
              </form>
            ) : null}
          </section>

          <section className="grid gap-4 rounded border bg-white p-6 shadow-sm">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">Franchise rollout overrides</h2>
              <p className="text-sm text-gray-600">
                Enable specific franchises to pilot the scheduler while the global toggle remains off. Overrides cascade to all
                organisations managed by the franchise.
              </p>
            </header>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <label className="text-sm md:w-72">
                <span className="font-medium">Search franchises</span>
                <input
                  type="search"
                  value={franchiseSearch}
                  onChange={(event) => setFranchiseSearch(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Filter by name"
                />
              </label>
              <span className="text-xs text-gray-500">
                Showing {filteredFranchiseFlags.length} of {franchiseFlags.length}
              </span>
            </div>
            {scopeError ? <p className="text-sm text-red-600">{scopeError}</p> : null}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
  <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
  <tr>
                  <th className="p-2">Organisation</th>
    <th className="p-2">Platform</th>
    <th className="p-2">Permissions</th>
    <th className="p-2">Connection</th>
    <th className="p-2">Status</th>
    <th className="p-2">Updated</th>
    <th className="p-2">Actions</th>
  </tr>
</thead>

                <tbody>
                  {flagLoading ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-gray-500">
                        Loading overrides…
                      </td>
                    </tr>
                  ) : filteredFranchiseFlags.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-gray-500">
                        No franchises found.
                      </td>
                    </tr>
                  ) : (
                    filteredFranchiseFlags.map((flag) => {
                      const saving = scopeSavingKey === `franchise:${flag.id}`;
                      const disabled = flagLoading || saving;
                      return (
                        <tr key={flag.id} className="border-b last:border-0">
                          <td className="p-3 align-top">
                            <div className="font-medium text-gray-900">{flag.name}</div>
                            <div className="text-xs text-gray-500">
                              {flag.updatedAt ? `Updated ${flag.updatedAt.toLocaleString()}` : "No overrides set"}
                              {flag.updatedBy ? ` by ${flag.updatedBy}` : null}
                            </div>
                          </td>
                          <td className="p-3 align-top">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={flag.enabled}
                                disabled={disabled}
                                onChange={(event) =>
                                  handleScopeToggle("franchise", flag.id, "enabled", event.target.checked)
                                }
                              />
                              Enable scheduler
                            </label>
                          </td>
                          <td className="p-3 align-top">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={flag.exportOnlyMode}
                                disabled={disabled}
                                onChange={(event) =>
                                  handleScopeToggle("franchise", flag.id, "exportOnlyMode", event.target.checked)
                                }
                              />
                              Export-only fallback
                            </label>
                          </td>
                          <td className="p-3 align-top">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={flag.analyticsEnabled}
                                disabled={disabled}
                                onChange={(event) =>
                                  handleScopeToggle("franchise", flag.id, "analyticsEnabled", event.target.checked)
                                }
                              />
                              Show analytics
                            </label>
                          </td>
                          <td className="p-3 align-top">
                            <input
                              type="text"
                              value={flag.notes ?? ""}
                              onChange={(event) => handleScopeNoteChange("franchise", flag.id, event.target.value)}
                              disabled={disabled}
                              placeholder="Optional note"
                              className="w-48 rounded border px-2 py-1 text-xs md:w-56"
                            />
                          </td>
                          <td className="p-3 align-top">
                            <button
                              type="button"
                              onClick={() => handleScopeSave("franchise", flag.id)}
                              disabled={disabled}
                              className="rounded bg-orange px-2 py-1 text-xs font-semibold text-white shadow hover:bg-orange/90"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 rounded border bg-white p-6 shadow-sm">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">Client visibility overrides</h2>
              <p className="text-sm text-gray-600">
                Adjust analytics and scheduling visibility for individual client organisations once they are ready to test the
                module in their portal.
              </p>
            </header>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <label className="text-sm md:w-72">
                <span className="font-medium">Search organisations</span>
                <input
                  type="search"
                  value={organisationSearch}
                  onChange={(event) => setOrganisationSearch(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Filter by name"
                />
              </label>
              <span className="text-xs text-gray-500">
                Showing {filteredOrganisationFlags.length} of {organisationFlags.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-3">Organisation</th>
                    <th className="p-3">Scheduler</th>
                    <th className="p-3">Export-only</th>
                    <th className="p-3">Analytics</th>
                    <th className="p-3">Notes</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flagLoading ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-gray-500">
                        Loading overrides…
                      </td>
                    </tr>
                  ) : filteredOrganisationFlags.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-gray-500">
                        No organisations found.
                      </td>
                    </tr>
                  ) : (
                    filteredOrganisationFlags.map((flag) => {
                      const saving = scopeSavingKey === `organisation:${flag.id}`;
                      const disabled = flagLoading || saving;
                      return (
                        <tr key={flag.id} className="border-b last:border-0">
                          <td className="p-3 align-top">
                            <div className="font-medium text-gray-900">{flag.name}</div>
                            <div className="text-xs text-gray-500">
                              {flag.updatedAt ? `Updated ${flag.updatedAt.toLocaleString()}` : "No overrides set"}
                              {flag.updatedBy ? ` by ${flag.updatedBy}` : null}
                            </div>
                          </td>
                          <td className="p-3 align-top">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={flag.enabled}
                                disabled={disabled}
                                onChange={(event) =>
                                  handleScopeToggle("organisation", flag.id, "enabled", event.target.checked)
                                }
                              />
                              Enable scheduler
                            </label>
                          </td>
                          <td className="p-3 align-top">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={flag.exportOnlyMode}
                                disabled={disabled}
                                onChange={(event) =>
                                  handleScopeToggle("organisation", flag.id, "exportOnlyMode", event.target.checked)
                                }
                              />
                              Export-only fallback
                            </label>
                          </td>
                          <td className="p-3 align-top">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={flag.analyticsEnabled}
                                disabled={disabled}
                                onChange={(event) =>
                                  handleScopeToggle("organisation", flag.id, "analyticsEnabled", event.target.checked)
                                }
                              />
                              Show analytics
                            </label>
                          </td>
                          <td className="p-3 align-top">
                            <input
                              type="text"
                              value={flag.notes ?? ""}
                              onChange={(event) => handleScopeNoteChange("organisation", flag.id, event.target.value)}
                              disabled={disabled}
                              placeholder="Optional note"
                              className="w-48 rounded border px-2 py-1 text-xs md:w-56"
                            />
                          </td>
                          <td className="p-3 align-top">
                            <button
                              type="button"
                              onClick={() => handleScopeSave("organisation", flag.id)}
                              disabled={disabled}
                              className="rounded bg-orange px-2 py-1 text-xs font-semibold text-white shadow hover:bg-orange/90"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
      {activeTab === "accounts" ? (
        <section className="grid gap-6 rounded border bg-white p-6 shadow-sm">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Account connections</h2>
            <p className="text-sm text-gray-600">
              Track which social channels are linked, the permissions granted, and whether any require re-authentication before
              scheduling.
            </p>
          </header>

<div className="grid gap-4 rounded border border-slate-200 p-4">
  <h3 className="text-sm font-semibold text-gray-900">Connect a social profile</h3>
  <div className="grid gap-4 md:grid-cols-2">
    <label className="text-sm">
      <span className="font-medium">Client</span>
      <input
        type="search"
        placeholder="Search clients…"
        value={clientSearch}
        onChange={(event) => setClientSearch(event.target.value)}
        className="mt-1 w-full rounded border px-3 py-2"
      />
      <select
        value={selectedClientId}
        onChange={(event) => {
          setSelectedClientId(event.target.value);
          setOrganisationOverrideTouched(false);
        }}
        className="mt-2 w-full rounded border px-3 py-2"
      >
        <option value="">Select a client (optional)</option>
        {filteredClients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
    <label className="text-sm">
      <span className="font-medium">Organisation</span>
      <select
        value={selectedOrganisationId}
        onChange={(event) => {
          const value = event.target.value;
          setSelectedOrganisationId(value);
          setOrganisationOverrideTouched(false);
          if (value && selectedClient) {
            const match = selectedClient.organisations.find((org) => org.id === value);
            if (match?.name) {
              setManualClientName(match.name);
            }
          }
        }}
        className="mt-1 w-full rounded border px-3 py-2"
        disabled={!selectedClient || selectedClient.organisations.length === 0}
      >
        <option value="">Select an organisation</option>
        {selectedClient?.organisations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
            {org.role ? ` · ${org.role}` : ""}
          </option>
        ))}
      </select>
      {selectedClient && selectedClient.organisations.length === 0 ? (
        <span className="mt-1 block text-xs text-slate-500">
          No organisation memberships detected. Use the override field below.
        </span>
      ) : null}
    </label>
    <label className="text-sm">
      <span className="font-medium">Organisation name override</span>
      <input
        type="text"
        value={manualClientName}
        onChange={(event) => {
          const value = event.target.value;
          setManualClientName(value);
          setOrganisationOverrideTouched(value.trim().length > 0);
        }}
        placeholder="Use when the client is not yet in CRM"
        className="mt-1 w-full rounded border px-3 py-2"
      />
    </label>
    <label className="text-sm md:col-span-2">
      <span className="font-medium">Display name</span>
      <input
        type="text"
        value={accountForm.displayName}
        onChange={(event) =>
          setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))
        }
        className="mt-1 w-full rounded border px-3 py-2"
        placeholder="Shown in the scheduler when referencing this account"
      />
    </label>
  </div>
  <div className="flex flex-wrap gap-6 text-sm">
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={accountForm.publishEnabled}
        onChange={(event) =>
          setAccountForm((prev) => ({ ...prev, publishEnabled: event.target.checked }))
        }
      />
      Allow scheduling / publishing permissions
    </label>
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={accountForm.analyticsEnabled}
        onChange={(event) =>
          setAccountForm((prev) => ({ ...prev, analyticsEnabled: event.target.checked }))
        }
      />
      Allow analytics insights
    </label>
  </div>
  <div className="space-y-2">
    <p className="text-xs text-gray-500">
      Choose a platform to launch the OAuth flow. We&apos;ll return you to this page once permissions are granted.
    </p>
    <div className="flex flex-wrap gap-2">
      {PLATFORM_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => startOAuthFlow(option.value)}
          className="rounded bg-orange px-3 py-2 text-sm font-semibold text-white shadow hover:bg-orange/90"
        >
          Connect {option.label}
        </button>
      ))}
    </div>
  </div>
  {accountError ? <p className="text-sm text-red-600">{accountError}</p> : null}
</div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="p-2">Organisation</th>
                  <th className="p-2">Platform</th>
                  <th className="p-2">Connection</th>
                  <th className="p-2">Permissions</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Updated</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountsLoading ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-gray-500">
                      Loading connections…
                    </td>
                  </tr>
                ) : accounts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-gray-500">
                      No connections captured yet.
                    </td>
                  </tr>
                ) : (
                  accounts.map((account) => (
                    <tr key={account.id} className="border-b last:border-0">
                      <td className="p-2 align-top">
                        <div className="font-medium text-gray-900">
                          {account.organisationName || account.organisationId || "Unknown"}
                          {account.hqManaged ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                              HQ
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-500">{account.displayName}</div>
                      </td>
                      <td className="p-2 align-top">
                        <div className="font-medium text-gray-900">
                          {PLATFORM_LABELS[account.platform] ?? account.platform}
                        </div>
                        <div className="text-xs text-gray-500">
                          {account.providerAccountName || account.providerAccountHandle || "—"}
                        </div>
                        {account.providerAccountHandle ? (
                          <div className="text-xs text-gray-500">
                            @{account.providerAccountHandle.replace(/^@/, "")}
                          </div>
                        ) : null}
                        {account.providerAccountUrl ? (
                          <div className="text-xs">
                            <a
                              href={account.providerAccountUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-500 underline"
                            >
                              View channel
                            </a>
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 align-top text-xs">
                        <div
                          className={`font-semibold ${
                            account.connection.requiresReauth
                              ? "text-red-600"
                              : account.connection.reauthRecommended
                              ? "text-amber-600"
                              : "text-emerald-600"
                          }`}
                        >
                          {account.connection.requiresReauth
                            ? "Re-auth required"
                            : account.connection.reauthRecommended
                            ? "Re-auth soon"
                            : account.connection.status
                            ? account.connection.status.replace(/_/g, " ")
                            : "Active"}
                        </div>
                        <div className="text-gray-500">
                          {account.connection.expiresAt
                            ? `Expires ${formatDateTime(account.connection.expiresAt)}`
                            : "No expiry provided"}
                        </div>
                        {account.connection.lastAuthorizedAt ? (
                          <div className="text-gray-500">
                            Linked {formatDateTime(account.connection.lastAuthorizedAt)}
                          </div>
                        ) : null}
                        {account.connection.lastAuthorizedBy ? (
                          <div className="text-gray-400">by {account.connection.lastAuthorizedBy}</div>
                        ) : null}
                      </td>
                      <td className="p-2 align-top text-xs text-gray-600">
                        <div>{account.scopes.publish ? "Publishing enabled" : "Scheduling blocked"}</div>
                        <div>{account.scopes.analytics ? "Analytics enabled" : "Analytics hidden"}</div>
                      </td>
                      <td className="p-2 align-top">
                        <select
                          value={account.status}
                          onChange={(event) =>
                            handleUpdateAccount(account.id, { status: event.target.value as SchedulerAccount["status"] })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        >
                          {ACCOUNT_STATUSES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 align-top text-xs text-gray-500">{formatDateTime(account.updatedAt)}</td>
                      <td className="p-2 align-top">
                        <div className="flex flex-col gap-2 text-xs">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={account.scopes.publish}
                              onChange={(event) =>
                                handleUpdateAccount(account.id, {
                                  scopes: { publish: event.target.checked, analytics: account.scopes.analytics },
                                })
                              }
                            />
                            Allow scheduling
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={account.scopes.analytics}
                              onChange={(event) =>
                                handleUpdateAccount(account.id, {
                                  scopes: { publish: account.scopes.publish, analytics: event.target.checked },
                                })
                              }
                            />
                            Allow analytics
                          </label>
                          <button
                            type="button"
                            onClick={() => startOAuthFlow(account.platform, account)}
                            className={`rounded px-2 py-1 text-left text-xs font-semibold shadow ${
                              account.connection.requiresReauth
                                ? "bg-red-600 text-white hover:bg-red-700"
                                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            }`}
                          >
                            {account.connection.requiresReauth ? "Reconnect now" : "Reconnect"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAccount(account.id)}
                            className="text-left text-red-600 hover:underline"
                          >
                            Remove connection
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {activeTab === "composer" ? (
        <section className="grid gap-6 rounded border bg-white p-6 shadow-sm">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Post composer</h2>
            <p className="text-sm text-gray-600">
              Build platform-ready posts linked to deliverables so clients know which asset each caption supports.
            </p>
          </header>

          {selectedProjectId ? (
            <section className="grid gap-3 rounded border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-indigo-900">AI copy suggestions</h3>
                  <p className="text-xs text-indigo-800">
                    Pull social-ready copy from recent content assistant drafts linked to this project.
                  </p>
                </div>
                <Link
                  href="/admin/tools"
                  className="text-xs font-medium text-indigo-900 underline-offset-4 hover:underline"
                >
                  Open content assistant
                </Link>
              </div>
              {aiDraftsLoading ? (
                <p className="text-xs text-indigo-800">Loading AI drafts…</p>
              ) : aiDraftsError ? (
                <p className="text-xs text-rose-700">{aiDraftsError}</p>
              ) : aiDrafts.length === 0 ? (
                <p className="text-xs text-indigo-800">No AI drafts captured for this project yet.</p>
              ) : (
                <div className="grid gap-3">
                  {aiDrafts.map((draft) => (
                    <article
                      key={draft.id}
                      className="rounded border border-white/60 bg-white/80 p-3 text-sm text-slate-700 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Draft {draft.id}</p>
                          {draft.createdAt ? (
                            <p className="text-xs text-slate-500">
                              {draft.createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          {draft.promptName && <p>Prompt: {draft.promptName}</p>}
                          {draft.modelName && <p>Model: {draft.modelName}</p>}
                          {draft.requestId && <p>Req: {draft.requestId}</p>}
                        </div>
                      </div>
                      {draft.warnings.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 rounded border border-amber-200 bg-amber-50 p-2 pl-4 text-xs text-amber-900">
                          {draft.warnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-2 text-xs text-slate-600">{draft.summary}</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {draft.socialPosts.map((post) => (
                          <div
                            key={post.id}
                            className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900">{post.platform}</span>
                              <button
                                type="button"
                                onClick={() => applyAiDraftToComposer(draft, post)}
                                className="text-xs font-medium text-indigo-700 underline-offset-2 hover:underline"
                              >
                                Use this copy
                              </button>
                            </div>
                            {post.headline && (
                              <p className="mt-1 text-sm font-medium text-slate-900">{post.headline}</p>
                            )}
                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{post.body}</p>
                            {post.hashtags.length > 0 && (
                              <p className="mt-1 text-[11px] text-slate-500">{post.hashtags.join(" ")}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {featureFlags?.analyticsEnabled ? (
            <div className="grid gap-4 rounded border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                <div className="flex min-w-[120px] flex-col rounded bg-white p-3 shadow-sm">
                  <span className="text-xs uppercase text-slate-500">Scheduled</span>
                  <span className="text-xl font-semibold text-slate-900">{analyticsSummary.totals.scheduled}</span>
                </div>
                <div className="flex min-w-[120px] flex-col rounded bg-white p-3 shadow-sm">
                  <span className="text-xs uppercase text-slate-500">Awaiting approval</span>
                  <span className="text-xl font-semibold text-slate-900">{analyticsSummary.totals.awaitingApproval}</span>
                </div>
                <div className="flex min-w-[120px] flex-col rounded bg-white p-3 shadow-sm">
                  <span className="text-xs uppercase text-slate-500">Drafts</span>
                  <span className="text-xl font-semibold text-slate-900">{analyticsSummary.totals.drafts}</span>
                </div>
                <div className="flex min-w-[120px] flex-col rounded bg-white p-3 shadow-sm">
                  <span className="text-xs uppercase text-slate-500">Next 7 days</span>
                  <span className="text-xl font-semibold text-slate-900">{analyticsSummary.upcomingWithinWeek}</span>
                </div>
              </div>
              <div className="grid gap-2 text-sm text-slate-700">
                <span className="text-xs uppercase text-slate-500">Platform mix (last 100 drafts)</span>
                {analyticsSummary.breakdown.length === 0 ? (
                  <p className="text-xs text-slate-500">No platform activity yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {analyticsSummary.breakdown.map((entry) => (
                      <span
                        key={entry.platform}
                        className="rounded-full bg-white px-3 py-1 text-xs font-medium shadow-sm"
                      >
                        {PLATFORM_LABELS[entry.platform] ?? entry.platform}: {entry.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <form className="grid gap-4 rounded border border-slate-200 p-4" onSubmit={handleCreatePost}>
            <h3 className="text-sm font-semibold text-gray-900">Create draft</h3>
            <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">Client</span>
              <select
                value={selectedClientId}
                onChange={(event) => {
                  setSelectedClientId(event.target.value);
                  setOrganisationOverrideTouched(false);
                }}
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="">Select a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {clientLoading ? <span className="mt-1 block text-xs text-gray-500">Loading clients…</span> : null}
            </label>

            <label className="text-sm">
              <span className="font-medium">Organisation</span>
              <select
                value={selectedOrganisationId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedOrganisationId(value);
                  setOrganisationOverrideTouched(false);
                  if (value && selectedClient) {
                    const match = selectedClient.organisations.find((org) => org.id === value);
                    if (match?.name) {
                      setManualClientName(match.name);
                    }
                  }
                }}
                className="mt-1 w-full rounded border px-3 py-2"
                disabled={!selectedClient || selectedClient.organisations.length === 0}
              >
                <option value="">Select an organisation</option>
                {selectedClient?.organisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                    {org.role ? ` · ${org.role}` : ""}
                  </option>
                ))}
              </select>
              {selectedClient && selectedClient.organisations.length === 0 ? (
                <span className="mt-1 block text-xs text-gray-500">
                  No organisation memberships detected. Use the manual label field.
                </span>
              ) : null}
            </label>

            <label className="text-sm">
              <span className="font-medium">Organisation label override</span>
              <input
                type="text"
                  value={manualClientName}
                  onChange={(event) => {
                    const value = event.target.value;
                    setManualClientName(value);
                    setOrganisationOverrideTouched(value.trim().length > 0);
                  }}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Use if the client is not listed"
                />
              </label>

              <label className="text-sm">
                <span className="font-medium">Project</span>
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="">Select a project (optional)</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                {projectLoading ? <span className="mt-1 block text-xs text-gray-500">Loading projects…</span> : null}
              </label>

              <label className="text-sm">
                <span className="font-medium">Manual project name</span>
                <input
                  type="text"
                  value={manualProjectName}
                  onChange={(event) => setManualProjectName(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Optional override"
                />
              </label>

              <div className="grid gap-1 text-sm">
                <span className="font-medium">Deliverable</span>
                <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
                  <input
                    type="search"
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    className="rounded border px-3 py-2"
                    placeholder="Search deliverable products"
                  />
                  <select
                    value={selectedProductId}
                    onChange={(event) => setSelectedProductId(event.target.value)}
                    className="rounded border px-3 py-2"
                  >
                    <option value="">Select deliverable (optional)</option>
                    {filteredProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </div>
                {productLoading ? <span className="text-xs text-gray-500">Loading products…</span> : null}
              </div>

              <label className="text-sm">
                <span className="font-medium">Manual deliverable label</span>
                <input
                  type="text"
                  value={selectedProductName}
                  onChange={(event) => setSelectedProductName(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Optional override"
                />
              </label>

              <label className="text-sm">
                <span className="font-medium">Status</span>
                <select
                  value={postForm.status}
                  onChange={(event) => setPostForm((prev) => ({ ...prev, status: event.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {POST_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="font-medium">Approval state</span>
                <select
                  value={postForm.approvalState}
                  onChange={(event) => setPostForm((prev) => ({ ...prev, approvalState: event.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {APPROVAL_STATES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="font-medium">Scheduled for</span>
                <input
                  type="datetime-local"
                  value={postForm.scheduledAtInput}
                  onChange={(event) => setPostForm((prev) => ({ ...prev, scheduledAtInput: event.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="font-medium">Timezone</span>
                <input
                  type="text"
                  value={postForm.timezone ?? ""}
                  onChange={(event) => setPostForm((prev) => ({ ...prev, timezone: event.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Europe/London"
                />
              </label>
            </div>

            <div className="grid gap-4">
              <fieldset className="text-sm">
                <legend className="font-medium">Platform variants</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {PLATFORM_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={platformSelection.has(option.value)}
                        onChange={(event) => handlePlatformToggle(option.value, event.target.checked)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="text-sm">
                <span className="font-medium">Primary caption</span>
                <textarea
                  value={postCaption}
                  onChange={(event) => setPostCaption(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  rows={4}
                  placeholder="Paste the copy you refined with the transcript assistant"
                />
              </label>

              <label className="text-sm">
                <span className="font-medium">Default hashtags</span>
                <input
                  type="text"
                  value={postHashtags}
                  onChange={(event) => setPostHashtags(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="#video #marketing #pineappletapped"
                />
              </label>

              <label className="text-sm">
                <span className="font-medium">Default link (optional)</span>
                <input
                  type="url"
                  value={baseLinkUrl}
                  onChange={(event) => setBaseLinkUrl(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="https://example.com/landing-page"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Variants inherit this link unless overridden. UTM tags are applied per platform below.
                </span>
              </label>

              <div className="grid gap-2">
                <span className="text-sm font-medium text-gray-900">Media attachments</span>
                <p className="text-xs text-gray-500">
                  Link drive files or hosted assets so the post references the actual deliverable. Attachments are shared with
                  clients once approved.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={attachmentLabel}
                    onChange={(event) => setAttachmentLabel(event.target.value)}
                    className="w-full rounded border px-3 py-2 sm:w-48"
                    placeholder="Label (e.g. Final edit)"
                  />
                  <input
                    type="text"
                    value={attachmentUrl}
                    onChange={(event) => setAttachmentUrl(event.target.value)}
                    className="w-full flex-1 rounded border px-3 py-2"
                    placeholder="Google Drive link, file ID, or URL"
                  />
                  <button
                    type="button"
                    onClick={handleAddAttachment}
                    className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-slate-900"
                  >
                    Add attachment
                  </button>
                </div>
                {attachmentError ? <p className="text-xs text-red-600">{attachmentError}</p> : null}
                {mediaAttachments.length > 0 ? (
                  <ul className="divide-y divide-slate-200 rounded border border-slate-200 text-sm">
                    {mediaAttachments.map((attachment) => (
                      <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                        <div>
                          <div className="font-medium text-gray-900">{attachment.label || attachment.url || attachment.driveFileUrl}</div>
                          <div className="text-xs text-gray-500">
                            {attachment.type === "drive" ? "Google Drive" : "External"} ·{" "}
                            {attachment.url || attachment.driveFileUrl}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-500">No attachments yet.</p>
                )}
              </div>

              <div className="grid gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Per-platform variants</h4>
                  <p className="text-xs text-gray-500">
                    Customise captions, first comments, tracking links, and thumbnails per platform. Leave fields blank to use
                    the defaults above.
                  </p>
                </div>
                {platformSelection.size === 0 ? (
                  <p className="text-xs text-gray-500">Select at least one platform to configure variants.</p>
                ) : (
                  Array.from(platformSelection).map((platform) => {
                    const draft = variantDrafts[platform] ?? getDefaultVariantDraft(platform);
                    const previewUtm = sanitiseUtm(draft.utm) ?? undefined;
                    const previewLink = buildTrackedLink(draft.linkUrl?.trim() || baseLinkUrl.trim() || null, previewUtm);
                    return (
                      <div key={platform} className="rounded border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h5 className="text-sm font-semibold text-gray-900">{PLATFORM_LABELS[platform] ?? platform}</h5>
                          <button
                            type="button"
                            className="text-xs text-slate-500 hover:underline"
                            onClick={() =>
                              updateVariantDraft(platform, getDefaultVariantDraft(platform))
                            }
                          >
                            Reset to defaults
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label className="text-xs font-medium text-gray-700">
                            Caption
                            <textarea
                              value={draft.caption}
                              onChange={(event) => updateVariantDraft(platform, { caption: event.target.value })}
                              className="mt-1 w-full rounded border px-2 py-2 text-sm"
                              rows={4}
                            />
                          </label>
                          <label className="text-xs font-medium text-gray-700">
                            First comment (optional)
                            <textarea
                              value={draft.firstComment}
                              onChange={(event) => updateVariantDraft(platform, { firstComment: event.target.value })}
                              className="mt-1 w-full rounded border px-2 py-2 text-sm"
                              rows={4}
                            />
                          </label>
                          <label className="text-xs font-medium text-gray-700">
                            Platform hashtags
                            <input
                              type="text"
                              value={draft.hashtags}
                              onChange={(event) => updateVariantDraft(platform, { hashtags: event.target.value })}
                              className="mt-1 w-full rounded border px-2 py-2 text-sm"
                              placeholder={postHashtags || "#hashtags"}
                            />
                          </label>
                          <label className="text-xs font-medium text-gray-700">
                            Link override
                            <input
                              type="url"
                              value={draft.linkUrl}
                              onChange={(event) => updateVariantDraft(platform, { linkUrl: event.target.value })}
                              className="mt-1 w-full rounded border px-2 py-2 text-sm"
                              placeholder={baseLinkUrl || "https://example.com"}
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <fieldset className="grid gap-2 text-xs">
                            <legend className="font-medium text-gray-700">UTM parameters</legend>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="grid gap-1">
                                <span>Source</span>
                                <input
                                  type="text"
                                  value={draft.utm.source ?? ""}
                                  onChange={(event) =>
                                    updateVariantDraft(platform, {
                                      utm: { ...draft.utm, source: event.target.value },
                                    })
                                  }
                                  className="rounded border px-2 py-1"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span>Medium</span>
                                <input
                                  type="text"
                                  value={draft.utm.medium ?? ""}
                                  onChange={(event) =>
                                    updateVariantDraft(platform, {
                                      utm: { ...draft.utm, medium: event.target.value },
                                    })
                                  }
                                  className="rounded border px-2 py-1"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span>Campaign</span>
                                <input
                                  type="text"
                                  value={draft.utm.campaign ?? ""}
                                  onChange={(event) =>
                                    updateVariantDraft(platform, {
                                      utm: { ...draft.utm, campaign: event.target.value },
                                    })
                                  }
                                  className="rounded border px-2 py-1"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span>Content</span>
                                <input
                                  type="text"
                                  value={draft.utm.content ?? ""}
                                  onChange={(event) =>
                                    updateVariantDraft(platform, {
                                      utm: { ...draft.utm, content: event.target.value },
                                    })
                                  }
                                  className="rounded border px-2 py-1"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span>Term</span>
                                <input
                                  type="text"
                                  value={draft.utm.term ?? ""}
                                  onChange={(event) =>
                                    updateVariantDraft(platform, {
                                      utm: { ...draft.utm, term: event.target.value },
                                    })
                                  }
                                  className="rounded border px-2 py-1"
                                />
                              </label>
                            </div>
                          </fieldset>
                          <div className="grid gap-2 text-xs">
                            <label className="font-medium text-gray-700">
                              Thumbnail from attachments
                              <select
                                value={draft.thumbnailAssetId}
                                onChange={(event) => {
                                  const selectedId = event.target.value;
                                  if (!selectedId) {
                                    updateVariantDraft(platform, { thumbnailAssetId: "", thumbnailUrl: draft.thumbnailUrl });
                                    return;
                                  }
                                  const selectedAttachment = mediaAttachments.find((item) => item.id === selectedId) || null;
                                  updateVariantDraft(platform, {
                                    thumbnailAssetId: selectedId,
                                    thumbnailUrl:
                                      selectedAttachment?.url ??
                                      selectedAttachment?.driveFileUrl ??
                                      draft.thumbnailUrl,
                                  });
                                }}
                                className="mt-1 w-full rounded border px-2 py-1"
                              >
                                <option value="">No linked attachment</option>
                                {mediaAttachments.map((attachment) => (
                                  <option key={attachment.id} value={attachment.id}>
                                    {attachment.label || attachment.url || attachment.driveFileUrl}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="font-medium text-gray-700">
                              Thumbnail URL override
                              <input
                                type="url"
                                value={draft.thumbnailUrl}
                                onChange={(event) =>
                                  updateVariantDraft(platform, { thumbnailUrl: event.target.value })
                                }
                                className="mt-1 w-full rounded border px-2 py-1"
                                placeholder="https://example.com/thumbnail.jpg"
                              />
                            </label>
                            <div className="text-xs text-gray-500">
                              {previewLink ? (
                                <span>
                                  Tracked link preview:{" "}
                                  <a href={previewLink} target="_blank" rel="noopener noreferrer" className="text-orange">
                                    {previewLink}
                                  </a>
                                </span>
                              ) : (
                                <span>Tracked link preview will appear once a base URL is set.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <label className="text-sm">
                <span className="font-medium">Notes for approvers</span>
                <textarea
                  value={postForm.notes}
                  onChange={(event) => setPostForm((prev) => ({ ...prev, notes: event.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                  rows={3}
                  placeholder="Include reminders about required approvers or campaign context."
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Drafts sync to the client portal deliverable once linked. Approvers will move posts into the scheduled column.
              </span>
              <button
                type="submit"
                disabled={postSaving}
                className="rounded bg-orange px-3 py-2 text-sm font-semibold text-white shadow hover:bg-orange/90"
              >
                {postSaving ? "Saving…" : "Create draft"}
              </button>
            </div>
            {postError ? <p className="text-sm text-red-600">{postError}</p> : null}
          </form>

          <div className="grid gap-4">
            <h3 className="text-sm font-semibold text-gray-900">Schedule overview</h3>
            <SchedulerCalendar posts={calendarPosts} loading={postLoading} onReschedule={handleReschedulePost} />
            <p className="text-xs text-gray-500">
              Drag posts between days to adjust timing or drop them into the Unscheduled tray to remove publishing dates.
            </p>
          </div>

          <div className="grid gap-3 rounded border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900">Approval notes</h3>
            {posts.length === 0 ? (
              <p className="text-xs text-gray-500">Create a post to capture approval context.</p>
            ) : (
              <div className="grid gap-4">
                {posts.map((post) => (
                  <div key={post.id} className="grid gap-2 rounded border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {post.deliverableProductName || post.organisationName || post.organisationId || "Campaign"}
                        </div>
                        <div>
                          Status: {post.status} · {post.approvalState}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">
                        {post.scheduledAt ? `Scheduled ${formatDateTime(post.scheduledAt)}` : "Not scheduled"}
                      </div>
                    </div>
                    <div className="grid gap-1 text-xs text-slate-600">
                      {post.approvalNotes.length === 0 ? (
                        <p className="text-xs text-gray-500">No notes yet.</p>
                      ) : (
                        post.approvalNotes.map((note) => (
                          <div key={note.id} className="rounded border border-slate-100 bg-slate-50 p-2">
                            <div className="text-[11px] uppercase tracking-wide text-slate-400">
                              {note.createdAt ? formatDateTime(note.createdAt) : "Pending timestamp"}
                              {note.createdBy ? ` · ${note.createdBy}` : ""}
                            </div>
                            <div className="whitespace-pre-line text-slate-700">{note.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="grid gap-2">
                      <textarea
                        value={noteDrafts[post.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((prev) => ({ ...prev, [post.id]: event.target.value }))
                        }
                        className="w-full rounded border px-2 py-2 text-xs"
                        rows={2}
                        placeholder="Add context for approvers or delivery teams"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddApprovalNote(post.id)}
                          disabled={!(noteDrafts[post.id]?.trim())}
                          className="rounded bg-slate-800 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          Add note
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
      {activeTab === "exports" ? (
        <section className="grid gap-6 rounded border bg-white p-6 shadow-sm">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Exports & offline workflows</h2>
            <p className="text-sm text-gray-600">
              Download the current schedule for manual publishing while we finish platform integrations.
            </p>
          </header>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="mr-2 font-medium">Filter by organisation</span>
              <select
                value={selectedOrganisationId}
                onChange={(event) => setSelectedOrganisationId(event.target.value)}
                className="rounded border px-3 py-2"
              >
                <option value="">All organisations</option>
                {organisationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="rounded bg-orange px-3 py-2 text-sm font-semibold text-white shadow hover:bg-orange/90"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={handleDownloadIcs}
              className="rounded border border-orange px-3 py-2 text-sm font-semibold text-orange shadow hover:bg-orange/10"
            >
              Download ICS
            </button>
            <span className="text-xs text-gray-500">
              {exportablePosts.length} draft{exportablePosts.length === 1 ? "" : "s"} in selection.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="p-2">Organisation</th>
                  <th className="p-2">Deliverable</th>
                  <th className="p-2">Platforms</th>
                  <th className="p-2">Scheduled</th>
                  <th className="p-2">Approval</th>
                </tr>
              </thead>
              <tbody>
                {exportablePosts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-500">
                      No drafts available for export.
                    </td>
                  </tr>
                ) : (
                  exportablePosts.map((post) => (
                    <tr key={post.id} className="border-b last:border-0">
                      <td className="p-2 align-top">
                        <div className="font-medium text-gray-900">
                          {post.organisationName || post.organisationId || "Unnamed client"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {post.projectName || post.projectId || "Unassigned"}
                        </div>
                      </td>
                      <td className="p-2 align-top text-sm text-gray-600">
                        {post.deliverableProductName || post.deliverableLabel || "Campaign"}
                      </td>
                      <td className="p-2 align-top text-xs text-gray-600">
                        {post.variants.map((variant) => variant.platform.toUpperCase()).join(", ") || "—"}
                      </td>
                      <td className="p-2 align-top text-xs text-gray-500">
                        {post.scheduledAt ? formatDateTime(post.scheduledAt) : "Not scheduled"}
                      </td>
                      <td className="p-2 align-top text-xs text-gray-600">{post.approvalState}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
