"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Auth, User } from "firebase/auth";
import type { Equipment, EquipmentStandard } from "@/lib/equipment";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";
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
import ComplianceBadge from "@/components/ComplianceBadge";
import {
  DRONE_STANDARD_ID,
  type ComplianceRecord,
  deriveComplianceState,
  isComplianceApproved,
} from "@/lib/compliance";

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
  focalLengthMin: string;
  focalLengthMax: string;
  manualUrl: string;
  weightKg: string;
  damage: string;
  available: boolean;
  photoUrl: string;
  documents: string[];
  meetsStandards: string[];
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
  focalLengthMin: "",
  focalLengthMax: "",
  manualUrl: "",
  weightKg: "",
  damage: "",
  available: true,
  photoUrl: "",
  documents: [],
  meetsStandards: [],
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
  const [standards, setStandards] = useState<EquipmentStandard[]>([]);
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
  const [complianceRecord, setComplianceRecord] = useState<ComplianceRecord | null>(
    null
  );

  const complianceState = useMemo(
    () => deriveComplianceState(complianceRecord),
    [complianceRecord]
  );
  const hasActiveCompliance = useMemo(
    () => isComplianceApproved(complianceState),
    [complianceState]
  );
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let stopAuth: (() => void) | undefined;
    let complianceUnsubscribe: (() => void) | undefined;
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

        if (!auth) {
          markUnavailable("Firebase auth is unavailable.");
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

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== "function") {
          markUnavailable("Firebase auth listener helper is unavailable");
          return;
        }

        stopAuth = onAuthStateChanged(auth, (user: User | null) => {
          unsubscribe?.();
          complianceUnsubscribe?.();
          if (!user) {
            setItems([]);
            setLoading(false);
            setAuthReady(true);
            setComplianceRecord(null);
            return;
          }

          setError(null);
          setAuthReady(true);
          setLoading(true);

          const complianceRef = doc(db, "users", user.uid, "compliance", "profile");
          complianceUnsubscribe = onSnapshot(
            complianceRef,
            (snapshot) => {
              if (snapshot.exists()) {
                setComplianceRecord({
                  id: snapshot.id,
                  uid: user.uid,
                  ...(snapshot.data() as Record<string, unknown>),
                } as ComplianceRecord);
              } else {
                setComplianceRecord(null);
              }
            },
            (err) => {
              console.error("Failed to load compliance profile", err);
              setComplianceRecord(null);
            }
          );

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
      complianceUnsubscribe?.();
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
          items.map(async (item): Promise<{ id: string; state: BookingState }> => {
            if (!item.id) {
              return {
                id: "",
                state: { bookings: [], hasConflicts: false, conflictIds: [] },
              };
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

              return {
                id: item.id,
                state: {
                  bookings: entries,
                  hasConflicts: conflictIds.length > 0,
                  conflictIds,
                } as BookingState,
              };
            } catch (err) {
              console.error(
                `Failed to load bookings for equipment ${item.id}`,
                err
              );
              return {
                id: item.id ?? "",
                state: {
                  bookings: [],
                  hasConflicts: false,
                  conflictIds: [],
                  error: "We couldn't load this schedule. Please try again.",
                } as BookingState,
              };
            }
          })
        );

        if (cancelled) return;

        const nextState: Record<string, BookingState> = {};
        results.forEach(({ id, state }) => {
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

  useEffect(() => {
    if (!firestore) {
      setStandards([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(firestore, "equipmentStandards"));
        if (cancelled) return;
        const list = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        setStandards(list as EquipmentStandard[]);
      } catch (err) {
        console.error("Failed to load equipment standards", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore]);

  const suggestedRental = useMemo(() => {
    const purchase = toNumber(form.newValue);
    if (!purchase) return 0;
    return parseFloat((purchase * RENTAL_PERCENTAGE).toFixed(2));
  }, [form.newValue]);

  const standardLookup = useMemo(() => {
    const map = new Map<string, EquipmentStandard>();
    standards.forEach((standard) => {
      if (standard.id) {
        map.set(standard.id, standard);
      }
    });
    return map;
  }, [standards]);

  const applicableStandards = useMemo(() => {
    const category = form.category.trim().toLowerCase();
    if (!category) return standards;
    return standards.filter((standard) => {
      if (!standard.category) return true;
      return standard.category.toLowerCase() === category;
    });
  }, [standards, form.category]);

  const isLensCategory = useMemo(() => {
    const category = form.category.trim().toLowerCase();
    if (!category) return false;
    return category.includes("lens");
  }, [form.category]);

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
      focalLengthMin:
        typeof item.focalLengthMin === "number" && Number.isFinite(item.focalLengthMin)
          ? String(item.focalLengthMin)
          : "",
      focalLengthMax:
        typeof item.focalLengthMax === "number" && Number.isFinite(item.focalLengthMax)
          ? String(item.focalLengthMax)
          : "",
      manualUrl: item.manualUrl || "",
      weightKg: item.weightKg != null ? String(item.weightKg) : "",
      damage: item.damage || "",
      available: item.available !== false,
      photoUrl: item.photo || "",
      documents: Array.isArray(item.documents) ? [...item.documents] : [],
      meetsStandards: Array.isArray(item.meetsStandards)
        ? [...item.meetsStandards]
        : [],
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

  const toggleStandard = (id: string) => {
    if (
      id === DRONE_STANDARD_ID &&
      !hasActiveCompliance &&
      !form.meetsStandards.includes(DRONE_STANDARD_ID)
    ) {
      setError(
        "HQ must approve your drone compliance before you can tag kit with the drone standard."
      );
      return;
    }
    setForm((prev) => {
      const exists = prev.meetsStandards.includes(id);
      return {
        ...prev,
        meetsStandards: exists
          ? prev.meetsStandards.filter((value) => value !== id)
          : [...prev.meetsStandards, id],
      };
    });
  };

  const handleFieldChange = (name: keyof FormState, value: string | boolean) => {
    if (name === "available") {
      const nextAvailable = value as boolean;
      if (
        nextAvailable &&
        form.meetsStandards.includes(DRONE_STANDARD_ID) &&
        !hasActiveCompliance
      ) {
        setError(
          "HQ must approve your drone compliance before this kit can be listed as available for hire."
        );
        return;
      }
      setForm((prev) => ({ ...prev, available: nextAvailable } as FormState));
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
    if (isLensCategory) {
      const hasStart = form.focalLengthMin.trim().length > 0;
      const hasEnd = form.focalLengthMax.trim().length > 0;
      if (hasStart !== hasEnd) {
        return "Enter both starting and ending focal lengths for lenses.";
      }
      if (hasStart && hasEnd) {
        const startValue = Number.parseFloat(form.focalLengthMin);
        const endValue = Number.parseFloat(form.focalLengthMax);
        if (!Number.isFinite(startValue) || startValue <= 0) {
          return "Enter a valid starting focal length greater than 0mm.";
        }
        if (!Number.isFinite(endValue) || endValue <= 0) {
          return "Enter a valid ending focal length greater than 0mm.";
        }
        if (startValue > endValue) {
          return "The starting focal length must be less than or equal to the ending focal length.";
        }
      }
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

    const requiresDroneCompliance = form.meetsStandards.includes(
      DRONE_STANDARD_ID
    );
    if (requiresDroneCompliance && !hasActiveCompliance) {
      setError(
        "Drone kit can only be listed after HQ approves your compliance documents."
      );
      return;
    }

    if (form.available && requiresDroneCompliance && !hasActiveCompliance) {
      setError(
        "Set this kit to unavailable or wait for HQ to approve your drone compliance before saving."
      );
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
        focalLengthMin: (() => {
          const trimmed = form.focalLengthMin.trim();
          if (!trimmed) return null;
          const parsed = Number.parseFloat(trimmed);
          return Number.isFinite(parsed) ? parsed : null;
        })(),
        focalLengthMax: (() => {
          const trimmed = form.focalLengthMax.trim();
          if (!trimmed) return null;
          const parsed = Number.parseFloat(trimmed);
          return Number.isFinite(parsed) ? parsed : null;
        })(),
        manualUrl: form.manualUrl.trim(),
        weightKg: toNumber(form.weightKg),
        damage: form.damage.trim(),
        available: form.available,
        photo: photoUrl,
        documents: documentUrls,
        updatedAt: timestamp,
        meetsStandards: Array.from(new Set(form.meetsStandards)),
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Drone compliance
            </span>
            <ComplianceBadge
              status={complianceState.status}
              title={complianceState.issues.join("\n")}
            />
            {complianceState.status !== "approved" && complianceState.issues.length > 0 && (
              <span className="text-xs text-red-600">
                {complianceState.issues[0]}
              </span>
            )}
          </div>
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
          {standards.length > 0 && (
            <div className="space-y-2">
              <span className="block text-sm font-medium">
                Standards this kit meets
              </span>
              <p className="text-xs text-gray-500">
                Tick the requirements your equipment fulfils so schedulers know
                what you can cover.
              </p>
              {applicableStandards.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No standards match this category yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {applicableStandards.map((standard) => {
                    if (!standard.id) return null;
                    const checked = form.meetsStandards.includes(standard.id);
                    const isDroneStandard = standard.id === DRONE_STANDARD_ID;
                    const disableDroneToggle =
                      isDroneStandard && !hasActiveCompliance && !checked;
                    const labelTitle =
                      isDroneStandard && !hasActiveCompliance
                        ? "HQ needs to approve your compliance documents before you can claim this standard."
                        : undefined;
                    return (
                      <li key={`standard-${standard.id}`}>
                        <label
                          className="flex items-start gap-2 text-sm"
                          title={labelTitle}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disableDroneToggle}
                            onChange={() => toggleStandard(standard.id!)}
                          />
                          <span>
                            <span className="font-medium">{standard.title}</span>
                            {standard.minimumSpec && (
                              <span className="block text-xs text-gray-500">
                                {standard.minimumSpec}
                              </span>
                            )}
                            {standard.description && (
                              <span className="block text-xs text-gray-500">
                                {standard.description}
                              </span>
                            )}
                            {standard.requiresApproval && (
                              <span className="mt-1 inline-flex rounded bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-900">
                                Requires approval
                              </span>
                            )}
                            {isDroneStandard && !hasActiveCompliance && (
                              <span className="mt-1 block text-xs text-red-600">
                                Submit and obtain approval for your licence and insurance before marking kit as drone compliant.
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
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
          {isLensCategory && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="lens-focal-start">
                  Starting focal length (mm)
                </label>
                <input
                  id="lens-focal-start"
                  className="input input-bordered"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.focalLengthMin}
                  onChange={(e) => handleFieldChange("focalLengthMin", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="lens-focal-end">
                  Ending focal length (mm)
                </label>
                <input
                  id="lens-focal-end"
                  className="input input-bordered"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.focalLengthMax}
                  onChange={(e) => handleFieldChange("focalLengthMax", e.target.value)}
                />
              </div>
            </div>
          )}
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
                <th className="p-2">Focal range</th>
                <th className="p-2">Documents</th>
                <th className="p-2">Standards</th>
                <th className="p-2">Available</th>
                <th className="p-2">Schedule</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const hasDroneStandard = Array.isArray(item.meetsStandards)
                  ? item.meetsStandards.includes(DRONE_STANDARD_ID)
                  : false;
                const focalRange = (() => {
                  const min =
                    typeof item.focalLengthMin === "number" && Number.isFinite(item.focalLengthMin)
                      ? item.focalLengthMin
                      : null;
                  const max =
                    typeof item.focalLengthMax === "number" && Number.isFinite(item.focalLengthMax)
                      ? item.focalLengthMax
                      : null;
                  if (min !== null && max !== null) {
                    return `${min}–${max} mm`;
                  }
                  if (min !== null) {
                    return `≥ ${min} mm`;
                  }
                  if (max !== null) {
                    return `≤ ${max} mm`;
                  }
                  return "—";
                })();
                return (
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
                    <td className="p-2 align-top">{focalRange}</td>
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
                    {Array.isArray(item.meetsStandards) && item.meetsStandards.length ? (
                      <ul className="flex flex-wrap gap-1">
                        {item.meetsStandards.map((standardId) => {
                          const standard = standardLookup.get(standardId);
                          if (!standardId) return null;
                          return (
                            <li key={`${item.id}-standard-${standardId}`}>
                              <span className="inline-flex items-center rounded bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                                {standard?.title || standardId}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-500">None</span>
                    )}
                  </td>
                  <td className="p-2 align-top">
                    {item.available === false ? "No" : "Yes"}
                    {hasDroneStandard && !hasActiveCompliance && (
                      <span className="mt-1 block text-xs text-red-600">
                        Drone kit will remain unavailable until your compliance is approved.
                      </span>
                    )}
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
              );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
