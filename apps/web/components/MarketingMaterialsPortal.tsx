"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";

import PortalContainer from "@/components/PortalContainer";

interface CollectionItem {
  id: string;
  title: string;
  type: "card" | "flyer" | "poster" | "social";
  description: string;
  formats: string[];
  defaultQuantity: number;
  vendorHint: string;
}

const COLLECTIONS = [
  { id: "cards", name: "Business cards" },
  { id: "flyers", name: "Flyers" },
  { id: "posters", name: "Posters" },
  { id: "digital", name: "Digital" },
] as const;

const ITEMS: CollectionItem[] = [
  {
    id: "classic-card",
    title: "Classic double-sided card",
    type: "card",
    description: "HQ approved layout with franchise contact details on the reverse.",
    formats: ["85×55mm", "US business card"],
    defaultQuantity: 250,
    vendorHint: "Maps to VistaPrint product 21",
  },
  {
    id: "premium-card",
    title: "Premium soft-touch card",
    type: "card",
    description: "Silky finish with spot gloss logo highlight for flagship launches.",
    formats: ["85×55mm"],
    defaultQuantity: 500,
    vendorHint: "VistaPrint Luxe range",
  },
  {
    id: "leaflet",
    title: "Tri-fold leaflet",
    type: "flyer",
    description: "Service overview with packages and QR code linking to your microsite.",
    formats: ["A4 tri-fold"],
    defaultQuantity: 100,
    vendorHint: "VistaPrint folded leaflet",
  },
  {
    id: "door-drop",
    title: "Door-drop flyer",
    type: "flyer",
    description: "Single-sided flyer tailored for neighbourhood campaigns.",
    formats: ["A5"],
    defaultQuantity: 1000,
    vendorHint: "Bulk digital print",
  },
  {
    id: "roller-banner",
    title: "Roller banner",
    type: "poster",
    description: "Event-ready pull-up banner with modular messaging panels.",
    formats: ["850×2000mm"],
    defaultQuantity: 2,
    vendorHint: "VistaPrint roller banner",
  },
  {
    id: "social-pack",
    title: "Social launch pack",
    type: "social",
    description: "Square, story, and reel templates to promote new services.",
    formats: ["1080×1080", "1080×1920"],
    defaultQuantity: 12,
    vendorHint: "Exports via Canva + direct upload",
  },
];

const ROADMAP = [
  {
    title: "Artwork automation",
    detail: "Dynamic placeholders will merge franchise contact details straight into each template.",
  },
  {
    title: "VistaPrint integration",
    detail: "Order payloads will flow through the VistaPrint API so HQ can approve or auto-fulfil.",
  },
  {
    title: "Asset analytics",
    detail: "Track downloads, print runs, and campaign launches across the network.",
  },
];

export default function MarketingMaterialsPortal() {
  const [activeCollection, setActiveCollection] = useState<(typeof COLLECTIONS)[number]["id"]>("cards");
  const [launchName, setLaunchName] = useState<string>("");
  const [launchDate, setLaunchDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    switch (activeCollection) {
      case "cards":
        return ITEMS.filter((item) => item.type === "card");
      case "flyers":
        return ITEMS.filter((item) => item.type === "flyer");
      case "posters":
        return ITEMS.filter((item) => item.type === "poster");
      case "digital":
        return ITEMS.filter((item) => item.type === "social");
      default:
        return ITEMS;
    }
  }, [activeCollection]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(
      "Brief stored. The marketing team will align artwork with your franchise profile and loop you in before we connect the print APIs."
    );
  };

  const resetFeedback = () => setFeedback(null);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Marketing materials studio</h1>
            <p className="text-sm text-gray-600">
              Access HQ-approved templates and queue bespoke requests ready for VistaPrint and digital distribution.
            </p>
          </div>
          <Link href="/franchise" className="btn-xs btn-outline">
            Back to franchise portal
          </Link>
        </div>

        <section className="card border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Template collections</h2>
              <p className="text-sm text-gray-600">
                Preview what will be available once the print API is enabled and download samples today.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {COLLECTIONS.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  className={`btn-xs ${activeCollection === collection.id ? "btn" : "btn-outline"}`}
                  onClick={() => {
                    resetFeedback();
                    setActiveCollection(collection.id);
                  }}
                >
                  {collection.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {filteredItems.map((item) => (
              <article key={item.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">{item.title}</h3>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{item.type}</p>
                  </div>
                  <span className="text-xs font-medium text-blue-700">Default qty: {item.defaultQuantity}</span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{item.description}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {item.formats.map((format) => (
                    <li key={format}>{format}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-gray-500">{item.vendorHint}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-xs">
                    Download sample
                  </button>
                  <button type="button" className="btn-xs btn-outline">
                    Configure once live
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Custom campaign brief</h2>
              <p className="text-sm text-gray-600">
                Submit an idea or upcoming launch so design can prep assets and pricing before automations go live.
              </p>
            </div>
            <span className="badge badge-outline text-xs">HQ review required</span>
          </div>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Campaign name</span>
                <input
                  className="input"
                  placeholder="Neighbourhood launch weekend"
                  value={launchName}
                  onChange={(event) => {
                    resetFeedback();
                    setLaunchName(event.target.value);
                  }}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Target date</span>
                <input
                  className="input"
                  type="date"
                  value={launchDate}
                  onChange={(event) => {
                    resetFeedback();
                    setLaunchDate(event.target.value);
                  }}
                  required
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Notes for studio</span>
              <textarea
                className="textarea min-h-[140px]"
                placeholder="Tell us about the audience, offer, and any required print quantities."
                value={notes}
                onChange={(event) => {
                  resetFeedback();
                  setNotes(event.target.value);
                }}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-sm">
                Save campaign brief
              </button>
              <p className="text-xs text-gray-500">
                We&rsquo;ll route this to HQ marketing and prepare a fulfilment quote once vendor APIs are wired up.
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
          <div className="grid gap-3 md:grid-cols-3">
            {ROADMAP.map((item) => (
              <article key={item.title} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">{item.title}</p>
                <p className="mt-1 text-gray-700">{item.detail}</p>
              </article>
            ))}
          </div>
          <p className="mt-4 text-sm text-gray-600">
            Need something sooner? Email <a href="mailto:marketing@pineappletapped.com" className="text-blue-600 underline">marketing@pineappletapped.com</a> and we&rsquo;ll assist manually until the integrations are switched on.
          </p>
        </section>
      </div>
    </PortalContainer>
  );
}
