"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { auth, db, storage, functions } from "@/lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
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
} from "@/lib/products";
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

const ReactQuill = dynamic(() => import("react-quill"), { ssr: false });
import "react-quill/dist/quill.snow.css";

const PRODUCT_IMAGE_ROOT = "Product_Images";

interface ModifierOption {
  id: string;
  name: string;
  price: number;
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

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;

  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<Category[]>([]);
  const [allModifiers, setAllModifiers] = useState<ModifierGroup[]>([]);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);

  const [tab, setTab] = useState<
    | "info"
    | "pnl"
    | "variations"
    | "deliverables"
    | "kit"
    | "tasks"
    | "seo"
    | "modifiers"
  >("info");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagline, setTagline] = useState("");
  const [price, setPrice] = useState("0");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [requirements, setRequirements] = useState("");
  const [deliveryIndex, setDeliveryIndex] = useState(0);
  const [deliverables, setDeliverables] = useState<
    (ProductDeliverable & { file?: File })[]
  >([]);
  const [variations, setVariations] = useState<
    (ProductVariation & { featuresText: string })[]
  >([]);
  const [modifiers, setModifiers] = useState<
    { groupId: string; optionId: string; price: string }[]
  >([]);
  const [seo, setSeo] = useState<ProductSEO>({});
  const [seoImageFile, setSeoImageFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venueId, setVenueId] = useState("");
  const [venue, setVenue] = useState("");
  const [hidden, setHidden] = useState(false);
  const [tasks, setTasks] = useState<ProductTask[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskForCustomer, setTaskForCustomer] = useState(false);
  const [taskSubtasks, setTaskSubtasks] = useState("");
  const [kitGroups, setKitGroups] = useState<{ groupId: string; items: string[] }[]>([]);
  const [equipmentList, setEquipmentList] = useState<
    { id: string; name: string; rentalPrice?: number; category?: string }
  >([]);
  const [labourFilmingRate, setLabourFilmingRate] = useState("0");
  const [labourEditingRate, setLabourEditingRate] = useState("0");
  const [kitCostMode, setKitCostMode] = useState<"manual" | "guided">("manual");
  const [manualKitCost, setManualKitCost] = useState("0");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [activeKitGroup, setActiveKitGroup] = useState<number | null>(null);
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

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsStaff(false);
        setLoading(false);
        return;
      }
      const meSnap = await getDoc(doc(db, "users", user.uid));
      const me = meSnap.data() as any;
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      let initialVenueId = "";
      let initialVenueName = "";
      if (staff) {
        const prodSnap = await getDoc(doc(db, "products", id));
        if (prodSnap.exists()) {
          const p = prodSnap.data() as Product;
          setName(p.name);
          setDescription(p.description);
          setTagline(p.tagline || "");
          setPrice(String(p.price));
          const budget = (p as any).budget || {};
          const labourFilming =
            budget.labourFilming ?? budget.labour ?? (p as any).labourCost ?? 0;
          const labourEditing = budget.labourEditing ?? 0;
          const initialKitMode =
            budget.kitMode === "guided" || budget.kitMode === "manual"
              ? budget.kitMode
              : "manual";
          const manualKit =
            budget.kitManual ?? budget.kit ?? (p as any).defaultKitCost ?? 0;
          setLabourFilmingRate(String(labourFilming));
          setLabourEditingRate(String(labourEditing));
          setManualKitCost(String(manualKit));
          setKitCostMode(initialKitMode);
          setTravelMiles(String(budget.travelMiles ?? 100));
          setTravelRate(String(budget.travelRate ?? 0.3));
          setParkingCost(String(budget.parking ?? 0));
          setTravelMilesTouched(budget.travelMiles !== undefined && budget.travelMiles !== null);
          setParkingTouched(budget.parking !== undefined && budget.parking !== null);
          setImageUrl(p.imageUrl || "");
          setRequirements(p.requirements || "");
          const idx = deliveryOptions.indexOf(p.deliveryTime || "");
          setDeliveryIndex(idx >= 0 ? idx : 0);
          setDeliverables((p.deliverables || []) as any);
          setVariations(
            (p.variations || []).map((v: any) => ({
              ...v,
              featuresText: (v.features || []).join("\n"),
            })) as any
          );
          setModifiers(
            (p.modifiers || []).map((m: any) => ({
              groupId: m.groupId,
              optionId: m.optionId,
              price: m.price ? String(m.price) : "",
            }))
          );
          setSeo(p.seo || {});
          setCategory(p.category || "");
          setEventDate(p.eventDate || "");
          initialVenueId = (p as any).venueId || "";
          initialVenueName = p.venue || "";
          setVenueId(initialVenueId);
          setVenue(initialVenueName);
          setHidden(p.hidden || false);
          setTasks(p.defaultTasks || []);
          setWorkflowId((p as any).workflowId || "");
          setKitGroups((p as any).requiredKit || []);
        }
        const [catSnap, modSnap, wfSnap, eqSnap, venueSnap] = await Promise.all([
          getDocs(collection(db, "categories")),
          getDocs(collection(db, "modifiers")),
          getDocs(collection(db, "workflows")),
          getDocs(collection(db, "equipment")),
          getDocs(collection(db, "venues")),
        ]);
        setCats(catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setAllModifiers(
          modSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any
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
        const venueList = venueSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Venue))
          .sort((a, b) => a.name.localeCompare(b.name));
        setVenues(venueList);
        if (!initialVenueName && initialVenueId) {
          const match = venueList.find((v) => v.id === initialVenueId);
          if (match) setVenue(match.name);
        }
      }
      setLoading(false);
    })();
  }, [id]);

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

  useEffect(() => {
    if (kitGroups.length === 0) {
      if (activeKitGroup !== null) setActiveKitGroup(null);
      return;
    }
    if (activeKitGroup === null || activeKitGroup >= kitGroups.length) {
      setActiveKitGroup(0);
    }
  }, [kitGroups, activeKitGroup]);

  const upload = async (path: string, file: File) => {
    const r = ref(storage, path);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    let img = imageUrl;
    if (imageFile)
      img = await upload(
        `${PRODUCT_IMAGE_ROOT}/${id}/main`,
        imageFile
      );

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
      const desc = d.description?.trim();
      if (desc) item.description = desc;
      if (thumb) item.thumbnailUrl = thumb;
      deliverableData.push(item);
    }

    const variationData: ProductVariation[] = variations.map((v) => ({
      id: v.id,
      name: v.name,
      price: Number(v.price) || 0,
      features: v.featuresText
        ? v.featuresText.split("\n").map((f) => f.trim()).filter(Boolean)
        : [],
    }));

    let seoImage = seo.socialImageUrl;
    if (seoImageFile)
      seoImage = await upload(
        `${PRODUCT_IMAGE_ROOT}/${id}/seo`,
        seoImageFile
      );

    const venueLabel = venue || selectedVenue?.name || null;
    const labourFilmingValue = parseMoney(labourFilmingRate);
    const labourEditingValue = parseMoney(labourEditingRate);
    const labourValue = labourFilmingValue + labourEditingValue;
    const manualKitValue = parseMoney(manualKitCost);
    const kitValue = kitCostMode === "guided" ? kitGuidanceValue : manualKitValue;
    const travelMilesValue = parseMoney(travelMiles, 100);
    const travelRateValue = parseMoney(travelRate, 0.3);
    const travelCostValue = Number.isFinite(travelMilesValue * travelRateValue)
      ? travelMilesValue * travelRateValue
      : 0;
    const parkingValue = parseMoney(parkingCost);
    await updateDoc(doc(db, "products", id), {
      name,
      description,
      tagline: tagline || null,
      price: Number(price) || 0,
      labourCost: labourValue,
      defaultKitCost: kitValue,
      budget: {
        labourFilming: labourFilmingValue,
        labourEditing: labourEditingValue,
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
      imageUrl: img || null,
      requirements: requirements || null,
      deliveryTime: deliveryOptions[deliveryIndex],
      deliverables: deliverableData,
      variations: variationData,
      modifiers: modifiers.map((m) => ({
        groupId: m.groupId,
        optionId: m.optionId,
        ...(m.price ? { price: Number(m.price) } : {}),
      })),
      category: category || null,
      eventDate: eventDate || null,
      venue: venueLabel,
      venueId: venueId || null,
      hidden,
      requiredKit: kitGroups,
      defaultTasks: tasks,
      seo: {
        title: seo.title || null,
        description: seo.description || null,
        keywords: seo.keywords || null,
        socialImageUrl: seoImage || null,
      },
    });
    if (workflowId) {
      const fn = httpsCallable(functions, "admin_assignWorkflow");
      await fn({ productId: id, workflowId });
    }
    router.push("/admin/products");
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

  const removeDeliverable = (index: number) => {
    setDeliverables((prev) => prev.filter((_, i) => i !== index));
  };

  const addVariation = () => {
    setVariations((v) => [
      ...v,
      { id: crypto.randomUUID(), name: "", price: 0, featuresText: "" },
    ]);
  };

  const updateVariation = (
    index: number,
    data: Partial<ProductVariation & { featuresText: string }>
  ) => {
    setVariations((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...data } : v))
    );
  };

  const removeVariation = (index: number) => {
    setVariations((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSelectModifier = (
    groupId: string,
    optionId: string,
    checked: boolean
  ) => {
    setModifiers((prev) => {
      if (checked) {
        const group = allModifiers.find((g) => g.id === groupId);
        if (group && !group.multiple) {
          return [
            ...prev.filter((m) => m.groupId !== groupId),
            { groupId, optionId, price: "" },
          ];
        }
        const exists = prev.find(
          (m) => m.groupId === groupId && m.optionId === optionId
        );
        return exists ? prev : [...prev, { groupId, optionId, price: "" }];
      }
      return prev.filter(
        (m) => !(m.groupId === groupId && m.optionId === optionId)
      );
    });
  };

  const selectedPrice = (groupId: string, optionId: string) =>
    modifiers.find(
      (m) => m.groupId === groupId && m.optionId === optionId
    )?.price || "";

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

  const addKitGroup = () =>
    setKitGroups((g) => {
      const next = [...g, { groupId: "", items: [] }];
      setActiveKitGroup(next.length - 1);
      return next;
    });
  const updateKitGroupId = (index: number, groupId: string) =>
    setKitGroups((prev) =>
      prev.map((g, i) => (i === index ? { ...g, groupId } : g))
    );
  const addEquipmentToGroup = (index: number, eqId: string) =>
    setKitGroups((prev) =>
      prev.map((g, i) =>
        i === index && !g.items.includes(eqId)
          ? { ...g, items: [...g.items, eqId] }
          : g
      )
    );
  const removeEquipmentFromGroup = (index: number, eqId: string) =>
    setKitGroups((prev) =>
      prev.map((g, i) =>
        i === index ? { ...g, items: g.items.filter((id) => id !== eqId) } : g
      )
    );
  const removeKitGroup = (index: number) => {
    setKitGroups((prev) => prev.filter((_, i) => i !== index));
    setActiveKitGroup((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
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
  const labourFilmingValue = parseMoney(labourFilmingRate);
  const labourEditingValue = parseMoney(labourEditingRate);
  const labourValue = labourFilmingValue + labourEditingValue;
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
  const filteredEquipment = useMemo(() => {
    const term = equipmentSearch.trim().toLowerCase();
    if (!term) return equipmentList.slice(0, 50);
    return equipmentList.filter((item) => {
      const nameMatch = item.name.toLowerCase().includes(term);
      const idMatch = item.id.toLowerCase().includes(term);
      const categoryMatch = item.category?.toLowerCase().includes(term);
      return nameMatch || idMatch || categoryMatch;
    });
  }, [equipmentList, equipmentSearch]);

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to edit products.</p>;

  return (
    <form onSubmit={save} className="grid gap-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Edit Product</h1>
      <nav className="flex gap-4 border-b">
        {[
          ["info", "Info"],
          ["pnl", "P&L"],
          ["variations", "Variations"],
          ["deliverables", "Deliverables"],
          ["kit", "Kit"],
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
          {imageUrl && (
            <Image
              src={imageUrl}
              alt={`${name} preview`}
              width={256}
              height={256}
              className="h-auto w-32 object-cover"
            />
          )}
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
      <label className="text-sm font-medium">Delivery Time: {deliveryOptions[deliveryIndex]}</label>
      <input
        type="range"
        min={0}
        max={deliveryOptions.length - 1}
        value={deliveryIndex}
        onChange={(e) => setDeliveryIndex(Number(e.target.value))}
      />
    </div>
  )}

      {tab === "pnl" && (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Price (GBP)</label>
            <input
              type="number"
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
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
                <p className="text-xs text-gray-500">
                  These rates are stored separately so you can see the split between
                  filming and post-production costs.
                </p>
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
                <span>Labour (filming)</span>
                <span>{formatCurrency(labourFilmingValue)}</span>
              </div>
              <div className="flex justify-between">
                <span>Labour (editing)</span>
                <span>{formatCurrency(labourEditingValue)}</span>
              </div>
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
          </div>
        </div>
      )}

      {tab === "variations" && (
        <div className="grid gap-4">
          {variations.map((v, i) => (
            <div key={v.id} className="border p-4 rounded grid gap-2">
              <input
                className="input"
                placeholder="Name"
                value={v.name}
                onChange={(e) => updateVariation(i, { name: e.target.value })}
              />
              <input
                type="number"
                className="input"
                placeholder="Price"
                value={v.price}
                onChange={(e) =>
                  updateVariation(i, { price: Number(e.target.value) })
                }
              />
              <textarea
                className="input"
                placeholder="Features (one per line)"
                value={v.featuresText}
                onChange={(e) =>
                  updateVariation(i, { featuresText: e.target.value })
                }
              />
              <button
                type="button"
                className="btn btn-sm w-fit"
                onClick={() => removeVariation(i)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm w-fit"
            onClick={addVariation}
          >
            Add Variation
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
            <h3 className="font-medium">Search kit database</h3>
            <p className="text-xs text-gray-500">
              Choose a group below, then search for equipment to add it directly from the
              register. Drag-and-drop still works if you prefer.
            </p>
            <div className="flex flex-col gap-2 md:flex-row">
              <input
                className="input md:max-w-sm"
                placeholder="Search by name, category, or ID"
                value={equipmentSearch}
                onChange={(e) => setEquipmentSearch(e.target.value)}
              />
              {kitGroups.length > 0 && activeKitGroup !== null && (
                <div className="rounded border px-3 py-2 text-sm text-gray-600">
                  Adding to: {kitGroups[activeKitGroup].groupId || `Group ${activeKitGroup + 1}`}
                </div>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto rounded border divide-y">
              {filteredEquipment.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">No equipment matches your search.</p>
              ) : (
                filteredEquipment.map((eq) => {
                  const isAdded =
                    activeKitGroup !== null &&
                    kitGroups[activeKitGroup]?.items.includes(eq.id);
                  return (
                    <div key={eq.id} className="flex items-center justify-between gap-4 p-3">
                      <div>
                        <p className="font-medium">{eq.name}</p>
                        <p className="text-xs text-gray-500">
                          {eq.category && <span className="mr-2">{eq.category}</span>}
                          {typeof eq.rentalPrice === "number"
                            ? `Rental £${eq.rentalPrice.toFixed(2)}`
                            : "No rental price"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-xs"
                        disabled={activeKitGroup === null || isAdded}
                        onClick={() => {
                          if (activeKitGroup === null) return;
                          addEquipmentToGroup(activeKitGroup, eq.id);
                        }}
                      >
                        {isAdded ? "Added" : "Add to group"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={addKitGroup}>
              Add Group
            </button>
            {kitGroups.length === 0 && (
              <span className="text-sm text-gray-600">Create a group to start assigning kit.</span>
            )}
          </div>
          {kitGroups.map((g, i) => (
            <div
              key={`${g.groupId || "group"}-${i}`}
              className={`border p-4 rounded grid gap-3 ${
                activeKitGroup === i ? "border-black" : "border-gray-200"
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const eqId = e.dataTransfer.getData("text/plain");
                if (eqId) addEquipmentToGroup(i, eqId);
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  className="input flex-1"
                  placeholder="Group label (e.g. Camera Ops)"
                  value={g.groupId}
                  onChange={(e) => updateKitGroupId(i, e.target.value)}
                />
                <button
                  type="button"
                  className={`btn btn-xs ${
                    activeKitGroup === i ? "bg-black text-white hover:bg-black" : ""
                  }`.trim()}
                  onClick={() => setActiveKitGroup(i)}
                >
                  {activeKitGroup === i ? "Active" : "Set active"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 min-h-[2rem]">
                {g.items.map((id) => {
                  const item = equipmentLookup.get(id);
                  return (
                    <span
                      key={id}
                      className="bg-gray-200 px-2 py-1 rounded flex items-center gap-2 text-sm"
                    >
                      <span>{item?.name || id}</span>
                      <button
                        type="button"
                        className="text-gray-500 hover:text-black"
                        onClick={() => removeEquipmentFromGroup(i, id)}
                        aria-label={`Remove ${item?.name || id}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {g.items.length === 0 && (
                  <span className="text-xs text-gray-500">No equipment added yet.</span>
                )}
              </div>
              <button
                type="button"
                className="text-sm text-red-600 w-fit"
                onClick={() => removeKitGroup(i)}
              >
                Remove Group
              </button>
            </div>
          ))}
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
          {allModifiers.map((g) => (
            <div key={g.id} className="border p-4 rounded grid gap-2">
              <p className="font-medium">{g.name}</p>
              {g.options.map((o) => {
                const selected = modifiers.find(
                  (m) => m.groupId === g.id && m.optionId === o.id
                );
                return (
                  <div key={o.id} className="flex items-center gap-2">
                    <input
                      type={g.multiple ? "checkbox" : "radio"}
                      name={`mod-${g.id}`}
                      checked={!!selected}
                      onChange={(e) =>
                        handleSelectModifier(g.id, o.id, e.target.checked)
                      }
                    />
                    <span>{o.name}</span>
                    {selected && (
                      <input
                        type="number"
                        className="input w-24"
                        value={selected.price}
                        onChange={(e) =>
                          setModifiers((prev) =>
                            prev.map((m) =>
                              m.groupId === g.id && m.optionId === o.id
                                ? { ...m, price: e.target.value }
                                : m
                            )
                          )
                        }
                        placeholder={`£${o.price}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
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
  );
}
