"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useRoleGate } from "@/hooks/useRoleGate";

type IntegrationStatus =
  | "loading"
  | "configured"
  | "missing"
  | "delegated-missing"
  | "error";

const STATUS_LABELS: Record<IntegrationStatus, { label: string; tone: "ok" | "warn" | "error" }> = {
  loading: { label: "Checking credentials…", tone: "warn" },
  configured: { label: "Service account configured", tone: "ok" },
  missing: { label: "Credentials not found", tone: "error" },
  "delegated-missing": {
    label: "Delegated user not configured",
    tone: "warn",
  },
  error: { label: "Unable to verify credentials", tone: "error" },
};

export default function StorageIntegrationClientPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [status, setStatus] = useState<IntegrationStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const checkStatus = async () => {
      try {
        const res = await fetch("/api/storage/integration/status", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Unexpected response: ${res.status}`);
        }
        const payload = (await res.json()) as {
          configured?: boolean;
          delegatedUserConfigured?: boolean;
        };
        if (!cancelled) {
          if (payload?.configured) {
            setStatus(payload.delegatedUserConfigured ? "configured" : "delegated-missing");
          } else {
            setStatus("missing");
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to check Drive integration status", error);
          setStatus("error");
        }
      }
    };

    void checkStatus();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (guardLoading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage storage integrations.</p>;

  const statusMeta = STATUS_LABELS[status];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Google Drive integration</h1>
        <p className="text-sm text-gray-600">
          Connect a Google service account so Storage Automation can browse, create, and ingest project folders on
          Drive.
        </p>
      </header>

      <section className="rounded border bg-white p-4 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Integration status</h2>
          <p className="text-xs text-gray-600">
            We check whether the <code>GOOGLE_SERVICE_ACCOUNT_KEY_BASE64</code> secret and optional{" "}
            <code>GOOGLE_SERVICE_ACCOUNT_DELEGATED_USER</code> override are available on the server. Update the
            configuration and redeploy Functions after making any changes.
          </p>
          <p
            className={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${
              statusMeta.tone === "ok"
                ? "bg-emerald-100 text-emerald-900"
                : statusMeta.tone === "warn"
                ? "bg-amber-100 text-amber-900"
                : "bg-red-100 text-red-900"
            }`}
          >
            {statusMeta.label}
          </p>
          {status === "missing" ? (
            <p className="text-xs text-red-600">
              We could not find the Drive service account credentials. Follow the steps below to generate and upload a
              key before retrying.
            </p>
          ) : null}
          {status === "configured" ? (
            <p className="text-xs text-emerald-700">
              Great! The service account key is present. Make sure your Drive root folder is shared with the service
              account email (or that domain-wide delegation is configured) so it can read and create subfolders.
            </p>
          ) : null}
          {status === "delegated-missing" ? (
            <p className="text-xs text-amber-700">
              The key is available but the <code>GOOGLE_SERVICE_ACCOUNT_DELEGATED_USER</code> environment variable is
              blank. Provide a Workspace user to impersonate when using domain-wide delegation, or share the Drive root
              folders directly with the service account.
            </p>
          ) : null}
          {status === "error" ? (
            <p className="text-xs text-red-600">
              The status check failed. Verify your network connection and try again. If the issue persists, confirm the
              deployment environment exposes the Drive credential secret.
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4 rounded border bg-slate-50 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Configure the service account</h2>
        <ol className="space-y-3 text-sm text-gray-700">
          <li>
            <strong>Enable the Drive API</strong> in your Google Cloud project and create a dedicated service account with
            the <em>Google Drive API</em> scope. Download the JSON key for this account and store it securely.
          </li>
          <li>
            <strong>Share your Drive root folders</strong> with the service account&apos;s client email or configure domain-wide
            delegation in the Google Workspace Admin console. If you opt for delegation, grant Drive scopes such as
            <code>https://www.googleapis.com/auth/drive</code> and decide which Workspace user the service should
            impersonate.
          </li>
          <li>
            <strong>Publish the credentials</strong> as the <code>GOOGLE_SERVICE_ACCOUNT_KEY_BASE64</code> environment
            variable for Firebase Functions (or your hosting provider). Generate the base64 string with:
            <pre className="mt-2 overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
              <code>{`cat service-account.json | base64`}</code>
            </pre>
            When using Firebase, run:
            <pre className="mt-2 overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
              <code>{`firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`}</code>
            </pre>
            Paste the base64 string when prompted, deploy your functions, then return here to confirm the status reads
            “Service account configured”.
          </li>
          <li>
            <strong>Set the delegated user (optional)</strong> via the <code>GOOGLE_SERVICE_ACCOUNT_DELEGATED_USER</code>
            environment variable when you need the service account to impersonate a Workspace user (for example,
            <code>ryan@pineappletapped.com</code>). Redeploy Functions after updating the secret or environment.
          </li>
        </ol>
        <p className="text-xs text-gray-600">
          Tip: rotate the service account key regularly and update the secret to maintain compliance with security best
          practices.
        </p>
      </section>

      <div>
        <Link className="btn btn-sm" href="/admin/storage">
          Back to Storage automation
        </Link>
      </div>
    </div>
  );
}
