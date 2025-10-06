"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db, functions } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getProductKit, type ProductKitGroup } from "@/lib/equipment";
import { extractUserRoles, hasRole } from "@/lib/roles";
import { adminListUsers } from "@/lib/admin";
import { CRM_STATUS_LABELS, normaliseCrmStatus } from "@/lib/crm";
import ProposalSetupBuilder, {
  type ProposalSetupItem as SetupLibraryItem,
  type ProposalSetupPlan,
} from "@/components/admin/proposals/ProposalSetupBuilder";
import ProposalStoryboardAssistant from "@/components/admin/proposals/ProposalStoryboardAssistant";

const SETUP_LAYOUT_LABELS: Record<ProposalSetupPlan["layout"], string> = {
  conference: "Conference stage",
  panel: "Panel / fireside",
  interview: "Interview setup",
  custom: "Custom layout",
};

const SETUP_ZONE_LABELS: Record<string, string> = {
  "stage-front": "Stage front",
  "stage-rear": "Stage rear",
  audience: "Audience",
  lighting: "Lighting rig",
  control: "Control / steering",
  support: "Support areas",
};

interface ProposalItem {
  type: "product" | "custom";
  productId?: string;
  name: string;
  price: number;
  notes?: string;
  rental?: number;
}

interface CRMDirectoryRecord {
  id: string;
  fullName: string;
  organisation: string;
  email: string;
  phone: string;
  crmStatus: string;
  statusLabel: string;
  orgId: string;
}

interface DirectoryEntry {
  key: string;
  id: string;
  type: "org" | "crm";
  label: string;
  badge: string;
  badgeClass: string;
  description?: string;
  search: string;
  meta: {
    orgId?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    organisation?: string;
    status?: string;
    statusLabel?: string;
  };
}

const CRM_STATUS_BADGE_TONE: Record<string, string> = {
  outreach: "bg-indigo-100 text-indigo-700",
  previous_prospect: "bg-violet-100 text-violet-700",
  lead: "bg-blue-100 text-blue-700",
  quote_request: "bg-sky-100 text-sky-700",
  discovery_call: "bg-cyan-100 text-cyan-700",
  drafting_proposal: "bg-amber-100 text-amber-700",
  proposal_sent: "bg-orange-100 text-orange-700",
  follow_up_call: "bg-teal-100 text-teal-700",
  awaiting_decision: "bg-rose-100 text-rose-700",
  client: "bg-emerald-100 text-emerald-700",
};

const normaliseString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const extractOrgId = (record: Record<string, any>): string => {
  const candidates: unknown[] = [
    record?.primaryOrgId,
    record?.orgId,
    record?.organisationId,
    Array.isArray(record?.orgIds) ? record.orgIds[0] : undefined,
  ];
  for (const candidate of candidates) {
    const value = normaliseString(candidate);
    if (value) {
      return value;
    }
  }
  return "";
};

export default function NewProposalPage() {
  const router = useRouter();
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);

  const [orgs, setOrgs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [crmRecords, setCrmRecords] = useState<CRMDirectoryRecord[]>([]);
  const [crmError, setCrmError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [agreementIds, setAgreementIds] = useState<string[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [setupPlan, setSetupPlan] = useState<ProposalSetupPlan>({
    layout: "conference",
    notes: "",
    placements: [],
  });
  const [kitCache, setKitCache] = useState<Record<string, ProductKitGroup[]>>({});
  const kitCacheRef = useRef<Record<string, ProductKitGroup[]>>({});
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const [organisationQuery, setOrganisationQuery] = useState("");
  const [selectedDirectoryKey, setSelectedDirectoryKey] = useState<string | null>(null);
  const [showDirectory, setShowDirectory] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const ensureKit = useCallback(async (productId: string) => {
    if (!productId) return [];
    const cached = kitCacheRef.current[productId];
    if (cached) return cached;
    const kit = await getProductKit(productId);
    kitCacheRef.current = { ...kitCacheRef.current, [productId]: kit };
    setKitCache((prev) => ({ ...prev, [productId]: kit }));
    return kit;
  }, []);

  useEffect(() => {
    kitCacheRef.current = kitCache;
  }, [kitCache]);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setCanManage(false); setLoading(false); return; }
      const uSnap = await getDoc(doc(db, "users", user.uid));
      const me = uSnap.data() as any;
      const roles = extractUserRoles(me);
      const allowed = hasRole(roles, ["admin", "sales"]);
      setCanManage(allowed);
      if (allowed) {
        const [orgSnap, prodSnap, secSnap, agrSnap, tplSnap, crmResponse] = await Promise.all([
          getDocs(collection(db, "orgs")),
          getDocs(collection(db, "products")),
          getDocs(collection(db, "proposalSections")),
          getDocs(collection(db, "agreements")),
          getDocs(collection(db, "proposalTemplates")),
          adminListUsers().catch((error) => {
            console.error("Failed to load CRM directory", error);
            setCrmError("We couldn't load the CRM directory. You can still select an organisation manually.");
            return null;
          }),
        ]);
        setOrgs(orgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setSections(secSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setAgreements(agrSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setTemplates(tplSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        if (crmResponse && Array.isArray(crmResponse.users)) {
          const users: CRMDirectoryRecord[] = crmResponse.users
            .map((entry: Record<string, any>) => {
              const id = normaliseString(entry.id) || normaliseString(entry.uid);
              if (!id) return null;
              const fullName = normaliseString(entry.fullName);
              const organisation = normaliseString(entry.organisation);
              const email = normaliseString(entry.email);
              const phone = normaliseString(entry.phone);
              const status = normaliseCrmStatus(entry.crmStatus);
              const statusLabel = CRM_STATUS_LABELS[status];
              const orgIdValue = extractOrgId(entry);
              return {
                id,
                fullName,
                organisation,
                email,
                phone,
                crmStatus: status,
                statusLabel,
                orgId: orgIdValue,
              } as CRMDirectoryRecord;
            })
            .filter(Boolean) as CRMDirectoryRecord[];
          setCrmRecords(users);
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowDirectory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      setItems(tpl.items || []);
      setAgreementIds(tpl.agreementIds || []);
      setSectionIds(tpl.sectionIds || []);
    }
  }, [templateId, templates]);

  useEffect(() => {
    async function fillRental() {
      const updated = await Promise.all(
        items.map(async (it) => {
          if (it.type === "product" && it.productId && typeof it.rental === "undefined") {
            try {
              const kit = await ensureKit(it.productId);
              const rental = kit
                .flatMap((g) => g.items)
                .reduce((sum, i) => sum + (i.rentalPrice || 0), 0);
              return { ...it, rental };
            } catch {
              return { ...it, rental: 0 };
            }
          }
          return it;
        })
      );
      setItems(updated);
    }
    if (items.some((it) => it.type === "product" && typeof it.rental === "undefined")) {
      void fillRental();
    }
  }, [items, ensureKit]);

  useEffect(() => {
    const productIds = Array.from(
      new Set(
        items
          .filter((it) => it.type === "product" && typeof it.productId === "string")
          .map((it) => it.productId as string)
      )
    );
    productIds.forEach((id) => {
      void ensureKit(id);
    });
  }, [items, ensureKit]);

  const kitLibraryItems = useMemo<SetupLibraryItem[]>(() => {
    const activeProductIds = new Set(
      items
        .filter((it) => it.type === "product" && typeof it.productId === "string")
        .map((it) => it.productId as string)
    );
    const seen = new Set<string>();
    const library: SetupLibraryItem[] = [];
    activeProductIds.forEach((productId) => {
      const groups = kitCache[productId];
      if (!groups) return;
      groups.forEach((group) => {
        (group.items || []).forEach((equipment: any) => {
          const equipId = typeof equipment.id === "string" ? equipment.id : null;
          if (!equipId || seen.has(equipId)) return;
          const name =
            typeof equipment.name === "string"
              ? equipment.name
              : typeof equipment.serialNumber === "string"
                ? equipment.serialNumber
                : "Equipment";
          const category = typeof equipment.category === "string" ? equipment.category : group.groupId;
          seen.add(equipId);
          library.push({ id: equipId, name, category: category || undefined, type: "equipment" });
        });
      });
    });
    library.sort((a, b) => a.name.localeCompare(b.name));
    return library;
  }, [items, kitCache]);

  const handleSetupPlanChange = useCallback((plan: ProposalSetupPlan) => {
    setSetupPlan(plan);
  }, []);

  const directory = useMemo<DirectoryEntry[]>(() => {
    const entries: DirectoryEntry[] = [];
    orgs.forEach((org) => {
      const name = normaliseString(org?.name) || "Untitled organisation";
      const domain = normaliseString(org?.domain);
      const key = `org:${org.id}`;
      entries.push({
        key,
        id: org.id,
        type: "org",
        label: name,
        badge: "Organisation",
        badgeClass: "bg-slate-100 text-slate-700",
        description: domain || undefined,
        search: [name, domain, normaliseString(org?.slug)].filter(Boolean).join(" ").toLowerCase(),
        meta: {
          orgId: org.id,
          organisation: name,
        },
      });
    });
    crmRecords.forEach((record) => {
      const label = record.organisation || record.fullName || record.email || "CRM record";
      const descriptionParts: string[] = [];
      if (record.fullName && record.organisation) {
        descriptionParts.push(record.fullName);
      } else if (record.fullName) {
        descriptionParts.push(record.fullName);
      }
      if (record.email) descriptionParts.push(record.email);
      if (record.phone) descriptionParts.push(record.phone);
      const searchTokens = [
        label,
        record.fullName,
        record.organisation,
        record.email,
        record.phone,
        record.statusLabel,
        record.crmStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const badgeClass = CRM_STATUS_BADGE_TONE[record.crmStatus] || "bg-orange-100 text-orange-700";
      entries.push({
        key: `crm:${record.id}`,
        id: record.id,
        type: "crm",
        label,
        badge: record.statusLabel || "CRM",
        badgeClass,
        description: descriptionParts.join(" • ") || undefined,
        search: searchTokens,
        meta: {
          orgId: record.orgId || undefined,
          fullName: record.fullName || undefined,
          email: record.email || undefined,
          phone: record.phone || undefined,
          organisation: record.organisation || undefined,
          status: record.crmStatus,
          statusLabel: record.statusLabel,
        },
      });
    });
    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }, [crmRecords, orgs]);

  const filteredDirectory = useMemo(() => {
    if (!showDirectory) return [];
    const queryValue = organisationQuery.trim().toLowerCase();
    if (!queryValue) {
      return directory.slice(0, 8);
    }
    return directory.filter((entry) => entry.search.includes(queryValue)).slice(0, 8);
  }, [directory, organisationQuery, showDirectory]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [organisationQuery, showDirectory]);

  const selectedEntry = useMemo(
    () => directory.find((entry) => entry.key === selectedDirectoryKey) || null,
    [directory, selectedDirectoryKey]
  );

  useEffect(() => {
    if (!orgId) return;
    if (selectedEntry && selectedEntry.type === "crm") {
      return;
    }
    const entry = directory.find((item) => item.type === "org" && item.id === orgId);
    if (entry) {
      setOrganisationQuery(entry.label);
      setSelectedDirectoryKey(entry.key);
    }
  }, [directory, orgId, selectedEntry]);

  const handleOrganisationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setOrganisationQuery(value);
    setSelectedDirectoryKey(null);
    setOrgId("");
    setClientEmail("");
    setShowDirectory(true);
  };

  const handleDirectorySelect = (entry: DirectoryEntry) => {
    setOrganisationQuery(entry.label);
    setSelectedDirectoryKey(entry.key);
    setShowDirectory(false);
    const entryOrgId = entry.type === "org" ? entry.id : entry.meta.orgId || "";
    setOrgId(entryOrgId);
    if (entry.type === "crm") {
      if (entry.meta.email) {
        setClientEmail(entry.meta.email);
      }
    }
  };

  const handleDirectoryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showDirectory && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      setShowDirectory(true);
    }
    if (!showDirectory || filteredDirectory.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredDirectory.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = filteredDirectory[highlightedIndex];
      if (entry) {
        handleDirectorySelect(entry);
      }
    } else if (event.key === "Escape") {
      setShowDirectory(false);
    }
  };

  const addProduct = async (id: string) => {
    const prod = products.find((p) => p.id === id);
    if (prod) {
      let rental = 0;
      try {
        const kit = await ensureKit(id);
        rental = kit
          .flatMap((g) => g.items)
          .reduce((sum, i) => sum + (i.rentalPrice || 0), 0);
      } catch {}
      setItems((prev) => [
        ...prev,
        { type: "product", productId: id, name: prod.name, price: prod.price, rental },
      ]);
    }
  };
  const addCustom = () => setItems((prev) => [...prev, { type: "custom", name: "", price: 0 }]);
  const addGeneratedItems = (generated: ProposalItem[]) => {
    if (!generated || generated.length === 0) return;
    setItems((prev) => [...prev, ...generated]);
  };
  const appendNarrativeToNotes = (value: string) => {
    if (!value || !value.trim()) return;
    setCustomText((prev) => {
      if (!prev || !prev.trim()) return value;
      return `${prev}\n\n${value}`;
    });
  };
  const updateItem = (i: number, field: keyof ProposalItem, value: any) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it))
    );
  };
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const toggleAgreement = (id: string) => {
    setAgreementIds((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };
  const toggleSection = (id: string) => {
    setSectionIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const submit = async () => {
    try {
      const callable = httpsCallable(functions, "admin_createProposal");
      await callable({
        orgId,
        clientEmail,
        items,
        agreementIds,
        sectionIds,
        templateId: templateId || undefined,
        customText,
        setupPlan,
      });
      router.push("/admin/proposals");
    } catch (err: any) {
      alert(err.message || "Error creating proposal");
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!canManage) return <p>You do not have permission to create proposals.</p>;

  return (
    <div className="grid gap-6 max-w-3xl">
      <h1 className="text-xl font-semibold">New Proposal</h1>
      {step === 1 && (
        <div className="card p-4 grid gap-4">
          <div ref={searchContainerRef} className="relative">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Organisation / CRM record
              <input
                type="text"
                className="input mt-1 w-full"
                placeholder="Search organisations, clients, or prospects"
                value={organisationQuery}
                onChange={handleOrganisationChange}
                onFocus={() => setShowDirectory(true)}
                onKeyDown={handleDirectoryKeyDown}
              />
            </label>
            {showDirectory && (
              <div className="absolute z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-lg">
                {filteredDirectory.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-500">No matches found.</p>
                ) : (
                  <ul>
                    {filteredDirectory.map((entry, index) => (
                      <li key={entry.key}>
                        <button
                          type="button"
                          className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left text-sm ${
                            index === highlightedIndex ? "bg-orange-50" : "bg-white"
                          }`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleDirectorySelect(entry)}
                        >
                          <div className="flex w-full items-center justify-between gap-3">
                            <p className="font-semibold text-gray-900">{entry.label}</p>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${entry.badgeClass}`}>
                              {entry.badge}
                            </span>
                          </div>
                          {entry.description ? (
                            <p className="text-xs text-gray-600">{entry.description}</p>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {crmError ? <p className="mt-2 text-xs text-amber-600">{crmError}</p> : null}
          </div>

          {selectedEntry ? (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
              <p className="font-semibold">{selectedEntry.label}</p>
              <p className="mt-1 text-xs uppercase tracking-wide">
                {selectedEntry.type === "crm" ? "CRM record" : "Organisation"}
              </p>
              {selectedEntry.meta.statusLabel ? (
                <p className="mt-1 text-xs">Pipeline status: {selectedEntry.meta.statusLabel}</p>
              ) : null}
              {selectedEntry.meta.email ? (
                <p className="mt-1 text-xs">Email: {selectedEntry.meta.email}</p>
              ) : null}
              {selectedEntry.meta.phone ? (
                <p className="mt-1 text-xs">Phone: {selectedEntry.meta.phone}</p>
              ) : null}
            </div>
          ) : organisationQuery ? (
            <p className="rounded-2xl border border-dashed border-gray-300 p-4 text-xs text-gray-600">
              Select an organisation from the CRM to attach this proposal to <span className="font-semibold text-gray-800">{organisationQuery}</span>.
            </p>
          ) : null}

          {selectedEntry?.type === "crm" && !selectedEntry.meta.orgId ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              This CRM contact is not linked to an organisation yet. Open the CRM to assign one before sending the proposal.
            </p>
          ) : null}

          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Client email
            <input
              type="email"
              className="input mt-1"
              placeholder="client@email.com"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Proposal template
            <select className="input mt-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Intro / notes
            <textarea
              className="input mt-1"
              placeholder="Add a personal introduction or notes for the client"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
            />
          </label>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <Link href="/admin/users" className="link text-orange-600">
              Manage organisations in CRM
            </Link>
            <button className="btn" disabled={!orgId || !clientEmail} onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="grid gap-4">
          <div className="card p-4 grid gap-3">
            <div className="flex gap-2">
              <select className="input" onChange={(e) => { if (e.target.value) { addProduct(e.target.value); e.target.value=""; } }}>
                <option value="">Add product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn" onClick={addCustom}>Add Custom</button>
            </div>
            {items.length === 0 ? <p>No items added.</p> : (
              <div className="grid gap-2">
                {items.map((it, i) => (
                  <div key={i} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      {it.type === "custom" ? (
                        <>
                          <input className="input flex-1" placeholder="Description" value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
                          <input className="input w-24" type="number" value={it.price} onChange={(e) => updateItem(i, "price", Number(e.target.value))} />
                        </>
                      ) : (
                        <>
                          <span className="flex-1">{it.name}</span>
                          <span className="w-24 text-right">£{it.price}</span>
                          {typeof it.rental === "number" && (
                            <span className="w-24 text-right text-xs text-gray-500">
                              £{it.rental.toFixed(2)} rent
                            </span>
                          )}
                        </>
                      )}
                      <button className="btn-outline" onClick={() => removeItem(i)}>Remove</button>
                    </div>
                    {it.type === "product" && (
                      <textarea className="input" placeholder="Notes" value={it.notes || ""} onChange={(e) => updateItem(i, "notes", e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between mt-2">
              <button className="btn-outline" onClick={() => setStep(1)}>Back</button>
              <button className="btn" onClick={() => setStep(3)}>Next</button>
            </div>
          </div>
          <div className="card p-4 grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">Stage & setup designer</h2>
              <p className="text-sm text-gray-600">
                Map camera angles, lighting positions, control areas, and staging stock before sending the proposal.
              </p>
            </div>
            <ProposalSetupBuilder
              kitItems={kitLibraryItems}
              value={setupPlan}
              onChange={handleSetupPlanChange}
            />
          </div>
          <ProposalStoryboardAssistant
            items={items}
            products={products}
            orgId={orgId || undefined}
            onAddItems={addGeneratedItems}
            onAppendNarrative={appendNarrativeToNotes}
          />
        </div>
      )}
      {step === 3 && (
        <div className="card p-4 grid gap-3">
          {sections.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} />
              <span>{s.title || s.id}</span>
            </label>
          ))}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(2)}>Back</button>
            <button className="btn" onClick={() => setStep(4)}>Next</button>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="card p-4 grid gap-3">
          {agreements.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input type="checkbox" checked={agreementIds.includes(a.id)} onChange={() => toggleAgreement(a.id)} />
              <span>{a.title || a.id}</span>
            </label>
          ))}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(3)}>Back</button>
            <button className="btn" onClick={() => setStep(5)}>Next</button>
          </div>
        </div>
      )}
      {step === 5 && (
        <div className="card p-4 grid gap-3">
          <p className="font-semibold">Review</p>
          <p>Organisation: {orgs.find((o) => o.id === orgId)?.name || orgId}</p>
          <p>Email: {clientEmail}</p>
          {items.length > 0 && (
            <ul className="list-disc pl-6">
              {items.map((it, i) => (
                <li key={i}>
                  {it.name} - £{it.price}
                  {typeof it.rental === "number" && it.rental > 0
                    ? ` (Rental £${it.rental.toFixed(2)})`
                    : ""}
                </li>
              ))}
            </ul>
          )}
          {(setupPlan.placements.length > 0 || setupPlan.notes.trim()) && (
            <div className="grid gap-1">
              <p className="font-medium">Setup plan</p>
              <p className="text-sm text-gray-600">Layout: {SETUP_LAYOUT_LABELS[setupPlan.layout] || setupPlan.layout}</p>
              {setupPlan.placements.length > 0 && (
                <ul className="list-disc pl-6">
                  {setupPlan.placements.map((placement) => (
                    <li key={placement.id}>
                      {placement.itemName} ×{placement.quantity} → {SETUP_ZONE_LABELS[placement.zone] || placement.zone}
                      {placement.notes ? ` (${placement.notes})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {setupPlan.notes.trim() && (
                <p className="text-sm text-gray-600">Notes: {setupPlan.notes.trim()}</p>
              )}
            </div>
          )}
          {sectionIds.length > 0 && <p>Sections: {sectionIds.length}</p>}
          {agreementIds.length > 0 && (
            <p>Agreements: {agreementIds.length}</p>
          )}
          <div className="flex justify-between mt-2">
            <button className="btn-outline" onClick={() => setStep(4)}>Back</button>
            <button className="btn" onClick={submit}>Create Proposal</button>
          </div>
        </div>
      )}
      <div>
        <Link href="/admin/proposals" className="link">Back to proposals</Link>
      </div>
    </div>
  );
}
