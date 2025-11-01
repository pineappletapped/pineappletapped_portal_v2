"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
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
  PROPOSAL_PLACEHOLDER_TOKENS,
  allowedTemplateKinds,
  createBlankPage,
  createTemplatePreset,
  defaultTemplateStyling,
  ensurePageElements,
  summarisePageForContents,
  syncPageFieldsFromElements,
  type ProposalTemplateElement,
  type ProposalTemplateElementRole,
  type ProposalTemplateImageElement,
  type ProposalTemplateItem,
  type ProposalTemplateKind,
  type ProposalTemplatePage,
  type ProposalTemplatePageType,
  type ProposalTemplateShapeElement,
  type ProposalTemplateStyling,
  type ProposalTemplateTextElement,
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

const createLocalElementId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `element-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [pageLibraryOpen, setPageLibraryOpen] = useState(false);

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

        let activeBrand = brandGuidelines;
        if (brandingSnap.exists()) {
          const data = brandingSnap.data() as any;
          if (typeof data?.logoUrl === "string") {
            setBrandLogoUrl(data.logoUrl);
          }
          const parsed = parseBrandGuidelines(data?.brandGuidelines);
          activeBrand = parsed;
          setBrandGuidelines(parsed);
          setBuilder((prev) => {
            const nextPages = prev.pages.length
              ? prev.pages.map((page) => ensurePageElements(page, { brand: parsed }))
              : [];
            return {
              ...createInitialBuilderState(parsed),
              name: prev.name,
              summary: prev.summary,
              kind: prev.kind,
              baseProductId: prev.baseProductId,
              pages: nextPages,
              items: prev.items,
              agreements: prev.agreements,
              metadata: prev.metadata,
            };
          });
        }

        const templateRecords = templateSnap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            name: normaliseString(data?.name) || docSnap.id,
            category: normaliseString(data?.category) || undefined,
            summary: normaliseString(data?.summary) || null,
            pages: Array.isArray(data?.pages)
              ? (data.pages as ProposalTemplatePage[]).map((page) =>
                  ensurePageElements(page, { brand: activeBrand }),
                )
              : [],
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
    setBuilder((prev) => {
      const next: BuilderState = { ...prev, ...updates } as BuilderState;
      if (updates.pages) {
        next.pages = updates.pages.map((page) =>
          syncPageFieldsFromElements(
            Array.isArray(page.elements) && page.elements.length
              ? page
              : ensurePageElements(page, { brand: brandGuidelines }),
          ),
        );
      }
      return next;
    });
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
    setBuilder((prev) => {
      const nextPages = [...prev.pages, newPage].map((page) =>
        syncPageFieldsFromElements(page),
      );
      return {
        ...prev,
        pages: nextPages,
      };
    });
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
      pages: prev.pages.map((page) => {
        if (page.id !== id) return page;
        const merged = { ...page, ...updates } as ProposalTemplatePage;
        const ensured =
          Array.isArray(merged.elements) && merged.elements.length
            ? merged
            : ensurePageElements(merged, { brand: brandGuidelines });
        return syncPageFieldsFromElements(ensured);
      }),
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

  useEffect(() => {
    setSelectedElementId(null);
  }, [activePageId]);

  const updateActivePageElements = (
    mutate: (elements: ProposalTemplateElement[]) => ProposalTemplateElement[],
  ) => {
    if (!activePage) return;
    setBuilder((prev) => ({
      ...prev,
      pages: prev.pages.map((page) => {
        if (page.id !== activePage.id) return page;
        const existing = Array.isArray(page.elements) ? [...page.elements] : [];
        const nextElements = mutate(existing).map((element, index) => ({
          ...element,
          order: element.order ?? index,
        }));
        return syncPageFieldsFromElements({
          ...page,
          elements: nextElements,
        });
      }),
    }));
  };

  const handleSelectElement = (id: string | null) => {
    setSelectedElementId(id);
  };

  const handleAddElement = (
    type: "text" | "placeholder" | "image" | "shape",
    options?: { token?: string },
  ) => {
    if (!activePage) return;
    updateActivePageElements((elements) => {
      const positionOffset = elements.length * 8;
      if (type === "image") {
        const image: ProposalTemplateImageElement = {
          id: createLocalElementId(),
          type: "image",
          url: "",
          fit: "cover",
          borderRadius: 12,
          x: 55,
          y: 20 + positionOffset,
          width: 30,
          height: 30,
          rotation: 0,
          order: elements.length,
        };
        return [...elements, image];
      }
      if (type === "shape") {
        const shape: ProposalTemplateShapeElement = {
          id: createLocalElementId(),
          type: "shape",
          shape: "rectangle",
          fill: brandGuidelines.colors?.secondary || "#6366F1",
          opacity: 0.2,
          borderRadius: 16,
          x: 8,
          y: 18 + positionOffset,
          width: 84,
          height: 20,
          rotation: 0,
          order: elements.length,
        };
        return [...elements, shape];
      }

      const baseText: ProposalTemplateTextElement = {
        id: createLocalElementId(),
        type,
        role: type === "text" ? "custom" : "body",
        content:
          type === "placeholder"
            ? options?.token || "{{clientName}}"
            : type === "text"
              ? "Double-click to edit"
              : "",
        placeholderToken: type === "placeholder" ? options?.token || "{{clientName}}" : null,
        fontSize: type === "text" ? 24 : 20,
        fontWeight: type === "text" ? "medium" : "regular",
        align: "left",
        color: "#111827",
        lineHeight: 1.4,
        x: 10,
        y: 18 + positionOffset,
        width: 80,
        height: 12,
        rotation: 0,
        order: elements.length,
      };
      return [...elements, baseText];
    });
  };

  const handleUpdateElement = (
    elementId: string,
    updates:
      | Partial<ProposalTemplateTextElement>
      | Partial<ProposalTemplateImageElement>
      | Partial<ProposalTemplateShapeElement>,
  ) => {
    updateActivePageElements((elements) =>
      elements.map((element) =>
        element.id === elementId
          ? ({
              ...element,
              ...updates,
            } as ProposalTemplateElement)
          : element,
      ),
    );
  };

  const handleRemoveElement = (elementId: string) => {
    updateActivePageElements((elements) =>
      elements.filter((element) => element.id !== elementId),
    );
    if (selectedElementId === elementId) {
      setSelectedElementId(null);
    }
  };

  const handleDuplicateElement = (elementId: string) => {
    updateActivePageElements((elements) => {
      const index = elements.findIndex((element) => element.id === elementId);
      if (index === -1) return elements;
      const original = elements[index];
      const clone: ProposalTemplateElement = {
        ...original,
        id: createLocalElementId(),
        x: Math.min(original.x + 4, 90),
        y: Math.min(original.y + 6, 90),
        order: elements.length,
      } as ProposalTemplateElement;
      return [...elements, clone];
    });
  };

  const activePageElements = activePage?.elements ?? [];
  const selectedElement = activePageElements.find(
    (element) => element.id === selectedElementId,
  );

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
          pages: Array.isArray(data?.pages)
            ? (data.pages as ProposalTemplatePage[]).map((page) =>
                ensurePageElements(page, { brand: brandGuidelines }),
              )
            : [],
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Pages</h3>
          <p className="text-xs text-slate-500">Organise the flow of your proposal.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageLibraryOpen((prev) => !prev)}
            className="btn"
          >
            {pageLibraryOpen ? "Close library" : "Add page"}
          </button>
          <button
            type="button"
            onClick={regenerateFromPreset}
            className="btn-outline"
          >
            Use preset
          </button>
        </div>
      </div>
      {pageLibraryOpen && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Page library
          </p>
          <div className="grid gap-3">
            {PAGE_LIBRARY.map((entry) => (
              <button
                type="button"
                key={entry.type}
                onClick={() => {
                  handleAddPage(entry.type);
                  setPageLibraryOpen(false);
                }}
                className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-slate-900/50 hover:shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{entry.label}</p>
                <p className="mt-1 text-xs text-slate-500">{entry.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
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
                    "flex items-center justify-between rounded-2xl border px-3 py-2",
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
                    <span className="text-[13px] font-semibold text-slate-900">
                      {index + 1}. {label}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {page.title?.trim() ? page.title : "Untitled page"}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
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


  const renderPageEditor = () => {
    if (!activePage) {
      return (
        <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          Select or add a page to edit its layout and content.
        </div>
      );
    }

    const layoutOptions = TEMPLATE_LAYOUT_OPTIONS;
    const pageIndex = builder.pages.findIndex((page) => page.id === activePage.id);
    const aspectClass =
      activePage.canvas?.aspectRatio === "4:3" ? "aspect-[4/3]" : "aspect-[16/9]";
    const accentColor =
      builder.styling.accentColor ||
      brandGuidelines.colors?.secondary ||
      DEFAULT_BRAND_GUIDELINES.colors.secondary;
    const secondaryColor =
      builder.styling.secondaryColor ||
      brandGuidelines.colors?.accent ||
      DEFAULT_BRAND_GUIDELINES.colors.accent;

    const canvasBackground: CSSProperties =
      builder.styling.background === "gradient"
        ? {
            backgroundImage: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`,
          }
        : builder.styling.background === "texture"
          ? {
              backgroundImage: `linear-gradient(135deg, ${accentColor}1a 25%, transparent 25%, transparent 50%, ${accentColor}1a 50%, ${accentColor}1a 75%, transparent 75%, transparent)`,
              backgroundSize: "24px 24px",
              backgroundColor: activePage.canvas?.backgroundColor || "#ffffff",
            }
          : { backgroundColor: activePage.canvas?.backgroundColor || "#ffffff" };

    const elementRoleOptions: { value: ProposalTemplateElementRole; label: string }[] = [
      { value: "title", label: "Title" },
      { value: "subtitle", label: "Subtitle" },
      { value: "body", label: "Body" },
      { value: "list", label: "List" },
      { value: "notes", label: "Notes" },
      { value: "custom", label: "Custom" },
    ];

    const textWeight = (weight: ProposalTemplateTextElement["fontWeight"]): number => {
      switch (weight) {
        case "bold":
          return 700;
        case "medium":
          return 600;
        default:
          return 400;
      }
    };

    const renderElement = (element: ProposalTemplateElement) => {
      const baseStyle: CSSProperties = {
        left: `${element.x}%`,
        top: `${element.y}%`,
        width: `${element.width}%`,
        minHeight: `${element.height}%`,
        transform: `rotate(${element.rotation ?? 0}deg)`,
        zIndex: element.order ?? 0,
      };

      const wrapperClass = clsx(
        "absolute cursor-pointer rounded-xl border border-transparent shadow-sm transition focus-visible:outline-none",
        selectedElementId === element.id
          ? "ring-2 ring-indigo-500"
          : "hover:ring-2 hover:ring-indigo-400",
      );

      if (element.type === "shape") {
        const shape = element as ProposalTemplateShapeElement;
        return (
          <div
            key={element.id}
            className={clsx(wrapperClass, "overflow-hidden")}
            style={baseStyle}
            onClick={(event) => {
              event.stopPropagation();
              handleSelectElement(element.id);
            }}
          >
            <div
              className="h-full w-full"
              style={{
                backgroundColor: shape.fill,
                opacity: shape.opacity,
                borderRadius:
                  shape.shape === "pill"
                    ? 999
                    : shape.shape === "rounded"
                      ? shape.borderRadius || 16
                      : shape.borderRadius || 12,
              }}
            />
          </div>
        );
      }

      if (element.type === "image") {
        const image = element as ProposalTemplateImageElement;
        return (
          <div
            key={element.id}
            className={clsx(wrapperClass, "overflow-hidden bg-slate-100")}
            style={baseStyle}
            onClick={(event) => {
              event.stopPropagation();
              handleSelectElement(element.id);
            }}
          >
            {image.url ? (
              <img
                src={image.url}
                alt="Proposal element"
                className={clsx(
                  "h-full w-full object-cover",
                  image.fit === "contain" && "object-contain",
                )}
                style={{ borderRadius: image.borderRadius }}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-white/80 px-3 py-1">Image placeholder</span>
                <span>Add a URL from the toolbar</span>
              </div>
            )}
          </div>
        );
      }

      const text = element as ProposalTemplateTextElement;
      return (
        <div
          key={element.id}
          className={clsx(wrapperClass, "bg-white/70 backdrop-blur")}
          style={baseStyle}
          onClick={(event) => {
            event.stopPropagation();
            handleSelectElement(element.id);
          }}
        >
          <div
            contentEditable
            suppressContentEditableWarning
            className="h-full w-full rounded-lg px-3 py-2 text-left text-sm outline-none"
            style={{
              fontSize: `${text.fontSize}px`,
              fontWeight: textWeight(text.fontWeight),
              color: text.color,
              lineHeight: text.lineHeight,
              textAlign: text.align,
            }}
            onBlur={(event) =>
              handleUpdateElement(element.id, {
                content: event.currentTarget.innerText,
              })
            }
            onFocus={() => handleSelectElement(element.id)}
          >
            {text.type === "placeholder"
              ? text.placeholderToken || text.content
              : text.content}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Page {pageIndex + 1} of {builder.pages.length}
              </p>
              <h3 className="text-lg font-semibold text-slate-900">
                {PAGE_TYPE_LABELS[activePage.type] || "Page"}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Layout
                <select
                  className="input mt-1"
                  value={activePage.layout}
                  onChange={(event) =>
                    handleUpdatePage(activePage.id, {
                      layout: event.target.value as ProposalTemplatePage["layout"],
                    })
                  }
                >
                  {layoutOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={activePage.includeInContents !== false}
                  onChange={(event) =>
                    handleUpdatePage(activePage.id, {
                      includeInContents: event.target.checked,
                    })
                  }
                />
                Include in contents
              </label>
              {activePage.type === "contents" && (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={activePage.autoContents !== false}
                    onChange={(event) =>
                      handleUpdatePage(activePage.id, {
                        autoContents: event.target.checked,
                      })
                    }
                  />
                  Auto-generate
                </label>
              )}
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Aspect ratio
                <select
                  className="input mt-1"
                  value={activePage.canvas?.aspectRatio || "16:9"}
                  onChange={(event) =>
                    handleUpdatePage(activePage.id, {
                      canvas: {
                        aspectRatio: event.target.value as "16:9" | "4:3",
                        padding: activePage.canvas?.padding,
                        backgroundColor: activePage.canvas?.backgroundColor,
                      },
                    })
                  }
                >
                  <option value="16:9">16:9</option>
                  <option value="4:3">4:3</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Canvas colour
                <input
                  className="input mt-1"
                  type="color"
                  value={activePage.canvas?.backgroundColor || "#ffffff"}
                  onChange={(event) =>
                    handleUpdatePage(activePage.id, {
                      canvas: {
                        aspectRatio: activePage.canvas?.aspectRatio || "16:9",
                        padding: activePage.canvas?.padding,
                        backgroundColor: event.target.value,
                      },
                    })
                  }
                />
              </label>
            </div>
          </div>

          <div className="mt-6 rounded-3xl bg-slate-900/5 p-6">
            <div
              className={clsx(
                "relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 shadow-xl",
                aspectClass,
              )}
              style={canvasBackground}
              onClick={() => handleSelectElement(null)}
            >
              <div className="absolute inset-0">
                {activePageElements.length === 0 && (
                  <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                    Add elements below to start designing this page.
                  </div>
                )}
                {activePageElements.map((element) => renderElement(element))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Element options
            </p>
            {selectedElement && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => handleDuplicateElement(selectedElement.id)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn-ghost text-red-600"
                  onClick={() => handleRemoveElement(selectedElement.id)}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          {!selectedElement ? (
            <p className="mt-3 text-sm text-slate-600">
              Select an element on the canvas to adjust typography, colour, and placement.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(["x", "y", "width", "height"] as const).map((dimension) => (
                  <label
                    key={dimension}
                    className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {dimension === "x"
                      ? "Left %"
                      : dimension === "y"
                        ? "Top %"
                        : dimension === "width"
                          ? "Width %"
                          : "Height %"}
                    <input
                      className="input mt-1"
                      type="number"
                      value={Number((selectedElement as any)[dimension] ?? 0)}
                      onChange={(event) =>
                        handleUpdateElement(selectedElement.id, {
                          [dimension]: Number(event.target.value),
                        } as any)
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Rotation°
                  <input
                    className="input mt-1"
                    type="number"
                    value={Number(selectedElement.rotation ?? 0)}
                    onChange={(event) =>
                      handleUpdateElement(selectedElement.id, {
                        rotation: Number(event.target.value),
                      } as any)
                    }
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Layer order
                  <input
                    className="input mt-1"
                    type="number"
                    value={Number(selectedElement.order ?? 0)}
                    onChange={(event) =>
                      handleUpdateElement(selectedElement.id, {
                        order: Number(event.target.value),
                      } as any)
                    }
                  />
                </label>
              </div>

              {selectedElement.type !== "shape" && selectedElement.type !== "image" && (
                <Fragment>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Font size
                      <input
                        className="input mt-1"
                        type="number"
                        value={(selectedElement as ProposalTemplateTextElement).fontSize}
                        onChange={(event) =>
                          handleUpdateElement(selectedElement.id, {
                            fontSize: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Line height
                      <input
                        className="input mt-1"
                        type="number"
                        step="0.05"
                        value={(selectedElement as ProposalTemplateTextElement).lineHeight}
                        onChange={(event) =>
                          handleUpdateElement(selectedElement.id, {
                            lineHeight: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Font weight
                      <select
                        className="input mt-1"
                        value={(selectedElement as ProposalTemplateTextElement).fontWeight}
                        onChange={(event) =>
                          handleUpdateElement(selectedElement.id, {
                            fontWeight: event.target.value as ProposalTemplateTextElement["fontWeight"],
                          })
                        }
                      >
                        <option value="regular">Regular</option>
                        <option value="medium">Medium</option>
                        <option value="bold">Bold</option>
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Text colour
                      <input
                        className="input mt-1"
                        type="color"
                        value={(selectedElement as ProposalTemplateTextElement).color}
                        onChange={(event) =>
                          handleUpdateElement(selectedElement.id, {
                            color: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(["left", "center", "right"] as const).map((alignment) => (
                        <button
                          key={alignment}
                          type="button"
                        className={clsx(
                          "btn-ghost px-3 py-1 text-xs",
                          (selectedElement as ProposalTemplateTextElement).align === alignment &&
                            "bg-slate-900 text-white",
                        )}
                        onClick={() =>
                          handleUpdateElement(selectedElement.id, { align: alignment })
                        }
                      >
                        {alignment}
                      </button>
                      ))}
                    </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Element role
                      <select
                        className="input mt-1"
                        value={(selectedElement as ProposalTemplateTextElement).role || "custom"}
                        onChange={(event) =>
                          handleUpdateElement(selectedElement.id, {
                            role: event.target.value as ProposalTemplateElementRole,
                          })
                        }
                      >
                        {elementRoleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedElement.type === "placeholder" && (
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Placeholder token
                        <select
                          className="input mt-1"
                          value={
                            (selectedElement as ProposalTemplateTextElement).placeholderToken ||
                            ""
                          }
                          onChange={(event) =>
                            handleUpdateElement(selectedElement.id, {
                              placeholderToken: event.target.value,
                              content: event.target.value,
                            })
                          }
                        >
                          {PROPOSAL_PLACEHOLDER_TOKENS.map((token) => (
                            <option key={token.token} value={token.token}>
                              {token.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </Fragment>
              )}

              {selectedElement.type === "image" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Image URL
                    <input
                      className="input mt-1"
                      type="url"
                      value={(selectedElement as ProposalTemplateImageElement).url}
                      onChange={(event) =>
                        handleUpdateElement(selectedElement.id, {
                          url: event.target.value,
                        })
                      }
                      placeholder="https://example.com/image.jpg"
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Fit
                    <select
                      className="input mt-1"
                      value={(selectedElement as ProposalTemplateImageElement).fit}
                      onChange={(event) =>
                        handleUpdateElement(selectedElement.id, {
                          fit: event.target.value as ProposalTemplateImageElement["fit"],
                        })
                      }
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Border radius
                    <input
                      className="input mt-1"
                      type="number"
                      value={(selectedElement as ProposalTemplateImageElement).borderRadius}
                      onChange={(event) =>
                        handleUpdateElement(selectedElement.id, {
                          borderRadius: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}

              {selectedElement.type === "shape" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Fill colour
                    <input
                      className="input mt-1"
                      type="color"
                      value={(selectedElement as ProposalTemplateShapeElement).fill}
                      onChange={(event) =>
                        handleUpdateElement(selectedElement.id, {
                          fill: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Opacity
                    <input
                      className="input mt-1"
                      type="number"
                      step="0.05"
                      value={(selectedElement as ProposalTemplateShapeElement).opacity}
                      onChange={(event) =>
                        handleUpdateElement(selectedElement.id, {
                          opacity: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Add elements
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-outline" onClick={() => handleAddElement("text")}>
              Text box
            </button>
            <div className="relative">
              <select
                className="input pr-8"
                onChange={(event) => {
                  if (!event.target.value) return;
                  handleAddElement("placeholder", { token: event.target.value });
                  event.target.value = "";
                }}
              >
                <option value="">Placeholder token…</option>
                {PROPOSAL_PLACEHOLDER_TOKENS.map((token) => (
                  <option key={token.token} value={token.token}>
                    {token.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-outline" onClick={() => handleAddElement("image")}>
              Image
            </button>
            <button type="button" className="btn-outline" onClick={() => handleAddElement("shape")}>
              Shape
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Tokens pull live client, project, and pricing details into the proposal. Shapes and text help you
            storyboard the slide before export.
          </p>
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

        <section className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              {renderPageList()}
            </div>
          </aside>

          <div className="space-y-6">
            {renderPageEditor()}

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

