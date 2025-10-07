"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { db, storage, functions } from "@/lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  addDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import type {
  Product,
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
  ProductOrderFormField,
} from "@/lib/products";
import type { PriceTiers } from "@/lib/pricing";
import type { Venue } from "@/lib/venues";
import type { KitBag, EquipmentStandard } from "@/lib/equipment";
import { defaultFranchiseRoyaltyConfig } from "@/lib/franchises";
import { generateFormId } from "@/lib/forms";
import ProductOrderFieldsEditor, {
  OrderFormFieldFormState,
} from "@/components/admin/products/ProductOrderFieldsEditor";
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
import DriveFolderPicker, {
  type DriveFolderSelection,
} from "@/components/storage/DriveFolderPicker";
import { useRoleGate } from "@/hooks/useRoleGate";

const ReactQuill = dynamic(() => import("react-quill"), { ssr: false });
import "react-quill/dist/quill.snow.css";

const PRODUCT_IMAGE_ROOT = "Product_Images";

type GalleryImage = {
  id: string;
  previewUrl: string;
  persisted: boolean;
  url?: string;
  file?: File;
};

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
  deliverableType?: DeliverableType | null;
  deliverableLabel?: string | null;
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
const DELIVERABLE_TYPE_LABELS: Record<DeliverableType, string> = DELIVERABLE_TYPES.reduce(
  (acc, entry) => ({ ...acc, [entry.value]: entry.label }),
  {} as Record<DeliverableType, string>
);

const deliverableIcons: Record<DeliverableType, IconType> = {
  "long-form-video": FiFilm,
  "short-form-vertical": FiSmartphone,
  photo: FiCamera,
  "photo-set": FiGrid,
  thumbnail: FiImage,
  "audio-licence": FiMusic,
  document: FiFileText,
};

const DRONE_STANDARD_ID = "drone_compliance";

const isDroneLabel = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const label = value.trim().toLowerCase();
  if (!label) return false;
  return label.includes("drone") || label.includes("uav") || label.includes("uas");
};

type KitGroup = {
  groupId: string;
  items: string[];
  label?: string | null;
  kitBagId?: string | null;
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

type BudgetOverrideFormState = {
  kitManual: string;
  kit: string;
  kitMode: "" | "manual" | "guided";
  travelMiles: string;
  travelRate: string;
  travelCost: string;
  parking: string;
};

const emptyBudgetForm: BudgetOverrideFormState = {
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
    typeof source?.travelRate === "number" && Number.isFinite(source.travelRate)
      ? String(source.travelRate)
      : "",
  travelCost:
    typeof source?.travelCost === "number" && Number.isFinite(source.travelCost)
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
  onsiteDays: string;
  onsiteSetupMinutes: string;
  onsiteShootMinutes: string;
  onsiteBreakdownMinutes: string;
  onsiteWindowStart: string;
  onsiteWindowEnd: string;
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

const generateRandomId = (): string =>
  typeof globalThis !== "undefined" &&
  globalThis.crypto &&
  typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const buildVariationFormState = (
  variation: ProductVariation | undefined,
  crewRoleState: CrewRoleFormState[]
): VariationFormState => {
  const features = Array.isArray(variation?.features)
    ? (variation?.features as string[])
    : [];
  const tier2 = variation?.priceTiers?.tier2;
  const tier3 = variation?.priceTiers?.tier3;
  return {
    id:
      typeof variation?.id === "string" && variation.id.length > 0
        ? variation.id
        : generateRandomId(),
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
    onsiteDays:
      typeof variation?.onsiteDays === "number" &&
      Number.isFinite(variation.onsiteDays)
        ? String(variation.onsiteDays)
        : typeof variation?.onsiteDays === "string"
          ? variation.onsiteDays
          : "",
    onsiteSetupMinutes:
      typeof variation?.onsiteSetupMinutes === "number" &&
      Number.isFinite(variation.onsiteSetupMinutes)
        ? String(variation.onsiteSetupMinutes)
        : typeof variation?.onsiteSetupMinutes === "string"
          ? variation.onsiteSetupMinutes
          : "",
    onsiteShootMinutes:
      typeof variation?.onsiteShootMinutes === "number" &&
      Number.isFinite(variation.onsiteShootMinutes)
        ? String(variation.onsiteShootMinutes)
        : typeof variation?.onsiteShootMinutes === "string"
          ? variation.onsiteShootMinutes
          : "",
    onsiteBreakdownMinutes:
      typeof variation?.onsiteBreakdownMinutes === "number" &&
      Number.isFinite(variation.onsiteBreakdownMinutes)
        ? String(variation.onsiteBreakdownMinutes)
        : typeof variation?.onsiteBreakdownMinutes === "string"
          ? variation.onsiteBreakdownMinutes
          : "",
    onsiteWindowStart:
      typeof variation?.onsiteTimeWindowStart === "string"
        ? variation.onsiteTimeWindowStart
        : "",
    onsiteWindowEnd:
      typeof variation?.onsiteTimeWindowEnd === "string"
        ? variation.onsiteTimeWindowEnd
        : "",
    budgetOverrides: createBudgetForm(variation?.budgetOverrides ?? null),
    crewOverrides: createCrewOverrideMap(
      crewRoleState,
      variation?.crewOverrides ?? null
    ),
  };
};

const buildModifierSelectionFromExisting = (
  selection: ProductModifierSelection,
  option: ModifierOption | undefined,
  crewRoleState: CrewRoleFormState[]
): ModifierSelectionFormState => {
  const rawAdjustments = Array.isArray(option?.crewAdjustments)
    ? (option?.crewAdjustments as ModifierCrewAdjustment[])
    : [];
  const templateAdjustments = rawAdjustments.filter(
    (adj): adj is ModifierCrewAdjustment =>
      !!adj && typeof adj.templateId === "string"
  );
  const crewOverrideMap = createCrewOverrideMap(
    crewRoleState,
    selection.crewOverrides ?? null
  );
  applyTemplateAdjustmentsToOverrides(
    crewOverrideMap,
    crewRoleState,
    templateAdjustments
  );
  const budgetSource = selection.budgetOverrides
    ? selection.budgetOverrides
    : option?.budgetAdjustments ?? null;
  const priceString =
    typeof selection.price === "number"
      ? String(selection.price)
      : option
      ? String(option.price ?? 0)
      : "";
  const tier2Value =
    typeof selection.priceTiers?.tier2 === "number"
      ? selection.priceTiers.tier2
      : option && typeof option.priceTiers?.tier2 === "number"
      ? option.priceTiers.tier2
      : null;
  const tier3Value =
    typeof selection.priceTiers?.tier3 === "number"
      ? selection.priceTiers.tier3
      : option && typeof option.priceTiers?.tier3 === "number"
      ? option.priceTiers.tier3
      : null;
  return {
    groupId: selection.groupId,
    optionId: selection.optionId,
    price: priceString,
    tier2Price:
      typeof tier2Value === "number" && Number.isFinite(tier2Value)
        ? String(tier2Value)
        : "",
    tier3Price:
      typeof tier3Value === "number" && Number.isFinite(tier3Value)
        ? String(tier3Value)
        : "",
    budgetOverrides: createBudgetForm(budgetSource),
    crewOverrides: crewOverrideMap,
    templateAdjustments,
    missingTemplates: computeMissingTemplates(
      crewRoleState,
      templateAdjustments
    ),
  };
};

const buildModifierSelectionFromOption = (
  groupId: string,
  option: ModifierOption,
  crewRoleState: CrewRoleFormState[]
): ModifierSelectionFormState => {
  const rawAdjustments = Array.isArray(option.crewAdjustments)
    ? (option.crewAdjustments as ModifierCrewAdjustment[])
    : [];
  const templateAdjustments = rawAdjustments.filter(
    (adj): adj is ModifierCrewAdjustment =>
      !!adj && typeof adj.templateId === "string"
  );
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
};

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;

  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<Category[]>([]);
  const [allModifiers, setAllModifiers] = useState<ModifierGroup[]>([]);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);

  type ProductTabKey =
    | "info"
    | "organiser"
    | "spec"
    | "pnl"
    | "variations"
    | "orderFields"
    | "deliverables"
    | "kit"
    | "tasks"
    | "seo"
    | "modifiers"
    | "drive";
  const [tab, setTab] = useState<ProductTabKey>("info");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagline, setTagline] = useState("");
  const [price, setPrice] = useState("0");
  const [priceTier2, setPriceTier2] = useState("");
  const [priceTier3, setPriceTier3] = useState("");
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const imageObjectUrlsRef = useRef<string[]>([]);
  const [requirements, setRequirements] = useState("");
  const [operationsInfo, setOperationsInfo] = useState("");
  const [closingWhyItWorks, setClosingWhyItWorks] = useState("");
  const [deliveryIndex, setDeliveryIndex] = useState(0);
  const [deliverables, setDeliverables] = useState<
    (ProductDeliverable & { file?: File })[]
  >([]);
  const [orderFormFields, setOrderFormFields] = useState<
    OrderFormFieldFormState[]
  >([]);
  const [variations, setVariations] = useState<VariationFormState[]>([]);
  const [organiserEnabled, setOrganiserEnabled] = useState(false);
  const [organiserMinimum, setOrganiserMinimum] = useState("");
  const [organiserExhibitorProductId, setOrganiserExhibitorProductId] =
    useState("");
  const [organiserExhibitorPrice, setOrganiserExhibitorPrice] = useState("");
  const [organiserUpsellIds, setOrganiserUpsellIds] = useState<string[]>([]);
  const [organiserCommissionRate, setOrganiserCommissionRate] = useState("");
  const toggleOrganiserUpsell = useCallback(
    (variationId: string, enabled: boolean) => {
      setOrganiserUpsellIds((prev) => {
        const next = new Set(prev);
        if (enabled) {
          next.add(variationId);
        } else {
          next.delete(variationId);
        }
        return Array.from(next);
      });
    },
    []
  );
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
  useEffect(() => {
    setOrganiserUpsellIds((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const allowed = new Set(
        variations
          .map((variation) => variation.id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      );
      const filtered = prev.filter((id) => allowed.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [variations]);
  useEffect(() => {
    if (!organiserEnabled) {
      return;
    }
    if (organiserExhibitorPrice.trim().length === 0 && price.trim().length > 0) {
      setOrganiserExhibitorPrice(price);
    }
  }, [organiserEnabled, organiserExhibitorPrice, price]);
  useEffect(() => {
    if (!organiserEnabled && tab === "organiser") {
      setTab("info");
    }
  }, [organiserEnabled, tab]);
  const [modifiers, setModifiers] = useState<ModifierSelectionFormState[]>([]);
  const [enabledModifierGroups, setEnabledModifierGroups] = useState<string[]>([]);
  const [seo, setSeo] = useState<ProductSEO>({});
  const [seoImageFile, setSeoImageFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [salesMode, setSalesMode] = useState<"ecommerce" | "quote">("ecommerce");
  const [workflowId, setWorkflowId] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventSetupDate, setEventSetupDate] = useState("");
  const [venueId, setVenueId] = useState("");
  const [venue, setVenue] = useState("");
  const [hidden, setHidden] = useState(false);
  const [driveTemplateFolderId, setDriveTemplateFolderId] = useState("");
  const [driveFolderName, setDriveFolderName] = useState("");
  const [driveTemplatePickerOpen, setDriveTemplatePickerOpen] = useState(false);
  const [tasks, setTasks] = useState<ProductTask[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskForCustomer, setTaskForCustomer] = useState(false);
  const [taskSubtasks, setTaskSubtasks] = useState("");
  const [kitGroups, setKitGroups] = useState<KitGroup[]>([]);
  const [equipmentList, setEquipmentList] = useState<
    { id: string; name: string; rentalPrice?: number; category?: string }[]
  >([]);
  const [kitBags, setKitBags] = useState<KitBag[]>([]);
  const [standards, setStandards] = useState<EquipmentStandard[]>([]);
  const [productStandards, setProductStandards] = useState<string[]>([]);
  const requiresDroneCoverage = useMemo(() => {
    if (!Array.isArray(modifiers) || modifiers.length === 0) return false;
    return modifiers.some((selection) => {
      const group = allModifiers.find((entry) => entry.id === selection.groupId);
      if (!group) return false;
      const option = group.options.find((entry) => entry.id === selection.optionId);
      if (!option) return false;
      return (
        isDroneLabel(group.name) ||
        isDroneLabel(group.id) ||
        isDroneLabel(option.name) ||
        isDroneLabel(option.id)
      );
    });
  }, [allModifiers, modifiers]);
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
  const [onsiteDays, setOnsiteDays] = useState("");
  const [onsiteSetupMinutes, setOnsiteSetupMinutes] = useState("");
  const [onsiteShootMinutes, setOnsiteShootMinutes] = useState("");
  const [onsiteBreakdownMinutes, setOnsiteBreakdownMinutes] = useState("");
  const [onsiteWindowStart, setOnsiteWindowStart] = useState("");
  const [onsiteWindowEnd, setOnsiteWindowEnd] = useState("");
  const [kitCostMode, setKitCostMode] = useState<"manual" | "guided">("manual");
  const [manualKitCost, setManualKitCost] = useState("0");
  const [travelMiles, setTravelMiles] = useState("100");
  const [travelRate, setTravelRate] = useState("0.3");
  const [parkingCost, setParkingCost] = useState("0");
  const [travelMilesTouched, setTravelMilesTouched] = useState(false);
  const [parkingTouched, setParkingTouched] = useState(false);
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
  const parseOptionalMinutes = (value: string): number | null => {
    if (!value || value.trim().length === 0) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const parseOptionalDays = (value: string): number | null => {
    if (!value || value.trim().length === 0) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const normaliseTimeOfDay = (value: string): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) {
      return null;
    }
    const [hoursStr, minutesStr] = trimmed.split(":");
    const hours = Number.parseInt(hoursStr, 10);
    const minutes = Number.parseInt(minutesStr, 10);
    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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
    if (!requiresDroneCoverage) return;
    setProductStandards((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      if (current.includes(DRONE_STANDARD_ID)) {
        return current;
      }
      return [...current, DRONE_STANDARD_ID];
    });
  }, [requiresDroneCoverage]);

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

  const toggleProductStandard = (standardId: string) => {
    setProductStandards((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      return current.includes(standardId)
        ? current.filter((id) => id !== standardId)
        : [...current, standardId];
    });
  };

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      let initialVenueId = "";
      let initialVenueName = "";
      let variationEntries: ProductVariation[] = [];
      let initialModifierSelections: ProductModifierSelection[] = [];
      let crewRoleInputs: CrewRoleFormState[] = [];
      try {
        const prodSnap = await getDoc(doc(db, "products", id));
        if (prodSnap.exists()) {
          const p = prodSnap.data() as Product;
          setName(p.name);
          setDescription(p.description);
          setTagline(p.tagline || "");
          setPrice(String(p.price));
          const tier2 = p.priceTiers?.tier2;
          const tier3 = p.priceTiers?.tier3;
          setPriceTier2(
            typeof tier2 === "number" && Number.isFinite(tier2) ? String(tier2) : ""
          );
          setPriceTier3(
            typeof tier3 === "number" && Number.isFinite(tier3) ? String(tier3) : ""
          );
          const budget = (p as any).budget || {};
          const initialKitMode =
            budget.kitMode === "guided" || budget.kitMode === "manual"
              ? budget.kitMode
              : "manual";
          const manualKit =
            budget.kitManual ?? budget.kit ?? (p as any).defaultKitCost ?? 0;
          setManualKitCost(String(manualKit));
          setKitCostMode(initialKitMode);
          setTravelMiles(String(budget.travelMiles ?? 100));
          setTravelRate(String(budget.travelRate ?? 0.3));
          setParkingCost(String(budget.parking ?? 0));
          setTravelMilesTouched(
            budget.travelMiles !== undefined && budget.travelMiles !== null
          );
          setParkingTouched(
            budget.parking !== undefined && budget.parking !== null
          );
          imageObjectUrlsRef.current.forEach((url) => {
            try {
              URL.revokeObjectURL(url);
            } catch {
              // Ignore failures when clearing previews.
            }
          });
          imageObjectUrlsRef.current = [];
          const storedGallery = Array.isArray(p.imageUrls)
            ? p.imageUrls.filter(
                (value): value is string =>
                  typeof value === "string" && value.trim().length > 0
              )
            : [];
          const fallbackImage =
            typeof p.imageUrl === "string" && p.imageUrl.trim().length > 0
              ? p.imageUrl.trim()
              : null;
          const combinedGallery =
            storedGallery.length > 0
              ? storedGallery
              : fallbackImage
              ? [fallbackImage]
              : [];
          setGalleryImages(
            combinedGallery.map((url) => ({
              id: generateFormId(),
              previewUrl: url,
              url,
              persisted: true,
            }))
          );
          setRequirements(p.requirements || "");
          setOperationsInfo(p.operationsInfo || "");
          setClosingWhyItWorks(
            typeof p.closingWhyItWorks === "string" ? p.closingWhyItWorks : ""
          );
          const idx = deliveryOptions.indexOf(p.deliveryTime || "");
          setDeliveryIndex(idx >= 0 ? idx : 0);
          setDeliverables((p.deliverables || []) as any);
          const initialOrderFields = Array.isArray(p.orderFormFields)
            ? (p.orderFormFields as ProductOrderFormField[])
            : [];
          setOrderFormFields(
            initialOrderFields.map((field) => ({
              id:
                typeof field.id === "string" && field.id.trim().length > 0
                  ? field.id
                  : generateFormId(),
              label:
                typeof field.label === "string" ? field.label : "",
              description:
                typeof field.description === "string"
                  ? field.description
                  : "",
              required: field.required === true,
              type: field.type === "long-text" ? "long-text" : "short-text",
            }))
          );
          variationEntries = Array.isArray(p.variations)
            ? (p.variations as ProductVariation[])
            : [];
          initialModifierSelections = Array.isArray(p.modifiers)
            ? (p.modifiers as ProductModifierSelection[])
            : [];
          const initialGroups =
            Array.isArray((p as any).modifierGroups) &&
            (p as any).modifierGroups.length
              ? (p as any).modifierGroups.filter(
                  (value: unknown): value is string => typeof value === "string"
                )
              : Array.from(
                  new Set(
                    ((p.modifiers || []) as any[])
                      .map((m) => m.groupId)
                      .filter((value: unknown): value is string => typeof value === "string")
                  )
                );
          setEnabledModifierGroups(initialGroups);
          setSeo(p.seo || {});
          setCategory(p.category || "");
          setSalesMode((p as any).salesMode === "quote" ? "quote" : "ecommerce");
          setEventStartDate(p.eventStartDate || p.eventDate || "");
          setEventEndDate(
            p.eventEndDate || p.eventStartDate || p.eventDate || ""
          );
          setEventSetupDate(p.eventSetupDate || "");
          initialVenueId = (p as any).venueId || "";
          initialVenueName = p.venue || "";
          setVenueId(initialVenueId);
          setVenue(initialVenueName);
          setHidden(p.hidden || false);
          const organiserProgramRaw = (p as any).organiserProgram ?? null;
          const organiserActive = organiserProgramRaw && organiserProgramRaw.enabled !== false;
          setOrganiserEnabled(Boolean(organiserActive));
          if (organiserActive) {
            const minValue = organiserProgramRaw?.minimumGuarantee;
            setOrganiserMinimum(
              minValue !== undefined && minValue !== null ? String(minValue) : ""
            );
            const exhibitorPriceValue = organiserProgramRaw?.exhibitorPrice;
            setOrganiserExhibitorPrice(
              exhibitorPriceValue !== undefined && exhibitorPriceValue !== null
                ? String(exhibitorPriceValue)
                : ""
            );
            setOrganiserExhibitorProductId(
              typeof organiserProgramRaw?.exhibitorProductId === "string"
                ? organiserProgramRaw.exhibitorProductId
                : ""
            );
            const commissionValue = organiserProgramRaw?.commissionRate;
            setOrganiserCommissionRate(
              commissionValue !== undefined && commissionValue !== null
                ? String(commissionValue)
                : ""
            );
            const upsellIds = Array.isArray(organiserProgramRaw?.upsellVariationIds)
              ? organiserProgramRaw.upsellVariationIds.filter(
                  (value: unknown): value is string =>
                    typeof value === "string" && value.trim().length > 0
                )
              : [];
            setOrganiserUpsellIds(upsellIds);
          } else {
            setOrganiserMinimum("");
            setOrganiserExhibitorPrice("");
            setOrganiserExhibitorProductId("");
            setOrganiserCommissionRate("");
            setOrganiserUpsellIds([]);
          }
          setDriveTemplateFolderId(
            typeof (p as any).driveTemplateFolderId === "string"
              ? (p as any).driveTemplateFolderId
              : ""
          );
          setDriveFolderName(
            typeof (p as any).driveFolderName === "string"
              ? (p as any).driveFolderName
              : ""
          );
          setTasks(p.defaultTasks || []);
          setWorkflowId((p as any).workflowId || "");
          setOnsiteDays(
            typeof (p as any).onsiteDays === "number"
              ? String((p as any).onsiteDays)
              : typeof (p as any).onsiteDays === "string"
                ? (p as any).onsiteDays
                : ""
          );
          setOnsiteSetupMinutes(
            typeof (p as any).onsiteSetupMinutes === "number"
              ? String((p as any).onsiteSetupMinutes)
              : typeof (p as any).onsiteSetupMinutes === "string"
                ? (p as any).onsiteSetupMinutes
                : ""
          );
          setOnsiteShootMinutes(
            typeof (p as any).onsiteShootMinutes === "number"
              ? String((p as any).onsiteShootMinutes)
              : typeof (p as any).onsiteShootMinutes === "string"
                ? (p as any).onsiteShootMinutes
                : ""
          );
          setOnsiteBreakdownMinutes(
            typeof (p as any).onsiteBreakdownMinutes === "number"
              ? String((p as any).onsiteBreakdownMinutes)
              : typeof (p as any).onsiteBreakdownMinutes === "string"
                ? (p as any).onsiteBreakdownMinutes
                : ""
          );
          setOnsiteWindowStart(
            typeof (p as any).onsiteTimeWindowStart === "string"
              ? (p as any).onsiteTimeWindowStart
              : ""
          );
          setOnsiteWindowEnd(
            typeof (p as any).onsiteTimeWindowEnd === "string"
              ? (p as any).onsiteTimeWindowEnd
              : ""
          );
          const requiredKit = Array.isArray((p as any).requiredKit)
            ? (p as any).requiredKit
            : [];
          setKitGroups(
            requiredKit.map((group: any): KitGroup => {
              const rawGroupId = typeof group?.groupId === "string" ? group.groupId : "";
              const items = Array.isArray(group?.items)
                ? group.items.filter(
                    (value: unknown): value is string => typeof value === "string"
                  )
                : [];
              const kitBagId =
                typeof group?.kitBagId === "string"
                  ? group.kitBagId
                  : rawGroupId.startsWith("kitBag:")
                  ? rawGroupId.split(":")[1] || null
                  : null;
              const label =
                typeof group?.label === "string"
                  ? group.label
                  : kitBagId
                  ? group?.name || rawGroupId
                  : rawGroupId;
              return {
                groupId: rawGroupId,
                items,
                label,
                kitBagId,
              };
            })
          );
          const rawStandards = Array.isArray((p as any).requiredStandards)
            ? (p as any).requiredStandards
            : [];
          const requiredStandards: string[] = Array.from(
            new Set(
              rawStandards
                .map((value: unknown) =>
                  typeof value === "string" ? value.trim() : ""
                )
                .filter((value: string) => value.length > 0)
            )
          );
          setProductStandards(requiredStandards);
          const rawVideos = Array.isArray((p as any).exampleVideos)
            ? (p as any).exampleVideos
            : [];
          const normalisedVideos = rawVideos
            .map((item: any): ExampleVideoInput | null => {
              if (typeof item === "string") {
                const url = item.trim();
                if (!url) return null;
                return createVideoInput({ url });
              }
              if (item && typeof item.url === "string") {
                const url = item.url.trim();
                if (!url) return null;
                const title =
                  typeof item.title === "string" ? item.title : "";
                return createVideoInput({ url, title });
              }
              return null;
            })
            .filter(
              (entry: ExampleVideoInput | null): entry is ExampleVideoInput =>
                entry !== null
            );
          if (normalisedVideos.length === 0) {
            const fallback =
              typeof (p as any).exampleWorkUrl === "string"
                ? (p as any).exampleWorkUrl.trim()
                : "";
            if (fallback) {
              normalisedVideos.push(createVideoInput({ url: fallback }));
            }
          }
          setExampleVideos(normalisedVideos);
          const specData = (p as any).productSpec || {};
          setProductSpec({
            overview:
              typeof specData.overview === "string" ? specData.overview : "",
            preparation:
              typeof specData.preparation === "string"
                ? specData.preparation
                : "",
            filming:
              typeof specData.filming === "string" ? specData.filming : "",
            editing:
              typeof specData.editing === "string" ? specData.editing : "",
            delivery:
              typeof specData.delivery === "string" ? specData.delivery : "",
            notes: typeof specData.notes === "string" ? specData.notes : "",
          });
          const rawCrewRoles = Array.isArray((p as any).crewRoles)
            ? (p as any).crewRoles
            : [];
          crewRoleInputs = rawCrewRoles.map((role: any) =>
            createCrewRoleInput({
              id:
                typeof role?.id === "string" && role.id.length > 0
                  ? role.id
                  : undefined,
              templateId:
                typeof role?.roleId === "string"
                  ? role.roleId
                  : typeof role?.templateId === "string"
                  ? role.templateId
                  : null,
              name:
                typeof role?.title === "string"
                  ? role.title
                  : typeof role?.name === "string"
                  ? role.name
                  : "",
              description:
                typeof role?.description === "string" ? role.description : "",
              instructions:
                typeof role?.instructions === "string"
                  ? role.instructions
                  : typeof role?.notes === "string"
                  ? role.notes
                  : "",
              quantity: normaliseNumberString(role?.quantity, "1"),
              unitRate: normaliseNumberString(role?.unitRate, ""),
              includeInBudget: role?.includeInBudget === false ? false : true,
            })
          );
          setCrewRoles(crewRoleInputs);
          setVariations(
            variationEntries.length
              ? variationEntries.map((variation) =>
                  buildVariationFormState(variation, crewRoleInputs)
                )
              : []
          );
        }
        const [
          catSnap,
          modSnap,
          wfSnap,
          eqSnap,
          venueSnap,
          bagSnap,
          standardSnap,
          crewRoleSnap,
        ] = await Promise.all([
          getDocs(collection(db, "categories")),
          getDocs(collection(db, "modifiers")),
          getDocs(collection(db, "workflows")),
          getDocs(collection(db, "equipment")),
          getDocs(collection(db, "venues")),
          getDocs(collection(db, "kitBags")),
          getDocs(collection(db, "equipmentStandards")),
          getDocs(collection(db, "crewRoleTemplates")),
        ]);
        setCats(catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        const modifierGroups = modSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ModifierGroup[];
        setAllModifiers(modifierGroups);
        setModifiers(
          initialModifierSelections.length
            ? initialModifierSelections.map((selection) =>
                buildModifierSelectionFromExisting(
                  selection,
                  modifierGroups
                    .find((group) => group.id === selection.groupId)
                    ?.options.find((opt) => opt.id === selection.optionId),
                  crewRoleInputs
                )
              )
            : []
        );
        setWorkflows(wfSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setEquipmentList(
          eqSnap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              name: data.name || d.id,
              rentalPrice:
                typeof data.rentalPrice === "number"
                  ? data.rentalPrice
                  : Number(data.rentalPrice) || undefined,
              category: data.category || undefined,
            };
          })
        );
        setKitBags(
          bagSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || "")) as KitBag[]
        );
        setStandards(
          standardSnap.docs
            .map(
              (d) =>
                ({
                  id: d.id,
                  ...(d.data() as any),
                } as EquipmentStandard)
            )
            .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
        );
        setCrewRoleTemplates(
          crewRoleSnap.docs
            .map((d) => {
              const data = d.data() as any;
              const quantity = toNumberOrUndefined(data.defaultQuantity);
              const rate = toNumberOrUndefined(data.defaultRate);
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
                defaultQuantity: quantity,
                defaultRate: rate,
                defaultIncludeInBudget:
                  data.defaultIncludeInBudget === false ? false : true,
              } as CrewRoleTemplate;
            })
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        const venueList = venueSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Venue))
          .sort((a, b) => a.name.localeCompare(b.name));
        setVenues(venueList);
        if (!initialVenueName && initialVenueId) {
          const match = venueList.find((v) => v.id === initialVenueId);
          if (match) setVenue(match.name);
        }
      } catch (error) {
        console.error("Failed to load product data", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading, id]);

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

  useEffect(
    () => () => {
      imageObjectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke failures during cleanup.
        }
      });
      imageObjectUrlsRef.current = [];
    },
    []
  );

  const addGalleryFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: GalleryImage[] = Array.from(files).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      imageObjectUrlsRef.current.push(previewUrl);
      return {
        id: generateFormId(),
        file,
        previewUrl,
        persisted: false,
      };
    });
    setGalleryImages((prev) => [...prev, ...additions]);
  };

  const removeGalleryImage = (id: string) => {
    setGalleryImages((prev) => {
      const target = prev.find((image) => image.id === id);
      if (target && !target.persisted && target.file) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          // Ignore revoke failures.
        }
        imageObjectUrlsRef.current = imageObjectUrlsRef.current.filter(
          (url) => url !== target.previewUrl
        );
      }
      return prev.filter((image) => image.id !== id);
    });
  };

  const makeGalleryCover = (id: string) => {
    setGalleryImages((prev) => {
      const index = prev.findIndex((image) => image.id === id);
      if (index <= 0) return prev;
      const next = [...prev];
      const [selected] = next.splice(index, 1);
      next.unshift(selected);
      return next;
    });
  };

  const handleDriveTemplateSelection = (selection: DriveFolderSelection) => {
    setDriveTemplateFolderId(selection.id);
    if (selection.name && selection.name.trim().length > 0) {
      setDriveFolderName(selection.name.trim());
    }
    setDriveTemplatePickerOpen(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const uploadedGalleryUrls = new Map<string, string>();
    const uploadBatchId = Date.now();
    for (let i = 0; i < galleryImages.length; i++) {
      const image = galleryImages[i];
      if (image.persisted || !image.file) continue;
      const storagePath = `${PRODUCT_IMAGE_ROOT}/${id}/gallery-${uploadBatchId}-${i}`;
      const url = await upload(storagePath, image.file);
      uploadedGalleryUrls.set(image.id, url);
      try {
        URL.revokeObjectURL(image.previewUrl);
      } catch {
        // Ignore revoke failures during save.
      }
      imageObjectUrlsRef.current = imageObjectUrlsRef.current.filter(
        (entry) => entry !== image.previewUrl
      );
    }
    const finalImageUrls = galleryImages
      .map((image) => {
        if (!image.persisted && image.file) {
          return uploadedGalleryUrls.get(image.id) ?? null;
        }
        if (image.url) return image.url;
        return null;
      })
      .filter((url): url is string => typeof url === "string" && url.trim().length > 0);

    const deliverableData: ProductDeliverable[] = [];
    for (let i = 0; i < deliverables.length; i++) {
      const d = deliverables[i];
      let thumb = d.thumbnailUrl;
      if (d.file)
        thumb = await upload(
          `${PRODUCT_IMAGE_ROOT}/${id}/deliverable-${i}`,
          d.file
        );
      const item: ProductDeliverable = { title: d.title };
      if (d.type) item.type = d.type;
      if (
        typeof d.quantity === "number" &&
        Number.isFinite(d.quantity) &&
        d.quantity > 0
      ) {
        item.quantity = Math.round(d.quantity);
      }
      const desc = d.description?.trim();
      if (desc) item.description = desc;
      if (thumb) item.thumbnailUrl = thumb;
      const scopedIds = Array.isArray(d.variationIds)
        ? d.variationIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0
          )
        : [];
      if (scopedIds.length > 0) item.variationIds = scopedIds;
      deliverableData.push(item);
    }

    const orderFieldData: ProductOrderFormField[] = orderFormFields
      .map((field) => {
        const label = field.label.trim();
        if (!label) return null;
        const idValue = field.id && field.id.trim().length > 0
          ? field.id
          : generateFormId();
        const description = field.description.trim();
        const type = field.type === "long-text" ? "long-text" : "short-text";
        const entry: ProductOrderFormField = {
          id: idValue,
          label,
          type,
        };
        if (description) entry.description = description;
        if (field.required) entry.required = true;
        return entry;
      })
      .filter((entry): entry is ProductOrderFormField => entry !== null);

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
      const onsiteDaysOverride = parseOptionalDays(variation.onsiteDays);
      if (onsiteDaysOverride !== null) entry.onsiteDays = onsiteDaysOverride;
      const onsiteSetupOverride = parseOptionalMinutes(
        variation.onsiteSetupMinutes
      );
      if (onsiteSetupOverride !== null)
        entry.onsiteSetupMinutes = onsiteSetupOverride;
      const onsiteShootOverride = parseOptionalMinutes(
        variation.onsiteShootMinutes
      );
      if (onsiteShootOverride !== null)
        entry.onsiteShootMinutes = onsiteShootOverride;
      const onsiteBreakdownOverride = parseOptionalMinutes(
        variation.onsiteBreakdownMinutes
      );
      if (onsiteBreakdownOverride !== null)
        entry.onsiteBreakdownMinutes = onsiteBreakdownOverride;
      const onsiteStartOverride = normaliseTimeOfDay(
        variation.onsiteWindowStart
      );
      if (onsiteStartOverride)
        entry.onsiteTimeWindowStart = onsiteStartOverride;
      const onsiteEndOverride = normaliseTimeOfDay(variation.onsiteWindowEnd);
      if (onsiteEndOverride) entry.onsiteTimeWindowEnd = onsiteEndOverride;
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

    let seoImage = seo.socialImageUrl;
    if (seoImageFile)
      seoImage = await upload(
        `${PRODUCT_IMAGE_ROOT}/${id}/seo`,
        seoImageFile
      );

    const venueLabel = venue || selectedVenue?.name || null;
    const crewRolesTotal = crewRoleData.reduce((total, role) => {
      if (role.includeInBudget === false) return total;
      const qty = Number(role.quantity) || 0;
      const rate = Number(role.unitRate) || 0;
      return total + qty * rate;
    }, 0);
    const labourValue = crewRolesTotal;
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
    const modifierOptionLookup = new Map<string, ModifierOption>();
    allModifiers.forEach((group) => {
      group.options.forEach((option) => {
        modifierOptionLookup.set(`${group.id}::${option.id}`, option);
      });
    });
    const modifierData: ProductModifierSelection[] = modifiers
      .filter((m) => enabledSet.has(m.groupId))
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
        const optionDetails = modifierOptionLookup.get(
          `${selection.groupId}::${selection.optionId}`
        );
        if (
          optionDetails &&
          (optionDetails.deliverableType || optionDetails.deliverableLabel)
        ) {
          entry.deliverable = {
            type: optionDetails.deliverableType ?? undefined,
            label:
              optionDetails.deliverableLabel?.trim() || optionDetails.name || undefined,
          };
        }
        return entry;
      });
    const requiredStandards = Array.isArray(productStandards)
      ? Array.from(
          new Set(
            productStandards
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter((id) => id.length > 0)
          )
        )
      : [];
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
    const onsiteDaysValueRaw = Number(onsiteDays);
    const onsiteDaysValue =
      onsiteDays.trim().length > 0 && Number.isFinite(onsiteDaysValueRaw) && onsiteDaysValueRaw > 0
        ? onsiteDaysValueRaw
        : null;
    const onsiteSetupValue = parseOptionalMinutes(onsiteSetupMinutes);
    const onsiteShootValue = parseOptionalMinutes(onsiteShootMinutes);
    const onsiteBreakdownValue = parseOptionalMinutes(onsiteBreakdownMinutes);
    const onsiteWindowStartValue = normaliseTimeOfDay(onsiteWindowStart);
    const onsiteWindowEndValue = normaliseTimeOfDay(onsiteWindowEnd);
    const organiserMinimumValue = parseOptionalPrice(organiserMinimum);
    const organiserExhibitorPriceValue = parseOptionalPrice(organiserExhibitorPrice);
    const organiserCommissionValue = parseOptionalPrice(organiserCommissionRate);
    const organiserUpsells = organiserUpsellIds
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);
    const organiserProgramPayload = organiserEnabled
      ? {
          enabled: true,
          minimumGuarantee: organiserMinimumValue,
          exhibitorProductId:
            organiserExhibitorProductId.trim().length > 0
              ? organiserExhibitorProductId.trim()
              : null,
          exhibitorPrice: organiserExhibitorPriceValue,
          upsellVariationIds: organiserUpsells,
          commissionRate: organiserCommissionValue,
        }
      : null;
    await updateDoc(doc(db, "products", id), {
      name,
      description,
      tagline: tagline || null,
      salesMode,
      price: baseProductPrice,
      priceTiers: productPriceTiers,
      labourCost: labourValue,
      defaultKitCost: kitValue,
      budget: {
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
      imageUrl: finalImageUrls[0] ?? null,
      imageUrls: finalImageUrls,
      requirements: requirements || null,
      operationsInfo: operationsInfo || null,
      closingWhyItWorks:
        closingWhyItWorks.trim().length > 0 ? closingWhyItWorks.trim() : null,
      deliveryTime: deliveryOptions[deliveryIndex],
      deliverables: deliverableData,
      variations: variationData,
      orderFormFields: orderFieldData,
      exampleVideos: videoData,
      exampleWorkUrl: primaryExampleVideo,
      modifierGroups: enabledGroups,
      modifiers: modifierData,
      category: category || null,
      organiserProgram: organiserProgramPayload,
      eventDate: eventStartDate || null,
      eventStartDate: eventStartDate || null,
      eventEndDate: eventEndDate || null,
      eventSetupDate: eventSetupDate || null,
      venue: venueLabel,
      venueId: venueId || null,
      onsiteDays: onsiteDaysValue,
      onsiteSetupMinutes: onsiteSetupValue,
      onsiteShootMinutes: onsiteShootValue,
      onsiteBreakdownMinutes: onsiteBreakdownValue,
      onsiteTimeWindowStart: onsiteWindowStartValue,
      onsiteTimeWindowEnd: onsiteWindowEndValue,
      hidden,
      driveTemplateFolderId:
        driveTemplateFolderId.trim().length > 0 ? driveTemplateFolderId.trim() : null,
      driveFolderName: driveFolderName.trim().length > 0 ? driveFolderName.trim() : null,
      requiredKit: kitGroups,
      requiredStandards,
      defaultTasks: tasks,
      productSpec: specPayload,
      crewRoles: crewRoleData,
      seo: {
        title: seo.title || null,
        description: seo.description || null,
        keywords: seo.keywords || null,
        socialImageUrl: seoImage || null,
      },
    });
    setOrderFormFields(
      orderFieldData.map((field) => ({
        id: field.id,
        label: field.label,
        description: field.description ?? "",
        required: field.required === true,
        type: field.type === "long-text" ? "long-text" : "short-text",
      }))
    );
    setGalleryImages(
      finalImageUrls.map((url) => ({
        id: generateFormId(),
        previewUrl: url,
        url,
        persisted: true,
      }))
    );
    const attachedBagIds = new Set(
      kitGroups
        .map((group) => group.kitBagId)
        .filter((value): value is string => typeof value === "string")
    );
    const bagAssignmentUpdates: Record<string, string[]> = {};
    await Promise.all(
      kitBags
        .filter((bag): bag is KitBag & { id: string } => typeof bag.id === "string" && bag.id.length > 0)
        .map(async (bag) => {
          const currentAssignments = Array.isArray(bag.assignedProductIds)
            ? bag.assignedProductIds.filter(
                (value: unknown): value is string => typeof value === "string"
              )
            : [];
          const shouldHave = attachedBagIds.has(bag.id);
          const alreadyHas = currentAssignments.includes(id);
          if (shouldHave && !alreadyHas) {
            const nextAssignments = [...currentAssignments, id];
            bagAssignmentUpdates[bag.id] = nextAssignments;
            await updateDoc(doc(db, "kitBags", bag.id), {
              assignedProductIds: nextAssignments,
              updatedAt: new Date(),
            });
          } else if (!shouldHave && alreadyHas) {
            const nextAssignments = currentAssignments.filter(
              (productId) => productId !== id
            );
            bagAssignmentUpdates[bag.id] = nextAssignments;
            await updateDoc(doc(db, "kitBags", bag.id), {
              assignedProductIds: nextAssignments,
              updatedAt: new Date(),
            });
          }
        })
    );
    if (Object.keys(bagAssignmentUpdates).length) {
      setKitBags((prev) =>
        prev.map((bag) =>
          bag.id && bagAssignmentUpdates[bag.id]
            ? { ...bag, assignedProductIds: bagAssignmentUpdates[bag.id] }
            : bag
        )
      );
    }
    if (workflowId) {
      const fn = httpsCallable(functions, "admin_assignWorkflow");
      await fn({ productId: id, workflowId });
    }
    router.push("/admin/products");
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

  const addVariation = () => {
    setVariations((prev) => [
      ...prev,
      buildVariationFormState(undefined, crewRoles),
    ]);
  };

  const updateVariation = (index: number, data: Partial<VariationFormState>) => {
    setVariations((prev) =>
      prev.map((variation, i) =>
        i === index ? { ...variation, ...data } : variation
      )
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
        const already = prev.find(
          (selection) =>
            selection.groupId === groupId && selection.optionId === optionId
        );
        if (already) return prev;
        const group = allModifiers.find((g) => g.id === groupId);
        const option = group?.options.find((opt) => opt.id === optionId);
        if (!option) return prev;
        const nextEntry = buildModifierSelectionFromOption(
          groupId,
          option,
          crewRoles
        );
        if (group && !group.multiple) {
          return [
            ...prev.filter((selection) => selection.groupId !== groupId),
            nextEntry,
          ];
        }
        return [...prev, nextEntry];
      }
      const next = prev.filter(
        (m) => !(m.groupId === groupId && m.optionId === optionId)
      );
      if (!next.some((entry) => entry.groupId === groupId)) {
        setEnabledModifierGroups((groups) =>
          groups.filter((id) => id !== groupId)
        );
      }
      return next;
    });
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

  const removeTask = (index: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== index));
  };

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

  const removeProduct = async () => {
    if (confirm("Delete this product?")) {
      await deleteDoc(doc(db, "products", id));
      router.push("/admin/products");
    }
  };

  const equipmentLookup = useMemo(() => {
    const map = new Map<string, typeof equipmentList[number]>();
    equipmentList.forEach((item) => map.set(item.id, item));
    return map;
  }, [equipmentList]);

  const kitGuidanceValue = useMemo(() => {
    let total = 0;
    for (const group of kitGroups) {
      for (const id of group.items) {
        const eq = equipmentLookup.get(id);
        const price = eq?.rentalPrice;
        if (typeof price === "number" && Number.isFinite(price)) {
          total += price;
        }
      }
    }
    return total;
  }, [kitGroups, equipmentLookup]);
  const kitItemsMissingPrices = useMemo(() => {
    const missing = new Set<string>();
    for (const group of kitGroups) {
      for (const id of group.items) {
        const eq = equipmentLookup.get(id);
        if (eq && !(typeof eq.rentalPrice === "number" && Number.isFinite(eq.rentalPrice))) {
          missing.add(eq.name || id);
        }
      }
    }
    return Array.from(missing);
  }, [kitGroups, equipmentLookup]);
  const selectedStandardNames = useMemo(() => {
    const lookup = new Map<string, string>();
    standards.forEach((standard) => {
      if (standard.id) {
        lookup.set(standard.id, standard.title || standard.id);
      }
    });
    return (Array.isArray(productStandards) ? productStandards : [])
      .map((id) => lookup.get(id) || id)
      .filter((name, index, array) => array.indexOf(name) === index);
  }, [productStandards, standards]);
  const droneStandardRecord = useMemo(
    () => standards.find((standard) => standard.id === DRONE_STANDARD_ID) || null,
    [standards]
  );
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
  const labourValue = crewCostValue;
  const manualKitValue = parseMoney(manualKitCost);
  const kitValue = kitCostMode === "guided" ? kitGuidanceValue : manualKitValue;
  const travelMilesValue = parseMoney(travelMiles, 100);
  const travelRateValue = parseMoney(travelRate, 0.3);
  const travelCostValue = Number.isFinite(travelMilesValue * travelRateValue)
    ? travelMilesValue * travelRateValue
    : 0;
  const parkingValue = parseMoney(parkingCost);
  const priceValue = parseMoney(price);
  const tierPriceValues = useMemo(
    () => {
      const tier1 = priceValue;
      const tier2 = priceTier2.trim().length
        ? parseMoney(priceTier2, tier1)
        : tier1;
      const tier3 = priceTier3.trim().length
        ? parseMoney(priceTier3, tier1)
        : tier1;
      return [
        { label: "Tier 1", value: tier1 },
        { label: "Tier 2", value: tier2 },
        { label: "Tier 3", value: tier3 },
      ];
    },
    [priceValue, priceTier2, priceTier3]
  );
  const franchiseRoyaltyConfig = useMemo(
    () => defaultFranchiseRoyaltyConfig(),
    []
  );
  const franchiseRateOptions = useMemo(() => {
    const rates = new Set<number>();
    franchiseRoyaltyConfig.hqTiers?.forEach((tier) => {
      if (typeof tier?.percentage === "number" && Number.isFinite(tier.percentage)) {
        rates.add(tier.percentage);
      }
    });
    const sourced = franchiseRoyaltyConfig.franchiseSourcedPercentage;
    if (typeof sourced === "number" && Number.isFinite(sourced)) {
      rates.add(sourced);
    }
    return Array.from(rates).sort((a, b) => b - a);
  }, [franchiseRoyaltyConfig]);
  const franchiseEarnings = useMemo(
    () =>
      franchiseRateOptions.map((percentage) => {
        const fraction = percentage / 100;
        return {
          percentage,
          values: tierPriceValues.map((tier) => ({
            label: tier.label,
            amount: tier.value * fraction,
          })),
        };
      }),
    [franchiseRateOptions, tierPriceValues]
  );
  const budgetTotal = labourValue + kitValue + travelCostValue + parkingValue;
  const profitValue = priceValue - budgetTotal;
  const navItems = useMemo(() => {
    const items: { key: ProductTabKey; label: string }[] = [
      { key: "info", label: "Info" },
    ];
    if (organiserEnabled) {
      items.push({ key: "organiser", label: "Organiser programme" });
    }
    items.push(
      { key: "drive", label: "Drive & Folders" },
      { key: "spec", label: "Product Spec" },
      { key: "pnl", label: "P&L" },
      { key: "variations", label: "Variations" },
      { key: "deliverables", label: "Deliverables" },
      { key: "orderFields", label: "Custom form fields" },
      { key: "kit", label: "Kit" },
      { key: "tasks", label: "Default Tasks" },
      { key: "seo", label: "SEO" },
      { key: "modifiers", label: "Modifiers" }
    );
    return items;
  }, [organiserEnabled]);
  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to edit products.</p>;

  return (
    <>
      <DriveFolderPicker
        open={driveTemplatePickerOpen}
        onClose={() => setDriveTemplatePickerOpen(false)}
        onConfirm={handleDriveTemplateSelection}
        title="Select template folder"
        description="Browse the client Drive template structure and choose the folder that should be cloned for this product."
        confirmLabel="Use this folder"
      />
      <form onSubmit={save} className="grid w-full gap-6">
      <h1 className="text-xl font-semibold">Edit Product</h1>
      <nav className="flex gap-4 border-b">
        {navItems.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
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
              Use Browse Drive to choose the Google Drive folder that should be cloned
              whenever an order for this product is created. The picker reads from the
              client Drive root and will populate the default folder name automatically.
            </p>
            <input
              className="input mt-3"
              placeholder="1AbCdEfGhIjKlMnOp"
              value={driveTemplateFolderId}
              onChange={(event) => setDriveTemplateFolderId(event.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDriveTemplatePickerOpen(true)}
              >
                Browse Drive
              </button>
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
          </div>
          <div className="rounded border bg-slate-50 p-4">
            <h2 className="text-sm font-semibold">Default folder name</h2>
            <p className="text-xs text-gray-600">
              Override the folder name that is created for this product inside each
              client&apos;s project. This will pre-fill when you select a template above,
              and you can adjust it if a different label is needed.
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
          <div className="rounded border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Sales workflow</p>
                <p className="text-xs text-gray-600">
                  Decide whether this product uses instant checkout or a bespoke quote intake.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={salesMode === "quote"}
                onClick={() =>
                  setSalesMode((current) =>
                    current === "quote" ? "ecommerce" : "quote"
                  )
                }
                className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
                  salesMode === "quote" ? "bg-orange-500" : "bg-gray-300"
                }`}
              >
                <span className="sr-only">Toggle sales workflow</span>
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    salesMode === "quote" ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-600">
              {salesMode === "quote"
                ? "Clients will request a tailored estimate with venue and project details."
                : "Clients can add the product to their cart and pay online."}
            </p>
          </div>
          <div className="rounded border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Organiser programme</p>
                <p className="text-xs text-gray-600">
                  Enable this product to unlock the organiser portal workflow, reseller pricing and upsell controls.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={organiserEnabled}
                onClick={() => setOrganiserEnabled((current) => !current)}
                className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
                  organiserEnabled ? "bg-emerald-500" : "bg-gray-300"
                }`}
              >
                <span className="sr-only">Toggle organiser programme</span>
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    organiserEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-600">
              {organiserEnabled
                ? "An organiser setup tab has been added so you can connect exhibitor products, partner pricing, and commission."
                : "Leave this off for standard services that clients purchase directly without organiser resale."}
            </p>
          </div>
          <label className="text-sm font-medium">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          <label className="text-sm font-medium">Tagline</label>
          <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          <label className="text-sm font-medium">Description</label>
        <ReactQuill theme="snow" value={description} onChange={setDescription} />
          <div className="grid gap-2">
            <label className="text-sm font-medium">Images</label>
            <input
              type="file"
              multiple
              onChange={(event) => {
                addGalleryFiles(event.target.files);
                if (event.target) {
                  event.target.value = "";
                }
              }}
            />
            {galleryImages.length === 0 ? (
              <p className="text-xs text-gray-500">
                Upload one or more images to showcase this product.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {galleryImages.map((image, index) => (
                  <div key={image.id} className="flex flex-col items-start gap-2">
                    <div className="relative">
                      <Image
                        src={image.previewUrl}
                        alt={`${name || "Product"} image ${index + 1}`}
                        width={240}
                        height={160}
                        className="h-24 w-36 rounded object-cover"
                      />
                      {index === 0 && (
                        <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                          Cover
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() => makeGalleryCover(image.id)}
                        disabled={index === 0}
                      >
                        {index === 0 ? "Cover" : "Make cover"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => removeGalleryImage(image.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Example videos</p>
                <p className="text-xs text-gray-600">
                  Add YouTube or Vimeo links to showcase previous work on the
                  storefront.
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
                  No example videos added yet.
                </p>
              )}
              {exampleVideos.map((video, index) => {
                const titleId = `example-video-title-${index}`;
                const urlId = `example-video-url-${index}`;
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
                      placeholder="Behind the scenes highlight"
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
                      Only public links are embedded. The first video appears
                      first on the product page.
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
              <label className="text-sm font-medium">Show start date</label>
              <input
                type="date"
                className="input"
                value={eventStartDate}
                onChange={(e) => {
                  const value = e.target.value;
                  setEventStartDate(value);
                  setEventEndDate((prev) => (prev ? prev : value));
                  setEventSetupDate((prev) => {
                    if (prev || !value) return prev;
                    const parsed = new Date(`${value}T00:00:00`);
                    if (Number.isNaN(parsed.getTime())) return prev;
                    const setup = new Date(parsed.getTime() - 24 * 60 * 60 * 1000);
                    return setup.toISOString().slice(0, 10);
                  });
                }}
              />
              <label className="text-sm font-medium">Show end date</label>
              <input
                type="date"
                className="input"
                value={eventEndDate}
                onChange={(e) => setEventEndDate(e.target.value)}
                min={eventStartDate || undefined}
              />
              <p className="text-xs text-gray-500 -mt-1">
                Clients will see the full run so they can pick the right day for filming.
              </p>
              <label className="text-sm font-medium">Optional setup day</label>
              <input
                type="date"
                className="input"
                value={eventSetupDate}
                onChange={(e) => setEventSetupDate(e.target.value)}
              />
              <p className="text-xs text-gray-500 -mt-1">
                Provide a date if you want to offer coverage the day before the show.
              </p>
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
          <label className="text-sm font-medium">Why it works summary</label>
          <textarea
            className="input"
            value={closingWhyItWorks}
            onChange={(e) => setClosingWhyItWorks(e.target.value)}
            placeholder="Optional closing statement shown on the product page CTA"
          />
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
          <label className="text-sm font-medium">On-site duration (days)</label>
          <input
            type="number"
            min="0.25"
            step="0.25"
            className="input"
            value={onsiteDays}
            onChange={(e) => setOnsiteDays(e.target.value)}
            placeholder="1"
          />
          <p className="text-xs text-gray-500 -mt-1">
            Used to block calendar availability for multi-day shoots.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium">Setup minutes</label>
              <input
                type="number"
                min="0"
                step="15"
                className="input"
                value={onsiteSetupMinutes}
                onChange={(e) => setOnsiteSetupMinutes(e.target.value)}
                placeholder="60"
              />
              <p className="text-xs text-gray-500">
                Optional. Time your crew needs on site before filming begins.
              </p>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Filming minutes</label>
              <input
                type="number"
                min="0"
                step="15"
                className="input"
                value={onsiteShootMinutes}
                onChange={(e) => setOnsiteShootMinutes(e.target.value)}
                placeholder="45"
              />
              <p className="text-xs text-gray-500">
                Optional. Core filming window customers should reserve.
              </p>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Breakdown minutes</label>
              <input
                type="number"
                min="0"
                step="15"
                className="input"
                value={onsiteBreakdownMinutes}
                onChange={(e) => setOnsiteBreakdownMinutes(e.target.value)}
                placeholder="15"
              />
              <p className="text-xs text-gray-500">
                Optional. Packing and wrap-up time after filming.
              </p>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Earliest arrival</label>
              <input
                type="time"
                className="input"
                value={onsiteWindowStart}
                onChange={(e) => setOnsiteWindowStart(e.target.value)}
                step={900}
                placeholder="08:00"
              />
              <p className="text-xs text-gray-500">
                Leave blank to default to 08:00.
              </p>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Latest finish</label>
              <input
                type="time"
                className="input"
                value={onsiteWindowEnd}
                onChange={(e) => setOnsiteWindowEnd(e.target.value)}
                step={900}
                placeholder="18:00"
              />
              <p className="text-xs text-gray-500">
                Leave blank to default to 18:00 or extend to fit the shoot.
              </p>
            </div>
          </div>
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

      {tab === "organiser" && (
        <div className="grid gap-4">
          <div className="rounded border bg-white p-4">
            <h2 className="text-sm font-semibold">Partner pricing & commission</h2>
            <p className="mt-1 text-xs text-gray-600">
              These defaults populate the organiser portal when a client purchases this package. Values can still be
              customised per organiser afterwards.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Minimum guarantee (£)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="500"
                  value={organiserMinimum}
                  onChange={(event) => setOrganiserMinimum(event.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Held against the organiser’s upfront payment before exhibitor sales are reconciled.
                </p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Exhibitor partner price (£)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder={price || "150"}
                  value={organiserExhibitorPrice}
                  onChange={(event) => setOrganiserExhibitorPrice(event.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Base price exhibitors see when booking through the organiser link.
                </p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Hidden exhibitor product ID</label>
                <input
                  className="input"
                  placeholder="exhibitor-product-id"
                  value={organiserExhibitorProductId}
                  onChange={(event) => setOrganiserExhibitorProductId(event.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Link a hidden product that exhibitors purchase after receiving the organiser invite.
                </p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Organiser commission (%)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="20"
                  value={organiserCommissionRate}
                  onChange={(event) => setOrganiserCommissionRate(event.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Percentage of exhibitor revenue released to the organiser once the guarantee is met.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded border bg-white p-4">
            <h2 className="text-sm font-semibold">Upsell variations for exhibitors</h2>
            <p className="mt-1 text-xs text-gray-600">
              Choose which variations or bundles unlock when exhibitors book through the organiser link.
            </p>
            {variations.length === 0 ? (
              <p className="mt-3 text-xs text-gray-500">
                Add product variations to surface upsell options in the organiser portal.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {variations.map((variation) => {
                  const variationId = variation.id;
                  if (!variationId) {
                    return null;
                  }
                  const checked = organiserUpsellIds.includes(variationId);
                  return (
                    <label
                      key={variationId}
                      className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-gray-300"
                        checked={checked}
                        onChange={(event) => toggleOrganiserUpsell(variationId, event.target.checked)}
                      />
                      <span className="grid gap-0.5">
                        <span className="font-medium text-gray-900">{variation.name || variationId}</span>
                        <span className="text-xs text-gray-600">
                          {variation.price
                            ? `Partner price: £${Number(variation.price).toFixed(2)}`
                            : "Uses organiser base price"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "spec" && (
        <div className="grid gap-6">
          <section className="grid gap-2">
            <h2 className="text-lg font-semibold">Production brief</h2>
            <p className="text-sm text-gray-600">
              Capture the filming standards, workflows, and delivery notes that
              contractors receive when this product is assigned.
            </p>
            <label className="text-sm font-medium">Overview</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.overview}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, overview: e.target.value }))
              }
              placeholder="High-level summary of the customer outcome and tone."
            />
            <label className="text-sm font-medium">Pre-production / preparation</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.preparation}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, preparation: e.target.value }))
              }
              placeholder="Booking details, contacts, mandatory checks, and kit prep."
            />
            <label className="text-sm font-medium">Filming guidelines</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.filming}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, filming: e.target.value }))
              }
              placeholder="Shot list expectations, audio requirements, and on-site processes."
            />
            <label className="text-sm font-medium">Editing / post-production</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.editing}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, editing: e.target.value }))
              }
              placeholder="Editing approach, review milestones, and export specs."
            />
            <label className="text-sm font-medium">Delivery & handover</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.delivery}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, delivery: e.target.value }))
              }
              placeholder="Where to upload finals, portal messaging, and follow-up actions."
            />
            <label className="text-sm font-medium">Additional notes</label>
            <textarea
              className="input min-h-[120px]"
              value={productSpec.notes}
              onChange={(e) =>
                setProductSpec((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Health & safety, brand guardrails, or escalation info."
            />
          </section>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Crew requirements</h2>
                <p className="text-sm text-gray-600">
                  Define the roles required to deliver this product, their
                  instructions, and default budgeting.
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
                No crew roles have been configured yet. Add the operators,
                editors, or specialists required so their guidance is ready to
                share with contractors.
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
                        placeholder="Provide the checklist contractors receive when they accept this role."
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
              Territories use Tier 1 by default unless a territory override is applied.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-6">
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
                    Guided from selected kit rental prices
                  </label>
                </div>
                {kitCostMode === "manual" ? (
                  <div className="grid gap-2">
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={manualKitCost}
                      onChange={(e) => setManualKitCost(e.target.value)}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                      <span>
                        Guided estimate from kit tab: {formatCurrency(kitGuidanceValue)}
                      </span>
                      {kitGuidanceValue > 0 && (
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => setManualKitCost(kitGuidanceValue.toFixed(2))}
                        >
                          Use guided value
                        </button>
                      )}
                    </div>
                    {kitItemsMissingPrices.length > 0 && (
                      <p className="text-xs text-amber-600">
                        Missing rental prices for {kitItemsMissingPrices.join(", ")}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded border bg-slate-50 p-3 text-sm">
                    <div className="flex justify-between font-medium">
                      <span>Guided kit total</span>
                      <span>{formatCurrency(kitGuidanceValue)}</span>
                    </div>
                    {kitGuidanceValue === 0 && (
                      <p className="mt-2 text-xs text-gray-600">
                        Select kit items and make sure rental prices are recorded to
                        build this estimate.
                      </p>
                    )}
                    {kitItemsMissingPrices.length > 0 && (
                      <p className="mt-2 text-xs text-amber-600">
                        Missing rental prices for {kitItemsMissingPrices.join(", ")}
                      </p>
                    )}
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
              {kitCostMode === "manual" && kitGuidanceValue > 0 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Guided estimate</span>
                  <span>{formatCurrency(kitGuidanceValue)}</span>
                </div>
              )}
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
            <div className="border rounded p-3 text-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Franchise earnings preview</span>
                <span className="text-xs text-gray-500">per tier</span>
              </div>
              <div className="overflow-x-auto">
                <table className="mt-1 w-full min-w-[240px] table-fixed text-xs">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1 pr-2 font-medium">Rate</th>
                      {tierPriceValues.map((tier) => (
                        <th key={tier.label} className="py-1 text-right font-medium">
                          {tier.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {franchiseEarnings.map((row) => (
                      <tr key={row.percentage} className="border-t">
                        <td className="py-1 pr-2 font-medium text-gray-700">
                          {row.percentage}%
                        </td>
                        {row.values.map((value) => (
                          <td key={value.label} className="py-1 text-right">
                            {formatCurrency(value.amount)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500">
                Uses the default HQ royalty tiers. Territory or workflow overrides may
                change the actual split.
              </p>
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
                  <details className="rounded border border-dashed p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      On-site schedule overrides
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-gray-600">
                          On-site duration (days)
                        </span>
                        <input
                          type="number"
                          min="0.25"
                          step="0.25"
                          className="input"
                          value={variation.onsiteDays}
                          onChange={(e) =>
                            updateVariation(index, { onsiteDays: e.target.value })
                          }
                          placeholder="Inherit"
                        />
                        <span className="text-[11px] text-gray-500">
                          Leave blank to inherit the base product duration.
                        </span>
                      </label>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-gray-600">
                            Setup minutes
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="15"
                            className="input"
                            value={variation.onsiteSetupMinutes}
                            onChange={(e) =>
                              updateVariation(index, {
                                onsiteSetupMinutes: e.target.value,
                              })
                            }
                            placeholder="Inherit"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-gray-600">
                            Filming minutes
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="15"
                            className="input"
                            value={variation.onsiteShootMinutes}
                            onChange={(e) =>
                              updateVariation(index, {
                                onsiteShootMinutes: e.target.value,
                              })
                            }
                            placeholder="Inherit"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-gray-600">
                            Breakdown minutes
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="15"
                            className="input"
                            value={variation.onsiteBreakdownMinutes}
                            onChange={(e) =>
                              updateVariation(index, {
                                onsiteBreakdownMinutes: e.target.value,
                              })
                            }
                            placeholder="Inherit"
                          />
                        </label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-gray-600">
                            Earliest arrival
                          </span>
                          <input
                            type="time"
                            step={900}
                            className="input"
                            value={variation.onsiteWindowStart}
                            onChange={(e) =>
                              updateVariation(index, {
                                onsiteWindowStart: e.target.value,
                              })
                            }
                            placeholder="Inherit"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-gray-600">
                            Latest finish
                          </span>
                          <input
                            type="time"
                            step={900}
                            className="input"
                            value={variation.onsiteWindowEnd}
                            onChange={(e) =>
                              updateVariation(index, {
                                onsiteWindowEnd: e.target.value,
                              })
                            }
                            placeholder="Inherit"
                          />
                        </label>
                      </div>
                      <p className="text-[11px] text-gray-500">
                        These overrides adjust booking spans and time slots for this variation
                        without changing the base product configuration.
                      </p>
                    </div>
                  </details>
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
                          step="0.01"
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

      {tab === "orderFields" && (
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium text-slate-900">
              Collect extra details when customers add this product to their cart.
            </p>
            <p className="mt-2">
              Configure optional or required questions for project information such as stand numbers,
              campaign goals, or billing references.
            </p>
          </div>
          <ProductOrderFieldsEditor
            fields={orderFormFields}
            onChange={setOrderFormFields}
          />
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
              <div className="grid gap-1">
                <label
                  htmlFor={`deliverable-${i}-quantity`}
                  className="text-xs font-medium text-gray-600"
                >
                  Quantity (optional)
                </label>
                <input
                  id={`deliverable-${i}-quantity`}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="input"
                  placeholder="Leave blank to treat as a single deliverable"
                  value={
                    typeof d.quantity === "number" &&
                    Number.isFinite(d.quantity) &&
                    d.quantity > 0
                      ? String(Math.round(d.quantity))
                      : ""
                  }
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    if (Number.isNaN(parsed) || parsed <= 0) {
                      updateDeliverable(i, { quantity: undefined });
                      return;
                    }
                    updateDeliverable(i, { quantity: parsed });
                  }}
                />
              </div>
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
              {d.thumbnailUrl && (
                <Image
                  src={d.thumbnailUrl}
                  alt={`${d.title || 'Deliverable'} thumbnail`}
                  width={192}
                  height={192}
                  className="h-auto w-24 object-cover"
                />
              )}
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

      {tab === "kit" && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <h3 className="font-medium">Required equipment standards</h3>
            <p className="text-xs text-gray-500">
              Select the standards a crew must meet before they can pick up this product in the portal.
            </p>
            {requiresDroneCoverage && (
              <div className="rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
                Drone coverage is enabled for this product, so it automatically requires{" "}
                {droneStandardRecord?.title || "drone compliance"}.{ " "}
                {droneStandardRecord
                  ? "Ensure at least one kit item is tagged with the drone compliance standard before launching sales."
                  : "Add the drone compliance standard in the equipment register so kit and crews can be approved."}
              </div>
            )}
            {standards.length === 0 ? (
              <p className="text-xs text-gray-500">
                No standards defined yet. Create standards in the equipment register to make them available here.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded border p-3">
                <ul className="grid gap-2">
                  {standards.map((standard) => {
                    if (!standard.id) return null;
                    const checked = productStandards.includes(standard.id);
                    return (
                      <li key={standard.id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProductStandard(standard.id!)}
                          />
                          <span>
                            <span className="font-medium">{standard.title || "Untitled standard"}</span>
                            {standard.minimumSpec && (
                              <span className="block text-xs text-gray-500">{standard.minimumSpec}</span>
                            )}
                            {standard.description && (
                              <span className="block text-xs text-gray-500">{standard.description}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {selectedStandardNames.length > 0 && (
              <p className="text-xs text-gray-500">
                Selected: {selectedStandardNames.join(", ")}
              </p>
            )}
          </div>
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
          {seo.socialImageUrl && (
            <Image
              src={seo.socialImageUrl}
              alt={`${name} social card`}
              width={256}
              height={256}
              className="h-auto w-32 object-cover"
            />
          )}
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
                            {(option.deliverableType || option.deliverableLabel) && (
                              <div className="rounded border border-dashed bg-white p-3 text-xs text-gray-600">
                                <p className="font-semibold text-gray-700">
                                  Additional deliverable
                                </p>
                                <p>
                                  {option.deliverableLabel?.trim() || "Uses modifier name"}
                                  {option.deliverableType
                                    ? ` (${DELIVERABLE_TYPE_LABELS[option.deliverableType] || option.deliverableType})`
                                    : ""}
                                </p>
                              </div>
                            )}
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
                                    step="0.01"
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
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn btn-xs"
                                  disabled={!enabled}
                                  onClick={() =>
                                    updateModifierSelection(group.id, option.id, {
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
                                  Add crew roles on the P&amp;L tab to adjust them for
                                  selected modifiers.
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

      <div className="flex gap-2">
        <button type="submit" className="btn w-fit">
          Save
        </button>
        <button
          type="button"
          className="btn btn-sm w-fit bg-red-600 text-white"
          onClick={removeProduct}
        >
          Delete
        </button>
      </div>
      </form>
    </>
  );
}
