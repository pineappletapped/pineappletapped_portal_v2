"use client";
import { Fragment, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { fetchOrgDocs, fetchUserOrgIds } from '@/lib/crm';

const SETUP_LAYOUT_LABELS: Record<string, string> = {
  conference: 'Conference stage',
  panel: 'Panel / fireside',
  interview: 'Interview setup',
  custom: 'Custom layout',
};

const SETUP_ZONE_LABELS: Record<string, string> = {
  'stage-front': 'Stage front',
  'stage-rear': 'Stage rear',
  audience: 'Audience',
  lighting: 'Lighting rig',
  control: 'Control / steering',
  support: 'Support areas',
};

const normaliseRichText = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/<br\s*\/?>(?=\s*<)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Lists proposals in the CRM pipeline. Staff can accept a proposal to
 * automatically create an order awaiting deposit. Once deposit is paid the
 * existing payment workflow will create the project and any tasks.
 */
export default function ProposalsPage() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const orgIdsRef = useRef<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const handleUserChange = async (user: User | null, db: any) => {
      if (cancelled) {
        return;
      }

      if (!user) {
        orgIdsRef.current = [];
        setProposals([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const orgIds = await fetchUserOrgIds(db, user.uid);
        orgIdsRef.current = orgIds;
        if (orgIds.length === 0) {
          setProposals([]);
          return;
        }

        const list = await fetchOrgDocs(db, 'proposals', orgIds);
        setProposals(list);
      } catch (err) {
        console.error('Failed to load proposals', err);
        if (!cancelled) {
          setError('Failed to load proposals. Please try again.');
          setProposals([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, (user: User | null) => handleUserChange(user, db));
      } catch (err) {
        console.error('Failed to initialise CRM proposals view', err);
        if (!cancelled) {
          setError('Failed to initialise CRM. Please refresh the page.');
          setProposals([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!expandedId) {
      return;
    }
    if (!proposals.some((proposal) => proposal.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, proposals]);

  const accept = async (id: string) => {
    if (!confirm('Accepting will create an order and may trigger task creation after payment. Continue?')) return;

    try {
      const { functions } = await ensureFirebase();
      if (!functions) {
        throw new Error('Proposal service is unavailable.');
      }

      const fn = httpsCallable(functions, 'admin_acceptProposal');
      await fn({ proposalId: id });
      setProposals((ps) => ps.map((p) => (p.id === id ? { ...p, status: 'accepted' } : p)));
    } catch (err: any) {
      console.error('Failed to accept proposal', err);
      alert(err?.message || 'Error accepting proposal');
    }
  };

  const renderSetupPlan = (plan: any) => {
    if (!plan || typeof plan !== 'object') {
      return null;
    }
    const placements = Array.isArray(plan.placements) ? plan.placements : [];
    const hasNotes = typeof plan.notes === 'string' && plan.notes.trim().length > 0;
    if (placements.length === 0 && !hasNotes) {
      return null;
    }
    const layoutLabel = SETUP_LAYOUT_LABELS[plan.layout] || plan.layout || 'Custom layout';
    return (
      <div className="grid gap-1">
        <p className="font-medium">Setup plan</p>
        <p className="text-sm text-gray-600">Layout: {layoutLabel}</p>
        {placements.length > 0 ? (
          <ul className="list-disc pl-5 text-sm text-gray-600">
            {placements.map((placement: any) => (
              <li key={placement.id || `${placement.itemId}-${placement.zone}`}>
                <span className="font-medium text-gray-700">{placement.itemName}</span> ×
                {placement.quantity || 1} →{' '}
                {SETUP_ZONE_LABELS[placement.zone] || placement.zone || 'Zone'}
                {placement.notes ? ` (${placement.notes})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {hasNotes ? (
          <p className="whitespace-pre-wrap text-sm text-gray-600">{plan.notes.trim()}</p>
        ) : null}
      </div>
    );
  };

  const renderSections = (sections: any[]) => {
    if (!Array.isArray(sections) || sections.length === 0) {
      return null;
    }
    return (
      <div className="grid gap-2">
        <p className="font-medium">Included sections</p>
        {sections.map((section) => {
          const content = normaliseRichText(section?.content);
          const summary = typeof section?.summary === 'string' ? section.summary.trim() : '';
          return (
            <div key={section?.id || section?.title} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-sm font-semibold text-gray-800">{section?.title || section?.id}</p>
              {summary ? (
                <p className="text-xs uppercase tracking-wide text-gray-500">{summary}</p>
              ) : null}
              {content ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{content}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderAgreements = (agreements: any[]) => {
    if (!Array.isArray(agreements) || agreements.length === 0) {
      return null;
    }
    return (
      <div className="grid gap-2">
        <p className="font-medium">Agreements</p>
        {agreements.map((agreement) => {
          const content = normaliseRichText(agreement?.content);
          return (
            <div key={agreement?.id || agreement?.title} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-gray-800">{agreement?.title || agreement?.id}</p>
                {agreement?.category ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {agreement.category}
                  </span>
                ) : null}
                {agreement?.requireSign ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    Signature required
                  </span>
                ) : null}
              </div>
              {content ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{content}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderBranding = (proposal: any) => {
    const color = typeof proposal?.brandColor === 'string' ? proposal.brandColor.trim() : '';
    const logo = typeof proposal?.logoUrl === 'string' ? proposal.logoUrl : '';
    if (!color && !logo) {
      return null;
    }
    return (
      <div className="grid gap-2">
        <p className="font-medium">Branding</p>
        <div className="flex flex-wrap items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Proposal logo" className="h-12 w-12 rounded-lg border border-gray-200 object-contain" />
          ) : null}
          {color ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="font-medium text-gray-700">Primary colour</span>
              <span
                aria-hidden
                className="inline-block h-5 w-5 rounded-full border border-gray-200"
                style={{ backgroundColor: color }}
              />
              <span className="font-mono text-xs text-gray-500">{color}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderDetails = (proposal: any) => {
    const setup = renderSetupPlan(proposal?.setupPlan);
    const sections = renderSections(proposal?.sections);
    const agreements = renderAgreements(proposal?.agreements);
    const branding = renderBranding(proposal);
    const customText = typeof proposal?.customText === 'string' && proposal.customText.trim().length > 0
      ? proposal.customText.trim()
      : '';

    if (!setup && !sections && !agreements && !branding && !customText) {
      return <p className="text-sm text-gray-500">No additional details recorded for this proposal.</p>;
    }

    return (
      <div className="grid gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        {customText ? (
          <div className="grid gap-1">
            <p className="font-medium">Intro / notes</p>
            <p className="whitespace-pre-wrap text-sm text-gray-600">{customText}</p>
          </div>
        ) : null}
        {branding}
        {setup}
        {sections}
        {agreements}
      </div>
    );
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Proposals</h1>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {proposals.length === 0 ? (
        <p>No proposals.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>ID</th>
              <th>Client</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => {
              const isExpanded = expandedId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className="border-t">
                    <td>{p.id.substring(0, 6)}</td>
                    <td>{p.clientEmail}</td>
                    <td>{p.status}</td>
                    <td className="flex gap-2">
                      {p.status === 'sent' && (
                        <button className="link" onClick={() => accept(p.id)}>
                          Accept
                        </button>
                      )}
                      <button
                        className="link text-gray-600"
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        {isExpanded ? 'Hide details' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td colSpan={4}>{renderDetails(p)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
