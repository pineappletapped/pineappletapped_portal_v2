"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Timestamp,
  addDoc,
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
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";

import PortalHero from "@/components/PortalHero";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";
import { hasRole, type RoleKey, type UserRoles } from "@/lib/roles";

interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
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
  scopes: { publish: boolean; analytics: boolean };
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface SchedulerPostVariant {
  id: string;
  platform: string;
  caption: string;
  firstComment: string | null;
  hashtags: string[];
}

interface SchedulerPost {
  id: string;
  organisationId: string | null;
  organisationName: string | null;
  projectId: string | null;
  projectName: string | null;
  deliverableLabel: string | null;
  deliverableProductId: string | null;
  deliverableProductName: string | null;
  status: string;
  approvalState: string;
  scheduledAt: Date | null;
  timezone: string | null;
  notes: string | null;
  variants: SchedulerPostVariant[];
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface SchedulerFeatureFlags {
  globalEnabled: boolean;
  exportOnlyMode: boolean;
  analyticsEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
  notes: string | null;
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
  const [manualClientName, setManualClientName] = useState("");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [manualProjectName, setManualProjectName] = useState("");

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedProductName, setSelectedProductName] = useState<string>("");

  const [accounts, setAccounts] = useState<SchedulerAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    platform: "youtube",
    displayName: "",
    status: "active",
    publishEnabled: true,
    analyticsEnabled: true,
  });
  const [accountSaving, setAccountSaving] = useState(false);

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
  const [platformSelection, setPlatformSelection] = useState<Set<string>>(new Set(["youtube", "linkedin"]));
  const [postSaving, setPostSaving] = useState(false);

  const [featureFlags, setFeatureFlags] = useState<SchedulerFeatureFlags | null>(null);
  const [flagLoading, setFlagLoading] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagSaving, setFlagSaving] = useState(false);
  const [flagNotes, setFlagNotes] = useState("");

  const [feedback, setFeedback] = useState<string | null>(null);

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
          return {
            id: docSnap.id,
            name,
            email: typeof data.email === "string" ? data.email : null,
            company: typeof data.company === "string" ? data.company : null,
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
    if (!dbRef || !selectedClientId) {
      setProjects([]);
      setSelectedProjectId("");
      setManualProjectName("");
      return;
    }
    setProjectLoading(true);
    getDocs(
      query(collection(dbRef, "projects"), where("userId", "==", selectedClientId), orderBy("createdAt", "desc"), limit(50))
    )
      .then((snapshot) => {
        const records: ProjectSummary[] = snapshot.docs.map((docSnap) => {
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
      })
      .catch((error) => {
        console.error("Failed to load projects", error);
      })
      .finally(() => setProjectLoading(false));
  }, [dbRef, selectedClientId]);
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
          return {
            id: docSnap.id,
            organisationId: normaliseText(data.organisationId) ?? null,
            organisationName: normaliseText(data.organisationName) ?? null,
            platform: normaliseText(data.platform) ?? "unknown",
            displayName: normaliseText(data.displayName) ?? `Account ${docSnap.id}`,
            status: normaliseText(data.status) ?? "active",
            scopes,
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
            ? data.variants.map((variant, index) => ({
                id: `${docSnap.id}-v${index}`,
                platform: normaliseText((variant as any)?.platform) ?? "unknown",
                caption: normaliseText((variant as any)?.caption) ?? "",
                firstComment: normaliseText((variant as any)?.firstComment),
                hashtags: Array.isArray((variant as any)?.hashtags)
                  ? ((variant as any)?.hashtags as unknown[])
                      .map((tag) => normaliseText(tag))
                      .filter((tag): tag is string => Boolean(tag))
                  : [],
              }))
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
            status: normaliseText(data.status) ?? "draft",
            approvalState: normaliseText(data.approvalState) ?? "draft",
            scheduledAt: toDate(data.scheduledAt),
            timezone: normaliseText(data.timezone),
            notes: normaliseText(data.notes),
            variants,
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
    setFlagLoading(true);
    setFlagError(null);
    fetch("/api/social-scheduler/feature-flags")
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || `Failed to load feature flags (${response.status})`);
        }
        const payload = await response.json();
        const updatedAt = payload.updatedAt ? new Date(payload.updatedAt) : null;
        setFeatureFlags({
          globalEnabled: Boolean(payload.globalEnabled),
          exportOnlyMode: Boolean(payload.exportOnlyMode),
          analyticsEnabled: payload.analyticsEnabled !== false,
          updatedAt,
          updatedBy: normaliseText(payload.updatedBy),
          notes: normaliseText(payload.notes),
        });
        setFlagNotes(payload.notes || "");
      })
      .catch((error) => {
        console.error("Failed to load scheduler feature flags", error);
        setFlagError(error?.message || "Unable to load feature flags");
      })
      .finally(() => setFlagLoading(false));
  }, []);
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const term = clientSearch.trim().toLowerCase();
    return clients.filter((client) => client.name.toLowerCase().includes(term));
  }, [clients, clientSearch]);

  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId) || null
    : null;

  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId) || null
    : null;

  const selectedProduct = selectedProductId
    ? products.find((product) => product.id === selectedProductId) || null
    : null;

  const canEditFlags = allowFlagEditing && hasRole(roles, "admin");

  const exportablePosts = useMemo(() => {
    if (!selectedClientId) return posts;
    return posts.filter((post) => post.organisationId === selectedClientId);
  }, [posts, selectedClientId]);

  const pilotRoles = useMemo(() => {
    if (!roles) return [] as string[];
    const allowed: RoleKey[] = ["admin", "marketing", "projects"];
    return allowed.filter((role) => hasRole(roles, role)).map((role) => getRoleLabel(role));
  }, [roles]);
  async function handleCreateAccount(event: FormEvent) {
    event.preventDefault();
    if (!dbRef) return;
    const organisationId = selectedClient?.id ?? null;
    const organisationName = selectedClient?.name ?? manualClientName.trim() || null;
    if (!organisationName) {
      setAccountError("Select a client or provide an organisation name before adding an account.");
      return;
    }
    if (!accountForm.displayName.trim()) {
      setAccountError("Provide a display name for the connected account.");
      return;
    }
    setAccountSaving(true);
    try {
      await addDoc(collection(dbRef, "socialAccounts"), {
        organisationId,
        organisationName,
        platform: accountForm.platform,
        displayName: accountForm.displayName.trim(),
        status: accountForm.status,
        scopes: {
          publish: accountForm.publishEnabled,
          analytics: accountForm.analyticsEnabled,
        },
        createdBy: authUser?.uid ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setAccountError(null);
      setFeedback("Account connection recorded.");
      setAccountForm({
        platform: "youtube",
        displayName: "",
        status: "active",
        publishEnabled: true,
        analyticsEnabled: true,
      });
      setManualClientName("");
    } catch (error) {
      console.error("Failed to create social account", error);
      setAccountError((error as Error)?.message || "Unable to create account");
    } finally {
      setAccountSaving(false);
    }
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
    const organisationId = selectedClient?.id ?? null;
    const organisationName = selectedClient?.name ?? manualClientName.trim() || null;
    if (!organisationName) {
      setPostError("Select or enter a client before drafting a post.");
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
    if (!postCaption.trim()) {
      setPostError("Write a caption to include in the post variants.");
      return;
    }
    setPostSaving(true);
    try {
      const payload: Record<string, unknown> = {
        organisationId,
        organisationName,
        projectId: selectedProject?.id ?? null,
        projectName: selectedProject?.name ?? manualProjectName.trim() || null,
        deliverableLabel: selectedProject?.reference ?? null,
        deliverableProductId: selectedProduct?.id ?? null,
        deliverableProductName: selectedProduct?.name ?? selectedProductName.trim() || null,
        status: postForm.status,
        approvalState: postForm.approvalState,
        timezone: postForm.timezone ?? null,
        scheduledAt: scheduledAt ? Timestamp.fromDate(scheduledAt) : null,
        notes: postForm.notes.trim() || null,
        createdBy: authUser?.uid ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        variants: platforms.map((platform) => ({
          platform,
          caption: postCaption.trim(),
          hashtags: postHashtags
            .split(/[\s,]+/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          firstComment: null,
        })),
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
      setPlatformSelection(new Set(["youtube", "linkedin"]));
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
      const payload = await response.json();
      setFeatureFlags({
        globalEnabled: Boolean(payload.globalEnabled),
        exportOnlyMode: Boolean(payload.exportOnlyMode),
        analyticsEnabled: payload.analyticsEnabled !== false,
        updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : null,
        updatedBy: normaliseText(payload.updatedBy),
        notes: normaliseText(payload.notes),
      });
      setFlagNotes(payload.notes || "");
      setFeedback("Feature flags updated.");
    } catch (error) {
      console.error("Failed to update scheduler flags", error);
      setFlagError((error as Error)?.message || "Unable to update scheduler settings");
    } finally {
      setFlagSaving(false);
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
        <section className="grid gap-6 rounded border bg-white p-6 shadow-sm">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Pilot rollout controls</h2>
            <p className="text-sm text-gray-600">
              Use the switches below to decide when social scheduling surfaces to franchises and clients. All changes are logged
              to the admin audit trail.
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

          <form className="grid gap-4 rounded border border-slate-200 p-4" onSubmit={handleCreateAccount}>
            <h3 className="text-sm font-semibold text-gray-900">Record a connection</h3>
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
                  onChange={(event) => setSelectedClientId(event.target.value)}
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
                <span className="font-medium">Organisation name override</span>
                <input
                  type="text"
                  value={manualClientName}
                  onChange={(event) => setManualClientName(event.target.value)}
                  placeholder="Use when the client is not yet in CRM"
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium">Platform</span>
                <select
                  value={accountForm.platform}
                  onChange={(event) =>
                    setAccountForm((prev) => ({ ...prev, platform: event.target.value }))
                  }
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {PLATFORM_OPTIONS.map((platform) => (
                    <option key={platform.value} value={platform.value}>
                      {platform.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="font-medium">Display name</span>
                <input
                  type="text"
                  value={accountForm.displayName}
                  onChange={(event) =>
                    setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))
                  }
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="Brand channel name"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium">Status</span>
                <select
                  value={accountForm.status}
                  onChange={(event) => setAccountForm((prev) => ({ ...prev, status: event.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {ACCOUNT_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col justify-end gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={accountForm.publishEnabled}
                    onChange={(event) =>
                      setAccountForm((prev) => ({ ...prev, publishEnabled: event.target.checked }))
                    }
                  />
                  Allow scheduling
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={accountForm.analyticsEnabled}
                    onChange={(event) =>
                      setAccountForm((prev) => ({ ...prev, analyticsEnabled: event.target.checked }))
                    }
                  />
                  Allow analytics syncing
                </label>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Capture connections while OAuth integrations are under development. Publishing workers use this metadata once
                enabled.
              </span>
              <button
                type="submit"
                disabled={accountSaving}
                className="rounded bg-orange px-3 py-2 text-sm font-semibold text-white shadow hover:bg-orange/90"
              >
                {accountSaving ? "Saving…" : "Add connection"}
              </button>
            </div>
            {accountError ? <p className="text-sm text-red-600">{accountError}</p> : null}
          </form>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="p-2">Client</th>
                  <th className="p-2">Platform</th>
                  <th className="p-2">Permissions</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Updated</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountsLoading ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-gray-500">
                      Loading connections…
                    </td>
                  </tr>
                ) : accounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-gray-500">
                      No connections captured yet.
                    </td>
                  </tr>
                ) : (
                  accounts.map((account) => (
                    <tr key={account.id} className="border-b last:border-0">
                      <td className="p-2 align-top">
                        <div className="font-medium text-gray-900">
                          {account.organisationName || account.organisationId || "Unknown"}
                        </div>
                        <div className="text-xs text-gray-500">{account.displayName}</div>
                      </td>
                      <td className="p-2 align-top capitalize">{account.platform}</td>
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

          <form className="grid gap-4 rounded border border-slate-200 p-4" onSubmit={handleCreatePost}>
            <h3 className="text-sm font-semibold text-gray-900">Create draft</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="font-medium">Client</span>
                <select
                  value={selectedClientId}
                  onChange={(event) => setSelectedClientId(event.target.value)}
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
                <span className="font-medium">Manual client label</span>
                <input
                  type="text"
                  value={manualClientName}
                  onChange={(event) => setManualClientName(event.target.value)}
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

              <label className="text-sm">
                <span className="font-medium">Deliverable</span>
                <select
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="">Select deliverable (optional)</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                {productLoading ? <span className="mt-1 block text-xs text-gray-500">Loading products…</span> : null}
              </label>

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
                        onChange={(event) => {
                          setPlatformSelection((prev) => {
                            const next = new Set(prev);
                            if (event.target.checked) {
                              next.add(option.value);
                            } else {
                              next.delete(option.value);
                            }
                            return next;
                          });
                        }}
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
                <span className="font-medium">Hashtags</span>
                <input
                  type="text"
                  value={postHashtags}
                  onChange={(event) => setPostHashtags(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="#video #marketing #pineappletapped"
                />
              </label>

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
            <h3 className="text-sm font-semibold text-gray-900">Recent drafts</h3>
            {postLoading ? (
              <p className="text-sm text-gray-500">Loading drafts…</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-gray-500">No drafts yet. Create your first kit to populate this table.</p>
            ) : (
              <div className="grid gap-3">
                {posts.map((post) => (
                  <article key={post.id} className="rounded border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
                      <div>
                        <h4 className="text-base font-semibold text-gray-900">
                          {post.organisationName || post.organisationId || "Unnamed client"}
                        </h4>
                        <div className="text-xs text-gray-500">
                          {post.projectName || post.projectId ? `Project: ${post.projectName || post.projectId}` : null}
                        </div>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span className="rounded bg-slate-100 px-2 py-1 font-medium capitalize">{post.status}</span>
                        <span className="rounded bg-slate-100 px-2 py-1 font-medium capitalize">
                          {post.approvalState}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-1">
                          {post.scheduledAt ? `Scheduled ${formatDateTime(post.scheduledAt)}` : "Not scheduled"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {post.variants.map((variant) => (
                        <div key={variant.id} className="rounded border border-slate-100 bg-slate-50 p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold capitalize">{variant.platform}</span>
                            <span className="text-xs text-gray-500">
                              {variant.hashtags.length > 0 ? variant.hashtags.join(" ") : "No hashtags"}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-line text-gray-700">{variant.caption}</p>
                        </div>
                      ))}
                    </div>
                  </article>
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
              <span className="mr-2 font-medium">Filter by client</span>
              <select
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                className="rounded border px-3 py-2"
              >
                <option value="">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
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
                  <th className="p-2">Client</th>
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
