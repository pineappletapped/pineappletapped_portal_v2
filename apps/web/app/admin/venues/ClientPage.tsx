"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import type { Venue } from "@/lib/venues";
import VenueMap from "@/components/VenueMap";

interface FormState {
  name: string;
  address: string;
  parkingTips: string;
  accessInfo: string;
  internetInfo: string;
  parkingRate: string;
  mileage: string;
  latitude: string;
  longitude: string;
  mapUrl: string;
  notes: string;
}

const emptyForm: FormState = {
  name: "",
  address: "",
  parkingTips: "",
  accessInfo: "",
  internetInfo: "",
  parkingRate: "",
  mileage: "",
  latitude: "",
  longitude: "",
  mapUrl: "",
  notes: "",
};

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseCoordinate(
  value: string,
  min: number,
  max: number,
  label: string
): { value: number | null; error?: string } {
  if (!value.trim()) return { value: null };
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { value: null, error: `${label} must be a valid number.` };
  }
  if (num < min || num > max) {
    return {
      value: null,
      error: `${label} must be between ${min} and ${max}.`,
    };
  }
  return { value: num };
}

function normaliseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatNumberField(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function VenueForm({
  state,
  onChange,
  onSubmit,
  submitLabel,
  loading,
  onCancel,
}: {
  state: FormState;
  onChange: (field: keyof FormState, value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  submitLabel: string;
  loading?: boolean;
  onCancel?: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Name *</span>
          <input
            className="input"
            value={state.name}
            onChange={(e) => onChange("name", e.target.value)}
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Mileage from Wellingborough (miles)</span>
          <input
            type="number"
            step="0.1"
            className="input"
            value={state.mileage}
            onChange={(e) => onChange("mileage", e.target.value)}
            placeholder="e.g. 72"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Fixed Parking Rate (£)</span>
          <input
            type="number"
            step="0.01"
            className="input"
            value={state.parkingRate}
            onChange={(e) => onChange("parkingRate", e.target.value)}
            placeholder="e.g. 18"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Address</span>
          <textarea
            className="input"
            value={state.address}
            onChange={(e) => onChange("address", e.target.value)}
            rows={3}
            placeholder="Street, City, Postcode"
          />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Latitude</span>
          <input
            type="number"
            step="0.000001"
            min={-90}
            max={90}
            className="input"
            value={state.latitude}
            onChange={(e) => onChange("latitude", e.target.value)}
            placeholder="e.g. 52.30210"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Longitude</span>
          <input
            type="number"
            step="0.000001"
            min={-180}
            max={180}
            className="input"
            value={state.longitude}
            onChange={(e) => onChange("longitude", e.target.value)}
            placeholder="e.g. -0.69342"
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Map Link</span>
        <input
          className="input"
          value={state.mapUrl}
          onChange={(e) => onChange("mapUrl", e.target.value)}
          placeholder="Optional Google Maps or venue URL"
        />
        <span className="text-xs text-gray-500">
          Provide both latitude and longitude to unlock the embedded map preview
          and include a link to directions if available.
        </span>
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Parking Tips</span>
        <textarea
          className="input"
          value={state.parkingTips}
          onChange={(e) => onChange("parkingTips", e.target.value)}
          rows={3}
          placeholder="Best places to park, permits, loading bays…"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Access Information</span>
        <textarea
          className="input"
          value={state.accessInfo}
          onChange={(e) => onChange("accessInfo", e.target.value)}
          rows={3}
          placeholder="Loading doors, lift details, security requirements…"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Internet Information</span>
        <textarea
          className="input"
          value={state.internetInfo}
          onChange={(e) => onChange("internetInfo", e.target.value)}
          rows={3}
          placeholder="Wi-Fi details, hardline availability, contact numbers…"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Additional Notes</span>
        <textarea
          className="input"
          value={state.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          rows={3}
          placeholder="Anything else worth remembering"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn" disabled={loading}>
          {loading ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function AdminVenuesPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [search, setSearch] = useState("");

  const [createForm, setCreateForm] = useState<FormState>(emptyForm);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsStaff(false);
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(db, "users", user.uid));
      const me = snap.data() as any;
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        await refresh();
      }
      setLoading(false);
    })();
  }, []);

  const refresh = async () => {
    const snap = await getDocs(collection(db, "venues"));
    const list = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) } as Venue))
      .sort((a, b) => a.name.localeCompare(b.name));
    setVenues(list);
  };

  const updateCreateForm = (field: keyof FormState, value: string) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateEditForm = (field: keyof FormState, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createForm.name.trim()) return;
    const latResult = parseCoordinate(createForm.latitude, -90, 90, "Latitude");
    if (latResult.error) {
      alert(latResult.error);
      return;
    }
    const lngResult = parseCoordinate(
      createForm.longitude,
      -180,
      180,
      "Longitude"
    );
    if (lngResult.error) {
      alert(lngResult.error);
      return;
    }
    if ((latResult.value !== null) !== (lngResult.value !== null)) {
      alert("Please provide both latitude and longitude to plot the venue on the map.");
      return;
    }
    const mapUrl = normaliseUrl(createForm.mapUrl);
    setCreating(true);
    try {
      await addDoc(collection(db, "venues"), {
        name: createForm.name.trim(),
        address: createForm.address.trim() || null,
        parkingTips: createForm.parkingTips.trim() || null,
        accessInfo: createForm.accessInfo.trim() || null,
        internetInfo: createForm.internetInfo.trim() || null,
        notes: createForm.notes.trim() || null,
        parkingRate: parseNumber(createForm.parkingRate),
        mileageFromWellingborough: parseNumber(createForm.mileage),
        latitude: latResult.value,
        longitude: lngResult.value,
        mapUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCreateForm(emptyForm);
      await refresh();
    } catch (err) {
      console.error("create venue failed", err);
      alert("Failed to create venue. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingId) return;
    if (!editForm.name.trim()) return;
    const latResult = parseCoordinate(editForm.latitude, -90, 90, "Latitude");
    if (latResult.error) {
      alert(latResult.error);
      return;
    }
    const lngResult = parseCoordinate(editForm.longitude, -180, 180, "Longitude");
    if (lngResult.error) {
      alert(lngResult.error);
      return;
    }
    if ((latResult.value !== null) !== (lngResult.value !== null)) {
      alert("Please provide both latitude and longitude to plot the venue on the map.");
      return;
    }
    const mapUrl = normaliseUrl(editForm.mapUrl);
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, "venues", editingId), {
        name: editForm.name.trim(),
        address: editForm.address.trim() || null,
        parkingTips: editForm.parkingTips.trim() || null,
        accessInfo: editForm.accessInfo.trim() || null,
        internetInfo: editForm.internetInfo.trim() || null,
        notes: editForm.notes.trim() || null,
        parkingRate: parseNumber(editForm.parkingRate),
        mileageFromWellingborough: parseNumber(editForm.mileage),
        latitude: latResult.value,
        longitude: lngResult.value,
        mapUrl,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEditForm(emptyForm);
      await refresh();
    } catch (err) {
      console.error("update venue failed", err);
      alert("Failed to update venue. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  const startEdit = (venue: Venue) => {
    setEditingId(venue.id || null);
    setEditForm({
      name: venue.name || "",
      address: venue.address || "",
      parkingTips: venue.parkingTips || "",
      accessInfo: venue.accessInfo || "",
      internetInfo: venue.internetInfo || "",
      parkingRate: formatNumberField(venue.parkingRate),
      mileage: formatNumberField(venue.mileageFromWellingborough),
      latitude: formatNumberField(venue.latitude),
      longitude: formatNumberField(venue.longitude),
      mapUrl: venue.mapUrl || "",
      notes: venue.notes || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const removeVenue = async (venue: Venue) => {
    if (!venue.id) return;
    const confirmed = confirm(`Delete ${venue.name}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, "venues", venue.id));
      if (editingId === venue.id) {
        cancelEdit();
      }
      await refresh();
    } catch (err) {
      console.error("delete venue failed", err);
      alert("Failed to delete venue. Please try again.");
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return venues;
    return venues.filter((venue) => {
      const haystack = [
        venue.name,
        venue.address,
        venue.notes,
        venue.parkingTips,
        venue.accessInfo,
        venue.internetInfo,
        venue.mapUrl,
        typeof venue.latitude === "number" ? String(venue.latitude) : null,
        typeof venue.longitude === "number" ? String(venue.longitude) : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [venues, search]);

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage venues.</p>;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap justify-between gap-4 items-end">
        <div>
          <h1 className="text-xl font-semibold">Venue Library</h1>
          <p className="text-sm text-gray-600">
            Store travel intel for commonly visited locations and link them to
            products or projects.
          </p>
        </div>
        <input
          className="input w-full sm:w-64"
          placeholder="Search venues"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <section className="card p-4 grid gap-3">
        <h2 className="text-lg font-semibold">Add a Venue</h2>
        <VenueForm
          state={createForm}
          onChange={updateCreateForm}
          onSubmit={handleCreate}
          submitLabel="Create Venue"
          loading={creating}
        />
      </section>

      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Saved Venues</h2>
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-600">No venues found.</p>
        ) : (
          <div className="grid gap-4">
            {filtered.map((venue) => {
              const isEditing = editingId === venue.id;
              const hasMileage =
                venue.mileageFromWellingborough !== undefined &&
                venue.mileageFromWellingborough !== null;
              const mileage = hasMileage
                ? `${venue.mileageFromWellingborough} miles`
                : null;
              const hasRate =
                venue.parkingRate !== undefined && venue.parkingRate !== null;
              const rate = hasRate
                ? `£${Number(venue.parkingRate).toFixed(2)}`
                : null;
              const hasCoords =
                typeof venue.latitude === "number" &&
                Number.isFinite(venue.latitude) &&
                typeof venue.longitude === "number" &&
                Number.isFinite(venue.longitude);
              return (
                <div key={venue.id} className="border rounded-md p-4 grid gap-3">
                  {isEditing ? (
                    <VenueForm
                      state={editForm}
                      onChange={updateEditForm}
                      onSubmit={handleSaveEdit}
                      submitLabel="Save Changes"
                      loading={savingEdit}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap justify-between gap-3">
                        <div className="grid gap-1">
                          <h3 className="text-base font-semibold">{venue.name}</h3>
                          <div className="text-sm text-gray-600 flex flex-wrap gap-3">
                            {mileage && <span>Mileage: {mileage}</span>}
                            {rate && <span>Parking Rate: {rate}</span>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="btn btn-sm"
                            onClick={() => startEdit(venue)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-outline text-red-600"
                            onClick={() => removeVenue(venue)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2 text-sm text-gray-700">
                        {venue.address && (
                          <p>
                            <span className="font-medium">Address:</span> {venue.address}
                          </p>
                        )}
                        {venue.parkingTips && (
                          <p className="whitespace-pre-line">
                            <span className="font-medium">Parking Tips:</span> {venue.parkingTips}
                          </p>
                        )}
                        {venue.accessInfo && (
                          <p className="whitespace-pre-line">
                            <span className="font-medium">Access:</span> {venue.accessInfo}
                          </p>
                        )}
                        {venue.internetInfo && (
                          <p className="whitespace-pre-line">
                            <span className="font-medium">Internet:</span> {venue.internetInfo}
                          </p>
                        )}
                        {venue.notes && (
                          <p className="whitespace-pre-line">
                            <span className="font-medium">Notes:</span> {venue.notes}
                          </p>
                        )}
                        {(venue.mapUrl || hasCoords) && (
                          <VenueMap venue={venue} className="mt-1" />
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
