"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";

import PortalContainer from "@/components/PortalContainer";

interface WorkwearPortalProps {
  audience: "franchise" | "team";
}

interface BundleConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  items: string[];
  defaultSupplier: string;
  leadTime: string;
}

const SUPPLIERS = [
  {
    id: "clothes2order",
    name: "Clothes2Order",
    readiness: "Ready for API connection",
    notes:
      "Supports on-demand embroidery and print. We'll map product SKUs once the API credentials are issued.",
    onboarding: "Awaiting production API keys",
  },
  {
    id: "pod",
    name: "POD fulfilment",
    readiness: "Roadmap",
    notes:
      "Acts as a backup print-on-demand supplier when core lines are out of stock or for limited runs.",
    onboarding: "Need garment catalogue and pricing feed",
  },
  {
    id: "local",
    name: "Local supplier",
    readiness: "Manual",
    notes:
      "Use for bespoke garments or rush orders where HQ approval is required before processing.",
    onboarding: "Submit specs for manual review",
  },
] as const;

const BUNDLES: BundleConfig[] = [
  {
    id: "starter",
    name: "Starter shift kit",
    category: "Core uniform",
    description: "Two polos, softshell jacket, and branded cap for new starters.",
    items: ["2× Moisture-wicking polo", "1× Softshell jacket", "1× Branded cap"],
    defaultSupplier: "clothes2order",
    leadTime: "7 working days",
  },
  {
    id: "production",
    name: "Production crew essentials",
    category: "Crew wear",
    description: "High-visibility layers and weatherproof trousers for on-location shoots.",
    items: ["1× Hi-vis jacket", "1× Waterproof trousers", "1× Thermal base layer"],
    defaultSupplier: "pod",
    leadTime: "10 working days",
  },
  {
    id: "event",
    name: "Event stand kit",
    category: "Events",
    description: "T-shirts, aprons, and tote bags ready for event activations.",
    items: ["4× Crew t-shirt", "2× Branded aprons", "25× Tote bags"],
    defaultSupplier: "clothes2order",
    leadTime: "5 working days",
  },
  {
    id: "winter",
    name: "Winter warmth",
    category: "Seasonal",
    description: "Layering essentials for cold-weather production days.",
    items: ["1× Insulated parka", "1× Fleece mid-layer", "1× Thermal gloves"],
    defaultSupplier: "local",
    leadTime: "14 working days",
  },
];

const SIZE_GUIDANCE = [
  {
    label: "Measurements spreadsheet",
    summary: "CSV template for capturing chest, waist, and inseam with conversion guides.",
  },
  {
    label: "Branding pack",
    summary: "Includes vector logos and embroidery rules to send to suppliers.",
  },
  {
    label: "Personalisation policy",
    summary: "Explains how to request name badges or role-based variations.",
  },
];

const DELIVERY_WINDOWS = [
  {
    title: "Standard",
    window: "5-7 working days",
    bestFor: "Most embroidered items via Clothes2Order",
  },
  {
    title: "Express",
    window: "2-3 working days",
    bestFor: "Screen-print orders with existing artwork",
  },
  {
    title: "Event critical",
    window: "Next-day dispatch",
    bestFor: "Hand-picked stock from POD partner, subject to manual approval",
  },
];

export default function WorkwearPortal({ audience }: WorkwearPortalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [preferredSupplier, setPreferredSupplier] = useState<string>(SUPPLIERS[0].id);
  const [notes, setNotes] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [orderName, setOrderName] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredBundles = useMemo(() => {
    if (selectedCategory === "all") return BUNDLES;
    return BUNDLES.filter((bundle) => bundle.category === selectedCategory);
  }, [selectedCategory]);

  const resetFeedback = () => setFeedback(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(
      "Request captured. The operations team will route this bundle to the pending supplier integration and follow up with next steps."
    );
  };

  const backHref = audience === "franchise" ? "/franchise" : "/contractors";
  const audienceNoun = audience === "franchise" ? "franchise" : "team";

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Workwear ordering hub</h1>
            <p className="text-sm text-gray-600">
              Outfit your {audienceNoun} with approved uniforms while we finalise the Clothes2Order integration and backup POD
              workflows.
            </p>
          </div>
          <Link href={backHref} className="btn-xs btn-outline">
            Back to {audience === "franchise" ? "franchise portal" : "team portal"}
          </Link>
        </div>

        <section className="card border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Supplier integrations</h2>
              <p className="text-sm text-gray-600">
                Track onboarding progress and choose which partner should fulfil this request when APIs are connected.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUPPLIERS.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  onClick={() => {
                    resetFeedback();
                    setPreferredSupplier(supplier.id);
                  }}
                  className={`btn-xs ${preferredSupplier === supplier.id ? "btn" : "btn-outline"}`}
                >
                  {supplier.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {SUPPLIERS.map((supplier) => (
              <article
                key={supplier.id}
                className={`rounded-lg border p-4 text-sm ${
                  supplier.id === preferredSupplier
                    ? "border-blue-200 bg-blue-50"
                    : "border-slate-200 bg-white"
                }`}
                aria-live={supplier.id === preferredSupplier ? "polite" : undefined}
              >
                <p className="text-xs uppercase tracking-wide text-gray-500">{supplier.readiness}</p>
                <h3 className="mt-1 text-base font-semibold">{supplier.name}</h3>
                <p className="mt-2 text-gray-600">{supplier.notes}</p>
                <p className="mt-3 text-gray-500">{supplier.onboarding}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="card border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Pre-approved bundles</h2>
              <p className="text-sm text-gray-600">
                Filter curated packs that match your crew type and pass order notes to HQ for fulfilment.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  resetFeedback();
                  setSelectedCategory("all");
                }}
                className={`btn-xs ${selectedCategory === "all" ? "btn" : "btn-outline"}`}
              >
                All bundles
              </button>
              {Array.from(new Set(BUNDLES.map((bundle) => bundle.category))).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    resetFeedback();
                    setSelectedCategory(category);
                  }}
                  className={`btn-xs ${selectedCategory === category ? "btn" : "btn-outline"}`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {filteredBundles.map((bundle) => (
              <article key={bundle.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">{bundle.name}</h3>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{bundle.category}</p>
                  </div>
                  <span className="text-xs font-medium text-blue-700">{bundle.leadTime}</span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{bundle.description}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {bundle.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-gray-500">
                  Preferred supplier: {SUPPLIERS.find((s) => s.id === bundle.defaultSupplier)?.name ?? "TBC"}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="card border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Sizing & wearer details</h2>
              <p className="text-sm text-gray-600">
                Gather accurate measurements and upload them once integrations are ready so orders flow straight to production.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SIZE_GUIDANCE.map((asset) => (
                <span key={asset.label} className="badge badge-outline whitespace-nowrap text-xs">
                  {asset.label}
                </span>
              ))}
            </div>
          </div>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Order name</span>
                <input
                  className="input"
                  placeholder="Spring onboarding cohort"
                  value={orderName}
                  onChange={(event) => {
                    resetFeedback();
                    setOrderName(event.target.value);
                  }}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Target delivery</span>
                <input
                  className="input"
                  type="date"
                  value={targetDate}
                  onChange={(event) => {
                    resetFeedback();
                    setTargetDate(event.target.value);
                  }}
                  required
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Additional notes</span>
              <textarea
                className="textarea min-h-[120px]"
                placeholder="List wearer names, sizes, and any personalisation required."
                value={notes}
                onChange={(event) => {
                  resetFeedback();
                  setNotes(event.target.value);
                }}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {DELIVERY_WINDOWS.map((window) => (
                <article key={window.title} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{window.title}</p>
                  <p className="text-sm font-semibold text-gray-800">{window.window}</p>
                  <p className="mt-1 text-gray-600">{window.bestFor}</p>
                </article>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-sm">
                Save request for HQ
              </button>
              <p className="text-xs text-gray-500">
                We will push these details to the selected supplier once credentials are configured.
              </p>
            </div>
            {feedback && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800" aria-live="polite">
                {feedback}
              </div>
            )}
          </form>
        </section>

        <section className="card border border-slate-200 p-4">
          <h2 className="text-lg font-semibold mb-2">Next steps</h2>
          <p className="text-sm text-gray-600">
            HQ will connect supplier catalogues, pricing, and artwork automation here so your orders can be raised and tracked
            without leaving the portal. Expect progress updates in the operations newsletter.
          </p>
        </section>
      </div>
    </PortalContainer>
  );
}
