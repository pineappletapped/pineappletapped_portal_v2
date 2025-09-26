"use client";

import { useMemo, useState } from "react";

type ProposalItem = {
  type: "product" | "custom";
  productId?: string;
  name: string;
  price: number;
  notes?: string;
  rental?: number;
};

type ProductRecord = {
  id: string;
  name?: string;
  category?: string | null;
  deliverables?: unknown;
  tags?: unknown;
};

type StoryboardSection = {
  id: string;
  title: string;
  summary: string;
  talkingPoints: string[];
};

type StoryboardTimeline = {
  phase: string;
  duration: string;
  tasks: string[];
};

type StoryboardItem = {
  id: string;
  name: string;
  priceHint: string | null;
  description: string | null;
};

type StoryboardResponse = {
  id: string;
  status: string;
  narrative: string;
  sections: StoryboardSection[];
  timeline: StoryboardTimeline[];
  recommendedItems: StoryboardItem[];
};

type ProposalStoryboardAssistantProps = {
  items: ProposalItem[];
  products: ProductRecord[];
  orgId?: string;
  onAddItems: (items: ProposalItem[]) => void;
  onAppendNarrative: (value: string) => void;
};

function normaliseDeliverables(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => {
        if (typeof entry === "string") return entry.split(/[\n,]+/);
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.label === "string") return record.label.split(/[\n,]+/);
        if (typeof record.name === "string") return record.name.split(/[\n,]+/);
        return [];
      })
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueStrings(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

export default function ProposalStoryboardAssistant({
  items,
  products,
  orgId,
  onAddItems,
  onAppendNarrative,
}: ProposalStoryboardAssistantProps) {
  const [projectName, setProjectName] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("Confident");
  const [goalText, setGoalText] = useState("Launch awareness, Generate demand, Enable sales follow-up");
  const [notes, setNotes] = useState("");
  const [extraDeliverables, setExtraDeliverables] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardResponse | null>(null);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductRecord>();
    products.forEach((product) => {
      if (typeof product.id === "string") {
        map.set(product.id, product);
      }
    });
    return map;
  }, [products]);

  const payloadItems = useMemo(() => {
    return items.map((item) => {
      const product = item.productId ? productMap.get(item.productId) : undefined;
      const category = typeof product?.category === "string" ? product?.category : null;
      const deliverables = normaliseDeliverables(product?.deliverables);
      return {
        name: item.name,
        category,
        price: Number.isFinite(item.price) ? item.price : null,
        deliverables,
      };
    });
  }, [items, productMap]);

  const deliverableSummary = useMemo(() => {
    const fromProducts = payloadItems.flatMap((item) => item.deliverables || []);
    const extra = normaliseDeliverables(extraDeliverables);
    const combined = uniqueStrings([...fromProducts, ...extra]);
    return combined;
  }, [payloadItems, extraDeliverables]);

  const canGenerate = payloadItems.length > 0 || deliverableSummary.length > 0 || notes.trim().length > 0;

  const handleGenerate = async () => {
    if (!canGenerate || status === "loading") return;
    setStatus("loading");
    setError(null);
    setStoryboard(null);
    const goals = goalText
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    try {
      const response = await fetch("/api/proposals/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim() || null,
          audience: audience.trim() || null,
          tone: tone.trim() || null,
          goals,
          deliverables: deliverableSummary,
          items: payloadItems,
          notes: notes.trim() || null,
          orgId: orgId || null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Unable to generate storyboard" }));
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to generate storyboard");
      }

      const data = (await response.json()) as StoryboardResponse;
      setStoryboard(data);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate storyboard");
      setStatus("error");
    }
  };

  const handleApplyItems = () => {
    if (!storyboard || storyboard.recommendedItems.length === 0) return;
    const generatedItems: ProposalItem[] = storyboard.recommendedItems.map((item) => ({
      type: "custom",
      name: item.name,
      price: 0,
      notes: [item.description, item.priceHint ? `Suggested budget ${item.priceHint}` : null]
        .filter(Boolean)
        .join(" — "),
    }));
    onAddItems(generatedItems);
  };

  const handleAppendNarrative = () => {
    if (!storyboard) return;
    const sectionText = storyboard.sections
      .map((section) => {
        const talkingPoints = section.talkingPoints.map((point) => `• ${point}`).join("\n");
        return `${section.title}\n${talkingPoints}`;
      })
      .join("\n\n");
    const timelineText = storyboard.timeline
      .map((phase) => {
        const tasks = phase.tasks.map((task) => `- ${task}`).join("\n");
        return `${phase.phase} (${phase.duration})\n${tasks}`;
      })
      .join("\n\n");
    const compiled = `${storyboard.narrative}\n\n${sectionText}\n\nTimeline\n${timelineText}`;
    onAppendNarrative(compiled);
  };

  return (
    <section className="card p-4 space-y-4" aria-labelledby="storyboard-assistant-heading">
      <header className="space-y-1">
        <h2 id="storyboard-assistant-heading" className="text-lg font-semibold">
          AI storyboard assistant
        </h2>
        <p className="text-sm text-gray-600">
          Turn your selected services into a proposal-ready storyboard, timeline, and draft line items you can drop straight into the quote.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2" aria-live="polite">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Project / campaign name</span>
          <input
            className="input"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="e.g. Spring product launch"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Primary audience</span>
          <input
            className="input"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            placeholder="e.g. Technology decision makers"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Tone</span>
          <input
            className="input"
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            placeholder="e.g. Confident, energetic"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Goals</span>
          <textarea
            className="input min-h-[80px]"
            value={goalText}
            onChange={(event) => setGoalText(event.target.value)}
            placeholder="List one per line"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="font-medium">Extra deliverables or key beats</span>
          <textarea
            className="input min-h-[80px]"
            value={extraDeliverables}
            onChange={(event) => setExtraDeliverables(event.target.value)}
            placeholder="List assets, interview angles, or milestone moments"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="font-medium">Context & must-have notes</span>
          <textarea
            className="input min-h-[80px]"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Budget guardrails, stakeholders, past learnings…"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn"
          onClick={handleGenerate}
          disabled={!canGenerate || status === "loading"}
        >
          {status === "loading" ? "Generating…" : "Generate storyboard"}
        </button>
        {!canGenerate && <span className="text-xs text-gray-500">Add at least one item, deliverable, or note.</span>}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {storyboard ? (
        <div className="space-y-4" aria-live="polite">
          <article className="border rounded-lg p-4 space-y-3">
            <header className="space-y-1">
              <h3 className="text-sm font-semibold text-gray-700">Narrative overview</h3>
              <p className="text-sm text-gray-600">{storyboard.narrative}</p>
            </header>
            <div className="grid gap-3">
              {storyboard.sections.map((section) => (
                <section key={section.id} className="border rounded-md p-3">
                  <h4 className="text-sm font-semibold text-gray-700">{section.title}</h4>
                  <p className="text-xs text-gray-500">{section.summary}</p>
                  <ul className="mt-2 list-disc pl-5 text-xs text-gray-600 space-y-1">
                    {section.talkingPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>

          <article className="border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Timeline</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {storyboard.timeline.map((phase) => (
                <section key={phase.phase} className="border rounded-md p-3">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center justify-between gap-2">
                    <span>{phase.phase}</span>
                    <span className="text-xs text-gray-500">{phase.duration}</span>
                  </h4>
                  <ul className="mt-2 list-disc pl-5 text-xs text-gray-600 space-y-1">
                    {phase.tasks.map((task) => (
                      <li key={task}>{task}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>

          <article className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-700">Recommended line items</h3>
              <button type="button" className="btn-xs" onClick={handleApplyItems}>
                Add to proposal
              </button>
            </div>
            {storyboard.recommendedItems.length === 0 ? (
              <p className="text-xs text-gray-500">No recommendations available.</p>
            ) : (
              <ul className="space-y-2 text-sm text-gray-700">
                {storyboard.recommendedItems.map((item) => (
                  <li key={item.id} className="border rounded-md p-3">
                    <p className="font-medium">{item.name}</p>
                    {item.description ? <p className="text-xs text-gray-500">{item.description}</p> : null}
                    {item.priceHint ? <p className="text-xs text-gray-400">Suggested budget {item.priceHint}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-outline" onClick={handleAppendNarrative}>
              Append storyboard to notes
            </button>
            <span className="text-xs text-gray-500">You can refine the copy after inserting it into the proposal template.</span>
          </div>
        </div>
      ) : status === "ready" ? (
        <p className="text-sm text-gray-500">Storyboard generated.</p>
      ) : null}
    </section>
  );
}
