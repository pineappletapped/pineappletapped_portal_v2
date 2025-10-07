"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { useRoleGate } from "@/hooks/useRoleGate";
import { ensureFirebase } from "@/lib/firebase";
import { parseEventOrganiserSnapshot, type EventOrganiserProfile } from "@/lib/organisers";

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function OrganiserClientPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["organiser", "admin"]);
  const [profile, setProfile] = useState<EventOrganiserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!allowed) {
        setLoading(false);
        return;
      }

      try {
        const { auth, db } = await ensureFirebase();
        if (!auth || !db) {
          throw new Error("Firebase is unavailable.");
        }

        const currentUser = auth.currentUser;
        if (!currentUser) {
          setProfile(null);
          setLoading(false);
          return;
        }

        const organiserSnap = await getDoc(doc(db, "eventOrganisers", currentUser.uid));
        if (cancelled) {
          return;
        }

        setProfile(parseEventOrganiserSnapshot(organiserSnap));
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load organiser profile", err);
          setError("Unable to load organiser programme details.");
          setProfile(null);
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
  }, [allowed]);

  const metrics = useMemo(() => {
    if (!profile) {
      return [
        { label: "Minimum guarantee", value: "—" },
        { label: "Hidden packages", value: "0" },
        { label: "Upsell variations", value: "0" },
        { label: "Linked projects", value: "0" },
      ];
    }
    return [
      { label: "Minimum guarantee", value: formatCurrency(profile.minimumGuarantee) },
      { label: "Hidden packages", value: profile.hiddenProductIds.length.toString() },
      { label: "Upsell variations", value: profile.upsellVariationIds.length.toString() },
      { label: "Linked projects", value: profile.linkedProjectIds.length.toString() },
    ];
  }, [profile]);

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading organiser workspace…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have access to the organiser workspace.
        </p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <PortalHero
          eyebrow="Partner programme"
          title="Event organiser workspace"
          description="Coordinate exhibitor filming packages, manage guaranteed coverage, and unlock revenue sharing for your events."
          metrics={metrics}
        />

        {error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
            {error}
          </div>
        ) : null}

        {profile ? (
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Programme overview</h2>
                <p className="text-sm text-gray-600">
                  These settings are shared with Pineapple Tapped so exhibitors receive the correct pricing and deliverables.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                {profile.active ? "Active" : "Paused"}
              </span>
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Minimum guarantee</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">
                  {formatCurrency(profile.minimumGuarantee)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Commission rate</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">
                  {profile.commissionRate != null ? `${profile.commissionRate}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Stripe status</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">{profile.stripeStatus || "Pending"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Stripe account</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">
                  {profile.stripeAccountId || "Not connected"}
                </dd>
              </div>
            </dl>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Hidden exhibitor packages</h3>
                {profile.hiddenProductIds.length > 0 ? (
                  <ul className="mt-2 grid gap-2 text-sm text-gray-700">
                    {profile.hiddenProductIds.map((id) => (
                      <li key={id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs">
                        {id}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">No hidden packages have been configured yet.</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Upsell variations</h3>
                {profile.upsellVariationIds.length > 0 ? (
                  <ul className="mt-2 grid gap-2 text-sm text-gray-700">
                    {profile.upsellVariationIds.map((id) => (
                      <li key={id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs">
                        {id}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">Add upsell variation IDs to offer enhanced packages to exhibitors.</p>
                )}
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900">Linked projects</h3>
              {profile.linkedProjectIds.length > 0 ? (
                <ul className="mt-2 grid gap-2 text-sm text-gray-700">
                  {profile.linkedProjectIds.map((id) => (
                    <li key={id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs">
                      {id}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-gray-600">No delivery projects are linked to this organiser yet.</p>
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600 shadow-sm">
            <p>
              Your account hasn&apos;t been activated as an organiser yet. Speak with your Pineapple Tapped contact if you need
              to onboard an event or reseller programme.
            </p>
          </section>
        )}
      </div>
    </PortalContainer>
  );
}
