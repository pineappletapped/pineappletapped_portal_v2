"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Timestamp,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";

import PortalHero from "@/components/PortalHero";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";

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

interface DraftRecord {
  id: string;
  status: string;
  summary: string;
  keywords: string[];
  youtubeTitles: string[];
  youtubeDescription: string;
  youtubeTags: string[];
  socialPosts: Array<{
    id: string;
    platform: string;
    headline: string;
    body: string;
    hashtags: string[];
  }>;
  transcriptPreview: string;
  projectName: string | null;
  deliverableLabel: string | null;
  deliverableProductId: string | null;
  deliverableProductName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface TranscriptSourceState {
  type: "drive" | "upload" | "manual";
  driveFileId?: string | null;
  driveFileUrl?: string | null;
  fileName?: string | null;
}

interface ProductRecord {
  id: string;
  name: string;
  status: string | null;
}

const PLATFORM_OPTIONS = [
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "X" },
  { value: "tiktok", label: "TikTok" },
];

const DEFAULT_PLATFORM_SELECTION = new Set(["youtube", "linkedin", "instagram"]);

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "from",
  "this",
  "have",
  "your",
  "about",
  "into",
  "their",
  "will",
  "there",
  "been",
  "were",
  "they",
  "them",
  "when",
  "what",
  "where",
  "like",
  "through",
  "over",
  "also",
  "because",
  "than",
  "make",
  "made",
  "just",
  "more",
  "some",
  "then",
  "well",
  "very",
  "here",
]);

function stripSrtCues(input: string): string {
  return input
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+$/.test(trimmed)) return false;
      if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}$/.test(trimmed)) return false;
      return true;
    })
    .join(" ");
}

function normaliseWhitespace(value: string) {
  return value
    .replace(/\s+/g, " ")
  .replace(/\s([?.!])/g, "$1")
    .trim();
}

function summariseTranscript(transcript: string) {
  const clean = normaliseWhitespace(transcript);
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (!sentences.length) {
    return clean.slice(0, 240);
  }
  return sentences.slice(0, 3).join(" ");
}

function extractKeywords(transcript: string) {
  const sanitized = transcript.replace(/[^a-zA-Z0-9\s]/g, " ").toLowerCase();
  const words = sanitized.split(/\s+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  const counts = new Map<string, number>();
  words.forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function extractDriveFileId(input: string): { id: string | null; url: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { id: null, url: null };
  }
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    return { id: trimmed, url: `https://drive.google.com/file/d/${trimmed}/view` };
  }
  const idMatch = trimmed.match(/\/d\/(.+?)\//) || trimmed.match(/id=([^&]+)/);
  if (idMatch && idMatch[1]) {
    return { id: idMatch[1], url: trimmed };
  }
  return { id: null, url: trimmed };
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

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
      console.warn("Failed to parse timestamp object", value, error);
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

export default function ContentAssistantWorkspace() {
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [dbRef, setDbRef] = useState<Firestore | null>(null);

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [manualClientName, setManualClientName] = useState("");
  const [manualClientEmail, setManualClientEmail] = useState("");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [manualProjectName, setManualProjectName] = useState("");

  const [deliverableLabel, setDeliverableLabel] = useState("");
  const [deliverableProductId, setDeliverableProductId] = useState("");
  const [deliverableProductName, setDeliverableProductName] = useState("");
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");

  const [driveLink, setDriveLink] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptSummary, setTranscriptSummary] = useState<string | null>(null);
  const [transcriptKeywords, setTranscriptKeywords] = useState<string[]>([]);
  const [transcriptSource, setTranscriptSource] = useState<TranscriptSourceState>({ type: "manual" });

  const [tone, setTone] = useState("Confident");
  const [callToAction, setCallToAction] = useState("");
  const [notes, setNotes] = useState("");
  const [platformSelection, setPlatformSelection] = useState<Set<string>>(new Set(DEFAULT_PLATFORM_SELECTION));

  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<DraftRecord | null>(null);

  const [draftHistory, setDraftHistory] = useState<DraftRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unsubscribeAuth: (() => void) | null = null;
    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        setDbRef(db as Firestore);
        setFirebaseReady(true);
        const authMod = await loadAuthModule();
        unsubscribeAuth = authMod.onAuthStateChanged(auth, (user) => {
          if (!mounted) return;
          setAuthUser(user);
        });
      } catch (error) {
        console.error("Failed to initialise Firebase", error);
        setFirebaseReady(false);
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
        const records: ClientRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const name = typeof data.fullName === "string" ? data.fullName : typeof data.name === "string" ? data.name : "";
          return {
            id: docSnap.id,
            name: name || data.email || "Unnamed client",
            email: typeof data.email === "string" ? data.email : null,
            company: typeof data.company === "string" ? data.company : null,
          } satisfies ClientRecord;
        });
        records.sort((a, b) => a.name.localeCompare(b.name));
        setClients(records);
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
    setProductError(null);
    getDocs(query(collection(dbRef, "products"), limit(100)))
      .then((snapshot) => {
        const records: ProductRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : `Product ${docSnap.id}`;
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
        setProductError(error?.message || "Unable to load deliverable products");
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
    setProjectsLoading(true);
    setProjectError(null);
    getDocs(
      query(collection(dbRef, "projects"), where("userId", "==", selectedClientId), orderBy("createdAt", "desc"), limit(50))
    )
      .then((snapshot) => {
        const results: ProjectSummary[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          return {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name.trim() ? data.name : data.reference || `Project ${docSnap.id}`,
            reference: typeof data.reference === "string" ? data.reference : null,
            status: typeof data.status === "string" ? data.status : null,
            dueDate: toDate(data.dueDate),
          } satisfies ProjectSummary;
        });
        results.sort((a, b) => {
          const aTime = a.dueDate?.getTime() ?? 0;
          const bTime = b.dueDate?.getTime() ?? 0;
          return bTime - aTime;
        });
        setProjects(results);
        if (results.length === 0) {
          setSelectedProjectId("");
        }
      })
      .catch((error) => {
        console.error("Failed to load projects", error);
        setProjectError(error?.message || "Unable to load projects");
      })
      .finally(() => setProjectsLoading(false));
  }, [dbRef, selectedClientId]);

  useEffect(() => {
    if (!dbRef || !authUser) return;
    setHistoryLoading(true);
    const q = query(
      collection(dbRef, "contentAssistantDrafts"),
      where("userId", "==", authUser.uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const drafts: DraftRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          return {
            id: docSnap.id,
            status: typeof data.status === "string" ? data.status : "draft",
            summary: typeof data.summary === "string" ? data.summary : "",
            keywords: Array.isArray(data.keywords) ? data.keywords : [],
            youtubeTitles: Array.isArray(data.youtubeTitles) ? data.youtubeTitles : [],
            youtubeDescription: typeof data.youtubeDescription === "string" ? data.youtubeDescription : "",
            youtubeTags: Array.isArray(data.youtubeTags) ? data.youtubeTags : [],
            socialPosts: Array.isArray(data.socialPosts)
              ? data.socialPosts.map((item: any) => ({
                  id:
                    item?.id ||
                    (typeof crypto !== "undefined" && "randomUUID" in crypto
                      ? crypto.randomUUID()
                      : Math.random().toString(36).slice(2, 10)),
                  platform: item?.platform || "Social",
                  headline: item?.headline || "",
                  body: item?.body || "",
                  hashtags: Array.isArray(item?.hashtags) ? item.hashtags : [],
                }))
              : [],
            transcriptPreview: typeof data.transcriptPreview === "string" ? data.transcriptPreview : "",
            projectName: typeof data.projectName === "string" ? data.projectName : null,
            deliverableLabel: typeof data.deliverableLabel === "string" ? data.deliverableLabel : null,
            deliverableProductId: typeof data.deliverableProductId === "string" ? data.deliverableProductId : null,
            deliverableProductName: typeof data.deliverableProductName === "string" ? data.deliverableProductName : null,
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
          } satisfies DraftRecord;
        });
        setDraftHistory(drafts);
        setHistoryLoading(false);
      },
      (error) => {
        console.error("Failed to subscribe to draft history", error);
        setHistoryLoading(false);
      }
    );
    return () => unsubscribe();
  }, [dbRef, authUser]);

  const clientOptions = useMemo(() => {
    const search = clientSearch.trim().toLowerCase();
    if (!search) return clients;
    return clients.filter((client) => {
      return (
        client.name.toLowerCase().includes(search) ||
        (client.email && client.email.toLowerCase().includes(search)) ||
        (client.company && client.company.toLowerCase().includes(search))
      );
    });
  }, [clientSearch, clients]);

  const activeClient = useMemo(() => clients.find((client) => client.id === selectedClientId) ?? null, [clients, selectedClientId]);
  const activeProject = useMemo(() => projects.find((project) => project.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const productOptions = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    let filtered = search
      ? products.filter((product) => product.name.toLowerCase().includes(search))
      : products;
    if (deliverableProductId) {
      const match = products.find((product) => product.id === deliverableProductId);
      if (match && !filtered.some((product) => product.id === match.id)) {
        filtered = [match, ...filtered];
      }
    }
    return filtered;
  }, [productSearch, products, deliverableProductId]);
  const activeProduct = useMemo(
    () => products.find((product) => product.id === deliverableProductId) ?? null,
    [products, deliverableProductId]
  );

  useEffect(() => {
    if (!activeProduct) return;
    setDeliverableProductName((prev) => {
      const trimmed = prev.trim();
      return trimmed ? prev : activeProduct.name;
    });
    setDeliverableLabel((prev) => {
      const trimmed = prev.trim();
      return trimmed ? prev : activeProduct.name;
    });
  }, [activeProduct]);

  useEffect(() => {
    const clean = stripSrtCues(transcriptText);
    setTranscriptSummary(clean ? summariseTranscript(clean) : null);
    setTranscriptKeywords(clean ? extractKeywords(clean) : []);
  }, [transcriptText]);

  const handleTranscriptFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setTranscriptSource({ type: "upload", fileName: file.name });
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setTranscriptText(stripSrtCues(text));
    };
    reader.readAsText(file);
  };

  const handleDriveLinkBlur = () => {
    const { id, url } = extractDriveFileId(driveLink);
    setTranscriptSource((prev) => ({ ...prev, type: "drive", driveFileId: id, driveFileUrl: url }));
  };

  const togglePlatform = (value: string) => {
    setPlatformSelection((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const buildClientName = () => {
    if (activeClient) return activeClient.name;
    if (manualClientName.trim()) return manualClientName.trim();
    return manualClientEmail.trim() || null;
  };

  const buildProjectName = () => {
    if (activeProject) return activeProject.name;
    return manualProjectName.trim() || null;
  };

  const handleProductSelect = (value: string) => {
    setDeliverableProductId(value);
    if (value) {
      setProductSearch("");
    }
  };

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGenerating(true);
    setGenerationError(null);
    setCurrentDraft(null);

    const transcript = transcriptText.trim();
    if (!transcript) {
      setGenerationError("Add or upload an SRT transcript before generating copy.");
      setGenerating(false);
      return;
    }

    try {
      const response = await fetch("/api/tools/social-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: activeClient?.id ?? null,
          clientName: buildClientName(),
          projectId: activeProject?.id ?? null,
          projectName: buildProjectName(),
          deliverableLabel: deliverableLabel.trim() || null,
          deliverableProductId: deliverableProductId.trim() || null,
          deliverableProductName: deliverableProductName.trim() || null,
          transcript,
          transcriptSource,
          tone: tone.trim() || null,
          callToAction: callToAction.trim() || null,
          notes: notes.trim() || null,
          platforms: Array.from(platformSelection),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(typeof payload.error === "string" ? payload.error : "Generation failed");
      }

      const payload = (await response.json()) as DraftRecord;
      setCurrentDraft({
        ...payload,
        projectName: buildProjectName(),
        deliverableLabel: deliverableLabel.trim() || null,
        deliverableProductId: deliverableProductId.trim() || null,
        deliverableProductName: deliverableProductName.trim() || activeProduct?.name || null,
      });
    } catch (error) {
      console.error("Generation error", error);
      setGenerationError(error instanceof Error ? error.message : "Failed to generate content");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!currentDraft) return;
    const projectId = activeProject?.id ?? null;
    if (!projectId) {
      setGenerationError("Link a project before publishing to the client portal.");
      return;
    }
    try {
      const response = await fetch("/api/tools/social-assistant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentDraft.id, status: "published", projectId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Unable to publish" }));
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to publish draft");
      }
      const payload = (await response.json()) as DraftRecord;
      setCurrentDraft(payload);
    } catch (error) {
      console.error("Publish error", error);
      setGenerationError(error instanceof Error ? error.message : "Failed to publish draft");
    }
  };

  return (
    <div className="grid gap-8">
      <PortalHero
        eyebrow="Creative tools"
        title="Content repurposing toolkit"
        description="Transform transcripts into ready-to-post copy across channels and link the outputs straight to client deliverables."
        quickActions={[
          {
            href: "#generator",
            label: "Generate social copy",
            description: "Upload transcripts and craft platform copy",
          },
          {
            href: "#history",
            label: "View recent drafts",
            description: "Review previous kits shared with clients",
          },
          {
            href: "/admin/tools/qr-code-generator",
            label: "Generate QR codes",
            description: "Create scannable links for launches",
          },
        ]}
        metrics={[
          { label: "Clients available", value: clients.length.toString() },
          { label: "Drafts this session", value: currentDraft ? "1" : "0" },
          { label: "Platforms selected", value: platformSelection.size.toString() },
        ]}
      />

      <section id="generator" className="card space-y-6 p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">Build a post kit</h2>
          <p className="text-sm text-gray-600">
            Choose the client context, upload or link an SRT transcript, then generate YouTube copy and social posts in one click.
          </p>
        </header>

        <form className="grid gap-6" onSubmit={handleGenerate}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900">Select client</label>
              <input
                type="text"
                className="input"
                placeholder="Search clients"
                value={clientSearch}
                onChange={(event) => setClientSearch(event.target.value)}
              />
              <select
                className="input"
                value={selectedClientId}
                onChange={(event) => {
                  setSelectedClientId(event.target.value);
                  setManualClientName("");
                  setManualClientEmail("");
                }}
              >
                <option value="">Manual entry</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                    {client.email ? ` (${client.email})` : ""}
                  </option>
                ))}
              </select>
              {clientLoading && <p className="text-xs text-gray-500">Loading clients…</p>}
              {clientError && <p className="text-xs text-red-600">{clientError}</p>}
              {!selectedClientId && (
                <div className="grid gap-2">
                  <input
                    type="text"
                    className="input"
                    placeholder="Client name"
                    value={manualClientName}
                    onChange={(event) => setManualClientName(event.target.value)}
                  />
                  <input
                    type="email"
                    className="input"
                    placeholder="Client email"
                    value={manualClientEmail}
                    onChange={(event) => setManualClientEmail(event.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900">Link project</label>
              <select
                className="input"
                value={selectedProjectId}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setManualProjectName("");
                }}
                disabled={projectsLoading || projectError !== null}
              >
                <option value="">Manual entry</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.reference ? ` (${project.reference})` : ""}
                  </option>
                ))}
              </select>
              {projectsLoading && <p className="text-xs text-gray-500">Loading projects…</p>}
              {projectError && <p className="text-xs text-red-600">{projectError}</p>}
              {!selectedProjectId && (
                <input
                  type="text"
                  className="input"
                  placeholder="Project name"
                  value={manualProjectName}
                  onChange={(event) => setManualProjectName(event.target.value)}
                />
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900">Deliverable link</label>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  className="input"
                  placeholder="Search deliverable products"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                />
                <select
                  className="input"
                  value={deliverableProductId}
                  onChange={(event) => handleProductSelect(event.target.value)}
                  disabled={productLoading || productError !== null}
                >
                  <option value="">No linked product</option>
                  {productOptions.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              {productLoading && <p className="text-xs text-gray-500">Loading deliverable products…</p>}
              {productError && <p className="text-xs text-red-600">{productError}</p>}
              <input
                type="text"
                className="input"
                placeholder="Deliverable label (e.g. YouTube edit)"
                value={deliverableLabel}
                onChange={(event) => setDeliverableLabel(event.target.value)}
              />
              <input
                type="text"
                className="input"
                placeholder="Deliverable product ID"
                value={deliverableProductId}
                onChange={(event) => setDeliverableProductId(event.target.value)}
              />
              <input
                type="text"
                className="input"
                placeholder="Deliverable product name"
                value={deliverableProductName}
                onChange={(event) => setDeliverableProductName(event.target.value)}
              />
              {activeProduct?.status && (
                <p className="text-xs text-gray-500">Current status: {activeProduct.status}</p>
              )}
              <p className="text-xs text-gray-500">
                Selecting a product links the kit back to the service clients purchased.
              </p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900">Reference assets</label>
              <input
                type="text"
                className="input"
                placeholder="Google Drive link or file ID"
                value={driveLink}
                onChange={(event) => setDriveLink(event.target.value)}
                onBlur={handleDriveLinkBlur}
              />
              <input type="file" accept=".srt,.txt" onChange={handleTranscriptFile} />
              {transcriptSource.fileName && (
                <p className="text-xs text-gray-500">Uploaded: {transcriptSource.fileName}</p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-gray-900">Transcript or talking points</label>
            <textarea
              className="input min-h-[160px]"
              placeholder="Paste or upload an SRT transcript."
              value={transcriptText}
              onChange={(event) => setTranscriptText(event.target.value)}
            />
            {transcriptSummary && (
              <p className="text-xs text-gray-500">
                Summary preview: {transcriptSummary}
              </p>
            )}
            {transcriptKeywords.length > 0 && (
              <p className="text-xs text-gray-500">Keywords detected: {transcriptKeywords.join(", ")}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900">Tone & CTA</label>
              <input
                type="text"
                className="input"
                placeholder="Tone"
                value={tone}
                onChange={(event) => setTone(event.target.value)}
              />
              <input
                type="text"
                className="input"
                placeholder="Primary call-to-action"
                value={callToAction}
                onChange={(event) => setCallToAction(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900">Internal notes</label>
              <textarea
                className="input min-h-[80px]"
                placeholder="Reminders for the delivery team or publishing guidance."
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium text-gray-900">Platforms to prepare</legend>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {PLATFORM_OPTIONS.map((platform) => (
                <label key={platform.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={platformSelection.has(platform.value)}
                    onChange={() => togglePlatform(platform.value)}
                  />
                  <span>{platform.label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              YouTube titles, descriptions, and tags are always generated when selected.
            </p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn" disabled={generating}>
              {generating ? "Generating…" : "Generate copy"}
            </button>
            {currentDraft && (
              <button type="button" className="btn-outline" onClick={handlePublish}>
                Publish to client portal
              </button>
            )}
            {generationError && <span className="text-sm text-red-600">{generationError}</span>}
          </div>
        </form>

        {currentDraft && (
          <div className="grid gap-6 rounded-lg border border-dashed border-gray-200 p-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">YouTube suggestions</h3>
              <div className="mt-1 space-y-1 text-xs text-gray-500">
                {currentDraft.deliverableLabel && <p>Deliverable: {currentDraft.deliverableLabel}</p>}
                {currentDraft.deliverableProductName && (
                  <p>
                    Linked product: {currentDraft.deliverableProductName}
                    {currentDraft.deliverableProductId && (
                      <>
                        {" "}(
                        <Link
                          href={`/products/${currentDraft.deliverableProductId}`}
                          className="text-blue-600 hover:underline"
                        >
                          View product
                        </Link>
                        )
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="grid gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Titles</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {currentDraft.youtubeTitles.map((title, index) => (
                      <li key={index}>{title}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Description</p>
                  <pre className="whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                    {currentDraft.youtubeDescription}
                  </pre>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Tags</p>
                  <p className="text-sm text-gray-700">{currentDraft.youtubeTags.join(", ")}</p>
                </div>
              </div>
            </div>

            {currentDraft.socialPosts.length > 0 && (
              <div className="grid gap-4">
                <h3 className="text-base font-semibold text-gray-900">Social post pack</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {currentDraft.socialPosts.map((post) => (
                    <article key={post.id} className="rounded-md border border-gray-200 p-4 shadow-sm">
                      <header className="mb-2 flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-gray-900">{post.platform}</span>
                        <span className="text-xs uppercase text-orange-500">{currentDraft.status}</span>
                      </header>
                      {post.headline && <p className="text-sm font-medium text-gray-800">{post.headline}</p>}
                      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{post.body}</p>
                      {post.hashtags.length > 0 && (
                        <p className="mt-3 text-xs text-gray-500">{post.hashtags.join(" ")}</p>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-1 text-xs text-gray-500">
              <span>Draft ID: {currentDraft.id}</span>
              <span>Summary: {currentDraft.summary}</span>
            </div>
          </div>
        )}
      </section>

      <section id="history" className="card space-y-4 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Recent drafts</h2>
            <p className="text-sm text-gray-600">Monitor previous generations and reopen approved kits.</p>
          </div>
          <Link href="/projects" className="btn-sm btn-outline">
            View client portal
          </Link>
        </header>
        {historyLoading ? (
          <p className="text-sm text-gray-500">Loading history…</p>
        ) : draftHistory.length === 0 ? (
          <p className="text-sm text-gray-500">No drafts captured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Deliverable</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {draftHistory.map((draft) => (
                  <tr key={draft.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{draft.summary || "—"}</td>
                    <td className="px-3 py-2">{draft.projectName || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <span>{draft.deliverableLabel || "—"}</span>
                        {draft.deliverableProductName && (
                          <span className="block text-xs text-gray-500">
                            {draft.deliverableProductId ? (
                              <Link href={`/products/${draft.deliverableProductId}`} className="text-blue-600 hover:underline">
                                {draft.deliverableProductName}
                              </Link>
                            ) : (
                              draft.deliverableProductName
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                        {draft.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatDate(draft.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
