"use client";

import { useEffect, useMemo, useState } from "react";

export type ProposalSetupLayout = "conference" | "panel" | "interview" | "custom";

export interface ProposalSetupItem {
  id: string;
  name: string;
  category?: string;
  icon?: string;
  type: "equipment" | "stock";
}

export interface ProposalSetupPlacement {
  id: string;
  itemId: string;
  itemName: string;
  zone: string;
  quantity: number;
  notes?: string;
  icon: string;
  type: "equipment" | "stock";
}

export interface ProposalSetupPlan {
  layout: ProposalSetupLayout;
  notes: string;
  placements: ProposalSetupPlacement[];
}

interface ProposalSetupBuilderProps {
  kitItems: ProposalSetupItem[];
  value: ProposalSetupPlan;
  onChange: (next: ProposalSetupPlan) => void;
}

const LAYOUT_OPTIONS: { id: ProposalSetupLayout; label: string; description: string }[] = [
  { id: "conference", label: "Conference stage", description: "Dual camera coverage with lighting truss and stage wash." },
  { id: "panel", label: "Panel / fireside", description: "Wider seating arc, focus on discussion area." },
  { id: "interview", label: "Interview setup", description: "Compact lighting tree and backdrop focus." },
  { id: "custom", label: "Custom", description: "Build your own layout from scratch." },
];

const ZONES: { id: string; label: string; description: string }[] = [
  { id: "stage-front", label: "Stage front", description: "Talent position, lecterns, panel seating." },
  { id: "stage-rear", label: "Stage rear", description: "Backdrops, uplighters, media walls." },
  { id: "audience", label: "Audience", description: "Audience POV cameras, mics, seating." },
  { id: "lighting", label: "Lighting rig", description: "Key/fill lights, effects, truss gear." },
  { id: "control", label: "Control / steering", description: "Vision mix, comms, streaming desk." },
  { id: "support", label: "Support areas", description: "Signage, power, staging stores." },
];

const STOCK_ITEMS: ProposalSetupItem[] = [
  { id: "stock-stage-platform", name: "Stage platform", category: "staging", icon: "🎤", type: "stock" },
  { id: "stock-lectern", name: "Lectern", category: "staging", icon: "🎙️", type: "stock" },
  { id: "stock-seating", name: "Panel seating", category: "seating", icon: "🪑", type: "stock" },
  { id: "stock-av-rack", name: "AV rack", category: "control", icon: "🧰", type: "stock" },
  { id: "stock-stream-encoder", name: "Streaming encoder", category: "control", icon: "🖥️", type: "stock" },
  { id: "stock-power", name: "Power distro", category: "power", icon: "🔌", type: "stock" },
  { id: "stock-comms", name: "Comms headsets", category: "comms", icon: "🎧", type: "stock" },
  { id: "stock-drape", name: "Backdrop drape", category: "dressing", icon: "🪄", type: "stock" },
];

const CATEGORY_ICONS: { match: RegExp; icon: string }[] = [
  { match: /camera|ptz/i, icon: "📷" },
  { match: /lens/i, icon: "🎞️" },
  { match: /light|lighting|led|uplit/i, icon: "💡" },
  { match: /mic|audio|wireless/i, icon: "🎤" },
  { match: /switcher|vision|mix|encoder|stream/i, icon: "🎛️" },
  { match: /monitor|display|screen/i, icon: "🖥️" },
  { match: /rig|truss|stand/i, icon: "🪜" },
  { match: /power|battery/i, icon: "🔋" },
];

const randomId = () => Math.random().toString(36).slice(2, 10);

function iconForItem(item: ProposalSetupItem): string {
  if (item.icon) return item.icon;
  const source = item.category || item.name;
  for (const entry of CATEGORY_ICONS) {
    if (entry.match.test(source)) return entry.icon;
  }
  return "⚙️";
}

export default function ProposalSetupBuilder({ kitItems, value, onChange }: ProposalSetupBuilderProps) {
  const [layout, setLayout] = useState<ProposalSetupLayout>(value.layout);
  const [notes, setNotes] = useState<string>(value.notes || "");
  const [placements, setPlacements] = useState<ProposalSetupPlacement[]>(value.placements || []);
  const [search, setSearch] = useState("");
  const [pendingItem, setPendingItem] = useState<ProposalSetupItem | null>(null);
  const [selectedZone, setSelectedZone] = useState<string>(ZONES[0]?.id || "stage-front");
  const [quantity, setQuantity] = useState<number>(1);
  const [placementNotes, setPlacementNotes] = useState<string>("");

  useEffect(() => {
    setLayout(value.layout);
    setNotes(value.notes || "");
    setPlacements(value.placements || []);
  }, [value]);

  useEffect(() => {
    onChange({ layout, notes, placements });
  }, [layout, notes, placements, onChange]);

  useEffect(() => {
    if (!pendingItem) return;
    setSelectedZone(ZONES[0]?.id || "stage-front");
    setQuantity(1);
    setPlacementNotes("");
  }, [pendingItem]);

  useEffect(() => {
    if (!kitItems) return;
    setPlacements((prev) =>
      prev.filter((placement) =>
        placement.type === "stock" || kitItems.some((item) => item.id === placement.itemId)
      )
    );
  }, [kitItems]);

  const combinedLibrary = useMemo(() => {
    const dedupe = new Map<string, ProposalSetupItem>();
    [...kitItems, ...STOCK_ITEMS].forEach((item) => {
      const icon = iconForItem(item);
      dedupe.set(item.id, { ...item, icon });
    });
    return Array.from(dedupe.values());
  }, [kitItems]);

  const filteredLibrary = useMemo(() => {
    if (!search.trim()) return combinedLibrary;
    const term = search.trim().toLowerCase();
    return combinedLibrary.filter((item) =>
      item.name.toLowerCase().includes(term) || item.category?.toLowerCase().includes(term)
    );
  }, [combinedLibrary, search]);

  const placementsByZone = useMemo(() => {
    return ZONES.map((zone) => ({
      zone,
      placements: placements.filter((p) => p.zone === zone.id),
    }));
  }, [placements]);

  const handleAddPlacement = () => {
    if (!pendingItem) return;
    const placement: ProposalSetupPlacement = {
      id: randomId(),
      itemId: pendingItem.id,
      itemName: pendingItem.name,
      icon: iconForItem(pendingItem),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      zone: selectedZone,
      notes: placementNotes.trim() ? placementNotes.trim() : undefined,
      type: pendingItem.type,
    };
    setPlacements((prev) => [...prev, placement]);
    setPendingItem(null);
  };

  const removePlacement = (id: string) => {
    setPlacements((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <span className="text-sm font-medium">Stage layout</span>
        <div className="grid gap-2 md:grid-cols-2">
          {LAYOUT_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`card p-3 text-left border ${layout === option.id ? "border-blue-500 shadow" : "border-transparent"}`}
              type="button"
              onClick={() => setLayout(option.id)}
            >
              <div className="font-semibold flex items-center gap-2">
                <span>{layout === option.id ? "✅" : ""}</span>
                {option.label}
              </div>
              <p className="text-sm text-gray-600">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-[1.2fr_1fr] gap-4">
        <div className="card p-4 grid gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Equipment & stock library</h3>
            <span className="text-xs text-gray-500">{combinedLibrary.length} items</span>
          </div>
          <input
            className="input"
            placeholder="Search camera, lighting, staging…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="grid gap-2 max-h-64 overflow-y-auto pr-1">
            {filteredLibrary.length === 0 ? (
              <p className="text-sm text-gray-500">No matching equipment.</p>
            ) : (
              filteredLibrary.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 border border-gray-200 rounded-md p-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xl" aria-hidden>{iconForItem(item)}</span>
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-gray-500 capitalize">{item.category || item.type}</div>
                    </div>
                  </div>
                  <button className="btn" type="button" onClick={() => setPendingItem(item)}>
                    Add
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card p-4 grid gap-3">
          <h3 className="font-semibold">Placement canvas</h3>
          {pendingItem ? (
            <div className="grid gap-2 border border-dashed border-blue-400 rounded-md p-3 bg-blue-50">
              <div className="flex items-center gap-2">
                <span className="text-2xl" aria-hidden>{iconForItem(pendingItem)}</span>
                <div>
                  <p className="font-medium">{pendingItem.name}</p>
                  <p className="text-xs text-gray-500">Choose zone and notes</p>
                </div>
              </div>
              <label className="grid gap-1 text-sm">
                <span>Zone</span>
                <select className="input" value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)}>
                  {ZONES.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>Quantity</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Notes</span>
                <textarea
                  className="input"
                  placeholder="Camera height, focus role, cueing notes…"
                  value={placementNotes}
                  onChange={(event) => setPlacementNotes(event.target.value)}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button className="btn-outline" type="button" onClick={() => setPendingItem(null)}>
                  Cancel
                </button>
                <button className="btn" type="button" onClick={handleAddPlacement}>
                  Place item
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Select equipment to place it on the plan. Configure zone, quantity, and specific cues.
            </p>
          )}
        </div>
      </div>

      <div className="card p-4 grid gap-3">
        <h3 className="font-semibold">Zone overview</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {placementsByZone.map(({ zone, placements: zonePlacements }) => (
            <div key={zone.id} className="border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{zone.label}</p>
                  <p className="text-xs text-gray-500">{zone.description}</p>
                </div>
                <span className="text-xs text-gray-500">{zonePlacements.length} item{zonePlacements.length === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-2 grid gap-2">
                {zonePlacements.length === 0 ? (
                  <p className="text-xs text-gray-400">Nothing placed yet.</p>
                ) : (
                  zonePlacements.map((placement) => (
                    <div key={placement.id} className="flex items-start justify-between gap-2 bg-gray-50 rounded-md p-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg" aria-hidden>{placement.icon}</span>
                          <p className="font-medium text-sm">
                            {placement.itemName} ×{placement.quantity}
                          </p>
                        </div>
                        {placement.notes && <p className="text-xs text-gray-500 mt-1">{placement.notes}</p>}
                      </div>
                      <button className="btn-outline" type="button" onClick={() => removePlacement(placement.id)}>
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="grid gap-1 text-sm">
        <span>Additional notes</span>
        <textarea
          className="input"
          placeholder="Site access, rig times, budget notes…"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
    </div>
  );
}
