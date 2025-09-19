"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Auth, User } from "firebase/auth";
import type { Equipment } from "@/lib/equipment";
import { ensureFirebase } from "@/lib/firebase";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

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
  photoUrl: string;
  documents: string[];
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
  photoUrl: "",
  documents: [],
};

const RENTAL_PERCENTAGE = 0.025;

const toNumber = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface BookingEntry {
  id: string;
  start: Date;
  end: Date;
  projectId?: string;
  status?: string;
  notes?: string;
}

interface BookingState {
  bookings: BookingEntry[];
  hasConflicts: boolean;
  conflictIds: string[];
  error?: string;
}

const toDateSafe = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const maybeDate = new Date(value);
  return Number.isNaN(maybeDate.getTime()) ? null : maybeDate;
};

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const formatDateRange = (start: Date, end: Date) => {
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return formatDate(start);
  }
  return `${formatDate(start)} → ${formatDate(end)}`;
};

const detectConflicts = (bookings: BookingEntry[]) => {
  const sorted = [...bookings].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  const conflictIds: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const comparison = sorted[j];
      if (comparison.start.getTime() <= current.end.getTime()) {
        if (!conflictIds.includes(current.id)) {
          conflictIds.push(current.id);
        }
        if (!conflictIds.includes(comparison.id)) {
          conflictIds.push(comparison.id);
        }
      } else {
        break;
      }
    }
  }
  return conflictIds;
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
  const [authInstance, setAuthInstance] = useState<Auth | null>(null);
  const [firestore, setFirestore] = useState<Firestore | null>(null);
  const [storageInstance, setStorageInstance] = useState<FirebaseStorage | null>(
    null
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [fileInputsKey, setFileInputsKey] = useState(0);
  const [bookingsState, setBookingsState] = useState<Record<string, BookingState>>({});
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let stopAuth: (() => void) | undefined;
    let cancelled = false;

    const markUnavailable = (
      message: string,
      userMessage = "Authentication is currently unavailable. Please refresh the page."
    ) => {
      if (cancelled) return;
      console.error(message);
      setError(userMessage);
      setItems([]);
      setAuthReady(true);
      setLoading(false);
    };

    (async () => {
      try {
        const { auth, db, storage } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || typeof auth.onAuthStateChanged !== "function") {
          markUnavailable("Firebase auth is unavailable or missing onAuthStateChanged");
          return;
        }

        if (!db) {
          markUnavailable(
            "Firestore is unavailable after Firebase initialisation",
            "Equipment data is currently unavailable. Please refresh the page."
          );
          return;
        }

        setAuthInstance(auth);
        setFirestore(db);
        setStorageInstance(storage ?? null);

        stopAuth = auth.onAuthStateChanged((user: User | null) => {
          unsubscribe?.();
          if (!user) {
            setItems([]);
            setLoading(false);
            setAuthReady(true);
            return;
          }

          setError(null);
          setAuthReady(true);
          setLoading(true);

          const equipmentQuery = query(
            collection(db, "equipment"),
            where("ownerId", "==", user.uid)
          );

          unsubscribe = onSnapshot(
            equipmentQuery,
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
      } catch (err) {
        console.error("Failed to initialise Firebase for ContractorKitManager", err);
        markUnavailable(
          "Failed to initialise Firebase for ContractorKitManager",
          "We couldn't connect to the equipment service. Please refresh the page."
        );
      }
    })();

    return () => {
      cancelled = true;
      stopAuth?.();
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!firestore) {
      setBookingsState({});
      setBookingsLoading(false);
      return;
    }

    let cancelled = false;
    const loadBookings = async () => {
      if (!items.length) {
        setBookingsState({});
        setBookingsError(null);
        setBookingsLoading(false);
        return;
      }

      setBookingsLoading(true);
      setBookingsError(null);

      try {
        const now = Timestamp.fromDate(new Date());
        const results = await Promise.all(
          items.map(async (item) => {
            if (!item.id) {
              return ["", { bookings: [], hasConflicts: false, conflictIds: [] }] as [
                string,
                BookingState,
              ];
            }
            try {
              const bookingsRef = collection(
                doc(firestore, "equipment", item.id),
                "bookings"
              );
              const snap = await getDocs(query(bookingsRef, where("end", ">=", now)));
              const entries = snap.docs
                .map((docSnap) => {
                  const data = docSnap.data() as any;
                  const start = toDateSafe(data.start);
                  const end = toDateSafe(data.end);
                  if (!start || !end) {
                    return null;
                  }
                  return {
                    id: docSnap.id,
                    start,
                    end,
                    projectId: data.projectId,
                    status: data.status,
                    notes: data.notes,
                  } as BookingEntry;
                })
                .filter((entry): entry is BookingEntry => entry !== null)
                .filter((entry) => entry.end.getTime() >= Date.now())
                .sort((a, b) => a.start.getTime() - b.start.getTime());

              const conflictIds = detectConflicts(entries);

              return [
                item.id,
                {
                  bookings: entries,
                  hasConflicts: conflictIds.length > 0,
                  conflictIds,
                } as BookingState,
              ];
            } catch (err) {
              console.error(
                `Failed to load bookings for equipment ${item.id}`,
                err
              );
              return [
                item.id,
                {
                  bookings: [],
                  hasConflicts: false,
                  conflictIds: [],
                  error: "We couldn't load this schedule. Please try again.",
                } as BookingState,
              ];
            }
          })
        );

        if (cancelled) return;

        const nextState: Record<string, BookingState> = {};
        results.forEach(([id, state]) => {
          if (!id) return;
          nextState[id] = state;
        });
        setBookingsState(nextState);
      } catch (err) {
        console.error("Failed to load kit booking schedules", err);
        if (!cancelled) {
          setBookingsError(
            "We couldn't load booking schedules. Please refresh the page."
          );
        }
      } finally {
        if (!cancelled) {
          setBookingsLoading(false);
        }
      }
    };

    loadBookings();

    return () => {
      cancelled = true;
    };
  }, [firestore, items]);

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
    setPhotoFile(null);
    setDocumentFiles([]);
    setFileInputsKey((key) => key + 1);
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
      photoUrl: item.photo || "",
      documents: Array.isArray(item.documents) ? [...item.documents] : [],
    });
    setRentalTouched(true);
    setCurrentTouched(true);
    setError(null);
    setPhotoFile(null);
    setDocumentFiles([]);
    setFileInputsKey((key) => key + 1);
  };

  const cancelForm = () => {
    resetForm();
    setShowForm(false);
  };

  const toggleSchedule = (id?: string) => {
    if (!id) return;
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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

  const clearExistingPhoto = () => {
    setForm((prev) => ({ ...prev, photoUrl: "" } as FormState));
    setPhotoFile(null);
  };

  const removeExistingDocument = (index: number) => {
    setForm((prev) => {
      const nextDocs = [...prev.documents];
      nextDocs.splice(index, 1);
      return { ...prev, documents: nextDocs } as FormState;
    });
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
    const user = authInstance?.currentUser;
    if (!user) {
      setError("You must be signed in to manage kit.");
      return;
    }

    if (!firestore) {
      setError("The equipment database is unavailable. Please refresh and try again.");
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
      if ((photoFile || documentFiles.length) && !storageInstance) {
        setError(
          "File storage is unavailable right now. Please refresh the page and try again."
        );
        return;
      }

      const equipmentCollection = collection(firestore, "equipment");
      const targetDoc = editingId
        ? doc(firestore, "equipment", editingId)
        : doc(equipmentCollection);

      const kitId = targetDoc.id;
      const storageBasePath = `equipment/${user.uid}/${kitId}`;
      let photoUrl = form.photoUrl.trim();
      let documentUrls = form.documents.filter((doc) => !!doc?.trim());

      if (photoFile && storageInstance) {
        const photoRef = ref(
          storageInstance,
          `${storageBasePath}/primary-${Date.now()}-${photoFile.name}`
        );
        await uploadBytes(photoRef, photoFile);
        photoUrl = await getDownloadURL(photoRef);
      }

      if (documentFiles.length && storageInstance) {
        const now = Date.now();
        const uploadedDocs = await Promise.all(
          documentFiles.map(async (file, index) => {
            const docRefStorage = ref(
              storageInstance,
              `${storageBasePath}/docs/${now}-${index}-${file.name}`
            );
            await uploadBytes(docRefStorage, file);
            return getDownloadURL(docRefStorage);
          })
        );
        documentUrls = [...documentUrls, ...uploadedDocs];
      }

      documentUrls = Array.from(new Set(documentUrls.map((url) => url.trim())));

      const timestamp = new Date();
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
        photo: photoUrl,
        documents: documentUrls,
        updatedAt: timestamp,
      };

      if (!editingId) {
        await setDoc(targetDoc, { ...payload, createdAt: timestamp });
      } else {
        await updateDoc(targetDoc, payload);
      }
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      console.error("Failed to save kit", err);
      setError(err?.message || "Failed to save kit item.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id?: string) => {
    if (!id) return;
    if (!confirm("Remove this kit item?")) return;
    if (!firestore) {
      setError("The equipment database is unavailable. Please refresh and try again.");
      return;
    }
    try {
      await deleteDoc(doc(firestore, "equipment", id));
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
          {bookingsError && (
            <p className="mt-1 text-xs text-red-600">{bookingsError}</p>
          )}
          {bookingsLoading && (
            <p className="mt-1 text-xs text-gray-500">
              Refreshing booking schedules…
            </p>
          )}
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
          <div className="space-y-2">
            <span className="block text-sm font-medium">Primary photo</span>
            {form.photoUrl && (
              <div className="flex items-center gap-3">
                <Image
                  src={form.photoUrl}
                  alt={`${form.name || "Kit"} photo`}
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded object-cover"
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-red-600"
                  onClick={clearExistingPhoto}
                >
                  Remove photo
                </button>
              </div>
            )}
            <input
              key={`photo-${fileInputsKey}`}
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            />
            {photoFile && (
              <p className="text-xs text-gray-600">Selected: {photoFile.name}</p>
            )}
            <p className="text-xs text-gray-500">
              Upload a clear image to help the team identify the kit.
            </p>
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-medium">Supporting documents</span>
            {form.documents.length > 0 && (
              <ul className="space-y-1 text-xs text-gray-600">
                {form.documents.map((url, index) => (
                  <li key={`${url}-${index}`} className="flex items-center gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-blue-600 hover:underline"
                    >
                      Document {index + 1}
                    </a>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-red-600"
                      onClick={() => removeExistingDocument(index)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              key={`docs-${fileInputsKey}`}
              type="file"
              multiple
              onChange={(e) => setDocumentFiles(Array.from(e.target.files ?? []))}
            />
            {documentFiles.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-gray-600">
                {documentFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`}>{file.name}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500">
              Add manuals, certificates, or proof of purchase (PDFs or images).
            </p>
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
          <table className="w-full min-w-[880px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Photo</th>
                <th className="p-2">Name</th>
                <th className="p-2">Category</th>
                <th className="p-2">Purchase £</th>
                <th className="p-2">Rental £</th>
                <th className="p-2">Documents</th>
                <th className="p-2">Available</th>
                <th className="p-2">Schedule</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Fragment key={item.id}>
                  <tr className="border-t">
                    <td className="p-2 align-top">
                      {item.photo ? (
                        <Image
                          src={item.photo}
                          alt={`${item.name || "Kit"} thumbnail`}
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <span className="text-xs text-gray-500">No photo</span>
                      )}
                    </td>
                    <td className="p-2 font-medium align-top">{item.name}</td>
                    <td className="p-2 align-top">{item.category}</td>
                    <td className="p-2 align-top">£{(item.newValue || 0).toFixed(2)}</td>
                    <td className="p-2 align-top">£{(item.rentalPrice || 0).toFixed(2)}</td>
                    <td className="p-2 align-top">
                      {Array.isArray(item.documents) && item.documents.length > 0 ? (
                        <ul className="space-y-1 text-xs">
                          {item.documents.map((url, index) => (
                            <li key={`${item.id}-doc-${index}`}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-blue-600 hover:underline"
                              >
                                Document {index + 1}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-gray-500">None</span>
                      )}
                    </td>
                    <td className="p-2 align-top">
                      {item.available === false ? "No" : "Yes"}
                    </td>
                    <td className="p-2 align-top">
                      <div className="flex flex-col gap-1">
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => toggleSchedule(item.id)}
                          disabled={bookingsLoading && !bookingsState[item.id ?? ""]}
                        >
                          {item.id && expandedRows.has(item.id)
                            ? "Hide schedule"
                            : "View schedule"}
                        </button>
                        {item.id && bookingsState[item.id]?.hasConflicts && (
                          <span className="text-xs font-medium text-red-600">
                            Conflicts detected
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 space-x-2 align-top">
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
                  {item.id && expandedRows.has(item.id) && (
                    <tr className="bg-gray-50">
                      <td className="p-3" colSpan={9}>
                        {(() => {
                          const schedule = bookingsState[item.id ?? ""];
                          if (bookingsLoading && !schedule) {
                            return <p className="text-sm">Loading schedule…</p>;
                          }

                          if (!schedule) {
                            return (
                              <p className="text-sm text-gray-600">
                                We don&apos;t have any schedule information for this kit
                                yet.
                              </p>
                            );
                          }

                          if (schedule.error) {
                            return (
                              <p className="text-sm text-red-600">{schedule.error}</p>
                            );
                          }

                          if (schedule.bookings.length === 0) {
                            return (
                              <div className="space-y-2 text-sm text-gray-600">
                                <p>
                                  No upcoming bookings. This kit is currently free for
                                  new reservations.
                                </p>
                                <p className="text-xs text-gray-500">
                                  Need to pencil something in? Reach out to the
                                  operations team so we can coordinate availability.
                                </p>
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-4">
                              <p className="text-sm text-gray-700">
                                Upcoming reservations are shown below. Dates are listed
                                in your local timezone.
                              </p>
                              <ol className="border-l-2 border-gray-200 pl-4 space-y-3">
                                {schedule.bookings.map((booking) => {
                                  const isConflict = schedule.conflictIds.includes(
                                    booking.id
                                  );
                                  const duration = Math.max(
                                    1,
                                    Math.round(
                                      (booking.end.getTime() -
                                        booking.start.getTime()) /
                                        (1000 * 60 * 60 * 24)
                                    )
                                  );
                                  return (
                                    <li key={booking.id} className="relative pl-4">
                                      <span
                                        className={`absolute left-[-11px] top-3 h-2.5 w-2.5 rounded-full ${
                                          isConflict
                                            ? "bg-red-500"
                                            : "bg-green-500"
                                        }`}
                                      />
                                      <div
                                        className={`rounded-md border p-3 text-sm ${
                                          isConflict
                                            ? "border-red-200 bg-red-50 text-red-700"
                                            : "border-gray-200 bg-white"
                                        }`}
                                      >
                                        <p className="font-medium">
                                          {formatDateRange(booking.start, booking.end)}
                                          <span className="ml-2 text-xs font-normal text-gray-500">
                                            {duration} day{duration === 1 ? "" : "s"}
                                          </span>
                                        </p>
                                        {booking.projectId && (
                                          <p className="text-xs text-gray-600">
                                            Project: {booking.projectId}
                                          </p>
                                        )}
                                        {booking.status && (
                                          <p className="text-xs text-gray-600">
                                            Status: {booking.status}
                                          </p>
                                        )}
                                        {booking.notes && (
                                          <p className="text-xs text-gray-600">
                                            Notes: {booking.notes}
                                          </p>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ol>
                              {schedule.hasConflicts ? (
                                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                  <p className="font-medium">Booking overlap detected</p>
                                  <p>
                                    Some reservations overlap. Please contact the Pineapple
                                    Tapped operations team so we can adjust the schedule or
                                    arrange alternative kit.
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-500">
                                  No clashes spotted. Let us know if you need to block out
                                  additional dates.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
