"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import PortalHero from "@/components/PortalHero";
import { formatDateTime } from "@/lib/datetime";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";

interface HqAccount {
  id: string;
  platform: string;
  displayName: string;
  organisationName: string | null;
  scopes: { publish: boolean; analytics: boolean };
  connection: {
    status: string | null;
    requiresReauth: boolean;
    reauthRecommended: boolean;
    expiresAt: Date | null;
    lastAuthorizedAt: Date | null;
  };
  providerAccountName: string | null;
  providerAccountUrl: string | null;
  updatedAt: Date | null;
  createdAt: Date | null;
}

interface HqAccountFormState {
  organisationName: string;
  displayName: string;
  publishEnabled: boolean;
  analyticsEnabled: boolean;
}

const PLATFORM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook Pages" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "vimeo", label: "Vimeo" },
];

const PLATFORM_LABELS = PLATFORM_OPTIONS.reduce<Record<string, string>>((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

function normaliseText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  if (typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      const result = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(result.getTime()) ? null : result;
    } catch (error) {
      return null;
    }
  }
  return null;
}

export default function SocialManagerClientPage() {
  const { allowed, loading: roleLoading } = useRoleGate("admin");
  const [dbRef, setDbRef] = useState<Firestore | null>(null);

  const [accounts, setAccounts] = useState<HqAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [accountForm, setAccountForm] = useState<HqAccountFormState>({
    organisationName: "Pineapple Tapped HQ",
    displayName: "",
    publishEnabled: true,
    analyticsEnabled: true,
  });

  const [platformSearch, setPlatformSearch] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const current = new URL(window.location.href);
    const status = current.searchParams.get("socialConnection");
    if (!status) {
      return;
    }
    const message = current.searchParams.get("message");
    if (status === "success") {
      setFeedback(message || "Social account connected.");
      setAccountError(null);
      setAccountForm((prev) => ({ ...prev, displayName: "" }));
    } else {
      setAccountError(message || "Unable to connect the social account.");
      setFeedback(null);
    }
    ["socialConnection", "message", "accountId", "platform", "reauth", "expiresAt"].forEach((param) =>
      current.searchParams.delete(param)
    );
    window.history.replaceState({}, "", `${current.pathname}${current.search}${current.hash}`);
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribeAuth: (() => void) | null = null;
    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (!mounted) return;
        setDbRef(db as Firestore);
        const authMod = await loadAuthModule();
        if (!mounted) return;
        unsubscribeAuth = authMod.onAuthStateChanged(auth, () => undefined);
      } catch (error) {
        console.error("Failed to initialise Firebase", error);
        if (!mounted) return;
        setDbRef(null);
      }
    })();
    return () => {
      mounted = false;
      if (unsubscribeAuth) {
        unsubscribeAuth();
      }
    };
  }, []);

  useEffect(() => {
    if (!dbRef) {
      return;
    }
    setAccountsLoading(true);
    const q = query(collection(dbRef, "socialAccounts"), orderBy("createdAt", "desc"), limit(100));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const mapped = snapshot.docs.reduce<HqAccount[]>((acc, docSnap: QueryDocumentSnapshot<DocumentData>) => {
          const data = docSnap.data() as Record<string, unknown>;
          const hqManaged = data.hqManaged === true || (!data.organisationId && !data.organisationName);
          if (!hqManaged) {
            return acc;
          }
          const connectionData = (data.connection ?? {}) as Record<string, unknown>;
          const connectionStatus: string | null =
            normaliseText(connectionData.status) ?? normaliseText(data.status) ?? "active";
          const connectionExpiresAt = toDate(connectionData.expiresAt ?? connectionData.expiry ?? null);
          const requiresReauth =
            connectionStatus === "requires_reauth" || Boolean(connectionData.requiresReauth ?? connectionData.reauthRequired);
          const reauthRecommended =
            requiresReauth ||
            Boolean(
              connectionData.reauthRecommended ??
                connectionData.reauthSoon ??
                connectionData.requiresReauthSoon
            ) ||
            (connectionExpiresAt ? connectionExpiresAt.getTime() - Date.now() < 48 * 60 * 60 * 1000 : false);
          const scopesRaw = (data.scopes ?? {}) as Record<string, unknown>;
          const scopes: HqAccount["scopes"] = {
            publish: scopesRaw.publish === true,
            analytics: scopesRaw.analytics === true || scopesRaw.insights === true,
          };
          const account: HqAccount = {
            id: docSnap.id,
            platform: normaliseText(data.platform) ?? "unknown",
            displayName: normaliseText(data.displayName) ?? `Account ${docSnap.id}`,
            organisationName:
              normaliseText(data.organisationName) ?? normaliseText(data.organisationId) ?? null,
            scopes,
            connection: {
              status: connectionStatus,
              requiresReauth,
              reauthRecommended,
              expiresAt: connectionExpiresAt,
              lastAuthorizedAt: toDate(
                connectionData.lastAuthorizedAt ??
                  connectionData.authorizedAt ??
                  connectionData.lastLinkedAt ??
                  data.lastAuthorizedAt ??
                  data.lastLinkedAt ??
                  null
              ),
            },
            providerAccountName:
              normaliseText(
                (data.provider as Record<string, unknown> | undefined)?.accountName ??
                  (data.provider as Record<string, unknown> | undefined)?.name ??
                  data.accountName
              ) ?? null,
            providerAccountUrl:
              normaliseText(
                (data.provider as Record<string, unknown> | undefined)?.accountUrl ??
                  data.accountUrl ??
                  data.channelUrl
              ) ?? null,
            updatedAt: toDate(data.updatedAt),
            createdAt: toDate(data.createdAt),
          };
          acc.push(account);
          return acc;
        }, []);
        setAccounts(mapped);
        setAccountsLoading(false);
        setAccountError(null);
      },
      (error) => {
        console.error("Failed to subscribe to HQ social accounts", error);
        setAccountError(error?.message || "Unable to load social accounts");
        setAccountsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [dbRef]);

  const filteredPlatforms = useMemo(() => {
    if (!platformSearch.trim()) {
      return PLATFORM_OPTIONS;
    }
    const term = platformSearch.trim().toLowerCase();
    return PLATFORM_OPTIONS.filter((option) => option.label.toLowerCase().includes(term));
  }, [platformSearch]);

  const summary = useMemo(() => {
    const totals = { active: 0, reauth: 0, total: accounts.length };
    accounts.forEach((account) => {
      if (account.connection.requiresReauth) {
        totals.reauth += 1;
      } else {
        totals.active += 1;
      }
    });
    return totals;
  }, [accounts]);

  const startOAuthFlow = useCallback(
    (platformKey: string, account?: HqAccount | null) => {
      if (typeof window === "undefined") {
        return;
      }
      const target = PLATFORM_OPTIONS.find((option) => option.value === platformKey);
      if (!target) {
        setAccountError("Unsupported platform selected.");
        return;
      }
      const origin = window.location.origin;
      const redirectUrl = new URL("/admin/social-manager", origin);
      redirectUrl.searchParams.set("tab", "accounts");

      const authUrl = new URL(`/api/social-accounts/${platformKey}`, origin);
      const organisationName =
        account?.organisationName ??
        (accountForm.organisationName.trim() || "Pineapple Tapped HQ");
      authUrl.searchParams.set("organisationName", organisationName);
      authUrl.searchParams.set("displayName", account?.displayName || accountForm.displayName || organisationName);
      const requestedScopes: string[] = [];
      const publishEnabled = account ? account.scopes.publish : accountForm.publishEnabled;
      const analyticsEnabled = account ? account.scopes.analytics : accountForm.analyticsEnabled;
      if (publishEnabled) requestedScopes.push("publish");
      if (analyticsEnabled) requestedScopes.push("analytics");
      if (requestedScopes.length > 0) {
        authUrl.searchParams.set("scopes", requestedScopes.join(","));
      }
      authUrl.searchParams.set("redirect", redirectUrl.toString());
      authUrl.searchParams.set("hqManaged", "true");
      if (account?.id) {
        authUrl.searchParams.set("accountId", account.id);
      }
      setAccountError(null);
      setFeedback(null);
      window.location.href = authUrl.toString();
    },
    [accountForm]
  );

  const handleUpdateAccount = useCallback(
    async (accountId: string, updates: Partial<HqAccount>) => {
      if (!dbRef) return;
      try {
        const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
        if (updates.scopes) {
          payload.scopes = {
            publish: updates.scopes.publish,
            analytics: updates.scopes.analytics,
          };
        }
        if (updates.connection?.status) {
          payload.status = updates.connection.status;
        }
        await updateDoc(doc(dbRef, "socialAccounts", accountId), payload);
        setFeedback("Account updated.");
      } catch (error) {
        console.error("Failed to update HQ social account", error);
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
            ? error
            : "Unable to update the account";
        setAccountError(message);
      }
    },
    [dbRef]
  );

  const handleDeleteAccount = useCallback(
    async (accountId: string) => {
      if (!dbRef) return;
      try {
        await deleteDoc(doc(dbRef, "socialAccounts", accountId));
        setFeedback("Account removed.");
      } catch (error) {
        console.error("Failed to remove HQ social account", error);
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
            ? error
            : "Unable to remove the account";
        setAccountError(message);
      }
    },
    [dbRef]
  );

  const heroMetrics = [
    { label: "Active", value: summary.active },
    { label: "Needs re-auth", value: summary.reauth },
    { label: "Total", value: summary.total },
  ];

  if (roleLoading) {
    return <div className="p-6 text-sm text-gray-600">Checking permissions…</div>;
  }

  if (!allowed) {
    return <div className="p-6 text-sm text-gray-600">You do not have access to manage HQ social accounts.</div>;
  }

  return (
    <div className="grid gap-6">
      <PortalHero
        title="HQ Social Manager"
        subtitle="Link Pineapple's owned channels, monitor token health, and refresh permissions before scheduled campaigns."
        metrics={heroMetrics}
        actions={[]}
      />

      <section className="grid gap-4 rounded border bg-white p-6 shadow-sm">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">Connect an HQ social profile</h2>
          <p className="text-sm text-gray-600">
            Use this launcher to connect Pineapple-owned accounts. Tokens are stored securely and marked as HQ-managed so client
            schedulers stay separate.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium">Organisation label</span>
            <input
              type="text"
              value={accountForm.organisationName}
              onChange={(event) => setAccountForm((prev) => ({ ...prev, organisationName: event.target.value }))}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="Pineapple Tapped HQ"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Display name</span>
            <input
              type="text"
              value={accountForm.displayName}
              onChange={(event) => setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="Shown in connection lists"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={accountForm.publishEnabled}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, publishEnabled: event.target.checked }))
              }
            />
            Allow scheduling / publishing permissions
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={accountForm.analyticsEnabled}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, analyticsEnabled: event.target.checked }))
              }
            />
            Allow analytics insights
          </label>
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              Choose a platform to launch the OAuth flow. We’ll mark the resulting account as HQ-managed automatically.
            </p>
            <input
              type="search"
              value={platformSearch}
              onChange={(event) => setPlatformSearch(event.target.value)}
              className="w-full rounded border px-3 py-2 text-sm md:w-64"
              placeholder="Filter platforms"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filteredPlatforms.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => startOAuthFlow(option.value)}
                className="rounded bg-orange px-3 py-2 text-sm font-semibold text-white shadow hover:bg-orange/90"
              >
                Connect {option.label}
              </button>
            ))}
          </div>
        </div>

        {feedback ? <p className="text-sm text-emerald-600">{feedback}</p> : null}
        {accountError ? <p className="text-sm text-red-600">{accountError}</p> : null}
      </section>

      <section className="grid gap-4 rounded border bg-white p-6 shadow-sm">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">HQ account connections</h2>
          <p className="text-sm text-gray-600">
            Tokens listed here are flagged as HQ managed. Refresh or revoke access before expiry to keep the scheduler running smoothly.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="p-2">Platform</th>
                <th className="p-2">Display name</th>
                <th className="p-2">Status</th>
                <th className="p-2">Permissions</th>
                <th className="p-2">Last updated</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accountsLoading ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-gray-500">
                    Loading HQ accounts…
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-gray-500">
                    No HQ connections captured yet.
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="border-b last:border-0">
                    <td className="p-2 align-top">
                      <div className="font-medium text-gray-900">
                        {PLATFORM_LABELS[account.platform] ?? account.platform}
                      </div>
                      {account.providerAccountName ? (
                        <div className="text-xs text-gray-500">{account.providerAccountName}</div>
                      ) : null}
                      {account.providerAccountUrl ? (
                        <div className="text-xs">
                          <a
                            href={account.providerAccountUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-500 underline"
                          >
                            View profile
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2 align-top text-sm text-gray-700">
                      <div className="font-semibold text-gray-900">{account.displayName}</div>
                      <div className="text-xs text-gray-500">{account.organisationName ?? "Pineapple Tapped HQ"}</div>
                    </td>
                    <td className="p-2 align-top text-xs">
                      <div
                        className={`font-semibold ${
                          account.connection.requiresReauth
                            ? "text-red-600"
                            : account.connection.reauthRecommended
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {account.connection.requiresReauth
                          ? "Re-auth required"
                          : account.connection.reauthRecommended
                          ? "Re-auth soon"
                          : account.connection.status?.replace(/_/g, " ") ?? "Active"}
                      </div>
                      <div className="text-gray-500">
                        {account.connection.expiresAt
                          ? `Expires ${formatDateTime(account.connection.expiresAt)}`
                          : "No expiry provided"}
                      </div>
                      {account.connection.lastAuthorizedAt ? (
                        <div className="text-gray-400">
                          Linked {formatDateTime(account.connection.lastAuthorizedAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2 align-top text-xs text-gray-600">
                      <div>{account.scopes.publish ? "Publishing enabled" : "Scheduling blocked"}</div>
                      <div>{account.scopes.analytics ? "Analytics enabled" : "Analytics hidden"}</div>
                    </td>
                    <td className="p-2 align-top text-xs text-gray-500">
                      {account.updatedAt ? formatDateTime(account.updatedAt) : "—"}
                    </td>
                    <td className="p-2 align-top text-xs">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => startOAuthFlow(account.platform, account)}
                          className="rounded bg-slate-800 px-3 py-1 font-semibold text-white shadow hover:bg-slate-900"
                        >
                          Refresh token
                        </button>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={account.scopes.publish}
                            onChange={(event) =>
                              handleUpdateAccount(account.id, {
                                scopes: {
                                  publish: event.target.checked,
                                  analytics: account.scopes.analytics,
                                },
                              })
                            }
                          />
                          <span>Allow publishing</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={account.scopes.analytics}
                            onChange={(event) =>
                              handleUpdateAccount(account.id, {
                                scopes: {
                                  publish: account.scopes.publish,
                                  analytics: event.target.checked,
                                },
                              })
                            }
                          />
                          <span>Allow analytics</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => handleDeleteAccount(account.id)}
                          className="rounded border border-red-600 px-3 py-1 font-semibold text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
