"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type { Equipment } from "@/lib/equipment";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

interface FormState {
  name: string;
  serialNumber: string;
  category: string;
  newValue: string;
  currentValue: string;
  rentalPrice: string;
  description: string;
  notes: string;
  length: string;
  manualUrl: string;
  weightKg: string;
  damage: string;
  available: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  serialNumber: "",
  category: "",
  newValue: "",
  currentValue: "",
  rentalPrice: "",
  description: "",
  notes: "",
  length: "",
  manualUrl: "",
  weightKg: "",
  damage: "",
  available: true,
};

const RENTAL_PERCENTAGE = 0.025;

const toNumber = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function ContractorKitManager() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rentalTouched, setRentalTouched] = useState(false);
  const [currentTouched, setCurrentTouched] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const stopAuth = auth.onAuthStateChanged((user: User | null) => {
      unsubscribe?.();
      if (!user) {
        setItems([]);
        setLoading(false);
        setAuthReady(true);
        return;
      }
      setAuthReady(true);
      setLoading(true);
      const q = query(collection(db, "equipment"), where("ownerId", "==", user.uid));
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list = snapshot.docs
            .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || "")) as Equipment[];
          setItems(list);
          setLoading(false);
        },
        (err) => {
          console.error("Failed to load kit", err);
          setError("Failed to load kit. Please try again.");
          setLoading(false);
        }
      );
    });

    return () => {
      stopAuth();
      unsubscribe?.();
    };
  }, []);

  const suggestedRental = useMemo(() => {
    const purchase = toNumber(form.newValue);
    if (!purchase) return 0;
    return parseFloat((purchase * RENTAL_PERCENTAGE).toFixed(2));
  }, [form.newValue]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setRentalTouched(false);
    setCurrentTouched(false);
    setError(null);
  };

  const startNew = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (item: Equipment) => {
    setShowForm(true);
    setEditingId(item.id || null);
    setForm({
      name: item.name || "",
      serialNumber: item.serialNumber || "",
      category: item.category || "",
      newValue: item.newValue != null ? String(item.newValue) : "",
      currentValue: item.currentValue != null ? String(item.currentValue) : "",
      rentalPrice: item.rentalPrice != null ? String(item.rentalPrice) : "",
      description: item.description || "",
      notes: item.notes || "",
      length: item.length || "",
      manualUrl: item.manualUrl || "",
      weightKg: item.weightKg != null ? String(item.weightKg) : "",
      damage: item.damage || "",
      available: item.available !== false,
    });
    setRentalTouched(true);
    setCurrentTouched(true);
    setError(null);
  };

  const cancelForm = () => {
    resetForm();
    setShowForm(false);
  };

  const handleFieldChange = (name: keyof FormState, value: string | boolean) => {
    if (name === "available") {
      setForm((prev) => ({ ...prev, available: value as boolean } as FormState));
      return;
    }

    const strValue = value as string;
    if (name === "currentValue") {
      setCurrentTouched(true);
    }
    if (name === "rentalPrice") {
      setRentalTouched(true);
    }

    if (name === "newValue") {
      setForm((prev) => {
        const next: FormState = { ...prev, newValue: strValue };
        if (!currentTouched) {
          next.currentValue = strValue;
        }
        if (!rentalTouched) {
          const numeric = toNumber(strValue);
          next.rentalPrice = numeric ? (numeric * RENTAL_PERCENTAGE).toFixed(2) : "";
        }
        return next;
      });
      return;
    }

    setForm((prev) => ({ ...prev, [name]: strValue } as FormState));
  };

  const applySuggestion = () => {
    if (!suggestedRental) return;
    setForm(
      (prev) => ({ ...prev, rentalPrice: suggestedRental.toFixed(2) } as FormState)
    );
    setRentalTouched(true);
  };

  const validate = () => {
    if (!form.name.trim()) {
      return "Please enter a name for this kit item.";
    }
    if (!form.category.trim()) {
      return "Please enter a category for this kit item.";
    }
    return null;
  };

  const submit = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError("You must be signed in to manage kit.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        name: form.name.trim(),
        serialNumber: form.serialNumber.trim(),
        category: form.category.trim(),
        ownerId: user.uid,
        newValue: toNumber(form.newValue),
        currentValue: toNumber(form.currentValue),
        rentalPrice: toNumber(form.rentalPrice),
        description: form.description.trim(),
        notes: form.notes.trim(),
        length: form.length.trim(),
        manualUrl: form.manualUrl.trim(),
        weightKg: toNumber(form.weightKg),
        damage: form.damage.trim(),
        available: form.available,
        updatedAt: new Date(),
      };

      if (!editingId) {
        payload.createdAt = new Date();
        await addDoc(collection(db, "equipment"), payload);
      } else {
        await updateDoc(doc(db, "equipment", editingId), payload);
      }
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      console.error("Failed to save kit", err);
      setError(err?.message || "Failed to save kit item.");
    }
    setSaving(false);
  };

  const remove = async (id?: string) => {
    if (!id) return;
    if (!confirm("Remove this kit item?")) return;
    try {
      await deleteDoc(doc(db, "equipment", id));
    } catch (err) {
      console.error("Failed to delete kit item", err);
      setError("Failed to delete kit item. Please try again.");
    }
  };

  if (!authReady && loading) {
    return <p>Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">My Kit</h2>
          <p className="text-sm text-gray-600">
            Equipment listed here appears in the admin equipment register with
            you recorded as the owner.
          </p>
        </div>
        <button className="btn self-start" onClick={startNew}>
          Add Kit Item
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showForm && (
        <div className="border rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              {editingId ? "Update kit item" : "Add kit item"}
            </h3>
            <button className="btn btn-sm btn-outline" onClick={cancelForm}>
              Cancel
            </button>
          </div>
          <input
            className="input input-bordered"
            placeholder="Item name"
            value={form.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
          />
          <input
            className="input input-bordered"
            placeholder="Serial number"
            value={form.serialNumber}
            onChange={(e) => handleFieldChange("serialNumber", e.target.value)}
          />
          <input
            className="input input-bordered"
            placeholder="Category (camera, audio, lighting...)"
            value={form.category}
            onChange={(e) => handleFieldChange("category", e.target.value)}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <input
                className="input input-bordered"
                placeholder="Purchase price (£)"
                type="number"
                min="0"
                step="0.01"
                value={form.newValue}
                onChange={(e) => handleFieldChange("newValue", e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Used to suggest a rental price at 2.5% per day.
              </p>
            </div>
            <div className="space-y-1">
              <input
                className="input input-bordered"
                placeholder="Current value (£)"
                type="number"
                min="0"
                step="0.01"
                value={form.currentValue}
                onChange={(e) => handleFieldChange("currentValue", e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Defaults to your purchase price and can be adjusted.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex gap-2">
              <input
                className="input input-bordered flex-1"
                placeholder="Rental price per day (£)"
                type="number"
                min="0"
                step="0.01"
                value={form.rentalPrice}
                onChange={(e) => handleFieldChange("rentalPrice", e.target.value)}
              />
              {suggestedRental > 0 && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={applySuggestion}
                >
                  Use £{suggestedRental.toFixed(2)}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Suggested rental is {RENTAL_PERCENTAGE * 100}% of purchase price per
              day.
            </p>
          </div>
          <textarea
            className="textarea textarea-bordered"
            placeholder="Description"
            value={form.description}
            onChange={(e) => handleFieldChange("description", e.target.value)}
          />
          <textarea
            className="textarea textarea-bordered"
            placeholder="Notes (e.g. accessories included)"
            value={form.notes}
            onChange={(e) => handleFieldChange("notes", e.target.value)}
          />
          <textarea
            className="textarea textarea-bordered"
            placeholder="Damage / condition notes"
            value={form.damage}
            onChange={(e) => handleFieldChange("damage", e.target.value)}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <input
              className="input input-bordered"
              placeholder="Length (for cables etc.)"
              value={form.length}
              onChange={(e) => handleFieldChange("length", e.target.value)}
            />
            <input
              className="input input-bordered"
              placeholder="Manual or instructions URL"
              value={form.manualUrl}
              onChange={(e) => handleFieldChange("manualUrl", e.target.value)}
            />
            <input
              className="input input-bordered"
              placeholder="Weight (kg)"
              type="number"
              min="0"
              step="0.1"
              value={form.weightKg}
              onChange={(e) => handleFieldChange("weightKg", e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.available}
              onChange={(e) => handleFieldChange("available", e.target.checked)}
            />
            Available for hire
          </label>
          <button className="btn" onClick={submit} disabled={saving}>
            {saving ? "Saving..." : editingId ? "Update kit item" : "Save kit item"}
          </button>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-600">
          You haven&apos;t added any kit yet. Use the “Add Kit Item” button to list
          what you can supply.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Category</th>
                <th className="p-2">Purchase £</th>
                <th className="p-2">Rental £</th>
                <th className="p-2">Available</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="p-2 font-medium">{item.name}</td>
                  <td className="p-2">{item.category}</td>
                  <td className="p-2">£{(item.newValue || 0).toFixed(2)}</td>
                  <td className="p-2">£{(item.rentalPrice || 0).toFixed(2)}</td>
                  <td className="p-2">{item.available === false ? "No" : "Yes"}</td>
                  <td className="p-2 space-x-2">
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => startEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-xs btn-outline text-red-600 border-red-200"
                      onClick={() => remove(item.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
