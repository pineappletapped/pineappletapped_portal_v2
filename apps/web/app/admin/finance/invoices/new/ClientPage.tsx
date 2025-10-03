
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";

import { useRoleGate } from "@/hooks/useRoleGate";
import { adminListUsers } from "@/lib/admin";
import { CRM_STATUS_LABELS, normaliseCrmStatus } from "@/lib/crm";
import { db } from "@/lib/firebase";
import { getProducts } from "@/lib/products";

interface LineItem {
  description: string;
  amount: string;
  productId: string;
}

interface SplitPayment {
  amount: string;
  dueDate: string;
}

interface InvoiceFormState {
  orgId: string;
  organisationName: string;
  projectId: string;
  crmRecordId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientStatus: string;
  dueDate: string;
  items: LineItem[];
  paymentTerms: string;
  termsUrl: string;
  allowStripe: boolean;
  stripePaymentLink: string;
  splitPaymentsEnabled: boolean;
  splitPayments: SplitPayment[];
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

const emptySplitPayment: SplitPayment = { amount: "", dueDate: "" };

const createInitialForm = (): InvoiceFormState => ({
  orgId: "",
  organisationName: "",
  projectId: "",
  crmRecordId: "",
  clientId: "",
  clientName: "",
  clientEmail: "",
  clientStatus: "",
  dueDate: "",
  items: [{ description: "", amount: "", productId: "" }],
  paymentTerms: "",
  termsUrl: "",
  allowStripe: true,
  stripePaymentLink: "",
  splitPaymentsEnabled: false,
  splitPayments: [{ ...emptySplitPayment }],
});

function formatCurrency(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(amount);
}

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

export default function NewInvoicePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [crmRecords, setCrmRecords] = useState<CRMDirectoryRecord[]>([]);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceFormState>(() => createInitialForm());
  const [organisationQuery, setOrganisationQuery] = useState("");
  const [selectedDirectoryKey, setSelectedDirectoryKey] = useState<string | null>(null);
  const [showDirectory, setShowDirectory] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "finance"]);

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
    if (guardLoading) {
      return;
    }
    if (!allowed) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const [orgSnap, prodList, crmResponse] = await Promise.all([
          getDocs(collection(db, "orgs")),
          getProducts(),
          adminListUsers().catch((error) => {
            console.error("Failed to load CRM directory", error);
            setCrmError(
              "We couldn't load the CRM directory. You can still enter a custom billing name."
            );
            return null;
          }),
        ]);
        if (!active) {
          return;
        }
        setOrgs(orgSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setProducts(prodList);
        if (crmResponse && Array.isArray(crmResponse.users)) {
          const users: CRMDirectoryRecord[] = crmResponse.users
            .map((entry: Record<string, any>) => {
              const id = normaliseString(entry.id) || normaliseString(entry.uid);
              if (!id) {
                return null;
              }
              const fullName = normaliseString(entry.fullName);
              const organisation = normaliseString(entry.organisation);
              const email = normaliseString(entry.email);
              const phone = normaliseString(entry.phone);
              const status = normaliseCrmStatus(entry.crmStatus);
              const statusLabel = CRM_STATUS_LABELS[status];
              const orgId = extractOrgId(entry);
              return {
                id,
                fullName,
                organisation,
                email,
                phone,
                crmStatus: status,
                statusLabel,
                orgId,
              } as CRMDirectoryRecord;
            })
            .filter(Boolean) as CRMDirectoryRecord[];
          setCrmRecords(users);
        }
      } catch (error) {
        console.error("Failed to load invoice prerequisites", error);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [allowed, guardLoading]);

  useEffect(() => {
    (async () => {
      if (!allowed) {
        return;
      }
      if (!form.orgId) {
        setProjects([]);
        return;
      }
      try {
        const pSnap = await getDocs(
          query(collection(db, "projects"), where("orgId", "==", form.orgId))
        );
        setProjects(pSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error("Failed to load projects for organisation", error);
        setProjects([]);
      }
    })();
  }, [allowed, form.orgId]);

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
        search: [name, domain, normaliseString(org?.slug)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
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
      if (record.email) {
        descriptionParts.push(record.email);
      }
      if (record.phone) {
        descriptionParts.push(record.phone);
      }
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
      const badgeClass =
        CRM_STATUS_BADGE_TONE[record.crmStatus] || "bg-orange-100 text-orange-700";
      entries.push({
        key: `crm:${record.id}`,
        id: record.id,
        type: "crm",
        label,
        badge: record.statusLabel,
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
    if (!showDirectory) {
      return [];
    }
    const queryValue = organisationQuery.trim().toLowerCase();
    if (!queryValue) {
      return directory.slice(0, 8);
    }
    return directory
      .filter((entry) => entry.search.includes(queryValue))
      .slice(0, 8);
  }, [directory, organisationQuery, showDirectory]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [organisationQuery, showDirectory]);

  const selectedEntry = useMemo(
    () => directory.find((entry) => entry.key === selectedDirectoryKey) || null,
    [directory, selectedDirectoryKey]
  );

  const invoiceTotal = useMemo(() => {
    return form.items.reduce((sum, item) => {
      const value = Number.parseFloat(item.amount || "0");
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
  }, [form.items]);

  const scheduleTotal = useMemo(() => {
    if (!form.splitPaymentsEnabled) {
      return 0;
    }
    return form.splitPayments.reduce((sum, payment) => {
      const value = Number.parseFloat(payment.amount || "0");
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
  }, [form.splitPayments, form.splitPaymentsEnabled]);

  const handleOrganisationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setOrganisationQuery(value);
    setSelectedDirectoryKey(null);
    setForm((prev) => ({
      ...prev,
      orgId: "",
      crmRecordId: "",
      clientId: "",
      clientName: "",
      clientEmail: "",
      clientStatus: "",
      organisationName: value,
      projectId: "",
    }));
    setShowDirectory(true);
  };

  const handleDirectorySelect = (entry: DirectoryEntry) => {
    setOrganisationQuery(entry.label);
    setSelectedDirectoryKey(entry.key);
    setShowDirectory(false);
    setForm((prev) => ({
      ...prev,
      orgId: entry.type === "org" ? entry.id : entry.meta.orgId || "",
      crmRecordId: entry.type === "crm" ? entry.id : "",
      clientId: entry.type === "crm" ? entry.id : "",
      clientName:
        entry.type === "crm"
          ? entry.meta.fullName || entry.label
          : entry.meta.organisation || entry.label,
      clientEmail: entry.meta.email || "",
      clientStatus: entry.meta.status || "",
      organisationName:
        entry.meta.organisation || entry.label || prev.organisationName,
      projectId: "",
    }));
  };

  const handleDirectoryKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ) => {
    if (!showDirectory && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      setShowDirectory(true);
    }
    if (!showDirectory || filteredDirectory.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        Math.min(prev + 1, filteredDirectory.length - 1)
      );
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

  const handleItemChange = (
    idx: number,
    field: keyof LineItem,
    value: string
  ) => {
    setForm((prev) => {
      const items = [...prev.items];
      const current = { ...items[idx], [field]: value } as LineItem;
      if (field === "productId") {
        current.description =
          products.find((p) => p.id === value)?.name || current.description;
      }
      items[idx] = current;
      return { ...prev, items };
    });
  };

  const addItem = () =>
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { description: "", amount: "", productId: "" }],
    }));

  const removeItem = (idx: number) =>
    setForm((prev) => ({
      ...prev,
      items:
        prev.items.length <= 1
          ? prev.items
          : prev.items.filter((_, index) => index !== idx),
    }));

  const handleSplitToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.target;
    setForm((prev) => ({
      ...prev,
      splitPaymentsEnabled: checked,
      splitPayments: checked
        ? prev.splitPayments.length > 0
          ? prev.splitPayments
          : [{ ...emptySplitPayment }]
        : [{ ...emptySplitPayment }],
    }));
  };

  const handleSplitPaymentChange = (
    index: number,
    field: keyof SplitPayment,
    value: string
  ) => {
    setForm((prev) => {
      const schedule = [...prev.splitPayments];
      schedule[index] = { ...schedule[index], [field]: value };
      return { ...prev, splitPayments: schedule };
    });
  };

  const addSplitPayment = () =>
    setForm((prev) => ({
      ...prev,
      splitPayments: [...prev.splitPayments, { ...emptySplitPayment }],
    }));

  const removeSplitPayment = (index: number) =>
    setForm((prev) => {
      const schedule = prev.splitPayments.filter((_, idx) => idx !== index);
      return {
        ...prev,
        splitPayments:
          schedule.length > 0 ? schedule : [{ ...emptySplitPayment }],
      };
    });

  const handleFormFieldChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const target = event.target;
    const { name } = target;
    if (!name) {
      return;
    }
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: target.checked } as InvoiceFormState));
    } else {
      setForm((prev) => ({ ...prev, [name]: target.value } as InvoiceFormState));
    }
  };

  const sanitiseLineItems = () => {
    return form.items
      .map((item) => {
        const amountValue = Number.parseFloat(item.amount || "0");
        const amount = Number.isFinite(amountValue) ? amountValue : 0;
        const description = item.description.trim();
        return {
          description,
          amount,
          productId: item.productId || null,
        };
      })
      .filter((item) => item.description || item.amount > 0);
  };

  const buildPaymentSchedule = () => {
    if (!form.splitPaymentsEnabled) {
      return [] as { amount: number; dueDate: string }[];
    }
    return form.splitPayments
      .map((entry) => {
        const amountValue = Number.parseFloat(entry.amount || "0");
        const amount = Number.isFinite(amountValue) ? amountValue : 0;
        const dueDate = entry.dueDate.trim();
        return {
          amount,
          dueDate,
        };
      })
      .filter((entry) => entry.amount > 0 && entry.dueDate);
  };

  const saveInvoice = async () => {
    if (saving) {
      return;
    }
    const billingName =
      organisationQuery.trim() ||
      form.organisationName.trim() ||
      selectedEntry?.label.trim() ||
      "";
    if (!billingName) {
      alert("Select or enter a client, prospect, or organisation to bill.");
      return;
    }
    const lineItems = sanitiseLineItems();
    if (lineItems.length === 0) {
      alert("Add at least one line item with a description or amount.");
      return;
    }
    const schedule = buildPaymentSchedule();
    if (form.splitPaymentsEnabled && schedule.length === 0) {
      alert("Add at least one split payment with an amount and due date.");
      return;
    }
    if (form.splitPaymentsEnabled) {
      const scheduleTotalValue = schedule.reduce((sum, entry) => sum + entry.amount, 0);
      if (Math.abs(scheduleTotalValue - invoiceTotal) > 0.5) {
        alert(
          "Split payments must add up to the invoice total before saving."
        );
        return;
      }
    }
    try {
      setSaving(true);
      const schedule = buildPaymentSchedule();
      const sortedSchedule = [...schedule].sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate)
      );
      const finalDueDate = form.splitPaymentsEnabled
        ? sortedSchedule.at(-1)?.dueDate || null
        : form.dueDate || null;
      const payload: Record<string, unknown> = {
        orgId: form.orgId || null,
        organisationName: billingName,
        crmRecordId: form.crmRecordId || null,
        clientId: form.clientId || null,
        clientName: form.clientName || billingName,
        clientEmail: form.clientEmail || null,
        clientStatus: form.clientStatus || null,
        billingEntityType: selectedEntry?.type || (billingName ? "custom" : null),
        projectId: form.projectId || null,
        dueDate: finalDueDate,
        items: lineItems,
        total: invoiceTotal,
        status: "unpaid",
        createdAt: new Date().toISOString(),
        paymentTerms: form.paymentTerms || null,
        termsUrl: form.termsUrl || null,
        allowStripePayment: form.allowStripe,
        stripePaymentLink: form.stripePaymentLink || null,
        splitPayments: form.splitPaymentsEnabled ? sortedSchedule : [],
        splitPaymentsTotal: form.splitPaymentsEnabled
          ? sortedSchedule.reduce((sum, entry) => sum + entry.amount, 0)
          : null,
        splitPaymentsCount: form.splitPaymentsEnabled
          ? sortedSchedule.length
          : null,
        firstPaymentDueDate: form.splitPaymentsEnabled
          ? sortedSchedule.at(0)?.dueDate || null
          : null,
      };
      await addDoc(collection(db, "clientInvoices"), payload);
      alert("Invoice created");
      setForm(createInitialForm());
      setOrganisationQuery("");
      setSelectedDirectoryKey(null);
      setShowDirectory(false);
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Error creating invoice");
    } finally {
      setSaving(false);
    }
  };

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }
  if (!allowed) {
    return <p>You do not have access to this page.</p>;
  }

  const splitScheduleDelta = form.splitPaymentsEnabled
    ? invoiceTotal - scheduleTotal
    : 0;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoice</p>
          <h1 className="text-2xl font-semibold text-gray-900">Create invoice</h1>
          <p className="text-sm text-gray-600">
            Connect this invoice to any client or prospect from the CRM, outline the work delivered, and configure payment terms.
          </p>
        </div>
        <Link href="/admin/finance" className="btn-outline btn-sm self-start">
          Back to finance overview
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Billing details</h2>
            <p className="text-sm text-gray-600">
              Search the CRM to attach this invoice to a client or prospect, then capture the services being billed.
            </p>
          </div>
          <div className="space-y-5 px-6 py-6">
            <div ref={searchContainerRef} className="relative">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Bill to
                <input
                  type="text"
                  className="input mt-1 w-full"
                  placeholder="Search clients, prospects, or organisations"
                  value={organisationQuery}
                  onChange={handleOrganisationChange}
                  onFocus={() => setShowDirectory(true)}
                  onKeyDown={handleDirectoryKeyDown}
                />
              </label>
              {showDirectory && (
                <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-lg">
                  {filteredDirectory.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-500">No matches found.</p>
                  ) : (
                    <ul>
                      {filteredDirectory.map((entry, index) => (
                        <li key={entry.key}>
                          <button
                            type="button"
                            className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left text-sm ${
                              index === highlightedIndex
                                ? "bg-orange-50"
                                : "bg-white"
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
              {crmError ? (
                <p className="mt-2 text-xs text-amber-600">{crmError}</p>
              ) : null}
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
                This invoice will be addressed to <span className="font-semibold text-gray-800">{organisationQuery}</span>.
              </p>
            ) : null}

            {form.orgId ? (
              <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-gray-500">
                Project
                <select
                  name="projectId"
                  className="input mt-1"
                  value={form.projectId}
                  onChange={handleFormFieldChange}
                >
                  <option value="">No specific project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name || project.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Line items</h3>
                <button
                  type="button"
                  className="btn-outline btn-xs"
                  onClick={addItem}
                >
                  Add line item
                </button>
              </div>
              <div className="space-y-3">
                {form.items.map((item, idx) => (
                  <div key={idx} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <label className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Description
                        <input
                          type="text"
                          className="input mt-1 w-full"
                          placeholder="e.g. Social media management retainer"
                          value={item.description}
                          onChange={(event) =>
                            handleItemChange(idx, "description", event.target.value)
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Amount
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input mt-1 w-32"
                          value={item.amount}
                          onChange={(event) =>
                            handleItemChange(idx, "amount", event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Link to product
                      <select
                        className="input mt-1 w-full"
                        value={item.productId}
                        onChange={(event) =>
                          handleItemChange(idx, "productId", event.target.value)
                        }
                      >
                        <option value="">Custom line item</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {form.items.length > 1 ? (
                      <button
                        type="button"
                        className="btn-outline btn-xs mt-3 text-red-600"
                        onClick={() => removeItem(idx)}
                      >
                        Remove line item
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <p className="text-right text-sm font-semibold text-gray-900">
              Total: {formatCurrency(invoiceTotal)}
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="btn"
                onClick={saveInvoice}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save invoice"}
              </button>
              <Link href="/admin/finance" className="btn-outline">
                Cancel
              </Link>
            </div>
          </div>
        </section>

        <aside className="grid gap-6">
          <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Payment terms</h2>
              <p className="text-sm text-gray-600">
                Outline how and when the client should pay, attach terms, and offer online payments through Stripe.
              </p>
            </div>
            <div className="space-y-4 px-6 py-6">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Payment terms
                <textarea
                  name="paymentTerms"
                  className="input mt-1 h-24 resize-none"
                  placeholder="e.g. Payment due within 14 days of invoice date. Late fees of 2% apply thereafter."
                  value={form.paymentTerms}
                  onChange={handleFormFieldChange}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Terms &amp; conditions link
                <input
                  type="url"
                  name="termsUrl"
                  className="input mt-1 w-full"
                  placeholder="https://"
                  value={form.termsUrl}
                  onChange={handleFormFieldChange}
                />
              </label>
              <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Allow Stripe payments</p>
                  <p className="text-xs text-gray-600">
                    Let the client settle the invoice securely online.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    name="allowStripe"
                    className="h-4 w-4"
                    checked={form.allowStripe}
                    onChange={handleFormFieldChange}
                  />
                  Enable
                </label>
              </div>
              {form.allowStripe ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Stripe payment link (optional)
                  <input
                    type="url"
                    name="stripePaymentLink"
                    className="input mt-1 w-full"
                    placeholder="https://checkout.stripe.com/..."
                    value={form.stripePaymentLink}
                    onChange={handleFormFieldChange}
                  />
                </label>
              ) : null}
              <div className="space-y-3 rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Payment schedule</p>
                    <p className="text-xs text-gray-600">
                      Offer a single due date or split the balance across staged payments.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={form.splitPaymentsEnabled}
                      onChange={handleSplitToggle}
                    />
                    Split payments
                  </label>
                </div>
                {!form.splitPaymentsEnabled ? (
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Payment due date
                    <input
                      type="date"
                      name="dueDate"
                      className="input mt-1 w-full"
                      value={form.dueDate}
                      onChange={handleFormFieldChange}
                    />
                  </label>
                ) : (
                  <div className="space-y-3">
                    {form.splitPayments.map((split, index) => (
                      <div key={index} className="rounded-2xl border border-dashed border-gray-300 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <label className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Amount
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input mt-1 w-full"
                              value={split.amount}
                              onChange={(event) =>
                                handleSplitPaymentChange(index, "amount", event.target.value)
                              }
                            />
                          </label>
                          <label className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Due date
                            <input
                              type="date"
                              className="input mt-1 w-full"
                              value={split.dueDate}
                              onChange={(event) =>
                                handleSplitPaymentChange(index, "dueDate", event.target.value)
                              }
                            />
                          </label>
                        </div>
                        {form.splitPayments.length > 1 ? (
                          <button
                            type="button"
                            className="btn-outline btn-xs mt-3 text-red-600"
                            onClick={() => removeSplitPayment(index)}
                          >
                            Remove payment
                          </button>
                        ) : null}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn-outline btn-xs"
                      onClick={addSplitPayment}
                    >
                      Add another payment
                    </button>
                    <div className="rounded-2xl bg-gray-50 p-3 text-xs text-gray-600">
                      <p>
                        Scheduled total: <span className="font-semibold text-gray-800">{formatCurrency(scheduleTotal)}</span>
                      </p>
                      <p>
                        {Math.abs(splitScheduleDelta) < 0.5
                          ? "The schedule matches the invoice total."
                          : splitScheduleDelta > 0
                          ? `Add ${formatCurrency(splitScheduleDelta)} more to match the invoice total.`
                          : `The schedule exceeds the invoice total by ${formatCurrency(Math.abs(splitScheduleDelta))}.`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
              <p className="text-sm text-gray-600">
                Double-check the key information before saving.
              </p>
            </div>
            <div className="space-y-3 px-6 py-6 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Bill to</span>
                <span className="font-semibold text-gray-900">
                  {selectedEntry?.label || organisationQuery || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Project</span>
                <span className="font-semibold text-gray-900">
                  {form.projectId || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Stripe enabled</span>
                <span className="font-semibold text-gray-900">
                  {form.allowStripe ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Payments</span>
                <span className="font-semibold text-gray-900">
                  {form.splitPaymentsEnabled
                    ? `${form.splitPayments.length} instalment${form.splitPayments.length === 1 ? "" : "s"}`
                    : form.dueDate || "Due on receipt"}
                </span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold text-gray-900">
                <span>Total</span>
                <span>{formatCurrency(invoiceTotal)}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
