"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { useRoleGate } from "@/hooks/useRoleGate";

interface SplitTermDraft {
  id: string;
  label: string;
  percentage: string;
  dueDays: string;
}

interface SecretStatus {
  configured: boolean;
  last4: string | null;
}

interface LoadedSplitTerm {
  label: string;
  percentage: number;
  dueDays: number | null;
}

interface LoadedSettings {
  publishableKey: string;
  platformFeePercent: number | null;
  defaultPayoutScheduleDays: number | null;
  splitTerms: LoadedSplitTerm[];
  secretKey: SecretStatus;
  webhookSecret: SecretStatus;
  updatedAt: string | null;
  updatedBy: { uid: string | null; email: string | null } | null;
}

function createDraft(term?: { label?: string; percentage?: number; dueDays?: number | null }) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    label: term?.label ?? "",
    percentage:
      term?.percentage !== undefined && term?.percentage !== null
        ? String(term.percentage)
        : "",
    dueDays:
      term?.dueDays !== undefined && term?.dueDays !== null
        ? String(term.dueDays)
        : "",
  } satisfies SplitTermDraft;
}

function formatTimestamp(iso: string | null) {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch (error) {
    console.warn("Failed to format timestamp", error);
    return null;
  }
}

export default function StripeConnectSettingsPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "finance"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState("");
  const [platformFeePercent, setPlatformFeePercent] = useState("");
  const [defaultPayoutScheduleDays, setDefaultPayoutScheduleDays] = useState("");
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [webhookSecretInput, setWebhookSecretInput] = useState("");
  const [clearSecretKey, setClearSecretKey] = useState(false);
  const [clearWebhookSecret, setClearWebhookSecret] = useState(false);
  const [splitTerms, setSplitTerms] = useState<SplitTermDraft[]>([]);
  const [secretStatus, setSecretStatus] = useState<SecretStatus>({ configured: false, last4: null });
  const [webhookStatus, setWebhookStatus] = useState<SecretStatus>({ configured: false, last4: null });
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: { uid: string | null; email: string | null } | null }>(
    { updatedAt: null, updatedBy: null }
  );

  const resetNotifications = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuccess(null);
    (async () => {
      try {
        const response = await fetch("/api/admin/stripe/settings");
        if (!response.ok) {
          throw new Error(`Failed to load settings (${response.status})`);
        }
        const data: LoadedSettings = await response.json();
        if (cancelled) return;
        setPublishableKey(data.publishableKey ?? "");
        setPlatformFeePercent(
          data.platformFeePercent !== null && data.platformFeePercent !== undefined
            ? String(data.platformFeePercent)
            : ""
        );
        setDefaultPayoutScheduleDays(
          data.defaultPayoutScheduleDays !== null && data.defaultPayoutScheduleDays !== undefined
            ? String(data.defaultPayoutScheduleDays)
            : ""
        );
        setSplitTerms(
          (data.splitTerms || []).map((term) =>
            createDraft({
              label: term.label,
              percentage: term.percentage,
              dueDays: term.dueDays,
            })
          )
        );
        setSecretStatus(data.secretKey ?? { configured: false, last4: null });
        setWebhookStatus(data.webhookSecret ?? { configured: false, last4: null });
        setMeta({ updatedAt: data.updatedAt, updatedBy: data.updatedBy });
        setSecretKeyInput("");
        setWebhookSecretInput("");
        setClearSecretKey(false);
        setClearWebhookSecret(false);
      } catch (fetchError) {
        console.error("Failed to load Stripe Connect settings", fetchError);
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Unable to load Stripe settings.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, guardLoading]);

  const addTerm = useCallback(() => {
    resetNotifications();
    setSplitTerms((prev) => [...prev, createDraft()]);
  }, [resetNotifications]);

  const removeTerm = useCallback((id: string) => {
    resetNotifications();
    setSplitTerms((prev) => prev.filter((term) => term.id !== id));
  }, [resetNotifications]);

  const updateTerm = useCallback((id: string, field: keyof Omit<SplitTermDraft, "id">, value: string) => {
    resetNotifications();
    setSplitTerms((prev) =>
      prev.map((term) => (term.id === id ? { ...term, [field]: value } : term))
    );
  }, [resetNotifications]);

  const preparedSplitTerms = useMemo(
    () =>
      splitTerms
        .map((term) => ({
          label: term.label.trim(),
          percentage: term.percentage.trim(),
          dueDays: term.dueDays.trim(),
        }))
        .filter((term) => term.label.length > 0 && term.percentage.length > 0),
    [splitTerms]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;
      resetNotifications();
      setSaving(true);
      try {
        const payload: Record<string, unknown> = {
          publishableKey: publishableKey.trim(),
          platformFeePercent: platformFeePercent.trim(),
          defaultPayoutScheduleDays: defaultPayoutScheduleDays.trim(),
          splitTerms: preparedSplitTerms,
        };
        if (clearSecretKey) {
          payload.secretKey = null;
        } else if (secretKeyInput.trim().length > 0) {
          payload.secretKey = secretKeyInput.trim();
        }
        if (clearWebhookSecret) {
          payload.webhookSecret = null;
        } else if (webhookSecretInput.trim().length > 0) {
          payload.webhookSecret = webhookSecretInput.trim();
        }

        const response = await fetch("/api/admin/stripe/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const message = typeof errorBody.error === "string" ? errorBody.error : "Failed to save settings.";
          throw new Error(message);
        }
        const data = await response.json();
        const nextSettings: LoadedSettings = data.settings;
        setPublishableKey(nextSettings.publishableKey ?? "");
        setPlatformFeePercent(
          nextSettings.platformFeePercent !== null && nextSettings.platformFeePercent !== undefined
            ? String(nextSettings.platformFeePercent)
            : ""
        );
        setDefaultPayoutScheduleDays(
          nextSettings.defaultPayoutScheduleDays !== null && nextSettings.defaultPayoutScheduleDays !== undefined
            ? String(nextSettings.defaultPayoutScheduleDays)
            : ""
        );
        setSplitTerms(
          (nextSettings.splitTerms || []).map((term) =>
            createDraft({
              label: term.label,
              percentage: term.percentage,
              dueDays: term.dueDays,
            })
          )
        );
        setSecretStatus(nextSettings.secretKey ?? { configured: false, last4: null });
        setWebhookStatus(nextSettings.webhookSecret ?? { configured: false, last4: null });
        setMeta({ updatedAt: nextSettings.updatedAt, updatedBy: nextSettings.updatedBy });
        setSecretKeyInput("");
        setWebhookSecretInput("");
        setClearSecretKey(false);
        setClearWebhookSecret(false);
        setSuccess("Stripe settings updated.");
      } catch (submitError) {
        console.error("Failed to save Stripe settings", submitError);
        setError(submitError instanceof Error ? submitError.message : "Failed to save settings.");
      } finally {
        setSaving(false);
      }
    },
    [
      clearSecretKey,
      clearWebhookSecret,
      defaultPayoutScheduleDays,
      platformFeePercent,
      preparedSplitTerms,
      publishableKey,
      resetNotifications,
      saving,
      secretKeyInput,
      webhookSecretInput,
    ]
  );

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage Stripe Connect settings.</p>;
  }

  const lastUpdated = formatTimestamp(meta.updatedAt);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Stripe Connect configuration</h1>
        <p className="text-sm text-gray-600">
          Manage platform keys, split payment schedules, and webhook configuration used across checkout, invoicing, and franchise payouts.
        </p>
        {lastUpdated ? (
          <p className="text-xs text-gray-500">
            Last updated {lastUpdated}
            {meta.updatedBy?.email ? ` by ${meta.updatedBy.email}` : meta.updatedBy?.uid ? ` by ${meta.updatedBy.uid}` : ""}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700" role="status">
          {success}
        </div>
      ) : null}

      <form className="grid gap-6" onSubmit={handleSubmit}>
        <section className="grid gap-4 rounded border border-gray-200 p-4">
          <div>
            <h2 className="text-lg font-semibold">API keys</h2>
            <p className="text-sm text-gray-500">Only update secret values when you rotate credentials. Leave blank to retain current secrets.</p>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Publishable key</span>
            <input
              className="input"
              value={publishableKey}
              onChange={(event) => {
                resetNotifications();
                setPublishableKey(event.target.value);
              }}
              placeholder="pk_live_..."
              autoComplete="off"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Secret key</span>
              <input
                className="input"
                type="password"
                value={secretKeyInput}
                onChange={(event) => {
                  resetNotifications();
                  setSecretKeyInput(event.target.value);
                }}
                placeholder={secretStatus.configured ? `Stored (${secretStatus.last4 ? `ending ${secretStatus.last4}` : "configured"})` : "sk_live_..."}
                autoComplete="off"
              />
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={clearSecretKey}
                  onChange={(event) => {
                    resetNotifications();
                    setClearSecretKey(event.target.checked);
                    if (event.target.checked) {
                      setSecretKeyInput("");
                    }
                  }}
                />
                <span>Clear stored secret on save</span>
              </label>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Webhook signing secret</span>
              <input
                className="input"
                type="password"
                value={webhookSecretInput}
                onChange={(event) => {
                  resetNotifications();
                  setWebhookSecretInput(event.target.value);
                }}
                placeholder={webhookStatus.configured ? `Stored (${webhookStatus.last4 ? `ending ${webhookStatus.last4}` : "configured"})` : "whsec_..."}
                autoComplete="off"
              />
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={clearWebhookSecret}
                  onChange={(event) => {
                    resetNotifications();
                    setClearWebhookSecret(event.target.checked);
                    if (event.target.checked) {
                      setWebhookSecretInput("");
                    }
                  }}
                />
                <span>Clear stored webhook secret on save</span>
              </label>
            </label>
          </div>
        </section>

        <section className="grid gap-4 rounded border border-gray-200 p-4">
          <div>
            <h2 className="text-lg font-semibold">Revenue shares & payouts</h2>
            <p className="text-sm text-gray-500">
              Configure default platform fees and payout cadence applied when routing orders to franchise Stripe accounts.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Platform fee (%)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.1"
                value={platformFeePercent}
                onChange={(event) => {
                  resetNotifications();
                  setPlatformFeePercent(event.target.value);
                }}
                placeholder="6"
              />
              <span className="text-xs text-gray-500">
                Applied to transfers routed through Stripe Connect. Leave blank to defer to franchise overrides.
              </span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Default payout schedule (days)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={defaultPayoutScheduleDays}
                onChange={(event) => {
                  resetNotifications();
                  setDefaultPayoutScheduleDays(event.target.value);
                }}
                placeholder="7"
              />
              <span className="text-xs text-gray-500">
                Number of days to hold funds before initiating franchise payouts. Used when franchise-specific settings are absent.
              </span>
            </label>
          </div>
        </section>

        <section className="grid gap-4 rounded border border-gray-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Split payment terms</h2>
              <p className="text-sm text-gray-500">
                Define default payment schedules (e.g. deposit, balance) for new orders and invoices. These feed into automation when scheduling PaymentIntents.
              </p>
            </div>
            <button type="button" className="btn btn-sm" onClick={addTerm}>
              Add term
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">Label</th>
                  <th className="px-2 py-1 w-32">% of total</th>
                  <th className="px-2 py-1 w-40">Due after (days)</th>
                  <th className="px-2 py-1 w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {splitTerms.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-3 text-center text-xs text-gray-500">
                      No default terms configured. Add at least one entry to seed deposit / balance schedules.
                    </td>
                  </tr>
                ) : (
                  splitTerms.map((term) => (
                    <tr key={term.id} className="border-t">
                      <td className="px-2 py-2">
                        <input
                          className="input w-full"
                          value={term.label}
                          onChange={(event) => updateTerm(term.id, "label", event.target.value)}
                          placeholder="Deposit"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="input w-full"
                          type="number"
                          min="0"
                          step="0.1"
                          value={term.percentage}
                          onChange={(event) => updateTerm(term.id, "percentage", event.target.value)}
                          placeholder="50"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="input w-full"
                          type="number"
                          min="0"
                          step="1"
                          value={term.dueDays}
                          onChange={(event) => updateTerm(term.id, "dueDays", event.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => removeTerm(term.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Saving updates the configuration used by checkout flows, invoice automation, and franchise remittance.
          </p>
          <button type="submit" className={clsx("btn", saving && "opacity-75")} disabled={saving}>
            {saving ? "Saving…" : "Save Stripe settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
