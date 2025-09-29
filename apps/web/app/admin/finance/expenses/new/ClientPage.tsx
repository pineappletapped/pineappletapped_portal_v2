"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalContainer from "@/components/PortalContainer";
import { db } from "@/lib/firebase";
import { collection, getDocs, addDoc } from "firebase/firestore";
import { useRoleGate } from "@/hooks/useRoleGate";

type FirestoreRecord = Record<string, unknown>;
type ProjectRecord = { id: string; name?: string | null; code?: string | null };

const inputClassName =
  "w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10";

export default function NewExpensePage() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [form, setForm] = useState({
    projectId: "",
    amount: "",
    description: "",
    date: "",
    paymentMethod: "",
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "finance"]);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const projSnap = await getDocs(collection(db, "projects"));
        const records: ProjectRecord[] = projSnap.docs.map((d) => {
          const data = d.data() as FirestoreRecord;
          const nameValue = typeof data.name === "string" ? data.name : null;
          const codeValue = typeof data.code === "string" ? data.code : null;
          return { id: d.id, name: nameValue, code: codeValue };
        });
        setProjects(records);
      } catch (error) {
        console.error("Failed to load projects", error);
        setFeedback({ type: "error", text: "Unable to load project list." });
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  const projectOptions = useMemo(() => {
    return projects
      .slice()
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: "base" }));
  }, [projects]);

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    if (!form.amount) {
      setFeedback({ type: "error", text: "Please enter an expense amount." });
      return;
    }
    const parsedAmount = parseFloat(form.amount);
    if (!Number.isFinite(parsedAmount)) {
      setFeedback({ type: "error", text: "Amount must be a valid number." });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "expenses"), {
        projectId: form.projectId || null,
        amount: parsedAmount,
        description: form.description?.trim() || "",
        date: form.date || new Date().toISOString(),
        paymentMethod: form.paymentMethod || "unknown",
        createdAt: new Date().toISOString(),
      });
      setFeedback({ type: "success", text: "Expense logged successfully." });
      setForm({ projectId: "", amount: "", description: "", date: "", paymentMethod: "" });
    } catch (error: any) {
      console.error("Failed to save expense", error);
      setFeedback({ type: "error", text: error?.message || "Error logging expense." });
    } finally {
      setSaving(false);
    }
  };

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading expense form…</p>
      </PortalContainer>
    );
  }
  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have access to this page.
        </p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Finance</p>
          <h1 className="text-2xl font-semibold text-gray-900">Log an expense</h1>
          <p className="text-sm text-gray-600">
            Record operational costs and assign them to projects so profitability stays accurate.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid gap-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {feedback ? (
            <div
              className={
                feedback.type === "success"
                  ? "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                  : "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              }
            >
              {feedback.text}
            </div>
          ) : null}

          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Cost centre
            <select
              name="projectId"
              value={form.projectId}
              onChange={handleChange}
              className={inputClassName}
              disabled={saving}
            >
              <option value="">General business expense</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || project.id}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-gray-500">
              Assign the spend to a project to keep profit reports aligned.
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-gray-700">
              Amount
              <input
                type="number"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                className={inputClassName}
                min="0"
                step="0.01"
                placeholder="0.00"
                disabled={saving}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-gray-700">
              Payment method
              <select
                name="paymentMethod"
                value={form.paymentMethod}
                onChange={handleChange}
                className={inputClassName}
                disabled={saving}
              >
                <option value="">Select payment method</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Expense date
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              className={inputClassName}
              disabled={saving}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Notes
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              className={`${inputClassName} min-h-[120px] resize-y`}
              placeholder="What was purchased and why?"
              disabled={saving}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving…" : "Save expense"}
            </button>
            <Link href="/admin/finance" className="btn-outline">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PortalContainer>
  );
}
