"use client";

import { useMemo, useState } from "react";

type PlanRow = {
  id: string;
  month: string;
  theme: string;
  deliverables: string;
  budget: string;
  priority: "awareness" | "engagement" | "conversion" | "mixed";
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const QUARTER_BY_MONTH: Record<string, string> = {
  January: "Q1",
  February: "Q1",
  March: "Q1",
  April: "Q2",
  May: "Q2",
  June: "Q2",
  July: "Q3",
  August: "Q3",
  September: "Q3",
  October: "Q4",
  November: "Q4",
  December: "Q4",
};

const DELIVERABLE_SUGGESTIONS = [
  {
    label: "Thought leadership blitz",
    deliverables: "2x Blog posts, Webinar deck, Executive LinkedIn kit",
    budget: "4200",
    priority: "awareness" as const,
  },
  {
    label: "Product launch runway",
    deliverables: "Launch video, Landing page copy, Email nurture (3), Paid social set",
    budget: "6100",
    priority: "conversion" as const,
  },
  {
    label: "Always-on social sprints",
    deliverables: "4x Reels/TikToks, 12x Social captions, Influencer outreach",
    budget: "3600",
    priority: "engagement" as const,
  },
];

const MARKETING_PRIORITY_LABELS: Record<PlanRow["priority"], string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  conversion: "Conversion",
  mixed: "Full funnel",
};

const initialRows: PlanRow[] = MONTHS.slice(0, 4).map((month, index) => ({
  id: `${month}-${index}`,
  month,
  theme: "",
  deliverables: "",
  budget: "",
  priority: "mixed",
}));

const parseDeliverables = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const randomId = () => Math.random().toString(36).slice(2, 10);

export default function ContentPlanPanel() {
  const [rows, setRows] = useState<PlanRow[]>(initialRows);
  const [marketingMix, setMarketingMix] = useState({
    awareness: 40,
    engagement: 35,
    conversion: 25,
  });

  const remainingMonths = useMemo(
    () => MONTHS.filter((month) => !rows.some((row) => row.month === month)),
    [rows]
  );

  const totalBudget = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const amount = parseFloat(row.budget);
        return sum + (Number.isNaN(amount) ? 0 : amount);
      }, 0),
    [rows]
  );

  const perQuarterSummary = useMemo(() => {
    return rows.reduce<Record<string, { budget: number; orders: number }>>(
      (acc, row) => {
        const quarter = QUARTER_BY_MONTH[row.month];
        if (!quarter) return acc;
        const deliverableCount = parseDeliverables(row.deliverables).length;
        const recommendedOrders = deliverableCount > 0 ? Math.max(1, Math.ceil(deliverableCount / 2)) : 0;
        const amount = parseFloat(row.budget);
        const current = acc[quarter] || { budget: 0, orders: 0 };
        acc[quarter] = {
          budget: current.budget + (Number.isNaN(amount) ? 0 : amount),
          orders: current.orders + recommendedOrders,
        };
        return acc;
      },
      {}
    );
  }, [rows]);

  const orderRecommendations = useMemo(() => {
    const insights: string[] = [];
    rows.forEach((row) => {
      const deliverables = parseDeliverables(row.deliverables);
      if (deliverables.length === 0) return;
      const recommendedOrders = Math.max(1, Math.ceil(deliverables.length / 2));
      insights.push(
        `${row.month}: plan for ${recommendedOrders} project order${
          recommendedOrders > 1 ? "s" : ""
        } to cover ${deliverables.length} deliverable${deliverables.length > 1 ? "s" : ""}.`
      );
    });
    if (totalBudget > 0) {
      const averageOrderValue = 2400;
      const projectedOrders = Math.max(1, Math.ceil(totalBudget / averageOrderValue));
      insights.push(
        `Across the year allocate roughly ${projectedOrders} full-service order${
          projectedOrders > 1 ? "s" : ""
        } to stay within the $${totalBudget.toLocaleString()} content budget.`
      );
    }
    if (rows.length < 12 && remainingMonths.length > 0) {
      insights.push(
        `Add the remaining ${remainingMonths.length} month${remainingMonths.length > 1 ? "s" : ""} to lock-in repeat work and keep your production queue full.`
      );
    }
    if (marketingMix.conversion >= 30) {
      insights.push("High conversion focus detected – bundle campaign and CRO projects to maximise ROI.");
    }
    return insights;
  }, [marketingMix.conversion, remainingMonths.length, rows, totalBudget]);

  const handleRowChange = (id: string, key: keyof PlanRow, value: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  };

  const addMonthRow = () => {
    if (remainingMonths.length === 0) return;
    const next = remainingMonths[0];
    setRows((prev) => [
      ...prev,
      {
        id: `${next}-${randomId()}`,
        month: next,
        theme: "",
        deliverables: "",
        budget: "",
        priority: "mixed",
      },
    ]);
  };

  const applySuggestionToRow = (id: string, suggestionIndex: number) => {
    const suggestion = DELIVERABLE_SUGGESTIONS[suggestionIndex];
    if (!suggestion) return;
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              deliverables: suggestion.deliverables,
              budget: suggestion.budget,
              priority: suggestion.priority,
            }
          : row
      )
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const updateMarketingMix = (key: keyof typeof marketingMix, value: number) => {
    setMarketingMix((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section className="card p-6 space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">Annual Content Planner</h2>
        <p className="text-sm text-gray-600">
          Build a rolling twelve-month roadmap, attach deliverables, and earmark production budget so your team can tee up
          multiple orders in advance.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-sm" onClick={addMonthRow} disabled={remainingMonths.length === 0}>
          Add {remainingMonths.length > 0 ? `${remainingMonths[0]} plan` : "month"}
        </button>
        <span className="text-xs text-gray-500">
          {12 - remainingMonths.length} / 12 months planned
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2">Campaign focus</th>
              <th className="px-3 py-2">Key deliverables</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Budget ($)</th>
              <th className="px-3 py-2">Orders</th>
              <th className="px-3 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const deliverableList = parseDeliverables(row.deliverables);
              const recommendedOrders = deliverableList.length > 0 ? Math.max(1, Math.ceil(deliverableList.length / 2)) : 0;
              return (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2">
                    <select
                      className="input w-32"
                      value={row.month}
                      onChange={(event) => handleRowChange(row.id, "month", event.target.value)}
                    >
                      {MONTHS.map((month) => (
                        <option key={month} value={month}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-full"
                      placeholder="Theme or campaign goal"
                      value={row.theme}
                      onChange={(event) => handleRowChange(row.id, "theme", event.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-2">
                      <textarea
                        className="input w-full min-h-[80px]"
                        placeholder="List deliverables separated by commas"
                        value={row.deliverables}
                        onChange={(event) => handleRowChange(row.id, "deliverables", event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2 text-xs">
                        {DELIVERABLE_SUGGESTIONS.map((suggestion, index) => (
                          <button
                            key={suggestion.label}
                            type="button"
                            className="badge cursor-pointer bg-gray-100 hover:bg-gray-200"
                            onClick={() => applySuggestionToRow(row.id, index)}
                          >
                            {suggestion.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="input"
                      value={row.priority}
                      onChange={(event) => handleRowChange(row.id, "priority", event.target.value as PlanRow["priority"])}
                    >
                      {Object.entries(MARKETING_PRIORITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-28"
                      type="number"
                      min="0"
                      step="100"
                      value={row.budget}
                      onChange={(event) => handleRowChange(row.id, "budget", event.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {recommendedOrders > 0 ? (
                      <div>
                        <p className="font-medium">{recommendedOrders} order{recommendedOrders > 1 ? "s" : ""}</p>
                        <p className="text-xs text-gray-500">{deliverableList.length} deliverable{deliverableList.length > 1 ? "s" : ""}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Add deliverables</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-xs text-red-500" onClick={() => removeRow(row.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="card border p-4">
          <h3 className="text-sm font-semibold text-gray-700">Budget outlook</h3>
          <p className="text-2xl font-semibold mt-2">${totalBudget.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Projected spend across planned initiatives.</p>
        </div>
        <div className="card border p-4">
          <h3 className="text-sm font-semibold text-gray-700">Quarterly breakdown</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {(["Q1", "Q2", "Q3", "Q4"] as const).map((quarter) => {
              const data = perQuarterSummary[quarter];
              if (!data) {
                return (
                  <li key={quarter} className="flex items-center justify-between text-gray-400">
                    <span>{quarter}</span>
                    <span>—</span>
                  </li>
                );
              }
              return (
                <li key={quarter} className="flex items-center justify-between">
                  <span>{quarter}</span>
                  <span>
                    ${data.budget.toLocaleString()} • {data.orders} order{data.orders !== 1 ? "s" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card border p-4">
          <h3 className="text-sm font-semibold text-gray-700">Marketing mix emphasis</h3>
          <div className="mt-3 space-y-3 text-xs">
            {(
              [
                ["awareness", "Awareness"],
                ["engagement", "Engagement"],
                ["conversion", "Conversion"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4">
                <span>{label}</span>
                <input
                  className="input w-20"
                  type="number"
                  min={0}
                  max={100}
                  value={marketingMix[key]}
                  onChange={(event) => updateMarketingMix(key, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Aim for ~100% combined to balance your annual mix.</p>
        </div>
      </div>

      <div className="card border p-4">
        <h3 className="text-sm font-semibold text-gray-700">Order strategy prompts</h3>
        {orderRecommendations.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">Add deliverables and budget to unlock tailored order suggestions.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-gray-600">
            {orderRecommendations.map((recommendation) => (
              <li key={recommendation}>• {recommendation}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
