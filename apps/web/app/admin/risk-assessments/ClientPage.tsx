"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import PortalContainer from "@/components/PortalContainer";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  RISK_DOCUMENT_AUDIENCE_LABELS,
  RISK_DOCUMENT_KIND_LABELS,
  buildCustomRiskDocument,
  buildGenericRiskDocument,
  createCustomRiskDocumentsSample,
  createGenericRiskDocumentsSample,
  getRiskProductOptions,
  getRiskProjectOptions,
  resolveRiskDocumentsForProject,
  type CustomRiskDocument,
  type GenericRiskDocument,
  type ResolvedRiskDocument,
  type RiskDocumentAudience,
  type RiskDocumentKind,
  type RiskDocumentProductOption,
  type RiskDocumentProjectOption,
} from "@/lib/risk-documents";

type OwnerType = "hq" | "franchisee";

interface GenericFormState {
  title: string;
  kind: RiskDocumentKind;
  task: string;
  summary: string;
  productIds: string[];
  hazards: string;
  controls: string;
  documentUrl: string;
  lastReviewedOn: string;
  visibleTo: Record<RiskDocumentAudience, boolean>;
}

interface CustomFormState {
  title: string;
  kind: RiskDocumentKind;
  task: string;
  summary: string;
  projectTemplateId: string;
  projectName: string;
  projectReference: string;
  projectKeys: string;
  linkedProductIds: string[];
  hazards: string;
  controls: string;
  documentUrl: string;
  lastReviewedOn: string;
  owner: OwnerType;
  visibleTo: Record<RiskDocumentAudience, boolean>;
}

const ACCESS_ROLES: ("admin" | "operations" | "projects")[] = ["admin", "operations", "projects"];

const audienceOptions: { id: RiskDocumentAudience; label: string; description: string }[] = [
  { id: "hq", label: RISK_DOCUMENT_AUDIENCE_LABELS.hq, description: "HQ administrators" },
  { id: "franchisee", label: RISK_DOCUMENT_AUDIENCE_LABELS.franchisee, description: "Franchise owners and operators" },
  { id: "team", label: RISK_DOCUMENT_AUDIENCE_LABELS.team, description: "Crew and internal team members" },
  { id: "client", label: RISK_DOCUMENT_AUDIENCE_LABELS.client, description: "Client project portal" },
];

const statusBadgeClasses: Record<string, string> = {
  current: "bg-emerald-50 text-emerald-700",
  "in-review": "bg-amber-50 text-amber-700",
  archived: "bg-gray-100 text-gray-600",
};

const isoToday = () => new Date().toISOString().slice(0, 10);

const buildGenericDefaultForm = (products: RiskDocumentProductOption[]): GenericFormState => {
  const firstProduct = products[0]?.id ?? "";
  return {
    title: "New production RAMS",
    kind: "risk-assessment",
    task: "Production day",
    summary: "Outline hazards and mitigations for the standard shoot workflow.",
    productIds: firstProduct ? [firstProduct] : [],
    hazards: "Slips, trips and falls\nManual handling\nWorking at height",
    controls: "Cable mats and cones\nTwo-person lifts for heavy kit\nCrew working at height harnessed",
    documentUrl: "https://example.com/risk-template.pdf",
    lastReviewedOn: isoToday(),
    visibleTo: { hq: true, franchisee: true, team: true, client: true },
  } satisfies GenericFormState;
};

const buildCustomDefaultForm = (projects: RiskDocumentProjectOption[]): CustomFormState => {
  const template = projects[0] ?? null;
  return {
    title: template ? `${template.name} RAMS` : "Bespoke project RAMS",
    kind: "risk-assessment",
    task: "Bespoke project",
    summary: template
      ? `Custom RAMS for ${template.name}, covering local access requirements and client approvals.`
      : "Capture bespoke site considerations before sharing with the client and crew.",
    projectTemplateId: template?.id ?? "",
    projectName: template?.name ?? "",
    projectReference: template?.reference ?? "",
    projectKeys: template?.reference ?? "",
    linkedProductIds: template ? [...template.productIds] : [],
    hazards: "Venue-specific access\nClient supplied power\nLocal permit requirements",
    controls: "Joint site induction\nPAT test client power distribution\nPermit uploaded to project",
    documentUrl: "https://example.com/custom-rams.pdf",
    lastReviewedOn: isoToday(),
    owner: "hq",
    visibleTo: { hq: true, franchisee: true, team: true, client: true },
  } satisfies CustomFormState;
};

const audienceListFromRecord = (record: Record<RiskDocumentAudience, boolean>): RiskDocumentAudience[] =>
  (Object.keys(record) as RiskDocumentAudience[]).filter((key) => record[key]);

const parseProjectKeys = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const parseDateSafe = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const reviewFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default function AdminRiskAssessmentsClientPage() {
  const { allowed, loading } = useRoleGate(ACCESS_ROLES);
  const productOptions = useMemo(() => getRiskProductOptions(), []);
  const projectOptions = useMemo(() => getRiskProjectOptions(), []);
  const [genericDocs, setGenericDocs] = useState<GenericRiskDocument[]>(() => createGenericRiskDocumentsSample());
  const [customDocs, setCustomDocs] = useState<CustomRiskDocument[]>(() => createCustomRiskDocumentsSample());
  const [viewerFilter, setViewerFilter] = useState<RiskDocumentAudience>("hq");
  const [activeTab, setActiveTab] = useState<"generic" | "custom">("generic");
  const [genericForm, setGenericForm] = useState<GenericFormState>(() => buildGenericDefaultForm(productOptions));
  const [customForm, setCustomForm] = useState<CustomFormState>(() => buildCustomDefaultForm(projectOptions));
  const [genericFormError, setGenericFormError] = useState<string | null>(null);
  const [customFormError, setCustomFormError] = useState<string | null>(null);
  const [genericFormNotice, setGenericFormNotice] = useState<string | null>(null);
  const [customFormNotice, setCustomFormNotice] = useState<string | null>(null);

  const productNameMap = useMemo(() => {
    const map = new Map<string, string>();
    productOptions.forEach((option) => {
      map.set(option.id, option.name);
    });
    return map;
  }, [productOptions]);

  const samplePreviewProject = projectOptions[0] ?? null;

  const previewGenericDocs = useMemo(() => {
    if (viewerFilter === "hq") {
      return genericDocs;
    }
    return genericDocs.filter((doc) => doc.visibleTo.includes(viewerFilter));
  }, [genericDocs, viewerFilter]);

  const previewCustomDocs = useMemo(() => {
    if (viewerFilter === "hq") {
      return customDocs;
    }
    return customDocs.filter((doc) => doc.visibleTo.includes(viewerFilter));
  }, [customDocs, viewerFilter]);

  const clientPreviewDocs: ResolvedRiskDocument[] = useMemo(() => {
    if (!samplePreviewProject) {
      return [];
    }
    const categories = samplePreviewProject.productIds
      .map((id) => {
        const option = productOptions.find((product) => product.id === id);
        return option ? option.category : null;
      })
      .filter((value): value is string => Boolean(value));

    return resolveRiskDocumentsForProject({
      projectId: samplePreviewProject.id,
      projectName: samplePreviewProject.name,
      projectReference: samplePreviewProject.reference,
      productIds: samplePreviewProject.productIds,
      categories,
      audience: "client",
      genericLibrary: genericDocs,
      customLibrary: customDocs,
    });
  }, [customDocs, genericDocs, productOptions, samplePreviewProject]);

  const clientFacingCount = useMemo(
    () =>
      genericDocs.filter((doc) => doc.visibleTo.includes("client")).length +
      customDocs.filter((doc) => doc.visibleTo.includes("client")).length,
    [customDocs, genericDocs]
  );

  const stats = useMemo(
    () => [
      { label: "Generic templates", value: genericDocs.length },
      { label: "Custom project packs", value: customDocs.length },
      { label: "Client-facing docs", value: clientFacingCount },
    ],
    [clientFacingCount, customDocs.length, genericDocs.length]
  );

  if (loading) {
    return (
      <PortalContainer>
        <p className="text-sm text-gray-600">Checking permissions…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Access restricted</h1>
          <p className="text-sm text-gray-600">
            The risk assessment workspace is available to HQ operations, projects, or admin roles. Ask an HQ administrator to
            enable access for your account.
          </p>
        </div>
      </PortalContainer>
    );
  }

  const handleGenericProductToggle = (productId: string) => {
    setGenericForm((prev) => {
      const exists = prev.productIds.includes(productId);
      return {
        ...prev,
        productIds: exists ? prev.productIds.filter((id) => id !== productId) : [...prev.productIds, productId],
      };
    });
  };

  const handleGenericAudienceToggle = (audience: RiskDocumentAudience) => {
    setGenericForm((prev) => ({
      ...prev,
      visibleTo: { ...prev.visibleTo, [audience]: !prev.visibleTo[audience] },
    }));
  };

  const handleCustomProductToggle = (productId: string) => {
    setCustomForm((prev) => {
      const exists = prev.linkedProductIds.includes(productId);
      return {
        ...prev,
        linkedProductIds: exists
          ? prev.linkedProductIds.filter((id) => id !== productId)
          : [...prev.linkedProductIds, productId],
      };
    });
  };

  const handleCustomAudienceToggle = (audience: RiskDocumentAudience) => {
    setCustomForm((prev) => ({
      ...prev,
      visibleTo: { ...prev.visibleTo, [audience]: !prev.visibleTo[audience] },
    }));
  };

  const handleCustomTemplateChange = (templateId: string) => {
    const template = projectOptions.find((option) => option.id === templateId) ?? null;
    setCustomForm((prev) => ({
      ...prev,
      projectTemplateId: templateId,
      projectName: template?.name ?? prev.projectName,
      projectReference: template?.reference ?? prev.projectReference,
      projectKeys: template?.reference ?? prev.projectKeys,
      linkedProductIds: template ? [...template.productIds] : prev.linkedProductIds,
    }));
  };

  const handleGenericSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setGenericFormError(null);
    setGenericFormNotice(null);

    if (genericForm.productIds.length === 0) {
      setGenericFormError("Select at least one product to attach the template to.");
      return;
    }

    const visibleAudiences = audienceListFromRecord(genericForm.visibleTo);
    const newDoc = buildGenericRiskDocument(`generic-${Date.now()}`, {
      type: "generic",
      title: genericForm.title || "Untitled RAMS",
      kind: genericForm.kind,
      task: genericForm.task,
      summary: genericForm.summary,
      hazards: genericForm.hazards,
      controls: genericForm.controls,
      documentUrl: genericForm.documentUrl || "#",
      lastReviewedOn: genericForm.lastReviewedOn || isoToday(),
      owner: "hq",
      visibleTo: visibleAudiences.length > 0 ? visibleAudiences : ["hq"],
      productIds: genericForm.productIds,
      categories: [],
    });

    setGenericDocs((prev) => [newDoc, ...prev]);
    setGenericForm(buildGenericDefaultForm(productOptions));
    setGenericFormNotice("Template added to the HQ library.");
  };

  const handleCustomSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setCustomFormError(null);
    setCustomFormNotice(null);

    const projectIdentifiers = parseProjectKeys(customForm.projectKeys);
    if (!customForm.projectName.trim() && !customForm.projectReference.trim() && projectIdentifiers.length === 0) {
      setCustomFormError("Provide a project name or reference so the RAMS can attach to the correct job.");
      return;
    }

    const visibleAudiences = audienceListFromRecord(customForm.visibleTo);
    const newDoc = buildCustomRiskDocument(`custom-${Date.now()}`, {
      type: "custom",
      title: customForm.title || "Custom RAMS",
      kind: customForm.kind,
      task: customForm.task,
      summary: customForm.summary,
      hazards: customForm.hazards,
      controls: customForm.controls,
      documentUrl: customForm.documentUrl || "#",
      lastReviewedOn: customForm.lastReviewedOn || isoToday(),
      owner: customForm.owner,
      visibleTo: visibleAudiences.length > 0 ? visibleAudiences : ["hq"],
      projectKeys: [
        customForm.projectName,
        customForm.projectReference,
        ...projectIdentifiers,
      ].filter((value): value is string => Boolean(value)),
      projectName: customForm.projectName || customForm.projectReference || "Project",
      linkedProductIds: customForm.linkedProductIds,
    });

    setCustomDocs((prev) => [newDoc, ...prev]);
    setCustomForm(buildCustomDefaultForm(projectOptions));
    setCustomFormNotice("Custom RAMS saved for the project.");
  };

  const renderDocumentBadgeList = (doc: { productIds?: string[]; linkedProductIds?: string[]; categories?: string[] }) => {
    const ids = (doc.linkedProductIds ?? doc.productIds ?? []).filter(Boolean);
    const names = ids.map((id) => productNameMap.get(id) ?? id).filter((value, index, arr) => value && arr.indexOf(value) === index);
    if (names.length === 0 && doc.categories && doc.categories.length > 0) {
      return doc.categories.map((category) => (
        <span
          key={`category-${category}`}
          className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"
        >
          {category}
        </span>
      ));
    }
    return names.map((name) => (
      <span
        key={name}
        className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
      >
        {name}
      </span>
    ));
  };

  const renderAudienceBadges = (audiences: RiskDocumentAudience[]) =>
    audiences.map((audience) => (
      <span
        key={audience}
        className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
      >
        {RISK_DOCUMENT_AUDIENCE_LABELS[audience]}
      </span>
    ));

  const renderReviewBadge = (status: string) => (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        statusBadgeClasses[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status === "in-review" ? "In review" : status === "archived" ? "Archived" : "Current"}
    </span>
  );

  const renderGenericCard = (doc: GenericRiskDocument) => {
    const reviewedDate = parseDateSafe(doc.lastReviewedOn);
    const reviewLabel = reviewedDate ? reviewFormatter.format(reviewedDate) : doc.lastReviewedOn;
    return (
      <li key={doc.id} className="rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900">{doc.title}</p>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {RISK_DOCUMENT_KIND_LABELS[doc.kind]} · {doc.task}
            </p>
            <p className="text-sm text-gray-600">{doc.summary}</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-gray-500">
            {renderReviewBadge(doc.status)}
            <span>{reviewLabel}</span>
            <span>{doc.owner === "hq" ? "HQ issued" : "Franchise issued"}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{renderDocumentBadgeList(doc)}</div>
        <div className="mt-3 flex flex-wrap gap-2">{renderAudienceBadges(doc.visibleTo)}</div>
        <div className="mt-3 text-xs text-blue-600">
          <Link href={doc.documentUrl || "#"} target="_blank" rel="noreferrer" className="font-medium underline">
            Open source document
          </Link>
        </div>
      </li>
    );
  };

  const renderCustomCard = (doc: CustomRiskDocument) => {
    const reviewedDate = parseDateSafe(doc.lastReviewedOn);
    const reviewLabel = reviewedDate ? reviewFormatter.format(reviewedDate) : doc.lastReviewedOn;
    return (
      <li key={doc.id} className="rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900">{doc.title}</p>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {RISK_DOCUMENT_KIND_LABELS[doc.kind]} · {doc.task}
            </p>
            <p className="text-sm text-gray-600">{doc.summary}</p>
            <p className="text-xs text-gray-500">Attached to: {doc.projectName}</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-gray-500">
            {renderReviewBadge(doc.status)}
            <span>{reviewLabel}</span>
            <span>{doc.owner === "hq" ? "Issued by HQ" : "Franchise authored"}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{renderDocumentBadgeList(doc)}</div>
        <div className="mt-3 flex flex-wrap gap-2">{renderAudienceBadges(doc.visibleTo)}</div>
        <div className="mt-3 text-xs text-blue-600">
          <Link href={doc.documentUrl || "#"} target="_blank" rel="noreferrer" className="font-medium underline">
            View uploaded file
          </Link>
        </div>
      </li>
    );
  };

  const renderClientPreviewCard = (doc: ResolvedRiskDocument) => {
    const reviewedDate = parseDateSafe(doc.lastReviewedOn);
    const reviewLabel = reviewedDate ? reviewFormatter.format(reviewedDate) : doc.lastReviewedOn;
    return (
      <li key={`client-preview-${doc.id}`} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-emerald-900">{doc.title}</p>
            <p className="text-xs uppercase tracking-wide text-emerald-700">
              {RISK_DOCUMENT_KIND_LABELS[doc.kind]} · {doc.task}
              {doc.type === "custom" && doc.projectName ? ` · ${doc.projectName}` : ""}
            </p>
            <p className="text-sm text-emerald-800">{doc.summary}</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-emerald-700">
            {renderReviewBadge(doc.status)}
            <span>{reviewLabel}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {doc.appliesToProducts.length > 0
            ? doc.appliesToProducts.map((product) => (
                <span
                  key={`${doc.id}-${product.id}`}
                  className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-emerald-700"
                >
                  {product.name}
                </span>
              ))
            : renderDocumentBadgeList(doc)}
        </div>
        {doc.audienceNotes ? (
          <p className="mt-3 text-xs text-emerald-700">{doc.audienceNotes}</p>
        ) : null}
        <div className="mt-3 text-xs text-emerald-800">
          <Link href={doc.documentUrl || "#"} target="_blank" rel="noreferrer" className="font-medium underline">
            Client view download link
          </Link>
        </div>
      </li>
    );
  };

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="space-y-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">Risk assessments &amp; operating procedures</h1>
            <p className="text-sm text-gray-600">
              Maintain the HQ RAMS library, publish bespoke project packs for franchise teams, and preview what clients see in
              their project dashboard.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">{stat.label}</p>
                <p className="text-xl font-semibold text-gray-900">{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-gray-500">Preview audience:</span>
            <div className="flex flex-wrap gap-2">
              {audienceOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setViewerFilter(option.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    viewerFilter === option.id
                      ? "bg-emerald-600 text-white shadow"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("generic")}
              className={`rounded-full px-4 py-1 text-sm font-medium transition ${
                activeTab === "generic" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Generic templates
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("custom")}
              className={`rounded-full px-4 py-1 text-sm font-medium transition ${
                activeTab === "custom" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Custom project packs
            </button>
          </div>

          {activeTab === "generic" ? (
            <form onSubmit={handleGenericSubmit} className="mt-6 grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-gray-900">Document title</label>
                <input
                  className="input"
                  value={genericForm.title}
                  onChange={(event) => setGenericForm((prev) => ({ ...prev, title: event.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Document type</label>
                  <select
                    className="input"
                    value={genericForm.kind}
                    onChange={(event) =>
                      setGenericForm((prev) => ({ ...prev, kind: event.target.value as RiskDocumentKind }))
                    }
                  >
                    {(Object.keys(RISK_DOCUMENT_KIND_LABELS) as RiskDocumentKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {RISK_DOCUMENT_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Task focus</label>
                  <input
                    className="input"
                    value={genericForm.task}
                    onChange={(event) => setGenericForm((prev) => ({ ...prev, task: event.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-gray-900">Summary</label>
                <textarea
                  className="input min-h-[80px]"
                  value={genericForm.summary}
                  onChange={(event) => setGenericForm((prev) => ({ ...prev, summary: event.target.value }))}
                />
              </div>
              <div className="grid gap-3">
                <p className="text-sm font-medium text-gray-900">Attach to products</p>
                {productOptions.length === 0 ? (
                  <p className="text-xs text-gray-500">No products available yet. Add products to connect templates.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {productOptions.map((product) => {
                      const checked = genericForm.productIds.includes(product.id);
                      return (
                        <label key={`generic-product-${product.id}`} className="flex items-start gap-2 rounded border p-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleGenericProductToggle(product.id)}
                          />
                          <span className="flex flex-col">
                            <span className="font-medium text-gray-900">{product.name}</span>
                            <span className="text-xs text-gray-500">{product.focus}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Key hazards</label>
                  <textarea
                    className="input min-h-[90px]"
                    value={genericForm.hazards}
                    onChange={(event) => setGenericForm((prev) => ({ ...prev, hazards: event.target.value }))}
                  />
                  <p className="text-xs text-gray-500">Use line breaks or commas to separate hazards.</p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Controls</label>
                  <textarea
                    className="input min-h-[90px]"
                    value={genericForm.controls}
                    onChange={(event) => setGenericForm((prev) => ({ ...prev, controls: event.target.value }))}
                  />
                  <p className="text-xs text-gray-500">Describe mitigation measures for each hazard.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Document link</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://..."
                    value={genericForm.documentUrl}
                    onChange={(event) => setGenericForm((prev) => ({ ...prev, documentUrl: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Last reviewed</label>
                  <input
                    className="input"
                    type="date"
                    value={genericForm.lastReviewedOn}
                    onChange={(event) => setGenericForm((prev) => ({ ...prev, lastReviewedOn: event.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium text-gray-900">Visible to</p>
                <div className="flex flex-wrap gap-3">
                  {audienceOptions.map((option) => (
                    <label key={`generic-audience-${option.id}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={genericForm.visibleTo[option.id]}
                        onChange={() => handleGenericAudienceToggle(option.id)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  Clients only see templates linked to products in their basket; staff always retain HQ access.
                </p>
              </div>
              {genericFormError ? <p className="text-sm text-red-600">{genericFormError}</p> : null}
              {genericFormNotice ? <p className="text-sm text-emerald-600">{genericFormNotice}</p> : null}
              <div>
                <button type="submit" className="btn">
                  Save template to library
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCustomSubmit} className="mt-6 grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Project template</label>
                  <select
                    className="input"
                    value={customForm.projectTemplateId}
                    onChange={(event) => handleCustomTemplateChange(event.target.value)}
                  >
                    <option value="">Custom project</option>
                    {projectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} · {project.reference}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Issued by</label>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="custom-owner"
                        value="hq"
                        checked={customForm.owner === "hq"}
                        onChange={() => setCustomForm((prev) => ({ ...prev, owner: "hq" }))}
                      />
                      HQ
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="custom-owner"
                        value="franchisee"
                        checked={customForm.owner === "franchisee"}
                        onChange={() => setCustomForm((prev) => ({ ...prev, owner: "franchisee" }))}
                      />
                      Franchise team
                    </label>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-gray-900">Document title</label>
                <input
                  className="input"
                  value={customForm.title}
                  onChange={(event) => setCustomForm((prev) => ({ ...prev, title: event.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Document type</label>
                  <select
                    className="input"
                    value={customForm.kind}
                    onChange={(event) =>
                      setCustomForm((prev) => ({ ...prev, kind: event.target.value as RiskDocumentKind }))
                    }
                  >
                    {(Object.keys(RISK_DOCUMENT_KIND_LABELS) as RiskDocumentKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {RISK_DOCUMENT_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Task focus</label>
                  <input
                    className="input"
                    value={customForm.task}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, task: event.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-gray-900">Summary</label>
                <textarea
                  className="input min-h-[80px]"
                  value={customForm.summary}
                  onChange={(event) => setCustomForm((prev) => ({ ...prev, summary: event.target.value }))}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Project name</label>
                  <input
                    className="input"
                    value={customForm.projectName}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, projectName: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Project reference</label>
                  <input
                    className="input"
                    value={customForm.projectReference}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, projectReference: event.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-gray-900">Additional project keys</label>
                <textarea
                  className="input min-h-[60px]"
                  placeholder="Add alternative references, job numbers, or slugs (comma or line separated)."
                  value={customForm.projectKeys}
                  onChange={(event) => setCustomForm((prev) => ({ ...prev, projectKeys: event.target.value }))}
                />
              </div>
              <div className="grid gap-3">
                <p className="text-sm font-medium text-gray-900">Linked products</p>
                {productOptions.length === 0 ? (
                  <p className="text-xs text-gray-500">Add products to connect the RAMS to deliverables.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {productOptions.map((product) => {
                      const checked = customForm.linkedProductIds.includes(product.id);
                      return (
                        <label key={`custom-product-${product.id}`} className="flex items-start gap-2 rounded border p-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleCustomProductToggle(product.id)}
                          />
                          <span className="flex flex-col">
                            <span className="font-medium text-gray-900">{product.name}</span>
                            <span className="text-xs text-gray-500">{product.focus}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Key hazards</label>
                  <textarea
                    className="input min-h-[90px]"
                    value={customForm.hazards}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, hazards: event.target.value }))}
                  />
                  <p className="text-xs text-gray-500">Use line breaks or commas to separate hazards.</p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Controls</label>
                  <textarea
                    className="input min-h-[90px]"
                    value={customForm.controls}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, controls: event.target.value }))}
                  />
                  <p className="text-xs text-gray-500">Document the mitigation plan crew must follow.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Document link</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://..."
                    value={customForm.documentUrl}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, documentUrl: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-gray-900">Last reviewed</label>
                  <input
                    className="input"
                    type="date"
                    value={customForm.lastReviewedOn}
                    onChange={(event) => setCustomForm((prev) => ({ ...prev, lastReviewedOn: event.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium text-gray-900">Visible to</p>
                <div className="flex flex-wrap gap-3">
                  {audienceOptions.map((option) => (
                    <label key={`custom-audience-${option.id}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={customForm.visibleTo[option.id]}
                        onChange={() => handleCustomAudienceToggle(option.id)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  Franchise-authored RAMS stay internal until the client audience is enabled.
                </p>
              </div>
              {customFormError ? <p className="text-sm text-red-600">{customFormError}</p> : null}
              {customFormNotice ? <p className="text-sm text-emerald-600">{customFormNotice}</p> : null}
              <div>
                <button type="submit" className="btn">
                  Publish bespoke RAMS
                </button>
              </div>
            </form>
          )}

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-200 p-4">
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Generic library preview</h2>
                <span className="text-xs text-gray-500">{previewGenericDocs.length} templates</span>
              </header>
              {previewGenericDocs.length === 0 ? (
                <p className="text-sm text-gray-600">
                  {viewerFilter === "hq"
                    ? "No templates saved yet. Add your first RAMS above."
                    : "This audience doesn’t have any templates assigned."}
                </p>
              ) : (
                <ul className="grid gap-3">{previewGenericDocs.map((doc) => renderGenericCard(doc))}</ul>
              )}
            </section>
            <section className="rounded-2xl border border-gray-200 p-4">
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Custom project packs</h2>
                <span className="text-xs text-gray-500">{previewCustomDocs.length} packs</span>
              </header>
              {previewCustomDocs.length === 0 ? (
                <p className="text-sm text-gray-600">
                  {viewerFilter === "hq"
                    ? "Create bespoke RAMS to see them listed here."
                    : "No bespoke documents are shared with this audience."}
                </p>
              ) : (
                <ul className="grid gap-3">{previewCustomDocs.map((doc) => renderCustomCard(doc))}</ul>
              )}
            </section>
          </div>

          <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-emerald-900">Client portal preview</h2>
                <p className="text-xs text-emerald-700">
                  {samplePreviewProject
                    ? `Showing what the client sees for ${samplePreviewProject.name}`
                    : "Select a project to preview the client view."}
                </p>
              </div>
              <span className="text-xs text-emerald-700">{clientPreviewDocs.length} shared documents</span>
            </div>
            {clientPreviewDocs.length === 0 ? (
              <p className="mt-4 text-sm text-emerald-800">
                No RAMS are currently shared with the client for this scenario. Attach a generic template to the products or
                publish a bespoke RAMS above.
              </p>
            ) : (
              <ul className="mt-4 grid gap-3">{clientPreviewDocs.map((doc) => renderClientPreviewCard(doc))}</ul>
            )}
          </div>
        </section>
      </div>
    </PortalContainer>
  );
}
