"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { useRoleGate } from "@/hooks/useRoleGate";
import type {
  CrewRoleTemplate,
  DeliverableType,
  ProductBudgetOverride,
} from "@/lib/products";
import type { PriceTiers } from "@/lib/pricing";

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

const DELIVERABLE_TYPES: { value: DeliverableType; label: string }[] = [
  { value: "long-form-video", label: "Long Form Video" },
  { value: "short-form-vertical", label: "Short Form (Vertical)" },
  { value: "photo", label: "Photo" },
  { value: "photo-set", label: "Photo Set" },
  { value: "thumbnail", label: "Thumbnail" },
  { value: "audio-licence", label: "Audio Licence" },
  { value: "document", label: "Document" },
];

type BudgetFormState = {
  kitManual: string;
  kit: string;
  kitMode: "" | "manual" | "guided";
  travelMiles: string;
  travelRate: string;
  travelCost: string;
  parking: string;
};

const emptyBudgetForm: BudgetFormState = {
  kitManual: "",
  kit: "",
  kitMode: "",
  travelMiles: "",
  travelRate: "",
  travelCost: "",
  parking: "",
};

const createRowId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const toBudgetForm = (
  budget?: ProductBudgetOverride | null
): BudgetFormState => ({
  kitManual:
    typeof budget?.kitManual === "number" && Number.isFinite(budget.kitManual)
      ? String(budget.kitManual)
      : "",
  kit:
    typeof budget?.kit === "number" && Number.isFinite(budget.kit)
      ? String(budget.kit)
      : "",
  kitMode:
    budget?.kitMode === "manual" || budget?.kitMode === "guided"
      ? budget.kitMode
      : "",
  travelMiles:
    typeof budget?.travelMiles === "number" && Number.isFinite(budget.travelMiles)
      ? String(budget.travelMiles)
      : "",
  travelRate:
    typeof budget?.travelRate === "number" && Number.isFinite(budget.travelRate)
      ? String(budget.travelRate)
      : "",
  travelCost:
    typeof budget?.travelCost === "number" && Number.isFinite(budget.travelCost)
      ? String(budget.travelCost)
      : "",
  parking:
    typeof budget?.parking === "number" && Number.isFinite(budget.parking)
      ? String(budget.parking)
      : "",
});

const parseNumberInput = (value: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toBudgetOverride = (
  form: BudgetFormState
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

type CrewAdjustmentFormRow = {
  id: string;
  templateId: string;
  quantity: string;
  unitRate: string;
  includeInBudget: "inherit" | "include" | "exclude";
};

const toCrewAdjustmentRows = (
  adjustments?: ModifierCrewAdjustment[] | null
): CrewAdjustmentFormRow[] => {
  if (!Array.isArray(adjustments)) return [];
  return adjustments.map((adj) => ({
    id: createRowId(),
    templateId: typeof adj?.templateId === "string" ? adj.templateId : "",
    quantity:
      typeof adj?.quantity === "number" && Number.isFinite(adj.quantity)
        ? String(adj.quantity)
        : "",
    unitRate:
      typeof adj?.unitRate === "number" && Number.isFinite(adj.unitRate)
        ? String(adj.unitRate)
        : "",
    includeInBudget:
      adj?.includeInBudget === true
        ? "include"
        : adj?.includeInBudget === false
        ? "exclude"
        : "inherit",
  }));
};

const fromCrewAdjustmentRows = (
  rows: CrewAdjustmentFormRow[]
): ModifierCrewAdjustment[] | undefined => {
  const result = rows
    .map((row) => {
      const templateId = row.templateId.trim();
      if (!templateId) return null;
      const quantity = parseNumberInput(row.quantity);
      const unitRate = parseNumberInput(row.unitRate);
      const include =
        row.includeInBudget === "inherit"
          ? undefined
          : row.includeInBudget === "include";
      const payload: ModifierCrewAdjustment = { templateId };
      if (quantity !== undefined) payload.quantity = quantity;
      if (unitRate !== undefined) payload.unitRate = unitRate;
      if (include !== undefined) payload.includeInBudget = include;
      return payload;
    })
    .filter((entry): entry is ModifierCrewAdjustment => entry !== null);
  return result.length ? result : undefined;
};

export default function ModifiersPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [newName, setNewName] = useState("");
  const [newMultiple, setNewMultiple] = useState(false);
  const [templates, setTemplates] = useState<CrewRoleTemplate[]>([]);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      const [modifierSnap, templateSnap] = await Promise.all([
        getDocs(collection(db, "modifiers")),
        getDocs(collection(db, "crewRoleTemplates")),
      ]);
      setGroups(
        modifierSnap.docs.map((d) => ({
          id: d.id,
          multiple: false,
          options: [],
          ...(d.data() as any),
        })) as any
      );
      setTemplates(
        templateSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const docRef = await addDoc(collection(db, "modifiers"), {
      name: newName,
      multiple: newMultiple,
      options: [],
    });
    setGroups((g) => [
      ...g,
      { id: docRef.id, name: newName, multiple: newMultiple, options: [] },
    ]);
    setNewName("");
    setNewMultiple(false);
  };

  const addOption = async (
    groupId: string,
    name: string,
    price: string,
    tier2Price: string,
    tier3Price: string,
    deliverableType: "" | DeliverableType,
    deliverableLabel: string,
    reset: () => void
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const basePrice = parseNumberInput(price) ?? 0;
    const tier2 = parseNumberInput(tier2Price);
    const tier3 = parseNumberInput(tier3Price);
    const option: ModifierOption = {
      id: crypto.randomUUID(),
      name: trimmed,
      price: basePrice,
    };
    if (deliverableType) option.deliverableType = deliverableType;
    const deliverableLabelTrimmed = deliverableLabel.trim();
    if (deliverableLabelTrimmed) option.deliverableLabel = deliverableLabelTrimmed;
    option.priceTiers = {
      tier1: basePrice,
      ...(tier2 !== undefined ? { tier2 } : {}),
      ...(tier3 !== undefined ? { tier3 } : {}),
    };
    const ref = doc(db, "modifiers", groupId);
    const group = groups.find((g) => g.id === groupId);
    const opts = [...(group?.options || []), option];
    await updateDoc(ref, { options: opts });
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: opts } : g))
    );
    reset();
  };

  const updateGroupMeta = async (
    groupId: string,
    name: string,
    multiple: boolean
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await updateDoc(doc(db, "modifiers", groupId), {
      name: trimmed,
      multiple,
    });
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId ? { ...g, name: trimmed, multiple } : g
      )
    );
  };

  const removeGroup = async (groupId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Are you sure you want to delete this modifier group?"
      );
      if (!confirmed) return;
    }
    await deleteDoc(doc(db, "modifiers", groupId));
    setGroups((gs) => gs.filter((g) => g.id !== groupId));
  };

  const updateOption = async (groupId: string, option: ModifierOption) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const opts = group.options.map((o) => (o.id === option.id ? option : o));
    await updateDoc(doc(db, "modifiers", groupId), { options: opts });
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: opts } : g))
    );
  };

  const removeOption = async (groupId: string, optionId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this option?");
      if (!confirmed) return;
    }
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const opts = group.options.filter((o) => o.id !== optionId);
    await updateDoc(doc(db, "modifiers", groupId), { options: opts });
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: opts } : g))
    );
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage modifiers.</p>;

  return (
    <div className="grid gap-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Modifiers</h1>
      <form onSubmit={addGroup} className="grid gap-2 border p-4 rounded">
        <input
          className="input"
          placeholder="Group name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newMultiple}
            onChange={(e) => setNewMultiple(e.target.checked)}
          />
          Allow multiple selections
        </label>
        <button type="submit" className="btn btn-sm w-fit">
          Add Group
        </button>
      </form>
      <div className="grid gap-4">
        {groups.map((g) => (
          <ModifierGroupCard
            key={g.id}
            group={g}
            templates={templates}
            onAddOption={addOption}
            onUpdateGroup={updateGroupMeta}
            onDeleteGroup={removeGroup}
            onUpdateOption={updateOption}
            onDeleteOption={removeOption}
          />
        ))}
      </div>
    </div>
  );
}

function OptionForm({
  groupId,
  onAdd,
}: {
  groupId: string;
  onAdd: (
    groupId: string,
    name: string,
    price: string,
    tier2Price: string,
    tier3Price: string,
    deliverableType: "" | DeliverableType,
    deliverableLabel: string,
    reset: () => void
  ) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [tier2Price, setTier2Price] = useState("");
  const [tier3Price, setTier3Price] = useState("");
  const [deliverableType, setDeliverableType] = useState<"" | DeliverableType>(
    ""
  );
  const [deliverableLabel, setDeliverableLabel] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(
          groupId,
          name,
          price,
          tier2Price,
          tier3Price,
          deliverableType,
          deliverableLabel,
          () => {
            setName("");
            setPrice("0");
            setTier2Price("");
            setTier3Price("");
            setDeliverableType("");
            setDeliverableLabel("");
          }
        );
      }}
      className="grid gap-2 rounded border border-dashed p-3"
    >
      <h3 className="text-sm font-medium">Add option</h3>
      <input
        className="input"
        placeholder="Option name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <div className="grid gap-2 md:grid-cols-3">
        <input
          type="number"
          className="input"
          placeholder="Tier 1"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input
          type="number"
          className="input"
          placeholder="Tier 2"
          value={tier2Price}
          onChange={(e) => setTier2Price(e.target.value)}
        />
        <input
          type="number"
          className="input"
          placeholder="Tier 3"
          value={tier3Price}
          onChange={(e) => setTier3Price(e.target.value)}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-gray-600">
            Deliverable type (optional)
          </span>
          <select
            className="input"
            value={deliverableType}
            onChange={(e) =>
              setDeliverableType(
                e.target.value ? (e.target.value as DeliverableType) : ""
              )
            }
          >
            <option value="">No additional deliverable</option>
            {DELIVERABLE_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-gray-600">Deliverable label</span>
          <input
            className="input"
            value={deliverableLabel}
            onChange={(e) => setDeliverableLabel(e.target.value)}
            placeholder="e.g. Bonus thumbnail"
          />
        </label>
      </div>
      <button type="submit" className="btn btn-sm w-fit">
        Add Option
      </button>
    </form>
  );
}

function EditableOptionRow({
  groupId,
  option,
  templates,
  onUpdate,
  onDelete,
}: {
  groupId: string;
  option: ModifierOption;
  templates: CrewRoleTemplate[];
  onUpdate: (groupId: string, option: ModifierOption) => void;
  onDelete: (groupId: string, optionId: string) => void;
}) {
  const [name, setName] = useState(option.name);
  const [price, setPrice] = useState(option.price.toString());
  const [tier2Price, setTier2Price] = useState(
    option.priceTiers?.tier2 != null && Number.isFinite(option.priceTiers.tier2)
      ? String(option.priceTiers.tier2)
      : ""
  );
  const [tier3Price, setTier3Price] = useState(
    option.priceTiers?.tier3 != null && Number.isFinite(option.priceTiers.tier3)
      ? String(option.priceTiers.tier3)
      : ""
  );
  const [deliverableType, setDeliverableType] = useState<"" | DeliverableType>(
    option.deliverableType ?? ""
  );
  const [deliverableLabel, setDeliverableLabel] = useState(
    option.deliverableLabel ?? ""
  );
  const [budgetForm, setBudgetForm] = useState<BudgetFormState>(() =>
    toBudgetForm(option.budgetAdjustments)
  );
  const [crewRows, setCrewRows] = useState<CrewAdjustmentFormRow[]>(() =>
    toCrewAdjustmentRows(option.crewAdjustments)
  );

  useEffect(() => {
    setName(option.name);
    setPrice(option.price.toString());
    setTier2Price(
      option.priceTiers?.tier2 != null && Number.isFinite(option.priceTiers.tier2)
        ? String(option.priceTiers.tier2)
        : ""
    );
    setTier3Price(
      option.priceTiers?.tier3 != null && Number.isFinite(option.priceTiers.tier3)
        ? String(option.priceTiers.tier3)
        : ""
    );
    setDeliverableType(option.deliverableType ?? "");
    setDeliverableLabel(option.deliverableLabel ?? "");
    setBudgetForm(toBudgetForm(option.budgetAdjustments));
    setCrewRows(toCrewAdjustmentRows(option.crewAdjustments));
  }, [option]);

  const templateNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    templates.forEach((tpl) =>
      map.set(tpl.id, tpl.name || "Untitled template")
    );
    return map;
  }, [templates]);

  const budgetHasValues = useMemo(
    () =>
      Object.entries(budgetForm).some(([key, value]) =>
        key === "kitMode" ? value !== "" : value.trim().length > 0
      ),
    [budgetForm]
  );

  const handleBudgetChange = (
    field: keyof BudgetFormState,
    value: string
  ) => {
    setBudgetForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateCrewRow = (
    rowId: string,
    patch: Partial<CrewAdjustmentFormRow>
  ) => {
    setCrewRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
    );
  };

  const addCrewRow = () => {
    setCrewRows((rows) => [
      ...rows,
      {
        id: createRowId(),
        templateId: "",
        quantity: "",
        unitRate: "",
        includeInBudget: "inherit",
      },
    ]);
  };

  const removeCrewRow = (rowId: string) => {
    setCrewRows((rows) => rows.filter((row) => row.id !== rowId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const basePrice = parseNumberInput(price) ?? 0;
    const tier2 = parseNumberInput(tier2Price);
    const tier3 = parseNumberInput(tier3Price);
    const payload: ModifierOption = {
      ...option,
      name: trimmed,
      price: basePrice,
      priceTiers: {
        tier1: basePrice,
        ...(tier2 !== undefined ? { tier2 } : {}),
        ...(tier3 !== undefined ? { tier3 } : {}),
      },
    };
    if (deliverableType) payload.deliverableType = deliverableType;
    else delete (payload as any).deliverableType;
    const deliverableLabelTrimmed = deliverableLabel.trim();
    if (deliverableLabelTrimmed) payload.deliverableLabel = deliverableLabelTrimmed;
    else delete (payload as any).deliverableLabel;
    const budgetOverrides = toBudgetOverride(budgetForm);
    if (budgetOverrides) payload.budgetAdjustments = budgetOverrides;
    else delete (payload as any).budgetAdjustments;
    const crewAdjustments = fromCrewAdjustmentRows(crewRows);
    if (crewAdjustments) payload.crewAdjustments = crewAdjustments;
    else delete (payload as any).crewAdjustments;
    onUpdate(groupId, payload);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded border p-3 text-sm bg-white"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[160px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="grid gap-2 md:grid-cols-3 flex-1 min-w-[220px]">
          <input
            type="number"
            className="input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Tier 1"
          />
          <input
            type="number"
            className="input"
            value={tier2Price}
            onChange={(e) => setTier2Price(e.target.value)}
            placeholder="Tier 2"
          />
          <input
            type="number"
            className="input"
            value={tier3Price}
            onChange={(e) => setTier3Price(e.target.value)}
            placeholder="Tier 3"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-sm w-fit">
            Save
          </button>
          <button
            type="button"
            className="btn btn-sm w-fit bg-red-600 text-white"
            onClick={() => onDelete(groupId, option.id)}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-gray-600">
            Deliverable type (optional)
          </span>
          <select
            className="input"
            value={deliverableType}
            onChange={(e) =>
              setDeliverableType(
                e.target.value ? (e.target.value as DeliverableType) : ""
              )
            }
          >
            <option value="">No additional deliverable</option>
            {DELIVERABLE_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-gray-600">
            Deliverable label
          </span>
          <input
            className="input"
            value={deliverableLabel}
            onChange={(e) => setDeliverableLabel(e.target.value)}
            placeholder="e.g. Social media thumbnail"
          />
        </label>
      </div>

      <details
        className="rounded border border-dashed p-3"
        open={budgetHasValues}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Budget adjustments
        </summary>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-gray-600">Kit total</span>
            <input
              type="number"
              className="input"
              value={budgetForm.kit}
              onChange={(e) => handleBudgetChange("kit", e.target.value)}
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
              value={budgetForm.kitManual}
              onChange={(e) =>
                handleBudgetChange("kitManual", e.target.value)
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
              value={budgetForm.kitMode}
              onChange={(e) =>
                handleBudgetChange("kitMode", e.target.value)
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
              value={budgetForm.travelMiles}
              onChange={(e) =>
                handleBudgetChange("travelMiles", e.target.value)
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
              value={budgetForm.travelRate}
              onChange={(e) =>
                handleBudgetChange("travelRate", e.target.value)
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
              value={budgetForm.travelCost}
              onChange={(e) =>
                handleBudgetChange("travelCost", e.target.value)
              }
              placeholder="Inherit"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-gray-600">
              Parking
            </span>
            <input
              type="number"
              className="input"
              value={budgetForm.parking}
              onChange={(e) =>
                handleBudgetChange("parking", e.target.value)
              }
              placeholder="Inherit"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => setBudgetForm(emptyBudgetForm)}
          >
            Clear budget overrides
          </button>
        </div>
      </details>

      <details
        className="rounded border border-dashed p-3"
        open={crewRows.length > 0}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Crew adjustments
        </summary>
        <div className="mt-3 grid gap-3">
          {crewRows.length === 0 && (
            <p className="text-xs text-gray-500">
              No crew template overrides added.
            </p>
          )}
          {crewRows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 rounded border bg-white p-3"
            >
              <label className="grid gap-1">
                <span className="text-xs font-medium text-gray-600">
                  Crew template
                </span>
                <select
                  className="input"
                  value={row.templateId}
                  onChange={(e) =>
                    updateCrewRow(row.id, { templateId: e.target.value })
                  }
                >
                  <option value="">Select template</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name || "Untitled template"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-gray-600">
                    Quantity override
                  </span>
                  <input
                    type="number"
                    className="input"
                    value={row.quantity}
                    onChange={(e) =>
                      updateCrewRow(row.id, { quantity: e.target.value })
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
                    value={row.unitRate}
                    onChange={(e) =>
                      updateCrewRow(row.id, { unitRate: e.target.value })
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
                    value={row.includeInBudget}
                    onChange={(e) =>
                      updateCrewRow(row.id, {
                        includeInBudget: e.target
                          .value as CrewAdjustmentFormRow["includeInBudget"],
                      })
                    }
                  >
                    <option value="inherit">Inherit</option>
                    <option value="include">Force include</option>
                    <option value="exclude">Force exclude</option>
                  </select>
                </label>
              </div>
              {row.templateId && !templateNameLookup.has(row.templateId) && (
                <p className="text-xs text-amber-600">
                  Template no longer exists. Update or remove this override.
                </p>
              )}
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => removeCrewRow(row.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-xs" onClick={addCrewRow}>
            Add crew adjustment
          </button>
          {crewRows.length > 0 && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => setCrewRows([])}
            >
              Clear crew adjustments
            </button>
          )}
        </div>
        {templates.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">
            No crew role templates found. Create templates to target roles by
            default.
          </p>
        )}
      </details>
    </form>
  );
}

function ModifierGroupCard({
  group,
  templates,
  onAddOption,
  onUpdateGroup,
  onDeleteGroup,
  onUpdateOption,
  onDeleteOption,
}: {
  group: ModifierGroup;
  templates: CrewRoleTemplate[];
  onAddOption: (
    groupId: string,
    name: string,
    price: string,
    tier2Price: string,
    tier3Price: string,
    deliverableType: "" | DeliverableType,
    deliverableLabel: string,
    reset: () => void
  ) => Promise<void> | void;
  onUpdateGroup: (groupId: string, name: string, multiple: boolean) => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateOption: (groupId: string, option: ModifierOption) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [multiple, setMultiple] = useState(group.multiple);
  useEffect(() => {
    setName(group.name);
    setMultiple(group.multiple);
  }, [group.id, group.name, group.multiple]);

  return (
    <div className="border p-4 rounded grid gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onUpdateGroup(group.id, name, multiple);
        }}
        className="grid gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            className="input flex-1 min-w-[180px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(e) => setMultiple(e.target.checked)}
              />
              Allow multiple
            </label>
            <button type="submit" className="btn btn-sm w-fit">
              Save
            </button>
            <button
              type="button"
              className="btn btn-sm w-fit bg-red-600 text-white"
              onClick={() => onDeleteGroup(group.id)}
            >
              Delete
            </button>
          </div>
        </div>
      </form>
      <div className="grid gap-2">
        {group.options.length === 0 ? (
          <p className="text-sm text-gray-600">No options yet.</p>
        ) : (
          group.options.map((option) => (
            <EditableOptionRow
              key={option.id}
              groupId={group.id}
              option={option}
              templates={templates}
              onUpdate={onUpdateOption}
              onDelete={onDeleteOption}
            />
          ))
      )}
      </div>
      <OptionForm groupId={group.id} onAdd={onAddOption} />
    </div>
  );
}
