"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { db, storage, functions } from "@/lib/firebase";
import { collection, addDoc, getDocs, updateDoc, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import type {
  ProductTask,
  ProductDeliverable,
  DeliverableType,
  ProductSEO,
  ProductVariation,
  ProductVideoLink,
  ProductSpec,
  ProductCrewRole,
  CrewRoleTemplate,
  ProductBudgetOverride,
  ProductCrewRoleOverride,
  ProductModifierSelection,
} from "@/lib/products";
import type { PriceTiers } from "@/lib/pricing";
import type { Venue } from "@/lib/venues";
import type { IconType } from "react-icons";
import {
  FiCheck,
  FiFilm,
  FiSmartphone,
  FiCamera,
  FiGrid,
  FiImage,
  FiMusic,
  FiFileText,
} from "react-icons/fi";
import type { Category } from "@/lib/categories";
import VenueMap from "@/components/VenueMap";
import { useRoleGate } from "@/hooks/useRoleGate";

const ReactQuill = dynamic(() => import("react-quill"), { ssr: false });
import "react-quill/dist/quill.snow.css";

const PRODUCT_IMAGE_ROOT = "Product_Images";

interface ModifierCrewAdjustment {
  templateId: string;
  quantity?: number | null;
  unitRate?: number | null;
  includeInBudget?: boolean | null;
}

interface ModifierOption {
  id: string;
  name: string;
  price: number;
  priceTiers?: PriceTiers | null;
  budgetAdjustments?: ProductBudgetOverride | null;
  crewAdjustments?: ModifierCrewAdjustment[] | null;
}

interface ModifierGroup {
  id: string;
  name: string;
  multiple: boolean;
  options: ModifierOption[];
}

const deliveryOptions = [
  "Same Day",
  "Next Day",
  "48hr",
  ...Array.from({ length: 28 }, (_, i) => `${i + 3} days`),
];

const presetTasks: ProductTask[] = [
  { title: "Customer Logo", forCustomer: true },
  { title: "Customer Brand Colours", forCustomer: true },
];

const DELIVERABLE_TYPES: { value: DeliverableType; label: string }[] = [
  { value: "long-form-video", label: "Long Form Video" },
  { value: "short-form-vertical", label: "Short Form (Vertical)" },
  { value: "photo", label: "Photo" },
  { value: "photo-set", label: "Photo Set" },
  { value: "thumbnail", label: "Thumbnail" },
  { value: "audio-licence", label: "Audio Licence" },
  { value: "document", label: "Document" },
];

const deliverableIcons: Record<DeliverableType, IconType> = {
  "long-form-video": FiFilm,
  "short-form-vertical": FiSmartphone,
  photo: FiCamera,
  "photo-set": FiGrid,
  thumbnail: FiImage,
  "audio-licence": FiMusic,
  document: FiFileText,
};

type ExampleVideoInput = {
  id: string;
  title: string;
  url: string;
};

const createVideoInput = (defaults?: Partial<ExampleVideoInput>): ExampleVideoInput => {
  const randomId =
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: randomId,
    title: defaults?.title ?? "",
    url: defaults?.url ?? "",
  };
};

type CrewRoleFormState = {
  id: string;
  templateId: string | null;
  name: string;
  description: string;
  instructions: string;
  quantity: string;
  unitRate: string;
  includeInBudget: boolean;
};

type ProductSpecFormState = {
  overview: string;
  preparation: string;
  filming: string;
  editing: string;
  delivery: string;
  notes: string;
};

const createCrewRoleInput = (
  defaults?: Partial<CrewRoleFormState>
): CrewRoleFormState => {
  const randomId =
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: defaults?.id ?? randomId,
    templateId: defaults?.templateId ?? null,
    name: defaults?.name ?? "",
    description: defaults?.description ?? "",
    instructions: defaults?.instructions ?? "",
    quantity: defaults?.quantity ?? "1",
    unitRate: defaults?.unitRate ?? "",
    includeInBudget: defaults?.includeInBudget ?? true,
  };
};

const normaliseNumberString = (value: unknown, fallback: string): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return fallback;
};

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
};

const parseRoleQuantity = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : 1;
};

const generateFormId = () =>
  typeof globalThis !== "undefined" &&
  (globalThis.crypto?.randomUUID?.() as string | undefined)
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type BudgetOverrideFormState = {
  labourFilming: string;
  labourEditing: string;
  kitManual: string;
  kit: string;
  kitMode: "" | "manual" | "guided";
  travelMiles: string;
  travelRate: string;
  travelCost: string;
  parking: string;
};

const emptyBudgetForm: BudgetOverrideFormState = {
  labourFilming: "",
  labourEditing: "",
  kitManual: "",
  kit: "",
  kitMode: "",
  travelMiles: "",
  travelRate: "",
  travelCost: "",
  parking: "",
};

const parseNumberInput = (value: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const createBudgetForm = (
  source?: ProductBudgetOverride | null
): BudgetOverrideFormState => ({
  labourFilming:
    typeof source?.labourFilming === "number" &&
    Number.isFinite(source.labourFilming)
      ? String(source.labourFilming)
      : "",
  labourEditing:
    typeof source?.labourEditing === "number" &&
    Number.isFinite(source.labourEditing)
      ? String(source.labourEditing)
      : "",
  kitManual:
    typeof source?.kitManual === "number" && Number.isFinite(source.kitManual)
      ? String(source.kitManual)
      : "",
  kit:
    typeof source?.kit === "number" && Number.isFinite(source.kit)
      ? String(source.kit)
      : "",
  kitMode:
    source?.kitMode === "manual" || source?.kitMode === "guided"
      ? source.kitMode
      : "",
  travelMiles:
    typeof source?.travelMiles === "number" &&
    Number.isFinite(source.travelMiles)
      ? String(source.travelMiles)
      : "",
  travelRate:
    typeof source?.travelRate === "number" &&
    Number.isFinite(source.travelRate)
      ? String(source.travelRate)
      : "",
  travelCost:
    typeof source?.travelCost === "number" &&
    Number.isFinite(source.travelCost)
      ? String(source.travelCost)
      : "",
  parking:
    typeof source?.parking === "number" && Number.isFinite(source.parking)
      ? String(source.parking)
      : "",
});

const parseBudgetFormToOverride = (
  form: BudgetOverrideFormState
): ProductBudgetOverride | undefined => {
  const payload: ProductBudgetOverride = {};
  const labourFilming = parseNumberInput(form.labourFilming);
  if (labourFilming !== undefined) payload.labourFilming = labourFilming;
  const labourEditing = parseNumberInput(form.labourEditing);
  if (labourEditing !== undefined) payload.labourEditing = labourEditing;
  const kitManual = parseNumberInput(form.kitManual);
  if (kitManual !== undefined) payload.kitManual = kitManual;
  const kit = parseNumberInput(form.kit);
  if (kit !== undefined) payload.kit = kit;
  if (form.kitMode === "manual" || form.kitMode === "guided") {
    payload.kitMode = form.kitMode;
  }
  const travelMiles = parseNumberInput(form.travelMiles);
  if (travelMiles !== undefined) payload.travelMiles = travelMiles;
  const travelRate = parseNumberInput(form.travelRate);
  if (travelRate !== undefined) payload.travelRate = travelRate;
  const travelCost = parseNumberInput(form.travelCost);
  if (travelCost !== undefined) payload.travelCost = travelCost;
  const parking = parseNumberInput(form.parking);
  if (parking !== undefined) payload.parking = parking;
  return Object.keys(payload).length ? payload : undefined;
};

type CrewOverrideFormState = {
  quantity: string;
  unitRate: string;
  includeInBudget: "inherit" | "include" | "exclude";
};

const defaultCrewOverrideForm: CrewOverrideFormState = {
  quantity: "",
  unitRate: "",
  includeInBudget: "inherit",
};

const createCrewOverrideMap = (
  crewRoles: CrewRoleFormState[],
  overrides?: ProductCrewRoleOverride[] | null
): Record<string, CrewOverrideFormState> => {
  const map: Record<string, CrewOverrideFormState> = {};
  const overrideLookup = new Map<string, ProductCrewRoleOverride>();
  (overrides || []).forEach((entry) => {
    if (entry && typeof entry.roleId === "string") {
      overrideLookup.set(entry.roleId, entry);
    }
  });
  crewRoles.forEach((role) => {
    const existing = overrideLookup.get(role.id);
    map[role.id] = {
      quantity:
        typeof existing?.quantity === "number" &&
        Number.isFinite(existing.quantity)
          ? String(existing.quantity)
          : "",
      unitRate:
        typeof existing?.unitRate === "number" &&
        Number.isFinite(existing.unitRate)
          ? String(existing.unitRate)
          : "",
      includeInBudget:
        existing?.includeInBudget === true
          ? "include"
          : existing?.includeInBudget === false
          ? "exclude"
          : "inherit",
    };
  });
  return map;
};

const syncCrewOverrideMap = (
  current: Record<string, CrewOverrideFormState>,
  crewRoles: CrewRoleFormState[]
): Record<string, CrewOverrideFormState> => {
  const next: Record<string, CrewOverrideFormState> = {};
  crewRoles.forEach((role) => {
    next[role.id] = current[role.id]
      ? current[role.id]
      : { ...defaultCrewOverrideForm };
  });
  return next;
};

const parseCrewOverrideMap = (
  map: Record<string, CrewOverrideFormState>
): ProductCrewRoleOverride[] => {
  return Object.entries(map)
    .map(([roleId, entry]) => {
      const quantity = parseNumberInput(entry.quantity);
      const unitRate = parseNumberInput(entry.unitRate);
      const include =
        entry.includeInBudget === "inherit"
          ? undefined
          : entry.includeInBudget === "include";
      if (
        quantity === undefined &&
        unitRate === undefined &&
        include === undefined
      ) {
        return null;
      }
      const payload: ProductCrewRoleOverride = { roleId };
      if (quantity !== undefined) payload.quantity = quantity;
      if (unitRate !== undefined) payload.unitRate = unitRate;
      if (include !== undefined) payload.includeInBudget = include;
      return payload;
    })
    .filter(
      (entry): entry is ProductCrewRoleOverride => entry !== null
    );
};

const applyTemplateAdjustmentsToOverrides = (
  overrides: Record<string, CrewOverrideFormState>,
  crewRoles: CrewRoleFormState[],
  adjustments: ModifierCrewAdjustment[]
) => {
  if (!Array.isArray(adjustments) || adjustments.length === 0) return;
  const templateLookup = new Map<string, CrewRoleFormState>();
  crewRoles.forEach((role) => {
    if (role.templateId) templateLookup.set(role.templateId, role);
  });
  adjustments.forEach((adjustment) => {
    if (!adjustment || typeof adjustment.templateId !== "string") return;
    const role = templateLookup.get(adjustment.templateId);
    if (!role) return;
    const entry = overrides[role.id] || { ...defaultCrewOverrideForm };
    overrides[role.id] = entry;
    if (
      !entry.quantity &&
      typeof adjustment.quantity === "number" &&
      Number.isFinite(adjustment.quantity)
    ) {
      entry.quantity = String(adjustment.quantity);
    }
    if (
      !entry.unitRate &&
      typeof adjustment.unitRate === "number" &&
      Number.isFinite(adjustment.unitRate)
    ) {
      entry.unitRate = String(adjustment.unitRate);
    }
    if (
      entry.includeInBudget === "inherit" &&
      typeof adjustment.includeInBudget === "boolean"
    ) {
      entry.includeInBudget = adjustment.includeInBudget ? "include" : "exclude";
    }
  });
};

const computeMissingTemplates = (
  crewRoles: CrewRoleFormState[],
  adjustments: ModifierCrewAdjustment[]
): string[] => {
  if (!Array.isArray(adjustments) || adjustments.length === 0) return [];
  const availableTemplates = new Set(
    crewRoles
      .map((role) => role.templateId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  return adjustments
    .map((adj) => adj?.templateId)
    .filter(
      (templateId): templateId is string =>
        typeof templateId === "string" && templateId.length > 0
    )
    .filter((templateId) => !availableTemplates.has(templateId));
};

type VariationFormState = {
  id: string;
  name: string;
  price: string;
  tier2Price: string;
  tier3Price: string;
  featuresText: string;
  budgetOverrides: BudgetOverrideFormState;
  crewOverrides: Record<string, CrewOverrideFormState>;
};

type ModifierSelectionFormState = {
  groupId: string;
  optionId: string;
  price: string;
  tier2Price: string;
  tier3Price: string;
  budgetOverrides: BudgetOverrideFormState;
  crewOverrides: Record<string, CrewOverrideFormState>;
  templateAdjustments: ModifierCrewAdjustment[];
  missingTemplates: string[];
};

export default function NewProductPage() {
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<Category[]>([]);
  const [allModifiers, setAllModifiers] = useState<ModifierGroup[]>([]);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);

  const [tab, setTab] = useState<
    | "info"
    | "spec"
    | "pnl"
    | "variations"
    | "deliverables"
    | "kit"
    | "tasks"
    | "seo"
    | "modifiers"
    | "drive"
  >("info");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagline, setTagline] = useState("");
  const [price, setPrice] = useState("0");
  const [priceTier2, setPriceTier2] = useState("");
  const [priceTier3, setPriceTier3] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [requirements, setRequirements] = useState("");
  const [operationsInfo, setOperationsInfo] = useState("");
  const [deliveryIndex, setDeliveryIndex] = useState(0);
  const [deliverables, setDeliverables] = useState<
    (ProductDeliverable & { file?: File })[]
  >([]);
  const [variations, setVariations] = useState<VariationFormState[]>([]);
  useEffect(() => {
    setDeliverables((prev) => {
      if (prev.length === 0) return prev;
      const allowed = new Set(variations.map((variation) => variation.id));
      let changed = false;
      const next = prev.map((deliverable) => {
        if (!Array.isArray(deliverable.variationIds)) return deliverable;
        const filtered = deliverable.variationIds.filter((id) =>
          allowed.has(id)
        );
        if (filtered.length === deliverable.variationIds.length) {
          return deliverable;
        }
        changed = true;
        if (filtered.length === 0) {
          const clone = { ...deliverable };
          delete clone.variationIds;
          return clone;
        }
        return { ...deliverable, variationIds: filtered };
      });
      return changed ? next : prev;
    });
  }, [variations]);
  const [modifiers, setModifiers] = useState<ModifierSelectionFormState[]>([]);
  const [enabledModifierGroups, setEnabledModifierGroups] = useState<string[]>([]);
  const [seo, setSeo] = useState<ProductSEO>({});
  const [seoImageFile, setSeoImageFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venueId, setVenueId] = useState("");
  const [venue, setVenue] = useState("");
  const [hidden, setHidden] = useState(false);
  const [driveTemplateFolderId, setDriveTemplateFolderId] = useState("");
  const [driveFolderName, setDriveFolderName] = useState("");
  const [labourFilmingRate, setLabourFilmingRate] = useState("0");
  const [labourEditingRate, setLabourEditingRate] = useState("0");
  const [kitCostMode, setKitCostMode] = useState<"manual" | "guided">("manual");
  const [manualKitCost, setManualKitCost] = useState("0");
  const [travelMiles, setTravelMiles] = useState("100");
  const [travelRate, setTravelRate] = useState("0.3");
  const [parkingCost, setParkingCost] = useState("0");
  const [travelMilesTouched, setTravelMilesTouched] = useState(false);
  const [parkingTouched, setParkingTouched] = useState(false);
  const [exampleVideos, setExampleVideos] = useState<ExampleVideoInput[]>([]);
  const [productSpec, setProductSpec] = useState<ProductSpecFormState>({
    overview: "",
    preparation: "",
    filming: "",
    editing: "",
    delivery: "",
    notes: "",
  });
  const [crewRoles, setCrewRoles] = useState<CrewRoleFormState[]>([]);
  const [crewRoleTemplates, setCrewRoleTemplates] = useState<CrewRoleTemplate[]>([]);
  const [roleLibraryMessage, setRoleLibraryMessage] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const selectedVenue = useMemo(
    () => venues.find((v) => v.id === venueId) || null,
    [venues, venueId]
  );
  const parseMoney = (value: string, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };
  const formatCurrency = (value: number) =>
    `£${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  const parseOptionalPrice = (value: string): number | null => {
    if (!value || value.trim().length === 0) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const buildPriceTierPayload = (
    tier1: number | null,
    tier2: string,
    tier3: string
  ): PriceTiers => {
    const tiers: PriceTiers = {};
    if (tier1 !== null) {
      tiers.tier1 = tier1;
    }
    const parsedTier2 = parseOptionalPrice(tier2);
    if (parsedTier2 !== null) tiers.tier2 = parsedTier2;
    const parsedTier3 = parseOptionalPrice(tier3);
    if (parsedTier3 !== null) tiers.tier3 = parsedTier3;
    return tiers;
  };
  const computeRoleCost = (role: CrewRoleFormState) => {
    const quantity = Number(role.quantity);
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    const rate = parseMoney(role.unitRate, 0);
    return qty * rate;
  };
  const addCrewRole = () => {
    setCrewRoles((prev) => [...prev, createCrewRoleInput()]);
    setRoleLibraryMessage(null);
  };
  const updateCrewRole = (index: number, patch: Partial<CrewRoleFormState>) => {
    setCrewRoles((prev) =>
      prev.map((role, i) => (i === index ? { ...role, ...patch } : role))
    );
    setRoleLibraryMessage(null);
  };
  const removeCrewRole = (index: number) => {
    setCrewRoles((prev) => prev.filter((_, i) => i !== index));
    setRoleLibraryMessage(null);
  };
  const handleCrewRoleTemplateChange = (index: number, templateId: string) => {
    setCrewRoles((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      if (!templateId) {
        next[index] = { ...current, templateId: null };
        return next;
      }
      const template = crewRoleTemplates.find((t) => t.id === templateId);
      if (!template) {
        next[index] = { ...current, templateId: null };
        return next;
      }
      next[index] = {
        ...current,
        templateId,
        name: template.name,
        description: template.description ?? "",
        instructions: template.instructions ?? "",
        quantity: normaliseNumberString(
          template.defaultQuantity,
          current.quantity || "1"
        ),
        unitRate: normaliseNumberString(
          template.defaultRate,
          current.unitRate || ""
        ),
        includeInBudget:
          template.defaultIncludeInBudget === false ? false : true,
      };
      return next;
    });
    setRoleLibraryMessage(null);
  };
  const handleSaveRoleAsTemplate = async (index: number) => {
    const role = crewRoles[index];
    if (!role) return;
    const name = role.name.trim();
    if (!name) {
      setRoleLibraryMessage({
        tone: "error",
        text: "Add a role name before saving it to the library.",
      });
      return;
    }
    try {
      const quantity = parseRoleQuantity(role.quantity);
      const rateInput = role.unitRate.trim();
      const parsedRate = rateInput ? parseMoney(rateInput, 0) : 0;
      const normalisedRate = rateInput
        ? Number(parsedRate.toFixed(2))
        : null;
      const payload: Record<string, any> = {
        name,
        description: role.description.trim() || null,
        instructions: role.instructions.trim() || null,
        defaultQuantity: quantity,
        defaultIncludeInBudget: role.includeInBudget !== false,
      };
      if (rateInput) payload.defaultRate = normalisedRate;
      const docRef = await addDoc(collection(db, "crewRoleTemplates"), payload);
      const template: CrewRoleTemplate = {
        id: docRef.id,
        name,
        description:
          typeof payload.description === "string"
            ? payload.description
            : undefined,
        instructions:
          typeof payload.instructions === "string"
            ? payload.instructions
            : undefined,
        defaultQuantity: quantity,
        defaultRate: rateInput ? normalisedRate ?? undefined : undefined,
        defaultIncludeInBudget: role.includeInBudget !== false,
      };
      setCrewRoleTemplates((prev) =>
        [...prev, template].sort((a, b) => a.name.localeCompare(b.name))
      );
      setCrewRoles((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, templateId: docRef.id } : item
        )
      );
      setRoleLibraryMessage({
        tone: "success",
        text: `Saved "${name}" to the crew role library.`,
      });
    } catch (error) {
      console.error("Failed to save crew role template", error);
      setRoleLibraryMessage({
        tone: "error",
        text: "Failed to save role to the library. Please try again.",
      });
    }
  };
  const handleUpdateRoleTemplate = async (index: number) => {
    const role = crewRoles[index];
    if (!role?.templateId) return;
    const name = role.name.trim();
    if (!name) {
      setRoleLibraryMessage({
        tone: "error",
        text: "Add a role name before updating the template.",
      });
      return;
    }
    try {
      const quantity = parseRoleQuantity(role.quantity);
      const rateInput = role.unitRate.trim();
      const parsedRate = rateInput ? parseMoney(rateInput, 0) : 0;
      const normalisedRate = rateInput
        ? Number(parsedRate.toFixed(2))
        : null;
      const payload: Record<string, any> = {
        name,
        description: role.description.trim() || null,
        instructions: role.instructions.trim() || null,
        defaultQuantity: quantity,
        defaultIncludeInBudget: role.includeInBudget !== false,
      };
      if (rateInput) payload.defaultRate = normalisedRate;
      else payload.defaultRate = null;
      await updateDoc(doc(db, "crewRoleTemplates", role.templateId), payload);
      setCrewRoleTemplates((prev) =>
        prev
          .map((template) =>
            template.id === role.templateId
              ? {
                  ...template,
                  name,
                  description:
                    typeof payload.description === "string"
                      ? payload.description
                      : undefined,
                  instructions:
                    typeof payload.instructions === "string"
                      ? payload.instructions
                      : undefined,
                  defaultQuantity: quantity,
                  defaultRate:
                    payload.defaultRate === null
                      ? undefined
                      : (payload.defaultRate as number),
                  defaultIncludeInBudget: role.includeInBudget !== false,
                }
              : template
          )
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setRoleLibraryMessage({
        tone: "success",
        text: `Updated "${name}" in the crew role library.`,
      });
    } catch (error) {
      console.error("Failed to update crew role template", error);
      setRoleLibraryMessage({
        tone: "error",
        text: "Failed to update the role template. Please try again.",
      });
    }
  };
  const [tasks, setTasks] = useState<ProductTask[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskForCustomer, setTaskForCustomer] = useState(false);
  const [taskSubtasks, setTaskSubtasks] = useState("");

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      const [catSnap, modSnap, wfSnap, venueSnap, crewRoleSnap] = await Promise.all([
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "modifiers")),
        getDocs(collection(db, "workflows")),
        getDocs(collection(db, "venues")),
        getDocs(collection(db, "crewRoleTemplates")),
      ]);
      setCats(catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      setAllModifiers(
        modSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModifierGroup[]
      );
      setWorkflows(wfSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      setVenues(
        venueSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Venue))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setCrewRoleTemplates(
        crewRoleSnap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              name: typeof data.name === "string" ? data.name : d.id,
              description:
                typeof data.description === "string"
                  ? data.description
                  : undefined,
              instructions:
                typeof data.instructions === "string"
                  ? data.instructions
                  : undefined,
              defaultQuantity: toNumberOrUndefined(data.defaultQuantity),
              defaultRate: toNumberOrUndefined(data.defaultRate),
              defaultIncludeInBudget:
                data.defaultIncludeInBudget === false ? false : true,
            } as CrewRoleTemplate;
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  useEffect(() => {
    setVariations((prev) => {
      if (!prev.length) return prev;
      let changed = false;
      const next = prev.map((variation) => {
        const synced = syncCrewOverrideMap(variation.crewOverrides, crewRoles);
        const prevKeys = Object.keys(variation.crewOverrides);
        const nextKeys = Object.keys(synced);
        const structureChanged =
          prevKeys.length !== nextKeys.length ||
          nextKeys.some((key) => variation.crewOverrides[key] !== synced[key]);
        if (structureChanged) {
          changed = true;
          return { ...variation, crewOverrides: synced };
        }
        return variation;
      });
      return changed ? next : prev;
    });

    setModifiers((prev) => {
      if (!prev.length) return prev;
      let changed = false;
      const next = prev.map((selection) => {
        const synced = syncCrewOverrideMap(selection.crewOverrides, crewRoles);
        const nextKeys = Object.keys(synced);
        const prevKeys = Object.keys(selection.crewOverrides);
        const structureChanged =
          prevKeys.length !== nextKeys.length ||
          nextKeys.some((key) => selection.crewOverrides[key] !== synced[key]);
        const overridesClone: Record<string, CrewOverrideFormState> = {};
        nextKeys.forEach((key) => {
          overridesClone[key] = { ...synced[key] };
        });
        applyTemplateAdjustmentsToOverrides(
          overridesClone,
          crewRoles,
          selection.templateAdjustments
        );
        const missingTemplates = computeMissingTemplates(
          crewRoles,
          selection.templateAdjustments
        );
        const defaultsChanged = nextKeys.some((key) => {
          const prevEntry = selection.crewOverrides[key];
          const nextEntry = overridesClone[key];
          if (!prevEntry) return true;
          return (
            prevEntry.quantity !== nextEntry.quantity ||
            prevEntry.unitRate !== nextEntry.unitRate ||
            prevEntry.includeInBudget !== nextEntry.includeInBudget
          );
        });
        const missingChanged =
          missingTemplates.length !== selection.missingTemplates.length ||
          missingTemplates.some(
            (value, index) => selection.missingTemplates[index] !== value
          );
        if (structureChanged || defaultsChanged || missingChanged) {
          changed = true;
          return {
            ...selection,
            crewOverrides: overridesClone,
            missingTemplates,
          };
        }
        return selection;
      });
      return changed ? next : prev;
    });
  }, [crewRoles]);

  useEffect(() => {
    if (selectedVenue) {
      if (
        !travelMilesTouched &&
        selectedVenue.mileageFromWellingborough !== undefined &&
        selectedVenue.mileageFromWellingborough !== null
      ) {
        setTravelMiles(String(selectedVenue.mileageFromWellingborough));
      }
      if (
        !parkingTouched &&
        selectedVenue.parkingRate !== undefined &&
        selectedVenue.parkingRate !== null
      ) {
        setParkingCost(String(selectedVenue.parkingRate));
      }
    } else {
      if (!travelMilesTouched) setTravelMiles("100");
      if (!parkingTouched) setParkingCost("0");
    }
  }, [selectedVenue, travelMilesTouched, parkingTouched]);

  const upload = async (path: string, file: File) => {
    const r = ref(storage, path);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  };

  const buildVariationForm = useCallback(
    (
      variation?: ProductVariation,
      crewRoleState: CrewRoleFormState[] = crewRoles
    ): VariationFormState => {
      const features = Array.isArray(variation?.features)
        ? variation!.features!
        : [];
      const tier2 = variation?.priceTiers?.tier2;
      const tier3 = variation?.priceTiers?.tier3;
      return {
        id: variation?.id || generateFormId(),
        name: variation?.name || "",
        price:
          variation && typeof variation.price === "number"
            ? String(variation.price)
            : "0",
        tier2Price:
          typeof tier2 === "number" && Number.isFinite(tier2) ? String(tier2) : "",
        tier3Price:
          typeof tier3 === "number" && Number.isFinite(tier3) ? String(tier3) : "",
        featuresText: features.join("\n"),
        budgetOverrides: createBudgetForm(variation?.budgetOverrides ?? null),
        crewOverrides: createCrewOverrideMap(
          crewRoleState,
          variation?.crewOverrides ?? null
        ),
      };
    },
    [crewRoles]
  );

  const buildModifierFormFromOption = useCallback(
    (
      groupId: string,
      option: ModifierOption,
      crewRoleState: CrewRoleFormState[] = crewRoles
    ): ModifierSelectionFormState => {
      const templateAdjustments = Array.isArray(option.crewAdjustments)
        ? option.crewAdjustments.filter(
            (adj): adj is ModifierCrewAdjustment =>
              !!adj && typeof adj.templateId === "string"
          )
        : [];
      const crewOverrideMap = createCrewOverrideMap(crewRoleState, []);
      applyTemplateAdjustmentsToOverrides(
        crewOverrideMap,
        crewRoleState,
        templateAdjustments
      );
      const tier2 = option.priceTiers?.tier2;
      const tier3 = option.priceTiers?.tier3;
      return {
        groupId,
        optionId: option.id,
        price: String(option.price ?? 0),
        tier2Price:
          typeof tier2 === "number" && Number.isFinite(tier2) ? String(tier2) : "",
        tier3Price:
          typeof tier3 === "number" && Number.isFinite(tier3) ? String(tier3) : "",
        budgetOverrides: createBudgetForm(option.budgetAdjustments ?? null),
        crewOverrides: crewOverrideMap,
        templateAdjustments,
        missingTemplates: computeMissingTemplates(
          crewRoleState,
          templateAdjustments
        ),
      };
    },
    [crewRoles]
  );

  const addVariation = () => {
    setVariations((prev) => [
      ...prev,
      buildVariationForm(undefined, crewRoles),
    ]);
  };

  const updateVariation = (
    index: number,
    data: Partial<VariationFormState>
  ) => {
    setVariations((prev) =>
      prev.map((variation, i) => (i === index ? { ...variation, ...data } : variation))
    );
  };

  const removeVariation = (index: number) => {
    setVariations((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVariationBudget = (
    index: number,
    field: keyof BudgetOverrideFormState,
    value: string
  ) => {
    setVariations((prev) =>
      prev.map((variation, i) =>
        i === index
          ? {
              ...variation,
              budgetOverrides: { ...variation.budgetOverrides, [field]: value },
            }
          : variation
      )
    );
  };

  const updateVariationCrewOverride = (
    index: number,
    roleId: string,
    patch: Partial<CrewOverrideFormState>
  ) => {
    setVariations((prev) =>
      prev.map((variation, i) => {
        if (i !== index) return variation;
        const current = variation.crewOverrides[roleId] || {
          ...defaultCrewOverrideForm,
        };
        return {
          ...variation,
          crewOverrides: {
            ...variation.crewOverrides,
            [roleId]: { ...current, ...patch },
          },
        };
      })
    );
  };

  const updateModifierSelection = (
    groupId: string,
    optionId: string,
    patch: Partial<ModifierSelectionFormState>
  ) => {
    setModifiers((prev) =>
      prev.map((selection) =>
        selection.groupId === groupId && selection.optionId === optionId
          ? { ...selection, ...patch }
          : selection
      )
    );
  };

  const updateModifierBudget = (
    groupId: string,
    optionId: string,
    field: keyof BudgetOverrideFormState,
    value: string
  ) => {
    setModifiers((prev) =>
      prev.map((selection) =>
        selection.groupId === groupId && selection.optionId === optionId
          ? {
              ...selection,
              budgetOverrides: {
                ...selection.budgetOverrides,
                [field]: value,
              },
            }
          : selection
      )
    );
  };

  const updateModifierCrewOverride = (
    groupId: string,
    optionId: string,
    roleId: string,
    patch: Partial<CrewOverrideFormState>
  ) => {
    setModifiers((prev) =>
      prev.map((selection) => {
        if (selection.groupId !== groupId || selection.optionId !== optionId) {
          return selection;
        }
        const current = selection.crewOverrides[roleId] || {
          ...defaultCrewOverrideForm,
        };
        return {
          ...selection,
          crewOverrides: {
            ...selection.crewOverrides,
            [roleId]: { ...current, ...patch },
          },
        };
      })
    );
  };

  const handleSelectModifier = (
    groupId: string,
    optionId: string,
    checked: boolean
  ) => {
    if (checked) {
      setEnabledModifierGroups((prev) =>
        prev.includes(groupId) ? prev : [...prev, groupId]
      );
    }
    setModifiers((prev) => {
      if (checked) {
        const group = allModifiers.find((g) => g.id === groupId);
        const option = group?.options.find((opt) => opt.id === optionId);
        if (!option) return prev;
        const nextEntry = buildModifierFormFromOption(groupId, option, crewRoles);
        if (group && !group.multiple) {
          return [
            ...prev.filter((selection) => selection.groupId !== groupId),
            nextEntry,
          ];
        }
        const exists = prev.find(
          (selection) =>
            selection.groupId === groupId && selection.optionId === optionId
        );
        return exists ? prev : [...prev, nextEntry];
      }
      const next = prev.filter(
        (selection) =>
          !(selection.groupId === groupId && selection.optionId === optionId)
      );
      if (!next.some((entry) => entry.groupId === groupId)) {
        setEnabledModifierGroups((groups) =>
          groups.filter((id) => id !== groupId)
        );
      }
      return next;
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const variationData: ProductVariation[] = variations.map((variation) => {
      const name = variation.name.trim();
      const features = variation.featuresText
        ? variation.featuresText
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean)
        : [];
      const basePrice = parseMoney(variation.price);
      const entry: ProductVariation = {
        id: variation.id,
        name,
        price: basePrice,
        priceTiers: buildPriceTierPayload(
          basePrice,
          variation.tier2Price,
          variation.tier3Price
        ),
      };
      if (features.length) entry.features = features;
      const budgetOverrides = parseBudgetFormToOverride(
        variation.budgetOverrides
      );
      if (budgetOverrides) entry.budgetOverrides = budgetOverrides;
      const crewOverrides = parseCrewOverrideMap(variation.crewOverrides);
      if (crewOverrides.length) entry.crewOverrides = crewOverrides;
      return entry;
    });
    const specPayload: ProductSpec = {};
    const specOverview = productSpec.overview.trim();
    if (specOverview) specPayload.overview = specOverview;
    const specPreparation = productSpec.preparation.trim();
    if (specPreparation) specPayload.preparation = specPreparation;
    const specFilming = productSpec.filming.trim();
    if (specFilming) specPayload.filming = specFilming;
    const specEditing = productSpec.editing.trim();
    if (specEditing) specPayload.editing = specEditing;
    const specDelivery = productSpec.delivery.trim();
    if (specDelivery) specPayload.delivery = specDelivery;
    const specNotes = productSpec.notes.trim();
    if (specNotes) specPayload.notes = specNotes;

    const crewRoleData: ProductCrewRole[] = crewRoles
      .map((role) => {
        const name = role.name.trim();
        if (!name) return null;
        const quantity = parseRoleQuantity(role.quantity);
        const description = role.description.trim();
        const instructions = role.instructions.trim();
        const rateInput = role.unitRate.trim();
        const parsedRate = rateInput ? parseMoney(rateInput, 0) : 0;
        const normalisedRate = rateInput
          ? Number(parsedRate.toFixed(2))
          : undefined;
        const payload: ProductCrewRole = {
          id: role.id,
          title: name,
          quantity,
          includeInBudget: role.includeInBudget !== false,
        };
        if (role.templateId) payload.roleId = role.templateId;
        if (description) payload.description = description;
        if (instructions) payload.instructions = instructions;
        if (normalisedRate !== undefined) payload.unitRate = normalisedRate;
        return payload;
      })
      .filter((entry): entry is ProductCrewRole => entry !== null);

    const venueLabel = venue || selectedVenue?.name || null;
    const labourFilmingValue = parseMoney(labourFilmingRate);
    const labourEditingValue = parseMoney(labourEditingRate);
    const crewRolesTotal = crewRoleData.reduce((total, role) => {
      if (role.includeInBudget === false) return total;
      const qty = Number(role.quantity) || 0;
      const rate = Number(role.unitRate) || 0;
      return total + qty * rate;
    }, 0);
    const labourValue = labourFilmingValue + labourEditingValue + crewRolesTotal;
    const manualKitValue = parseMoney(manualKitCost);
    const kitValue = kitCostMode === "guided" ? kitGuidanceValue : manualKitValue;
    const travelMilesValue = parseMoney(travelMiles, 100);
    const travelRateValue = parseMoney(travelRate, 0.3);
    const travelCostValue = Number.isFinite(travelMilesValue * travelRateValue)
      ? travelMilesValue * travelRateValue
      : 0;
    const parkingValue = parseMoney(parkingCost);
    const enabledGroups = enabledModifierGroups.filter((id) => typeof id === "string");
    const enabledSet = new Set(enabledGroups);
    const modifierData: ProductModifierSelection[] = modifiers
      .filter((selection) => enabledSet.has(selection.groupId))
      .map((selection) => {
        const entry: ProductModifierSelection = {
          groupId: selection.groupId,
          optionId: selection.optionId,
        };
        const priceOverride = parseOptionalPrice(selection.price);
        const tier2Override = parseOptionalPrice(selection.tier2Price);
        const tier3Override = parseOptionalPrice(selection.tier3Price);
        if (priceOverride !== null) {
          entry.price = priceOverride;
          entry.priceTiers = buildPriceTierPayload(
            priceOverride,
            selection.tier2Price,
            selection.tier3Price
          );
        } else if (tier2Override !== null || tier3Override !== null) {
          entry.priceTiers = buildPriceTierPayload(
            null,
            selection.tier2Price,
            selection.tier3Price
          );
        }
        const budgetOverrides = parseBudgetFormToOverride(
          selection.budgetOverrides
        );
        if (budgetOverrides) entry.budgetOverrides = budgetOverrides;
        const crewOverrides = parseCrewOverrideMap(selection.crewOverrides);
        if (crewOverrides.length) entry.crewOverrides = crewOverrides;
        return entry;
      });
    const videoData = exampleVideos
      .map((video) => {
        const url = video.url.trim();
        if (!url) return null;
        const entry: ProductVideoLink = { url };
        const title = video.title.trim();
        if (title) entry.title = title;
        return entry;
      })
      .filter((entry): entry is ProductVideoLink => !!entry);
    const primaryExampleVideo = videoData.length > 0 ? videoData[0].url : null;
    const baseProductPrice = parseMoney(price);
    const productPriceTiers = buildPriceTierPayload(
      baseProductPrice,
      priceTier2,
      priceTier3
    );
    const docRef = await addDoc(collection(db, "products"), {
      name,
      description,
      tagline: tagline || null,
      price: baseProductPrice,
      priceTiers: productPriceTiers,
      labourCost: labourValue,
      defaultKitCost: kitValue,
      budget: {
        labourFilming: labourFilmingValue,
        labourEditing: labourEditingValue,
        labourCrew: crewRolesTotal,
        labour: labourValue,
        kitMode: kitCostMode,
        kitManual: manualKitValue,
        kitGuidance: kitGuidanceValue,
        kit: kitValue,
        travelMiles: travelMilesValue,
        travelRate: travelRateValue,
        travelCost: Number.isFinite(travelCostValue) ? travelCostValue : 0,
        parking: parkingValue,
      },
      requirements: requirements || null,
      operationsInfo: operationsInfo || null,
      deliveryTime: deliveryOptions[deliveryIndex],
      category: category || null,
      eventDate: eventDate || null,
      venue: venueLabel,
      venueId: venueId || null,
      hidden,
      driveTemplateFolderId:
        driveTemplateFolderId.trim().length > 0 ? driveTemplateFolderId.trim() : null,
      driveFolderName: driveFolderName.trim().length > 0 ? driveFolderName.trim() : null,
      defaultTasks: tasks,
      variations: variationData,
      seo: {
        title: seo.title || null,
        description: seo.description || null,
        keywords: seo.keywords || null,
      },
      exampleVideos: videoData,
      exampleWorkUrl: primaryExampleVideo,
      modifierGroups: enabledGroups,
      productSpec: specPayload,
      crewRoles: crewRoleData,
    });
    let imageUrl = "";
    if (imageFile)
      imageUrl = await upload(
        `${PRODUCT_IMAGE_ROOT}/${docRef.id}/main`,
        imageFile
      );
    const deliverableData: ProductDeliverable[] = [];
    for (let i = 0; i < deliverables.length; i++) {
      const d = deliverables[i];
      let thumb = d.thumbnailUrl;
      if (d.file)
        thumb = await upload(
          `${PRODUCT_IMAGE_ROOT}/${docRef.id}/deliverable-${i}`,
          d.file
        );
      const item: ProductDeliverable = { title: d.title };
      if (d.type) item.type = d.type;
      const desc = d.description?.trim();
      if (desc) item.description = desc;
      if (thumb) item.thumbnailUrl = thumb;
      const scopedIds = Array.isArray(d.variationIds)
        ? d.variationIds.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0
          )
        : [];
      if (scopedIds.length > 0) item.variationIds = scopedIds;
      deliverableData.push(item);
    }
    let seoImage = "";
    if (seoImageFile)
      seoImage = await upload(
        `${PRODUCT_IMAGE_ROOT}/${docRef.id}/seo`,
        seoImageFile
      );
    await updateDoc(docRef, {
      imageUrl: imageUrl || null,
      deliverables: deliverableData,
      modifierGroups: enabledGroups,
      modifiers: modifierData,
      seo: { ...seo, socialImageUrl: seoImage || null },
    });
    if (workflowId) {
      const fn = httpsCallable(functions, "admin_assignWorkflow");
      await fn({ productId: docRef.id, workflowId });
    }
    router.push(`/admin/products/${docRef.id}`);
  };

  const addExampleVideo = () => {
    setExampleVideos((prev) => [...prev, createVideoInput()]);
  };

  const updateExampleVideo = (
    index: number,
    patch: Partial<ExampleVideoInput>
  ) => {
    setExampleVideos((prev) =>
      prev.map((video, i) => (i === index ? { ...video, ...patch } : video))
    );
  };

  const removeExampleVideo = (index: number) => {
    setExampleVideos((prev) => prev.filter((_, i) => i !== index));
  };

  const addDeliverable = () => {
    setDeliverables((d) => [
      ...d,
      { title: "", description: "", type: "long-form-video" },
    ]);
  };
  const updateDeliverable = (index: number, data: Partial<ProductDeliverable & { file?: File }>) => {
    setDeliverables((prev) => prev.map((d, i) => (i === index ? { ...d, ...data } : d)));
  };
  const setDeliverableVariation = (
    index: number,
    variationId: string,
    checked: boolean
  ) => {
    setDeliverables((prev) =>
      prev.map((deliverable, i) => {
        if (i !== index) return deliverable;
        const existing = Array.isArray(deliverable.variationIds)
          ? deliverable.variationIds.filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0
            )
          : [];
        const nextIds = checked
          ? existing.includes(variationId)
            ? existing
            : [...existing, variationId]
          : existing.filter((id) => id !== variationId);
        if (nextIds.length === existing.length) {
          return deliverable;
        }
        if (nextIds.length === 0) {
          const clone = { ...deliverable };
          delete clone.variationIds;
          return clone;
        }
        return { ...deliverable, variationIds: nextIds };
      })
    );
  };
  const removeDeliverable = (index: number) => {
    setDeliverables((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleModifierGroup = (groupId: string, enabled: boolean) => {
    setEnabledModifierGroups((prev) => {
      if (enabled) {
        return prev.includes(groupId) ? prev : [...prev, groupId];
      }
      return prev.filter((id) => id !== groupId);
    });
    if (!enabled) {
      setModifiers((prev) => prev.filter((m) => m.groupId !== groupId));
    }
  };

  const togglePreset = (task: ProductTask) => {
    setTasks((prev) => {
      const exists = prev.find((t) => t.title === task.title);
      if (exists) return prev.filter((t) => t.title !== task.title);
      return [...prev, task];
    });
  };
  const updateTask = (index: number, data: Partial<ProductTask>) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...data } : t)));
  };
  const updateTaskSubtasks = (index: number, text: string) => {
    const arr = text.split("\n").map((s) => s.trim()).filter(Boolean);
    updateTask(index, { subtasks: arr.length ? arr : undefined });
  };
  const removeTask = (index: number) => setTasks((prev) => prev.filter((_, i) => i !== index));

  const addTaskFromForm = (e: React.FormEvent) => {
    e.preventDefault();
    const subs = taskSubtasks
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setTasks((t) => [
      ...t,
      {
        title: taskTitle,
        forCustomer: taskForCustomer,
        ...(subs.length ? { subtasks: subs } : {}),
      },
    ]);
    setTaskTitle("");
    setTaskForCustomer(false);
    setTaskSubtasks("");
  };

  const kitGuidanceValue = 0;
  const crewCostValue = useMemo(() => {
    return crewRoles.reduce((total, role) => {
      if (!role.includeInBudget) return total;
      const quantity = Number(role.quantity);
      const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      const rate = parseMoney(role.unitRate, 0);
      return total + qty * rate;
    }, 0);
  }, [crewRoles]);
  const crewRoleBreakdown = useMemo(
    () =>
      crewRoles.map((role) => {
        const quantity = Number(role.quantity);
        const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
        const rate = parseMoney(role.unitRate, 0);
        return {
          id: role.id,
          name: role.name.trim() || "Crew role",
          quantity: qty,
          rate,
          total: qty * rate,
          included: role.includeInBudget !== false,
        };
      }),
    [crewRoles]
  );
  const includedCrewRoles = useMemo(
    () => crewRoleBreakdown.filter((role) => role.included && role.total > 0),
    [crewRoleBreakdown]
  );
  const labourFilmingValue = parseMoney(labourFilmingRate);
  const labourEditingValue = parseMoney(labourEditingRate);
  const labourValue = labourFilmingValue + labourEditingValue + crewCostValue;
  const manualKitValue = parseMoney(manualKitCost);
  const kitValue = kitCostMode === "guided" ? kitGuidanceValue : manualKitValue;
  const travelMilesValue = parseMoney(travelMiles, 100);
  const travelRateValue = parseMoney(travelRate, 0.3);
  const travelCostValue = Number.isFinite(travelMilesValue * travelRateValue)
    ? travelMilesValue * travelRateValue
    : 0;
  const parkingValue = parseMoney(parkingCost);
  const priceValue = parseMoney(price);
  const budgetTotal = labourValue + kitValue + travelCostValue + parkingValue;
  const profitValue = priceValue - budgetTotal;

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to create products.</p>;

  return (
    <form onSubmit={save} className="grid gap-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Create Product</h1>
      <nav className="flex gap-4 border-b">
        {[ 
          ["info", "Info"],
          ["drive", "Drive & Folders"],
          ["spec", "Product Spec"],
          ["pnl", "P&L"],
          ["variations", "Variations"],
          ["deliverables", "Deliverables"],
          ["tasks", "Default Tasks"],
          ["seo", "SEO"],
          ["modifiers", "Modifiers"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as any)}
            className={`pb-2 ${tab === key ? "border-b-2 border-black" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "drive" && (
        <div className="grid gap-4">
          <div className="rounded border bg-slate-50 p-4">
            <h2 className="text-sm font-semibold">Deliverable template folder</h2>
            <p className="text-xs text-gray-600">
              Provide the Google Drive folder ID that should be cloned whenever an
              order for this product is created. Leave blank to start with an empty
              folder.
            </p>
            <input
              className="input mt-3"
              placeholder="1AbCdEfGhIjKlMnOp"
              value={driveTemplateFolderId}
              onChange={(event) => setDriveTemplateFolderId(event.target.value)}
            />
            {driveTemplateFolderId.trim().length > 0 && (
              <a
                className="text-xs text-blue-600 underline"
                href={`https://drive.google.com/drive/folders/${encodeURIComponent(
                  driveTemplateFolderId.trim()
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                Open template in Drive
              </a>
            )}
          </div>
          <div className="rounded border bg-slate-50 p-4">
            <h2 className="text-sm font-semibold">Default folder name</h2>
            <p className="text-xs text-gray-600">
              Override the folder name that is created for this product inside each
              client&apos;s project. Leave blank to use the product name.
            </p>
            <input
              className="input mt-3"
              placeholder="eg. Divine Resolve Project Files"
              value={driveFolderName}
              onChange={(event) => setDriveFolderName(event.target.value)}
            />
          </div>
        </div>
      )}

      {tab === "info" && (
        <div className="grid gap-2">
          <label className="text-sm font-medium">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          <label className="text-sm font-medium">Tagline</label>
          <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          <label className="text-sm font-medium">Description</label>
        <ReactQuill theme="snow" value={description} onChange={setDescription} />
          <label className="text-sm font-medium">Image</label>
          <input type="file" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          <div className="rounded border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Example videos</p>
                <p className="text-xs text-gray-600">
                  Add YouTube or Vimeo links to appear on the product page.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={addExampleVideo}
              >
                Add video
              </button>
            </div>
            <div className="mt-3 grid gap-3">
              {exampleVideos.length === 0 && (
                <p className="text-xs text-gray-500">
                  No example videos yet.
                </p>
              )}
              {exampleVideos.map((video, index) => {
                const titleId = `new-example-video-title-${index}`;
                const urlId = `new-example-video-url-${index}`;
                return (
                  <div
                    key={video.id}
                    className="grid gap-2 rounded border bg-white p-3"
                  >
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>Video {index + 1}</span>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => removeExampleVideo(index)}
                        aria-label={`Remove video ${index + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                    <label
                      className="text-xs font-medium text-gray-600"
                      htmlFor={titleId}
                    >
                      Title (optional)
                    </label>
                    <input
                      id={titleId}
                      className="input"
                      placeholder="Launch teaser"
                      value={video.title}
                      onChange={(e) =>
                        updateExampleVideo(index, { title: e.target.value })
                      }
                    />
                    <label
                      className="text-xs font-medium text-gray-600"
                      htmlFor={urlId}
                    >
                      Video URL
                    </label>
                    <input
                      id={urlId}
                      type="url"
                      className="input"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={video.url}
                      onChange={(e) =>
                        updateExampleVideo(index, { url: e.target.value })
                      }
                    />
                    <p className="text-xs text-gray-500">
                      The first video will be highlighted on the storefront.
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
          <label className="text-sm font-medium">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">None</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="text-sm font-medium">Workflow</label>
          <select className="input" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
            <option value="">None</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {cats.find((c) => c.id === category)?.name === "Exhibition Videography" && (
            <>
              <label className="text-sm font-medium">Event Date</label>
              <input
                type="date"
                className="input"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <label className="text-sm font-medium">Linked Venue</label>
              <select
                className="input"
                value={venueId}
                onChange={(e) => {
                  const value = e.target.value;
                  setVenueId(value);
                  if (value) {
                    const match = venues.find((v) => v.id === value);
                    setVenue(match?.name || "");
                  }
                }}
              >
                <option value="">Custom / not listed</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {selectedVenue && (
                <div className="rounded bg-slate-100 p-2 text-xs text-gray-600 grid gap-1">
                  {selectedVenue.mileageFromWellingborough !== null &&
                    selectedVenue.mileageFromWellingborough !== undefined && (
                      <div>
                        Mileage: {selectedVenue.mileageFromWellingborough} miles
                      </div>
                    )}
                  {selectedVenue.parkingRate !== null &&
                    selectedVenue.parkingRate !== undefined && (
                      <div>
                        Parking Rate: £{Number(selectedVenue.parkingRate).toFixed(2)}
                      </div>
                    )}
                  {selectedVenue.parkingTips && (
                    <div className="truncate">
                      <span className="font-medium">Parking:</span> {selectedVenue.parkingTips}
                    </div>
                  )}
                  {selectedVenue.accessInfo && (
                    <div className="truncate">
                      <span className="font-medium">Access:</span> {selectedVenue.accessInfo}
                    </div>
                  )}
                {selectedVenue.internetInfo && (
                  <div className="truncate">
                    <span className="font-medium">Internet:</span> {selectedVenue.internetInfo}
                  </div>
                )}
                <VenueMap venue={selectedVenue} className="mt-1" height={200} />
              </div>
            )}
              <label className="text-sm font-medium">Venue Label</label>
              <input
                className="input"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Shown on the product page"
              />
              <p className="text-xs text-gray-500 -mt-1">
                This text appears on the customer-facing product pages.
              </p>
            </>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            Hide product from store
          </label>
          <label className="text-sm font-medium">Requirements</label>
          <textarea className="input" value={requirements} onChange={(e) => setRequirements(e.target.value)} />
          <label className="text-sm font-medium">
            Delivery Time: {deliveryOptions[deliveryIndex]}
          </label>
          <input
            type="range"
            min={0}
            max={deliveryOptions.length - 1}
            value={deliveryIndex}
            onChange={(e) => setDeliveryIndex(Number(e.target.value))}
          />
          <label className="text-sm font-medium">Our Operations</label>
          <textarea
            className="input"
            value={operationsInfo}
            onChange={(e) => setOperationsInfo(e.target.value)}
            placeholder="Arrival window, on-site timings, contact details, etc."
          />
          <p className="text-xs text-gray-500 -mt-1">
            Shown beneath Delivery Time on the customer product page.
          </p>
    </div>
      )}

      {tab === "spec" && (
        <div className="grid gap-6">
          <section className="grid gap-2">
            <h2 className="text-lg font-semibold">Production brief</h2>
            <p className="text-sm text-gray-600">
              Outline the process a contractor should follow when delivering this
              product. These notes are stored with the product so your crew has
              clear guidance.
            </p>
            <label className="text-sm font-medium">Overview</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.overview}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, overview: e.target.value }))
              }
              placeholder="High-level summary of the deliverable and the client outcome."
            />
            <label className="text-sm font-medium">Pre-production / preparation</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.preparation}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, preparation: e.target.value }))
              }
              placeholder="Booking information, contacts, access requirements, and kit prep."
            />
            <label className="text-sm font-medium">Filming guidelines</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.filming}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, filming: e.target.value }))
              }
              placeholder="Shot lists, coverage expectations, and on-location standards."
            />
            <label className="text-sm font-medium">Editing / post-production</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.editing}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, editing: e.target.value }))
              }
              placeholder="Editing approach, review cadence, and deliverable specs."
            />
            <label className="text-sm font-medium">Delivery & handover</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.delivery}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, delivery: e.target.value }))
              }
              placeholder="Portal upload steps, naming conventions, and client comms."
            />
            <label className="text-sm font-medium">Additional notes</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.notes}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Health & safety, brand guardrails, or escalation paths."
            />
          </section>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Crew requirements</h2>
                <p className="text-sm text-gray-600">
                  List each role required for this product so you can brief the
                  team and budget their work.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={addCrewRole}>
                Add role
              </button>
            </div>
            {roleLibraryMessage && (
              <p
                className={`text-sm ${
                  roleLibraryMessage.tone === "error"
                    ? "text-rose-600"
                    : "text-emerald-700"
                }`}
              >
                {roleLibraryMessage.text}
              </p>
            )}
            {crewRoles.length === 0 ? (
              <p className="text-sm text-gray-500">
                Start by adding each operator, editor, or specialist that typically
                delivers this product. Their guidance and day rates are saved for
                future scheduling.
              </p>
            ) : (
              <div className="grid gap-4">
                {crewRoles.map((role, index) => {
                  const template = role.templateId
                    ? crewRoleTemplates.find((t) => t.id === role.templateId)
                    : null;
                  const roleCost = computeRoleCost(role);
                  const quantityValue = Number(role.quantity);
                  const quantityDisplay =
                    Number.isFinite(quantityValue) && quantityValue > 0
                      ? quantityValue
                      : 1;
                  const rateValue = parseMoney(role.unitRate, 0);
                  return (
                    <div
                      key={role.id}
                      className="grid gap-3 rounded border bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold">Role {index + 1}</h3>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => removeCrewRole(index)}
                        >
                          Remove
                        </button>
                      </div>
                      <label className="text-xs font-medium text-gray-600">
                        Role template
                      </label>
                      <select
                        className="input"
                        value={role.templateId ?? ""}
                        onChange={(e) =>
                          handleCrewRoleTemplateChange(index, e.target.value)
                        }
                      >
                        <option value="">Custom</option>
                        {crewRoleTemplates.map((templateOption) => (
                          <option key={templateOption.id} value={templateOption.id}>
                            {templateOption.name}
                          </option>
                        ))}
                      </select>
                      {template?.description && (
                        <p className="text-xs text-gray-500">
                          {template.description}
                        </p>
                      )}
                      <label className="text-xs font-medium text-gray-600">
                        Role name
                      </label>
                      <input
                        className="input"
                        value={role.name}
                        onChange={(e) =>
                          updateCrewRole(index, { name: e.target.value })
                        }
                        placeholder="e.g. Lead Videographer"
                      />
                      <label className="text-xs font-medium text-gray-600">
                        Role description
                      </label>
                      <textarea
                        className="input min-h-[90px]"
                        value={role.description}
                        onChange={(e) =>
                          updateCrewRole(index, { description: e.target.value })
                        }
                        placeholder="Summary of responsibilities, deliverables, or expectations."
                      />
                      <label className="text-xs font-medium text-gray-600">
                        Instructions for assigned crew
                      </label>
                      <textarea
                        className="input min-h-[120px]"
                        value={role.instructions}
                        onChange={(e) =>
                          updateCrewRole(index, { instructions: e.target.value })
                        }
                        placeholder="Provide the checklist a contractor receives when they accept this role."
                      />
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-gray-600">
                            Quantity required
                          </label>
                          <input
                            type="number"
                            min={1}
                            className="input"
                            value={role.quantity}
                            onChange={(e) =>
                              updateCrewRole(index, { quantity: e.target.value })
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-gray-600">
                            Day rate / cost
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input"
                            value={role.unitRate}
                            onChange={(e) =>
                              updateCrewRole(index, { unitRate: e.target.value })
                            }
                            placeholder="250"
                          />
                          <p className="text-xs text-gray-500">
                            Estimated cost: {formatCurrency(roleCost)} ({quantityDisplay}
                            {" "}
                            x £{rateValue.toFixed(2)})
                          </p>
                        </div>
                        <div className="flex items-center gap-2 pt-6">
                          <input
                            type="checkbox"
                            checked={role.includeInBudget}
                            onChange={(e) =>
                              updateCrewRole(index, {
                                includeInBudget: e.target.checked,
                              })
                            }
                          />
                          <span className="text-xs font-medium text-gray-600">
                            Include in P&L
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {role.includeInBudget
                          ? "Counted towards labour budgeting."
                          : "Excluded from budgeting calculations."}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1 text-xs">
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => handleSaveRoleAsTemplate(index)}
                        >
                          Save to library
                        </button>
                        {role.templateId && (
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost"
                            onClick={() => handleUpdateRoleTemplate(index)}
                          >
                            Update template
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "pnl" && (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Customer price tiers (GBP)</label>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-gray-600">Tier 1</span>
                <input
                  type="number"
                  className="input"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-gray-600">Tier 2</span>
                <input
                  type="number"
                  className="input"
                  value={priceTier2}
                  onChange={(e) => setPriceTier2(e.target.value)}
                  placeholder="Defaults to Tier 1"
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-gray-600">Tier 3</span>
                <input
                  type="number"
                  className="input"
                  value={priceTier3}
                  onChange={(e) => setPriceTier3(e.target.value)}
                  placeholder="Defaults to Tier 1"
                />
              </label>
            </div>
            <span className="text-xs text-gray-500">
              Territories use Tier 1 by default. Configure territory-specific tiers in Franchise Manager.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="grid gap-6">
              <div className="grid gap-2">
                <h3 className="font-medium">Labour rates</h3>
                <label className="text-sm font-medium">Filming labour rate</label>
                <input
                  type="number"
                  className="input"
                  value={labourFilmingRate}
                  onChange={(e) => setLabourFilmingRate(e.target.value)}
                />
                <label className="text-sm font-medium">Editing labour rate</label>
                <input
                  type="number"
                  className="input"
                  value={labourEditingRate}
                  onChange={(e) => setLabourEditingRate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <h3 className="font-medium">Kit costs</h3>
                <div className="flex flex-col gap-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="kit-cost-mode"
                      value="manual"
                      checked={kitCostMode === "manual"}
                      onChange={() => setKitCostMode("manual")}
                    />
                    Manual entry
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="kit-cost-mode"
                      value="guided"
                      checked={kitCostMode === "guided"}
                      onChange={() => setKitCostMode("guided")}
                    />
                    Guided from kit selection (after assigning kit)
                  </label>
                </div>
                {kitCostMode === "manual" ? (
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={manualKitCost}
                    onChange={(e) => setManualKitCost(e.target.value)}
                  />
                ) : (
                  <div className="rounded border bg-slate-50 p-3 text-sm text-gray-600">
                    Guided totals update automatically once kit is assigned to the product.
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <h3 className="font-medium">Travel & parking</h3>
                <label className="text-sm font-medium">Travel miles (estimate)</label>
                <input
                  type="number"
                  className="input"
                  value={travelMiles}
                  onChange={(e) => {
                    setTravelMilesTouched(true);
                    setTravelMiles(e.target.value);
                  }}
                />
                <label className="text-sm font-medium">Travel rate (per mile)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={travelRate}
                  onChange={(e) => setTravelRate(e.target.value)}
                />
                <label className="text-sm font-medium">Parking budget</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={parkingCost}
                  onChange={(e) => {
                    setParkingTouched(true);
                    setParkingCost(e.target.value);
                  }}
                />
              </div>
            </div>
            <div className="border rounded p-3 text-sm space-y-2">
              <div className="flex justify-between">
                <span>Price</span>
                <span>{formatCurrency(priceValue)}</span>
              </div>
              <div className="flex justify-between">
                <span>Labour (filming)</span>
                <span>{formatCurrency(labourFilmingValue)}</span>
              </div>
              <div className="flex justify-between">
                <span>Labour (editing)</span>
                <span>{formatCurrency(labourEditingValue)}</span>
              </div>
              <div className="flex justify-between">
                <span>Labour (crew roles)</span>
                <span>{formatCurrency(crewCostValue)}</span>
              </div>
              {includedCrewRoles.length > 0 && (
                <div className="space-y-1 rounded bg-slate-50 p-2 text-xs text-gray-600">
                  {includedCrewRoles.map((role) => (
                    <div key={role.id} className="flex justify-between">
                      <span className="truncate pr-2">
                        {role.name} × {role.quantity}
                      </span>
                      <span>{formatCurrency(role.total)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between">
                <span>Kit {kitCostMode === "guided" ? "(guided)" : "(manual)"}</span>
                <span>{formatCurrency(kitValue)}</span>
              </div>
              <div>
                <div className="flex justify-between">
                  <span>Travel</span>
                  <span>{formatCurrency(travelCostValue)}</span>
                </div>
                <div className="text-xs text-gray-500 text-right">
                  {travelMilesValue} miles @ £{travelRateValue.toFixed(2)}
                </div>
              </div>
              <div className="flex justify-between">
                <span>Parking</span>
                <span>{formatCurrency(parkingValue)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>Budget total</span>
                <span>{formatCurrency(budgetTotal)}</span>
              </div>
              <div
                className={`flex justify-between font-semibold ${
                  profitValue < 0 ? "text-red-600" : ""
                }`}
              >
                <span>Estimated profit</span>
                <span>{formatCurrency(profitValue)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "variations" && (
        <div className="grid gap-4">
          {variations.length === 0 ? (
            <p className="text-sm text-gray-600">
              No variations have been created yet. Use variations to offer
              alternative package sizes or day rates while tailoring the
              budgeting and crew requirements.
            </p>
          ) : (
            variations.map((variation, index) => {
              const budget = variation.budgetOverrides;
              const budgetHasValues = Object.entries(budget).some(
                ([key, value]) =>
                  key === "kitMode" ? value !== "" : value.trim().length > 0
              );
              return (
                <div
                  key={variation.id}
                  className="grid gap-3 rounded border bg-white p-4 shadow-sm"
                >
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-gray-600">
                      Variation name
                    </span>
                    <input
                      className="input"
                      value={variation.name}
                      onChange={(e) =>
                        updateVariation(index, { name: e.target.value })
                      }
                      placeholder="e.g. Two day shoot"
                    />
                  </label>
                  <div className="grid gap-2 md:grid-cols-3">
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-gray-600">
                        Tier 1 price
                      </span>
                      <input
                        type="number"
                        className="input"
                        value={variation.price}
                        onChange={(e) =>
                          updateVariation(index, { price: e.target.value })
                        }
                        placeholder="Defaults to the base product price"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-gray-600">
                        Tier 2 price
                      </span>
                      <input
                        type="number"
                        className="input"
                        value={variation.tier2Price}
                        onChange={(e) =>
                          updateVariation(index, { tier2Price: e.target.value })
                        }
                        placeholder="Leave blank to match Tier 1"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-gray-600">
                        Tier 3 price
                      </span>
                      <input
                        type="number"
                        className="input"
                        value={variation.tier3Price}
                        onChange={(e) =>
                          updateVariation(index, { tier3Price: e.target.value })
                        }
                        placeholder="Leave blank to match Tier 1"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Tier values default to the base product price when left blank.
                  </p>
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-gray-600">
                      Feature highlights
                    </span>
                    <textarea
                      className="input min-h-[90px]"
                      value={variation.featuresText}
                      onChange={(e) =>
                        updateVariation(index, { featuresText: e.target.value })
                      }
                      placeholder="List the differentiators for this package (one per line)."
                    />
                  </label>
                  <details
                    className="rounded border border-dashed p-3"
                    open={budgetHasValues}
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      Budget overrides
                    </summary>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Labour (filming)
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.labourFilming}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "labourFilming",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Labour (editing)
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.labourEditing}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "labourEditing",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Kit total
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.kit}
                          onChange={(e) =>
                            updateVariationBudget(index, "kit", e.target.value)
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Manual kit value
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.kitManual}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "kitManual",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Kit mode override
                        </span>
                        <select
                          className="input"
                          value={budget.kitMode}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "kitMode",
                              e.target.value
                            )
                          }
                        >
                          <option value="">Inherit</option>
                          <option value="manual">Manual</option>
                          <option value="guided">Guided</option>
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Travel miles
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.travelMiles}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "travelMiles",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Travel rate
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.travelRate}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "travelRate",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Travel cost
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.travelCost}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "travelCost",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          Parking budget
                        </span>
                        <input
                          type="number"
                          className="input"
                          value={budget.parking}
                          onChange={(e) =>
                            updateVariationBudget(
                              index,
                              "parking",
                              e.target.value
                            )
                          }
                          placeholder="Inherit"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() =>
                          updateVariation(index, {
                            budgetOverrides: { ...emptyBudgetForm },
                          })
                        }
                      >
                        Clear budget overrides
                      </button>
                    </div>
                  </details>
                  <details
                    className="rounded border border-dashed p-3"
                    open={crewRoles.length > 0}
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      Crew overrides
                    </summary>
                    {crewRoles.length === 0 ? (
                      <p className="mt-2 text-xs text-gray-500">
                        Add crew roles on the P&amp;L tab to override their
                        quantity or rates for specific variations.
                      </p>
                    ) : (
                      <div className="mt-3 grid gap-3">
                        {crewRoles.map((role) => {
                          const override =
                            variation.crewOverrides[role.id] ||
                            defaultCrewOverrideForm;
                          return (
                            <div
                              key={role.id}
                              className="grid gap-2 rounded border bg-white p-3"
                            >
                              <p className="text-sm font-semibold">
                                {role.name || "Crew role"}
                              </p>
                              <div className="grid gap-2 md:grid-cols-3">
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Quantity override
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={override.quantity}
                                    onChange={(e) =>
                                      updateVariationCrewOverride(
                                        index,
                                        role.id,
                                        { quantity: e.target.value }
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Unit rate override
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={override.unitRate}
                                    onChange={(e) =>
                                      updateVariationCrewOverride(
                                        index,
                                        role.id,
                                        { unitRate: e.target.value }
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Budget inclusion
                                  </span>
                                  <select
                                    className="input"
                                    value={override.includeInBudget}
                                    onChange={(e) =>
                                      updateVariationCrewOverride(
                                        index,
                                        role.id,
                                        {
                                          includeInBudget: e.target
                                            .value as CrewOverrideFormState["includeInBudget"],
                                        }
                                      )
                                    }
                                  >
                                    <option value="inherit">Inherit</option>
                                    <option value="include">Force include</option>
                                    <option value="exclude">Force exclude</option>
                                  </select>
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {crewRoles.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => {
                            const cleared: Record<string, CrewOverrideFormState> = {};
                            crewRoles.forEach((role) => {
                              cleared[role.id] = { ...defaultCrewOverrideForm };
                            });
                            updateVariation(index, { crewOverrides: cleared });
                          }}
                        >
                          Clear crew overrides
                        </button>
                      </div>
                    )}
                  </details>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => removeVariation(index)}
                    >
                      Remove variation
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <button
            type="button"
            className="btn btn-sm w-fit"
            onClick={addVariation}
          >
            Add variation
          </button>
        </div>
      )}

      {tab === "deliverables" && (
        <div className="grid gap-4">
          {deliverables.map((d, i) => (
            <div key={i} className="border p-4 rounded grid gap-2">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon =
                    (d.type && deliverableIcons[d.type]) || FiCheck;
                  return <Icon className="text-orange" size={16} />;
                })()}
                <input
                  className="input flex-1"
                  placeholder="Title"
                  value={d.title}
                  onChange={(e) =>
                    updateDeliverable(i, { title: e.target.value })
                  }
                />
              </div>
              <select
                className="input"
                value={d.type || "long-form-video"}
                onChange={(e) =>
                  updateDeliverable(i, {
                    type: e.target.value as DeliverableType,
                  })
                }
              >
                {DELIVERABLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <textarea
                className="input"
                placeholder="Description"
                value={d.description || ""}
                onChange={(e) => updateDeliverable(i, { description: e.target.value })}
              />
              {variations.length > 0 && (
                <div className="grid gap-2">
                  <p className="text-xs font-medium text-gray-600">
                    Included with
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {variations.map((variation, variationIndex) => {
                      const label = variation.name.trim()
                        ? variation.name.trim()
                        : `Package ${variationIndex + 1}`;
                      const checked = Array.isArray(d.variationIds)
                        ? d.variationIds.includes(variation.id)
                        : false;
                      return (
                        <label
                          key={variation.id}
                          className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setDeliverableVariation(
                                i,
                                variation.id,
                                e.target.checked
                              )
                            }
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500">
                    Leave unticked to include with every package.
                  </p>
                </div>
              )}
              <input
                type="file"
                onChange={(e) => updateDeliverable(i, { file: e.target.files?.[0] || undefined })}
              />
              <button type="button" className="btn btn-sm w-fit" onClick={() => removeDeliverable(i)}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-sm w-fit" onClick={addDeliverable}>
            Add Deliverable
          </button>
        </div>
      )}

      {tab === "tasks" && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            {presetTasks.map((p) => (
              <label key={p.title} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!tasks.find((t) => t.title === p.title)}
                  onChange={() => togglePreset(p)}
                />
                {p.title}
              </label>
            ))}
          </div>
          <form onSubmit={addTaskFromForm} className="grid gap-2 border p-4 rounded">
            <input
              className="input"
              placeholder="Task title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={taskForCustomer}
                onChange={(e) => setTaskForCustomer(e.target.checked)}
              />
              Customer task
            </label>
            <textarea
              className="input"
              placeholder="Subtasks (one per line)"
              value={taskSubtasks}
              onChange={(e) => setTaskSubtasks(e.target.value)}
            />
            <button type="submit" className="btn btn-sm w-fit">
              Add Task
            </button>
          </form>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <h3 className="font-medium">Client</h3>
              {tasks
                .map((t, i) => ({ t, i }))
                .filter(({ t }) => t.forCustomer)
                .map(({ t, i }) => (
                  <div key={i} className="border p-4 rounded grid gap-2">
                    <input
                      className="input"
                      placeholder="Task title"
                      value={t.title}
                      onChange={(e) => updateTask(i, { title: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={t.forCustomer}
                        onChange={(e) => updateTask(i, { forCustomer: e.target.checked })}
                      />
                      Customer task
                    </label>
                    <textarea
                      className="input"
                      placeholder="Subtasks (one per line)"
                      value={(t.subtasks || []).join("\n")}
                      onChange={(e) => updateTaskSubtasks(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm w-fit"
                      onClick={() => removeTask(i)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
            </div>
            <div className="grid gap-2">
              <h3 className="font-medium">Internal</h3>
              {tasks
                .map((t, i) => ({ t, i }))
                .filter(({ t }) => !t.forCustomer)
                .map(({ t, i }) => (
                  <div key={i} className="border p-4 rounded grid gap-2">
                    <input
                      className="input"
                      placeholder="Task title"
                      value={t.title}
                      onChange={(e) => updateTask(i, { title: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={t.forCustomer}
                        onChange={(e) => updateTask(i, { forCustomer: e.target.checked })}
                      />
                      Customer task
                    </label>
                    <textarea
                      className="input"
                      placeholder="Subtasks (one per line)"
                      value={(t.subtasks || []).join("\n")}
                      onChange={(e) => updateTaskSubtasks(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm w-fit"
                      onClick={() => removeTask(i)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {tab === "seo" && (
        <div className="grid gap-2">
          <label className="text-sm font-medium">Page Title</label>
          <input className="input" value={seo.title || ""} onChange={(e) => setSeo({ ...seo, title: e.target.value })} />
          <label className="text-sm font-medium">Description</label>
          <textarea
            className="input"
            value={seo.description || ""}
            onChange={(e) => setSeo({ ...seo, description: e.target.value })}
          />
          <label className="text-sm font-medium">Keywords</label>
          <input
            className="input"
            value={seo.keywords || ""}
            onChange={(e) => setSeo({ ...seo, keywords: e.target.value })}
          />
          <label className="text-sm font-medium">Social Card</label>
          <input type="file" onChange={(e) => setSeoImageFile(e.target.files?.[0] || null)} />
        </div>
      )}

      {tab === "modifiers" && (
        <div className="grid gap-4">
          {allModifiers.map((group) => {
            const enabled = enabledModifierGroups.includes(group.id);
            const selections = modifiers.filter(
              (selection) => selection.groupId === group.id
            );
            return (
              <div
                key={group.id}
                className="grid gap-3 rounded border bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{group.name}</p>
                    <p className="text-xs text-gray-500">
                      {group.multiple
                        ? "Customers can combine multiple options."
                        : "Customers may choose a single option."}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleModifierGroup(group.id, e.target.checked)}
                    />
                    <span>Enabled</span>
                  </label>
                </div>
                <div className={`grid gap-3 ${enabled ? "" : "opacity-50"}`}>
                  {group.options.map((option) => {
                    const selected = selections.find(
                      (entry) => entry.optionId === option.id
                    );
                    const budget = selected?.budgetOverrides ?? emptyBudgetForm;
                    const budgetHasValues = Object.entries(budget).some(
                      ([key, value]) =>
                        key === "kitMode" ? value !== "" : value.trim().length > 0
                    );
                    const missingTemplates = selected?.missingTemplates ?? [];
                    return (
                      <div
                        key={option.id}
                        className="grid gap-2 rounded border border-dashed bg-slate-50 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <input
                            type={group.multiple ? "checkbox" : "radio"}
                            name={`mod-${group.id}`}
                            checked={!!selected}
                            disabled={!enabled}
                            onChange={(e) =>
                              handleSelectModifier(
                                group.id,
                                option.id,
                                e.target.checked
                              )
                            }
                          />
                          <span className="flex-1 min-w-[160px] font-medium">
                            {option.name}
                          </span>
                          <span className="text-xs text-gray-500">
                            Default £{Number(option.price || 0).toFixed(2)}
                          </span>
                        </div>
                        {selected && (
                          <div className="grid gap-3 text-sm">
                            <div className="grid gap-2 md:grid-cols-3">
                              <label className="grid gap-1">
                                <span className="text-xs font-medium text-gray-600">
                                  Tier 1 override
                                </span>
                                <input
                                  type="number"
                                  className="input"
                                  value={selected.price}
                                  disabled={!enabled}
                                  onChange={(e) =>
                                    updateModifierSelection(group.id, option.id, {
                                      price: e.target.value,
                                    })
                                  }
                                  placeholder={`Defaults to £${Number(option.price || 0).toFixed(2)}`}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-xs font-medium text-gray-600">
                                  Tier 2 override
                                </span>
                                <input
                                  type="number"
                                  className="input"
                                  value={selected.tier2Price}
                                  disabled={!enabled}
                                  onChange={(e) =>
                                    updateModifierSelection(group.id, option.id, {
                                      tier2Price: e.target.value,
                                    })
                                  }
                                  placeholder="Leave blank to match Tier 1"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-xs font-medium text-gray-600">
                                  Tier 3 override
                                </span>
                                <input
                                  type="number"
                                  className="input"
                                  value={selected.tier3Price}
                                  disabled={!enabled}
                                  onChange={(e) =>
                                    updateModifierSelection(group.id, option.id, {
                                      tier3Price: e.target.value,
                                    })
                                  }
                                  placeholder="Leave blank to match Tier 1"
                                />
                              </label>
                            </div>
                            <p className="text-[11px] text-gray-500">
                              Remove values to inherit the base modifier pricing for each tier.
                            </p>
                            <details
                              className="rounded border border-dashed p-3"
                              open={budgetHasValues}
                            >
                              <summary className="cursor-pointer text-sm font-medium">
                                Budget overrides
                              </summary>
                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Labour (filming)
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.labourFilming}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "labourFilming",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Labour (editing)
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.labourEditing}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "labourEditing",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Kit total
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.kit}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "kit",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Manual kit value
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.kitManual}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "kitManual",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Kit mode override
                                  </span>
                                  <select
                                    className="input"
                                    value={budget.kitMode}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "kitMode",
                                        e.target.value
                                      )
                                    }
                                  >
                                    <option value="">Inherit</option>
                                    <option value="manual">Manual</option>
                                    <option value="guided">Guided</option>
                                  </select>
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Travel miles
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.travelMiles}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "travelMiles",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Travel rate
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.travelRate}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "travelRate",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Travel cost
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.travelCost}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "travelCost",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs font-medium text-gray-600">
                                    Parking budget
                                  </span>
                                  <input
                                    type="number"
                                    className="input"
                                    value={budget.parking}
                                    disabled={!enabled}
                                    onChange={(e) =>
                                      updateModifierBudget(
                                        group.id,
                                        option.id,
                                        "parking",
                                        e.target.value
                                      )
                                    }
                                    placeholder="Inherit"
                                  />
                                </label>
                              </div>
                            </details>
                            <details className="rounded border border-dashed p-3">
                              <summary className="cursor-pointer text-sm font-medium">
                                Crew overrides
                              </summary>
                              {crewRoles.length === 0 ? (
                                <p className="mt-2 text-xs text-gray-500">
                                  Add crew roles on the P&amp;L tab to override their
                                  quantity or rates for specific modifiers.
                                </p>
                              ) : (
                                <div className="mt-3 grid gap-3">
                                  {crewRoles.map((role) => {
                                    const override =
                                      selected.crewOverrides[role.id] ||
                                      defaultCrewOverrideForm;
                                    return (
                                      <div
                                        key={role.id}
                                        className="grid gap-2 rounded border bg-white p-3"
                                      >
                                        <p className="text-sm font-semibold">
                                          {role.name || "Crew role"}
                                        </p>
                                        <div className="grid gap-2 md:grid-cols-3">
                                          <label className="grid gap-1">
                                            <span className="text-xs font-medium text-gray-600">
                                              Quantity override
                                            </span>
                                            <input
                                              type="number"
                                              className="input"
                                              value={override.quantity}
                                              disabled={!enabled}
                                              onChange={(e) =>
                                                updateModifierCrewOverride(
                                                  group.id,
                                                  option.id,
                                                  role.id,
                                                  { quantity: e.target.value }
                                                )
                                              }
                                              placeholder="Inherit"
                                            />
                                          </label>
                                          <label className="grid gap-1">
                                            <span className="text-xs font-medium text-gray-600">
                                              Unit rate override
                                            </span>
                                            <input
                                              type="number"
                                              className="input"
                                              value={override.unitRate}
                                              disabled={!enabled}
                                              onChange={(e) =>
                                                updateModifierCrewOverride(
                                                  group.id,
                                                  option.id,
                                                  role.id,
                                                  { unitRate: e.target.value }
                                                )
                                              }
                                              placeholder="Inherit"
                                            />
                                          </label>
                                          <label className="grid gap-1">
                                            <span className="text-xs font-medium text-gray-600">
                                              Budget inclusion
                                            </span>
                                            <select
                                              className="input"
                                              value={override.includeInBudget}
                                              disabled={!enabled}
                                              onChange={(e) =>
                                                updateModifierCrewOverride(
                                                  group.id,
                                                  option.id,
                                                  role.id,
                                                  {
                                                    includeInBudget: e.target
                                                      .value as CrewOverrideFormState["includeInBudget"],
                                                  }
                                                )
                                              }
                                            >
                                              <option value="inherit">Inherit</option>
                                              <option value="include">Force include</option>
                                              <option value="exclude">Force exclude</option>
                                            </select>
                                          </label>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {crewRoles.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-xs"
                                    disabled={!enabled}
                                    onClick={() => {
                                      const cleared: Record<string, CrewOverrideFormState> = {};
                                      crewRoles.forEach((role) => {
                                        cleared[role.id] = { ...defaultCrewOverrideForm };
                                      });
                                      updateModifierSelection(group.id, option.id, {
                                        crewOverrides: cleared,
                                      });
                                    }}
                                  >
                                    Clear crew overrides
                                  </button>
                                </div>
                              )}
                              {missingTemplates.length > 0 && (
                                <p className="mt-3 text-xs text-amber-600">
                                  Defaults referencing templates {missingTemplates.join(
                                    ", "
                                  )} could not find a matching crew role.
                                </p>
                              )}
                            </details>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => handleSelectModifier(group.id, option.id, false)}
                              >
                                Remove option
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {group.options.length === 0 && (
                    <p className="text-sm text-gray-500">
                      This group does not have any options yet.
                    </p>
                  )}
                  {!enabled && (
                    <p className="text-xs text-gray-500">
                      Enable the group to choose which options apply to this product.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="submit" className="btn w-fit">
        Create
      </button>
    </form>
  );
}
