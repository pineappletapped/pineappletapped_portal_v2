"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { useRoleGate } from "@/hooks/useRoleGate";
import { ensureFirebase } from "@/lib/firebase";
import {
  DEFAULT_BRAND_GUIDELINES,
  parseBrandGuidelines,
  type BrandGuidelinesState,
} from "@/lib/brand-guidelines";
import { formatDate } from "@/lib/datetime";
import {
  PAGE_LIBRARY,
  PAGE_TYPE_LABELS,
  TEMPLATE_KINDS,
  TEMPLATE_LAYOUT_OPTIONS,
  allowedTemplateKinds,
  createBlankPage,
  createTemplatePreset,
  defaultTemplateStyling,
  summarisePageForContents,
  type ProposalTemplateItem,
  type ProposalTemplateKind,
  type ProposalTemplatePage,
  type ProposalTemplatePageType,
  type ProposalTemplateStyling,
  type TemplateProductSummary,
} from "@/lib/proposal-templates";

interface StoredAgreement {
  id: string;
  title?: string;
  category?: string;
}

interface StoredTemplateRecord {
  id: string;
  name: string;
  category?: string;
  summary?: string | null;
  pages?: ProposalTemplatePage[];
  styling?: ProposalTemplateStyling | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface StoredProductRecord extends TemplateProductSummary {
  id: string;
}

type FeedbackState = { tone: "success" | "error"; message: string } | null;

type TemplateMetadata = {
  allowProductOverride: boolean;
};

const normaliseString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const findTemplateKindDescriptor = (id: string | null | undefined) =>
  TEMPLATE_KINDS.find((kind) => kind.id === id);

type PageUpdate = Partial<ProposalTemplatePage>;

type BuilderState = {
  name: string;
  summary: string;
  kind: ProposalTemplateKind;
  baseProductId: string;
  pages: ProposalTemplatePage[];
  items: ProposalTemplateItem[];
  agreements: string[];
  styling: ProposalTemplateStyling;
  metadata: TemplateMetadata;
};

const createInitialBuilderState = (
  brand: BrandGuidelinesState,
): BuilderState => ({
  name: "",
  summary: "",
  kind: "detailed",
  baseProductId: "",
  pages: [],
  items: [],
  agreements: [],
  styling: defaultTemplateStyling(brand),
  metadata: { allowProductOverride: true },
});

const sortByName = <T extends { name?: string; title?: string }>(
  values: T[],
): T[] =>
  [...values].sort((a, b) => {
    const labelA = (a.name || a.title || "").toLowerCase();
    const labelB = (b.name || b.title || "").toLowerCase();
    return labelA.localeCompare(labelB);
  });

const deriveContentsEntries = (
  pages: ProposalTemplatePage[],
  activeId?: string,
): string[] =>
  pages
    .filter((page) => page.id !== activeId && page.includeInContents !== false)
    .map((page) => summarisePageForContents(page));

export default function ProposalTemplatesWorkspace() {
  const { allowed, loading: roleLoading } = useRoleGate(["admin", "sales"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [brandGuidelines, setBrandGuidelines] = useState<BrandGuidelinesState>(
    DEFAULT_BRAND_GUIDELINES,
  );
  const [brandLogoUrl, setBrandLogoUrl] = useState<string>("");
  const [templates, setTemplates] = useState<StoredTemplateRecord[]>([]);
  const [agreements, setAgreements] = useState<StoredAgreement[]>([]);
  const [products, setProducts] = useState<StoredProductRecord[]>([]);
  const [builder, setBuilder] = useState<BuilderState>(() =>
    createInitialBuilderState(DEFAULT_BRAND_GUIDELINES),
  );
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [presetSeeded, setPresetSeeded] = useState(false);

  useEffect(() => {
    if (roleLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { db } = await ensureFirebase();
        if (!db) throw new Error("Firestore unavailable");

        const [brandingSnap, templateSnap, agreementSnap, productSnap] =
          await Promise.all([
            getDoc(doc(db, "settings", "branding")),
            getDocs(collection(db, "proposalTemplates")),
            getDocs(collection(db, "agreements")),
            getDocs(collection(db, "products")),
          ]);

        if (cancelled) return;

        if (brandingSnap.exists()) {
          const data = brandingSnap.data() as any;
          if (typeof data?.logoUrl === "string") {
            setBrandLogoUrl(data.logoUrl);
          }
          const parsed = parseBrandGuidelines(data?.brandGuidelines);
          setBrandGuidelines(parsed);
          setBuilder((prev) => ({
            ...createInitialBuilderState(parsed),
            name: prev.name,
            summary: prev.summary,
            kind: prev.kind,
            baseProductId: prev.baseProductId,
            pages: prev.pages.length > 0 ? prev.pages : [],
            items: prev.items,
            agreements: prev.agreements,
            metadata: prev.metadata,
          }));
        }

        const templateRecords = templateSnap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            name: normaliseString(data?.name) || docSnap.id,
            category: normaliseString(data?.category) || undefined,
            summary: normaliseString(data?.summary) || null,
            pages: Array.isArray(data?.pages) ? (data.pages as ProposalTemplatePage[]) : [],
            styling: data?.styling || null,
            brandColor: normaliseString(data?.brandColor) || null,
            logoUrl: normaliseString(data?.logoUrl) || null,
            createdAt: data?.createdAt || null,
            updatedAt: data?.updatedAt || null,
          } as StoredTemplateRecord;
        });

        setTemplates(sortByName(templateRecords));
        setAgreements(
          sortByName(
            agreementSnap.docs.map((docSnap) => {
              const data = docSnap.data() as any;
              return {
                id: docSnap.id,
                title: normaliseString(data?.title) || docSnap.id,
                category: normaliseString(data?.category) || undefined,
              } as StoredAgreement;
            }),
          ),
        );
        setProducts(
          sortByName(
            productSnap.docs.map((docSnap) => {
              const data = docSnap.data() as any;
              return {
                id: docSnap.id,
                name: normaliseString(data?.name) || docSnap.id,
                summary: normaliseString(data?.summary) || normaliseString(data?.shortDescription),
                headline: normaliseString(data?.headline),
                storyboardEnabled: Boolean(data?.storyboardEnabled),
                operationsSummary: normaliseString(data?.operationsSummary),
                price: typeof data?.price === "number" ? data.price : undefined,
              } as StoredProductRecord;
            }),
          ),
        );
      } catch (error) {
        console.error("Failed to load proposal template workspace", error);
        if (!cancelled) {
          setFeedback({
            tone: "error",
            message: "Failed to load workspace. Refresh and try again.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, roleLoading]);

  const selectedProduct = useMemo(() => {
    if (!builder.baseProductId) return null;
    return products.find((product) => product.id === builder.baseProductId) || null;
  }, [builder.baseProductId, products]);

  useEffect(() => {
    if (!allowed) return;
    if (presetSeeded) return;
    if (builder.kind === "quick" && !selectedProduct) {
      return;
    }
    const preset = createTemplatePreset(builder.kind, {
      brand: brandGuidelines,
      product: selectedProduct || undefined,
    });
    setBuilder((prev) => ({
      ...prev,
      pages: preset.pages,
      items: preset.items,
    }));
    setActivePageId(preset.pages.length > 0 ? preset.pages[0].id : null);
    setPresetSeeded(true);
  }, [allowed, brandGuidelines, builder.kind, presetSeeded, selectedProduct]);

  const handleBuilderChange = (updates: Partial<BuilderState>) => {
    setBuilder((prev) => ({
      ...prev,
      ...updates,
    }));
  };

  const handleTemplateKindChange = (kind: ProposalTemplateKind) => {
    if (builder.kind === kind) return;
    handleBuilderChange({ kind });
    setPresetSeeded(false);
  };

  const regenerateFromPreset = () => {
    if (builder.kind === "quick" && !selectedProduct) {
      setFeedback({
        tone: "error",
        message: "Select a product before generating a quick template preset.",
      });
      return;
    }
    const preset = createTemplatePreset(builder.kind, {
      brand: brandGuidelines,
      product: selectedProduct || undefined,
    });
    handleBuilderChange({
      pages: preset.pages,
      items: preset.items,
    });
    setActivePageId(preset.pages.length > 0 ? preset.pages[0].id : null);
    setPresetSeeded(true);
  };

  const handleAddPage = (type: ProposalTemplatePageType) => {
    if (builder.kind === "quick" && !selectedProduct && type === "service_overview") {
      setFeedback({
        tone: "error",
        message: "Select a product to populate the service overview.",
      });
    }
    const newPage = createBlankPage(type, brandGuidelines, selectedProduct || undefined);
    setBuilder((prev) => ({
      ...prev,
      pages: [...prev.pages, newPage],
    }));
    setActivePageId(newPage.id);
  };

  const handleRemovePage = (id: string) => {
    setBuilder((prev) => ({
      ...prev,
      pages: prev.pages.filter((page) => page.id !== id),
    }));
    setActivePageId((current) => {
      if (current === id) {
        const remaining = builder.pages.filter((page) => page.id !== id);
        return remaining.length > 0 ? remaining[0].id : null;
      }
      return current;
    });
  };

  const handleMovePage = (id: string, direction: "up" | "down") => {
    setBuilder((prev) => {
      const index = prev.pages.findIndex((page) => page.id === id);
      if (index === -1) return prev;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= prev.pages.length) return prev;
      const nextPages = [...prev.pages];
      const [moved] = nextPages.splice(index, 1);
      nextPages.splice(nextIndex, 0, moved);
      return { ...prev, pages: nextPages };
    });
  };

  const handleUpdatePage = (id: string, updates: PageUpdate) => {
    setBuilder((prev) => ({
      ...prev,
      pages: prev.pages.map((page) =>
        page.id === id
          ? {
              ...page,
              ...updates,
            }
          : page,
      ),
    }));
  };

  const activePage = useMemo(() => {
    if (!builder.pages.length) return null;
    if (activePageId) {
      return builder.pages.find((page) => page.id === activePageId) || builder.pages[0];
    }
    return builder.pages[0];
  }, [activePageId, builder.pages]);

  useEffect(() => {
    if (!activePage && builder.pages.length > 0) {
      setActivePageId(builder.pages[0].id);
    }
  }, [activePage, builder.pages]);

  const handleToggleAgreement = (id: string) => {
    handleBuilderChange({
      agreements: builder.agreements.includes(id)
        ? builder.agreements.filter((agreementId) => agreementId !== id)
        : [...builder.agreements, id],
    });
  };

  const handleAddProductItem = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    handleBuilderChange({
      items: [
        ...builder.items,
        {
          type: "product",
          productId: product.id,
          name: product.name,
          price: product.price,
          description: product.summary,
        },
      ],
    });
  };

  const handleAddCustomItem = () => {
    handleBuilderChange({
      items: [
        ...builder.items,
        {
          type: "custom",
          name: `Custom line item ${builder.items.length + 1}`,
          price: undefined,
        },
      ],
    });
  };

  const handleUpdateItem = (
    index: number,
    updates: Partial<ProposalTemplateItem>,
  ) => {
    handleBuilderChange({
      items: builder.items.map((item, idx) =>
        idx === index
          ? {
              ...item,
              ...updates,
            }
          : item,
      ),
    });
  };

  const handleRemoveItem = (index: number) => {
    handleBuilderChange({
      items: builder.items.filter((_, idx) => idx !== index),
    });
  };

  const metrics = useMemo(() => {
    const primaryColour = brandGuidelines.colors?.primary || "—";
    const font = brandGuidelines.fonts?.primary || "—";
    return [
      { label: "Templates", value: templates.length },
      { label: "Primary colour", value: primaryColour },
      { label: "Primary font", value: font },
      { label: "Pages", value: builder.pages.length },
    ];
  }, [brandGuidelines, builder.pages.length, templates.length]);

  const quickActions = TEMPLATE_KINDS.map((kind) => ({
    label: kind.label,
    description: kind.description,
    onClick: () => handleTemplateKindChange(kind.id),
  }));

  const contentsPreview = useMemo(
    () => (activePage ? deriveContentsEntries(builder.pages, activePage.id) : []),
    [activePage, builder.pages],
  );

  const refreshTemplates = async () => {
    try {
      const { db } = await ensureFirebase();
      if (!db) return;
      const snapshot = await getDocs(collection(db, "proposalTemplates"));
      const records = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          name: normaliseString(data?.name) || docSnap.id,
          category: normaliseString(data?.category) || undefined,
          summary: normaliseString(data?.summary) || null,
          pages: Array.isArray(data?.pages) ? (data.pages as ProposalTemplatePage[]) : [],
          styling: data?.styling || null,
          brandColor: normaliseString(data?.brandColor) || null,
          logoUrl: normaliseString(data?.logoUrl) || null,
          createdAt: data?.createdAt || null,
          updatedAt: data?.updatedAt || null,
        } as StoredTemplateRecord;
      });
      setTemplates(sortByName(records));
    } catch (error) {
      console.error("Failed to refresh templates", error);
    }
  };

  const handleSaveTemplate = async () => {
    if (!builder.name.trim()) {
      setFeedback({ tone: "error", message: "Template name is required." });
      return;
    }
    if (builder.pages.length === 0) {
      setFeedback({ tone: "error", message: "Add at least one page to the template." });
      return;
    }
    if (builder.kind === "quick" && !selectedProduct) {
      setFeedback({
        tone: "error",
        message: "Select a base product before saving a quick template.",
      });
      return;
    }

    try {
      setSaving(true);
      const { functions } = await ensureFirebase();
      if (!functions) throw new Error("Cloud Functions unavailable");
      const callable = httpsCallable(functions, "admin_saveProposalTemplate");
      await callable({
        name: builder.name.trim(),
        summary: builder.summary.trim() || undefined,
        category: builder.kind,
        baseProductId: builder.baseProductId || undefined,
        items: builder.items,
        agreementIds: builder.agreements,
        pages: builder.pages,
        styling: builder.styling,
        brandColor: brandGuidelines.colors?.primary,
        logoUrl: brandLogoUrl || undefined,
        metadata: builder.metadata,
      });
      setFeedback({ tone: "success", message: "Template saved." });
      setPresetSeeded(true);
      setBuilder((prev) => ({
        ...prev,
        name: "",
        summary: "",
        agreements: [],
        items: [],
        pages: [],
      }));
      setActivePageId(null);
      setPresetSeeded(false);
      await refreshTemplates();
    } catch (error: any) {
      console.error("Failed to save proposal template", error);
      setFeedback({
        tone: "error",
        message:
          error?.message || "Unable to save template. Check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderPageList = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Pages</h3>
        <button
          type="button"
          onClick={regenerateFromPreset}
          className="btn-outline"
        >
          Regenerate from preset
        </button>
      </div>
      {builder.pages.length === 0 ? (
        <p className="text-sm text-slate-600">No pages yet. Add a page to begin.</p>
      ) : (
        <ol className="space-y-2">
          {builder.pages.map((page, index) => {
            const label = PAGE_TYPE_LABELS[page.type] || "Page";
            return (
              <li key={page.id}>
                <div
                  className={clsx(
                    "flex items-center justify-between rounded-2xl border p-3",
                    activePage?.id === page.id
                      ? "border-slate-900 bg-slate-900/5"
                      : "border-slate-200 bg-white",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActivePageId(page.id)}
                    className="flex flex-1 flex-col text-left"
                  >
                    <span className="text-sm font-semibold text-slate-900">{label}</span>
                    <span className="text-xs text-slate-500">
                      {page.title?.trim() ? page.title : "Untitled page"}
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleMovePage(page.id, "up")}
                      className="btn-ghost px-2"
                      aria-label="Move page up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMovePage(page.id, "down")}
                      className="btn-ghost px-2"
                      aria-label="Move page down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemovePage(page.id)}
                      className="btn-ghost text-red-600"
                      aria-label="Remove page"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  const renderAddPageLibrary = () => (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Add a page</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {PAGE_LIBRARY.map((entry) => (
          <button
            type="button"
            key={entry.type}
            onClick={() => handleAddPage(entry.type)}
            className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-slate-900/60 hover:shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-900">{entry.label}</p>
            <p className="mt-1 text-xs text-slate-500">{entry.description}</p>
          </button>
        ))}
      </div>
    </div>
  );

  const renderPageEditor = () => {
    if (!activePage) {
      return (
        <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          Select or add a page to edit its layout and content.
        </div>
      );
    }

    const handleFieldChange = (field: keyof ProposalTemplatePage, value: any) => {
      handleUpdatePage(activePage.id, { [field]: value });
    };

    const layoutOptions = TEMPLATE_LAYOUT_OPTIONS;
    const contentsEntries = contentsPreview;
    const bulletPointValue = (activePage.bulletPoints || []).join("\n");

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {PAGE_TYPE_LABELS[activePage.type] || "Page"}
            </h3>
            <p className="text-xs text-slate-500">
              Configure layout, copy, and visibility for this page.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="text-xs text-slate-600">
              Layout
              <select
                className="input ml-2"
                value={activePage.layout}
                onChange={(event) => handleFieldChange("layout", event.target.value)}
              >
                {layoutOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {activePage.type !== "cover" && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={activePage.includeInContents !== false}
                  onChange={(event) =>
                    handleFieldChange("includeInContents", event.target.checked)
                  }
                />
                Show in contents
              </label>
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Title
            <input
              className="input mt-1"
              type="text"
              value={activePage.title || ""}
              onChange={(event) => handleFieldChange("title", event.target.value)}
              disabled={activePage.autoContents}
            />
          </label>
          {activePage.type !== "contents" && (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Subtitle
              <input
                className="input mt-1"
                type="text"
                value={activePage.subtitle || ""}
                onChange={(event) => handleFieldChange("subtitle", event.target.value)}
              />
            </label>
          )}
          {activePage.type === "contents" ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Contents preview</p>
              {contentsEntries.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  Pages marked for the table of contents will appear here once added.
                </p>
              ) : (
                <ol className="mt-2 space-y-1 text-xs">
                  {contentsEntries.map((entry) => (
                    <li key={entry} className="rounded bg-slate-100 px-3 py-1">
                      {entry}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Body copy
              <textarea
                className="input mt-1 min-h-[120px]"
                value={activePage.body || ""}
                onChange={(event) => handleFieldChange("body", event.target.value)}
              />
            </label>
          )}

          {[
            "service_overview",
            "storyboard",
            "operations",
            "custom",
          ].includes(activePage.type) && (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Highlights / bullet points
              <textarea
                className="input mt-1 min-h-[100px]"
                value={bulletPointValue}
                onChange={(event) =>
                  handleFieldChange(
                    "bulletPoints",
                    event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  )
                }
              />
              <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                One item per line
              </span>
            </label>
          )}

          {[
            "service_overview",
            "storyboard",
            "operations",
            "custom",
          ].includes(activePage.type) && (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Reference product (optional)
              <select
                className="input mt-1"
                value={activePage.productId || builder.baseProductId || ""}
                onChange={(event) => handleFieldChange("productId", event.target.value)}
              >
                <option value="">No linked product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {activePage.type === "quote" || activePage.type === "estimate" ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quote mode
              <select
                className="input mt-1"
                value={activePage.displayMode || activePage.type}
                onChange={(event) => handleFieldChange("displayMode", event.target.value)}
              >
                <option value="quote">Quote</option>
                <option value="estimate">Estimate</option>
              </select>
            </label>
          ) : null}

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes for the proposal editor
            <textarea
              className="input mt-1 min-h-[80px]"
              value={activePage.notes || ""}
              onChange={(event) => handleFieldChange("notes", event.target.value)}
            />
          </label>
        </div>
      </div>
    );
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600">Loading proposal templates…</p>;
  }

  if (!allowed) {
    return <p className="p-6 text-sm text-slate-600">You do not have access to this workspace.</p>;
  }

  return (
    <PortalContainer>
      <div className="space-y-6">
        <PortalHero
          eyebrow="Sales operations"
          title="Proposal templates"
          description="Compose branded proposal templates that pull through Pineapple Tapped typography, colour, and tone. Seed a preset, add new sections, and link agreements so teams can deliver proposals in minutes."
          metrics={metrics}
          quickActions={quickActions}
        />

        {feedback && (
          <div
            className={clsx(
              "rounded-3xl border p-4",
              feedback.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900",
            )}
          >
            <p className="text-sm font-medium">{feedback.message}</p>
          </div>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,360px)]">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Template details
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Name the template, choose a preset, and decide whether editors can swap the base product before tailoring pages.
                </p>
              </div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Template name
                <input
                  className="input mt-1"
                  type="text"
                  value={builder.name}
                  onChange={(event) => handleBuilderChange({ name: event.target.value })}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Summary
                <textarea
                  className="input mt-1 min-h-[80px]"
                  value={builder.summary}
                  onChange={(event) => handleBuilderChange({ summary: event.target.value })}
                />
              </label>
              <div
                className={clsx(
                  "grid gap-4",
                  builder.kind === "quick" && "sm:grid-cols-2",
                )}
              >
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Template preset
                  <select
                    className="input mt-1"
                    value={builder.kind}
                    onChange={(event) => {
                      const nextKind = event.target.value as ProposalTemplateKind;
                      if (allowedTemplateKinds.includes(nextKind)) {
                        handleTemplateKindChange(nextKind);
                      }
                    }}
                  >
                    {TEMPLATE_KINDS.map((kind) => (
                      <option key={kind.id} value={kind.id}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                    {findTemplateKindDescriptor(builder.kind)?.description}
                  </span>
                </label>
                {builder.kind === "quick" && (
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Base product
                    <select
                      className="input mt-1"
                      value={builder.baseProductId}
                      onChange={(event) => {
                        handleBuilderChange({ baseProductId: event.target.value });
                        setPresetSeeded(false);
                      }}
                    >
                      <option value="">Select a product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                      Seed the quick template with this product’s overview and pricing.
                    </span>
                  </label>
                )}
              </div>
              <label className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={builder.metadata.allowProductOverride}
                  onChange={(event) =>
                    handleBuilderChange({
                      metadata: {
                        ...builder.metadata,
                        allowProductOverride: event.target.checked,
                      },
                    })
                  }
                />
                Allow editors to swap the base product when applying this template
              </label>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Styling defaults
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Tune the layout theme, accent colours, and background the proposal PDF will use by default.
                </p>
              </div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Theme
                <select
                  className="input mt-1"
                  value={builder.styling.theme}
                  onChange={(event) =>
                    handleBuilderChange({
                      styling: { ...builder.styling, theme: event.target.value as ProposalTemplateStyling["theme"] },
                    })
                  }
                >
                  <option value="modern">Modern</option>
                  <option value="spotlight">Spotlight</option>
                  <option value="classic">Classic</option>
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Accent colour
                  <input
                    className="input mt-1"
                    type="color"
                    value={builder.styling.accentColor || brandGuidelines.colors.secondary}
                    onChange={(event) =>
                      handleBuilderChange({
                        styling: { ...builder.styling, accentColor: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Secondary colour
                  <input
                    className="input mt-1"
                    type="color"
                    value={builder.styling.secondaryColor || brandGuidelines.colors.accent}
                    onChange={(event) =>
                      handleBuilderChange({
                        styling: { ...builder.styling, secondaryColor: event.target.value },
                      })
                    }
                  />
                </label>
              </div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Page background style
                <select
                  className="input mt-1"
                  value={builder.styling.background}
                  onChange={(event) =>
                    handleBuilderChange({
                      styling: { ...builder.styling, background: event.target.value as ProposalTemplateStyling["background"] },
                    })
                  }
                >
                  <option value="clean">Clean</option>
                  <option value="gradient">Gradient</option>
                  <option value="texture">Texture</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={builder.styling.includePageNumbers}
                  onChange={(event) =>
                    handleBuilderChange({
                      styling: {
                        ...builder.styling,
                        includePageNumbers: event.target.checked,
                      },
                    })
                  }
                />
                Show page numbers on generated PDFs
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
                Global brand colours and fonts from the guidelines are applied automatically. Adjust the accents here when you
                need a variation.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4">
              {renderPageList()}
              {renderAddPageLibrary()}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              {renderPageEditor()}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Line items
                  </p>
                  <p className="text-xs text-slate-500">
                    Seed pricing for quote and estimate pages. These can be tailored when sending the proposal.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={handleAddCustomItem}
                  >
                    Add custom item
                  </button>
                  <div className="relative">
                    <select
                      className="input"
                      onChange={(event) => {
                        if (!event.target.value) return;
                        handleAddProductItem(event.target.value);
                        event.target.value = "";
                      }}
                    >
                      <option value="">Add product…</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              {builder.items.length === 0 ? (
                <p className="text-sm text-slate-600">No line items yet.</p>
              ) : (
                <div className="space-y-3">
                  {builder.items.map((item, index) => (
                    <div
                      key={`${item.type}-${index}`}
                      className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_120px_140px_auto] md:items-center"
                    >
                      <input
                        className="input"
                        type="text"
                        value={item.name}
                        onChange={(event) =>
                          handleUpdateItem(index, { name: event.target.value })
                        }
                        placeholder="Description"
                      />
                      <input
                        className="input"
                        type="number"
                        value={item.price ?? ""}
                        onChange={(event) =>
                          handleUpdateItem(index, {
                            price:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                        placeholder="Price"
                      />
                      <input
                        className="input"
                        type="text"
                        value={item.description || ""}
                        onChange={(event) =>
                          handleUpdateItem(index, {
                            description: event.target.value,
                          })
                        }
                        placeholder="Notes"
                      />
                      <button
                        type="button"
                        className="btn-ghost text-red-600"
                        onClick={() => handleRemoveItem(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Policies & agreements
                </p>
                <p className="text-xs text-slate-500">
                  Attach agreements to the template so the terms page always stays current.
                </p>
              </div>
              <div className="space-y-2">
                {agreements.length === 0 ? (
                  <p className="text-sm text-slate-600">No agreements published yet.</p>
                ) : (
                  agreements.map((agreement) => (
                    <label
                      key={agreement.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 p-3 text-sm"
                    >
                      <span>
                        <span className="font-medium text-slate-900">
                          {agreement.title || agreement.id}
                        </span>
                        {agreement.category && (
                          <span className="ml-2 text-xs uppercase tracking-wide text-slate-400">
                            {agreement.category}
                          </span>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={builder.agreements.includes(agreement.id)}
                        onChange={() => handleToggleAgreement(agreement.id)}
                      />
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                Save to publish the template for the proposal builder. Page numbers and theming follow the styling controls above.
              </div>
              <button
                type="button"
                className="btn"
                onClick={handleSaveTemplate}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Template library</h2>
          <p className="text-sm text-slate-600">
            Review published templates and understand how many pages each preset contains.
          </p>
          {templates.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No templates saved yet.</p>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {templates.map((template) => (
                <div key={template.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{template.name}</p>
                      <p className="text-xs text-slate-500">
                        {findTemplateKindDescriptor(template.category || "")?.label ||
                          template.category ||
                          "Custom"}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                      {template.pages?.length || 0} pages
                    </span>
                  </div>
                  {template.summary && (
                    <p className="mt-2 text-xs text-slate-600">{template.summary}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    {template.brandColor && (
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        Colour: {template.brandColor}
                      </span>
                    )}
                    {Boolean(template.updatedAt) && (
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        Updated {formatDate(template.updatedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PortalContainer>
  );
}

