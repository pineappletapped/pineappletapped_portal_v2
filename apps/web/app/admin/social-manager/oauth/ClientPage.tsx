"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import PortalHero from "@/components/PortalHero";
import { useRoleGate } from "@/hooks/useRoleGate";

type SecretStatus = {
  configured: boolean;
  last4: string | null;
  managedExternally: boolean;
};

type PlatformSecretStatus = {
  platform: string;
  label: string;
  clientId: SecretStatus;
  clientSecret: SecretStatus;
};

type LoadedSettings = {
  serviceKey: SecretStatus;
  encryptionKey: SecretStatus;
  platforms: PlatformSecretStatus[];
  updatedAt: string | null;
  updatedBy: { uid: string | null; email: string | null } | null;
};

type PlatformFormState = {
  clientId: string;
  clientSecret: string;
  clearClientId: boolean;
  clearClientSecret: boolean;
};

function createBlankPlatformForms(platforms: PlatformSecretStatus[]): Record<string, PlatformFormState> {
  return platforms.reduce<Record<string, PlatformFormState>>((acc, platform) => {
    acc[platform.platform] = {
      clientId: "",
      clientSecret: "",
      clearClientId: false,
      clearClientSecret: false,
    } satisfies PlatformFormState;
    return acc;
  }, {});
}

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch (error) {
    console.warn("Failed to format timestamp", error);
    return null;
  }
}

function SecretStatusBadge({ status }: { status: SecretStatus }) {
  const label = status.configured
    ? `Configured${status.last4 ? ` · ••••${status.last4}` : ""}`
    : "Not configured";
  const badgeClass = status.configured ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${badgeClass}`}>
      {label}
    </span>
  );
}

export default function SocialOAuthManagerPage() {
  const { allowed, loading: guardLoading } = useRoleGate("admin");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<LoadedSettings | null>(null);

  const [serviceKeyInput, setServiceKeyInput] = useState("");
  const [clearServiceKey, setClearServiceKey] = useState(false);
  const [encryptionKeyInput, setEncryptionKeyInput] = useState("");
  const [clearEncryptionKey, setClearEncryptionKey] = useState(false);
  const [platformForms, setPlatformForms] = useState<Record<string, PlatformFormState>>({});

  const resetNotifications = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    resetNotifications();
    try {
      const response = await fetch("/api/admin/social/oauth-settings", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load OAuth settings (${response.status}).`);
      }
      const data = (await response.json()) as LoadedSettings;
      setSettings(data);
      setPlatformForms(createBlankPlatformForms(data.platforms));
      setServiceKeyInput("");
      setEncryptionKeyInput("");
      setClearServiceKey(false);
      setClearEncryptionKey(false);
    } catch (fetchError) {
      console.error("Failed to load social OAuth settings", fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load OAuth settings.");
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [resetNotifications]);

  useEffect(() => {
    if (guardLoading) {
      return;
    }
    if (!allowed) {
      setLoading(false);
      return;
    }
    void loadSettings();
  }, [allowed, guardLoading, loadSettings]);

  const heroMetrics = useMemo(() => {
    if (!settings) {
      return [];
    }
    const platformCount = settings.platforms.length;
    const configuredIds = settings.platforms.filter((platform) => platform.clientId.configured).length;
    const configuredSecrets = settings.platforms.filter((platform) => platform.clientSecret.configured).length;
    return [
      { label: "Platforms", value: platformCount },
      { label: "Client IDs", value: configuredIds },
      { label: "Client secrets", value: configuredSecrets },
    ];
  }, [settings]);

  const lastUpdated = useMemo(() => formatTimestamp(settings?.updatedAt ?? null), [settings?.updatedAt]);
  const updatedBy = settings?.updatedBy?.email ?? settings?.updatedBy?.uid ?? null;

  const handlePlatformFieldChange = useCallback(
    (platform: string, field: keyof PlatformFormState, value: string | boolean) => {
      resetNotifications();
      setPlatformForms((prev) => {
        const previous: PlatformFormState = prev[platform] ?? {
          clientId: "",
          clientSecret: "",
          clearClientId: false,
          clearClientSecret: false,
        };

        const next: PlatformFormState = {
          clientId: previous.clientId,
          clientSecret: previous.clientSecret,
          clearClientId: previous.clearClientId,
          clearClientSecret: previous.clearClientSecret,
        };

        if (field === "clientId" || field === "clientSecret") {
          next[field] = typeof value === "string" ? value : previous[field];
        } else {
          next[field] = typeof value === "boolean" ? value : previous[field];
        }

        return { ...prev, [platform]: next };
      });
    },
    [resetNotifications],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;
      resetNotifications();

      const payload: Record<string, unknown> = {};

      if (clearServiceKey) {
        payload.serviceKey = null;
      } else if (serviceKeyInput.trim().length > 0) {
        payload.serviceKey = serviceKeyInput.trim();
      }

      if (clearEncryptionKey) {
        payload.encryptionKey = null;
      } else if (encryptionKeyInput.trim().length > 0) {
        payload.encryptionKey = encryptionKeyInput.trim();
      }

      if (settings && settings.platforms.length > 0) {
        const platformPayload: Record<string, Record<string, string | null>> = {};
        settings.platforms.forEach((platform) => {
          const formState = platformForms[platform.platform] ?? {
            clientId: "",
            clientSecret: "",
            clearClientId: false,
            clearClientSecret: false,
          };
          const updates: Record<string, string | null> = {};
          if (formState.clearClientId) {
            updates.clientId = null;
          } else if (formState.clientId.trim().length > 0) {
            updates.clientId = formState.clientId.trim();
          }
          if (formState.clearClientSecret) {
            updates.clientSecret = null;
          } else if (formState.clientSecret.trim().length > 0) {
            updates.clientSecret = formState.clientSecret.trim();
          }
          if (Object.keys(updates).length > 0) {
            platformPayload[platform.platform] = updates;
          }
        });
        if (Object.keys(platformPayload).length > 0) {
          payload.platforms = platformPayload;
        }
      }

      if (Object.keys(payload).length === 0) {
        setError("Enter a value or choose a credential to clear before saving.");
        return;
      }

      setSaving(true);
      try {
        const response = await fetch("/api/admin/social/oauth-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          const message = typeof data.error === "string" ? data.error : `Save failed (${response.status}).`;
          throw new Error(message);
        }
        const data = (await response.json()) as { success?: boolean; settings?: LoadedSettings; error?: string };
        const nextSettings = data.settings ?? null;
        if (!nextSettings) {
          throw new Error("Settings updated but response did not include the latest values.");
        }
        setSettings(nextSettings);
        setPlatformForms(createBlankPlatformForms(nextSettings.platforms));
        setServiceKeyInput("");
        setEncryptionKeyInput("");
        setClearServiceKey(false);
        setClearEncryptionKey(false);
        setSuccess("OAuth credentials updated.");
      } catch (submitError) {
        console.error("Failed to save OAuth credentials", submitError);
        setError(submitError instanceof Error ? submitError.message : "Failed to save OAuth credentials.");
      } finally {
        setSaving(false);
      }
    },
    [
      clearEncryptionKey,
      clearServiceKey,
      encryptionKeyInput,
      platformForms,
      resetNotifications,
      saving,
      serviceKeyInput,
      settings,
    ],
  );

  if (guardLoading) {
    return <div className="p-6 text-sm text-gray-600">Checking permissions…</div>;
  }

  if (!allowed) {
    return <div className="p-6 text-sm text-gray-600">You do not have access to manage social OAuth credentials.</div>;
  }

  return (
    <div className="grid gap-6">
      <PortalHero
        eyebrow="Admin portal"
        title="OAuth credentials"
        description="Manage the client IDs, client secrets, and encryption keys required to link HQ-owned social accounts."
        metrics={heroMetrics}
        quickActions={[
          {
            label: "Review HQ connections",
            description: "Return to the social manager to check account health.",
            href: "/admin/social-manager",
          },
        ]}
      />

      <section className="grid gap-4 rounded border bg-white p-6 shadow-sm">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">Service credentials</h2>
          <p className="text-sm text-gray-600">
            Configure the shared keys used to sign OAuth states and encrypt provider tokens before they are stored in
            Firestore. These values apply to every HQ-managed connection.
          </p>
          {lastUpdated && (
            <p className="text-xs text-gray-500">
              Last updated {lastUpdated}
              {updatedBy ? ` by ${updatedBy}` : ""}.
            </p>
          )}
        </header>

        {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {success && <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}

        {loading && !settings ? (
          <p className="text-sm text-gray-600">Loading OAuth configuration…</p>
        ) : !settings ? (
          <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p>We couldn’t load the current OAuth configuration. Refresh the page or try again.</p>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              onClick={() => void loadSettings()}
              disabled={loading}
            >
              Retry loading settings
            </button>
          </div>
        ) : (
          <form className="grid gap-6" onSubmit={handleSubmit}>
            <div className="grid gap-6 md:grid-cols-2">
              <article className="rounded border bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Social account service key</h3>
                  {settings && <SecretStatusBadge status={settings.serviceKey} />}
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  Used to sign OAuth state payloads and validate HQ credential submissions from Cloud Functions.
                </p>
                {settings?.serviceKey.managedExternally && (
                  <p className="mt-2 text-xs font-medium text-amber-600">
                    Managed via environment variables. Update infrastructure to change this value.
                  </p>
                )}
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-medium text-gray-700">
                    New service key
                    <textarea
                      value={serviceKeyInput}
                      onChange={(event) => {
                        resetNotifications();
                        setServiceKeyInput(event.target.value);
                      }}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm"
                      placeholder="Paste the shared HQ service key"
                      rows={3}
                      disabled={settings?.serviceKey.managedExternally || clearServiceKey || saving}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={clearServiceKey}
                      onChange={(event) => {
                        resetNotifications();
                        setClearServiceKey(event.target.checked);
                      }}
                      disabled={settings?.serviceKey.managedExternally || saving}
                    />
                    Clear existing service key
                  </label>
                </div>
              </article>

              <article className="rounded border bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Token encryption key</h3>
                  {settings && <SecretStatusBadge status={settings.encryptionKey} />}
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  Required for AES-256-GCM encryption of access and refresh tokens before they are saved to Firestore.
                  Accepts base64, hex, or 32-character UTF-8 strings that decode to 32 bytes.
                </p>
                {settings?.encryptionKey.managedExternally && (
                  <p className="mt-2 text-xs font-medium text-amber-600">
                    Managed via environment variables. Update infrastructure to change this value.
                  </p>
                )}
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-medium text-gray-700">
                    New encryption key
                    <textarea
                      value={encryptionKeyInput}
                      onChange={(event) => {
                        resetNotifications();
                        setEncryptionKeyInput(event.target.value);
                      }}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm"
                      placeholder="Paste the 32-byte encryption key"
                      rows={3}
                      disabled={settings?.encryptionKey.managedExternally || clearEncryptionKey || saving}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={clearEncryptionKey}
                      onChange={(event) => {
                        resetNotifications();
                        setClearEncryptionKey(event.target.checked);
                      }}
                      disabled={settings?.encryptionKey.managedExternally || saving}
                    />
                    Clear existing encryption key
                  </label>
                </div>
              </article>
            </div>

            <section className="grid gap-4">
              <header className="space-y-1">
                <h3 className="text-sm font-semibold text-gray-900">Platform OAuth clients</h3>
                <p className="text-xs text-gray-600">
                  Each platform requires a client ID and client secret. Use the controls below to rotate credentials or
                  clear them if the integration should fall back to the mock connector.
                </p>
              </header>

              <div className="grid gap-4 lg:grid-cols-2">
                {(settings?.platforms ?? []).map((platform) => {
                  const formState = platformForms[platform.platform] ?? {
                    clientId: "",
                    clientSecret: "",
                    clearClientId: false,
                    clearClientSecret: false,
                  };
                  return (
                    <article key={platform.platform} className="flex flex-col gap-4 rounded border bg-white p-4 shadow-sm">
                      <header className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold text-gray-900">{platform.label}</h4>
                          <div className="flex flex-wrap gap-2">
                            <SecretStatusBadge status={platform.clientId} />
                            <SecretStatusBadge status={platform.clientSecret} />
                          </div>
                        </div>
                        {(platform.clientId.managedExternally || platform.clientSecret.managedExternally) && (
                          <p className="text-xs font-medium text-amber-600">
                            Managed via environment variables. Update infrastructure to change these credentials.
                          </p>
                        )}
                      </header>

                      <div className="grid gap-3 text-xs text-gray-700">
                        <label className="space-y-1">
                          <span className="font-medium">Client ID</span>
                          <input
                            type="text"
                            value={formState.clientId}
                            onChange={(event) =>
                              handlePlatformFieldChange(platform.platform, "clientId", event.target.value)
                            }
                            className="w-full rounded border px-3 py-2 text-sm"
                            placeholder="Paste client ID"
                            disabled={platform.clientId.managedExternally || formState.clearClientId || saving}
                          />
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={formState.clearClientId}
                            onChange={(event) =>
                              handlePlatformFieldChange(platform.platform, "clearClientId", event.target.checked)
                            }
                            disabled={platform.clientId.managedExternally || saving}
                          />
                          Clear client ID
                        </label>
                        <label className="space-y-1">
                          <span className="font-medium">Client secret</span>
                          <textarea
                            value={formState.clientSecret}
                            onChange={(event) =>
                              handlePlatformFieldChange(platform.platform, "clientSecret", event.target.value)
                            }
                            className="w-full rounded border px-3 py-2 text-sm"
                            placeholder="Paste client secret"
                            rows={3}
                            disabled={platform.clientSecret.managedExternally || formState.clearClientSecret || saving}
                          />
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={formState.clearClientSecret}
                            onChange={(event) =>
                              handlePlatformFieldChange(platform.platform, "clearClientSecret", event.target.checked)
                            }
                            disabled={platform.clientSecret.managedExternally || saving}
                          />
                          Clear client secret
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save OAuth configuration"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
