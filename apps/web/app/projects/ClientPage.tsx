"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { auth, db } from "@/lib/firebase";
import { formatOrderDisplayId } from "@/lib/orders";

interface OrderRecord {
  id: string;
  status: string;
  friendlyId: string | null;
  projectId: string | null;
  createdAt: Date | null;
}

interface ProjectRecord {
  id: string;
  name: string;
  status: string;
  stage: string | null;
  orgId: string | null;
  orgName: string | null;
  orderId: string | null;
  dueDate: Date | null;
  updatedAt: Date | null;
  approvalsPending: number;
  summary: string | null;
}

interface QuoteRequestRecord {
  id: string;
  name: string;
  status: string;
  createdAt: Date | null;
}

const PROJECTS_PER_ORG = 25;

const normaliseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value) {
    const potential = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof potential.toDate === "function") {
      try {
        const result = potential.toDate();
        return result instanceof Date && !Number.isNaN(result.getTime()) ? result : null;
      } catch (err) {
        console.warn("Failed to convert Firestore timestamp with toDate", err);
      }
    }
    if (typeof potential.toMillis === "function") {
      try {
        const millis = potential.toMillis();
        if (typeof millis === "number" && Number.isFinite(millis)) {
          return new Date(millis);
        }
      } catch (err) {
        console.warn("Failed to convert Firestore timestamp with toMillis", err);
      }
    }
  }
  return null;
};

const formatDate = (value: Date | null): string => {
  if (!value) return "—";
  return value.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const extractStatus = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
};

const calculateApprovals = (project: Record<string, any>): number => {
  const approvals = Array.isArray(project.approvals)
    ? project.approvals
    : Array.isArray(project.approvalRequests)
    ? project.approvalRequests
    : [];
  const pendingStatuses = new Set(["pending", "awaiting_review", "needs_action", "changes_requested", "in_progress"]);
  return approvals.filter((approval) => {
    const status = extractStatus(approval?.status ?? approval?.state, "").toLowerCase();
    if (!status) return true;
    if (pendingStatuses.has(status)) return true;
    return !["approved", "complete", "completed", "accepted"].includes(status);
  }).length;
};

const summariseProject = (
  project: Record<string, any>,
  orgLookup: Map<string, string>,
): ProjectRecord => {
  const orgId = typeof project.orgId === "string" && project.orgId.trim() ? project.orgId.trim() : null;
  const status = extractStatus(project.status, "active");
  const stage = extractStatus(project.stage ?? project.phase ?? project.pipelineStage, "");
  const summaryField =
    typeof project.summary === "string"
      ? project.summary
      : typeof project.description === "string"
      ? project.description
      : typeof project.latestNote === "string"
      ? project.latestNote
      : null;

  return {
    id: project.id,
    name:
      (typeof project.name === "string" && project.name.trim().length > 0 && project.name.trim()) ||
      (typeof project.projectName === "string" && project.projectName.trim().length > 0 && project.projectName.trim()) ||
      `Project ${project.id}`,
    status,
    stage: stage || null,
    orgId,
    orgName: orgId ? orgLookup.get(orgId) ?? null : null,
    orderId:
      (typeof project.orderId === "string" && project.orderId.trim().length > 0 && project.orderId.trim()) ||
      (typeof project.orderRef === "string" && project.orderRef.trim().length > 0 && project.orderRef.trim()) ||
      null,
    dueDate: normaliseDate(project.dueDate ?? project.deliveryDate ?? project.deadline ?? project.goLiveDate ?? null),
    updatedAt: normaliseDate(project.updatedAt ?? project.modifiedAt ?? project.createdAt ?? null),
    approvalsPending: calculateApprovals(project),
    summary: summaryField ? summaryField.trim() : null,
  };
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [quotes, setQuotes] = useState<QuoteRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      if (!firebaseUser) {
        setProjects([]);
        setOrders([]);
        setQuotes([]);
        setLoading(false);
        setError("Sign in to view your projects.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [ordersSnapshot, quotesSnapshot] = await Promise.all([
          getDocs(
            query(collection(db, "orders"), where("userId", "==", firebaseUser.uid))
          ),
          getDocs(
            query(collection(db, "quoteRequests"), where("userId", "==", firebaseUser.uid))
          ),
        ]);

        const orderRecords: OrderRecord[] = ordersSnapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            status: extractStatus(data.status, "processing"),
            friendlyId: formatOrderDisplayId({ id: docSnap.id, ...data }, { fallbackToOriginal: true }),
            projectId:
              (typeof data.projectId === "string" && data.projectId.trim().length > 0 && data.projectId.trim()) || null,
            createdAt: normaliseDate(data.createdAt ?? data.placedAt ?? null),
          };
        });

        const quoteRecords: QuoteRequestRecord[] = quotesSnapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            name:
              (typeof data.projectName === "string" && data.projectName.trim().length > 0 && data.projectName.trim()) ||
              (typeof data.name === "string" && data.name.trim().length > 0 && data.name.trim()) ||
              `Request ${docSnap.id}`,
            status: extractStatus(data.status, "pending"),
            createdAt: normaliseDate(data.createdAt ?? data.submittedAt ?? null),
          };
        });

        const membershipsSnapshot = await getDocs(
          query(collection(db, "memberships"), where("userId", "==", firebaseUser.uid))
        );
        const orgIds = membershipsSnapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const orgId = data.orgId;
            return typeof orgId === "string" && orgId.trim().length > 0 ? orgId.trim() : null;
          })
          .filter((value): value is string => Boolean(value));

        const uniqueOrgIds = Array.from(new Set(orgIds));
        const orgLookup = new Map<string, string>();

        await Promise.all(
          uniqueOrgIds.map(async (orgId) => {
            try {
              const orgSnap = await getDoc(doc(db, "orgs", orgId));
              if (orgSnap.exists()) {
                const data = orgSnap.data() as Record<string, any>;
                const name =
                  (typeof data.name === "string" && data.name.trim().length > 0 && data.name.trim()) ||
                  (typeof data.displayName === "string" && data.displayName.trim().length > 0 && data.displayName.trim()) ||
                  null;
                if (name) {
                  orgLookup.set(orgId, name);
                }
              }
            } catch (orgError) {
              console.warn("Failed to load organisation", orgId, orgError);
            }
          })
        );

        const projectRecords: ProjectRecord[] = [];

        await Promise.all(
          uniqueOrgIds.map(async (orgId) => {
            try {
              const projectSnapshot = await getDocs(
                query(collection(db, "projects"), where("orgId", "==", orgId), limit(PROJECTS_PER_ORG))
              );
              projectSnapshot.docs.forEach((docSnap) =>
                projectRecords.push(
                  summariseProject({ id: docSnap.id, ...docSnap.data() }, orgLookup)
                )
              );
            } catch (projectError) {
              console.error("Failed to load projects for org", orgId, projectError);
            }
          })
        );

        try {
          const assignedSnapshot = await getDocs(
            query(collection(db, "projects"), where("memberUserIds", "array-contains", firebaseUser.uid), limit(40))
          );
          assignedSnapshot.docs.forEach((docSnap) =>
            projectRecords.push(summariseProject({ id: docSnap.id, ...docSnap.data() }, orgLookup))
          );
        } catch (assignedError) {
          console.warn("Failed to load assigned projects", assignedError);
        }

        const dedupedProjectsMap = new Map<string, ProjectRecord>();
        projectRecords.forEach((project) => {
          if (!dedupedProjectsMap.has(project.id)) {
            dedupedProjectsMap.set(project.id, project);
          }
        });

        const dedupedProjects = Array.from(dedupedProjectsMap.values());
        dedupedProjects.sort((a, b) => {
          const aTime = a.updatedAt ? a.updatedAt.getTime() : a.dueDate ? a.dueDate.getTime() : 0;
          const bTime = b.updatedAt ? b.updatedAt.getTime() : b.dueDate ? b.dueDate.getTime() : 0;
          return bTime - aTime;
        });

        if (!cancelled) {
          setOrders(orderRecords);
          setQuotes(quoteRecords);
          setProjects(dedupedProjects);
        }
      } catch (err: any) {
        console.error("Projects view initialisation failed", err);
        if (!cancelled) {
          setError(
            err?.message ||
              "We couldn’t load your projects. Refresh the page or contact your Pineapple Tapped producer."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const activeProjects = useMemo(
    () =>
      projects.filter((project) => {
        const status = project.status.toLowerCase();
        return !["completed", "complete", "archived", "cancelled", "closed"].includes(status);
      }),
    [projects],
  );

  const completedProjects = useMemo(
    () =>
      projects.filter((project) => {
        const status = project.status.toLowerCase();
        return ["completed", "complete", "archived", "closed"].includes(status);
      }),
    [projects],
  );

  const pendingQuotes = quotes.filter((quote) => quote.status.toLowerCase() === "pending");
  const inProgressOrders = orders.filter((order) => {
    const status = order.status.toLowerCase();
    return !["completed", "complete", "delivered", "fulfilled", "cancelled", "refunded"].includes(status);
  });

  const heroMetrics = [
    { label: "Active projects", value: activeProjects.length },
    { label: "Wrapped projects", value: completedProjects.length },
    { label: "Pending quotes", value: pendingQuotes.length },
    { label: "Orders in progress", value: inProgressOrders.length },
  ];

  return (
    <PortalContainer>
      <div className="space-y-10">
        <PortalHero
          eyebrow="Client portal"
          title="Projects & approvals"
          description="Track shoots from briefing through delivery, jump into approvals, and keep tabs on open orders."
          backgroundClass="bg-slate-900"
          metrics={heroMetrics}
          quickActions={[
            {
              label: "Start a project",
              description: "Brief the team on new deliverables.",
              href: "/projects/new",
            },
            {
              label: "Shared inbox",
              description: "Follow updates from Pineapple Tapped.",
              href: "/emails",
            },
            {
              label: "Book production",
              description: "Secure a shoot slot that suits you.",
              href: "/bookings",
            },
          ]}
        />

        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">{error}</div>
        )}

        <section aria-labelledby="projects-active" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="projects-active" className="text-xl font-semibold text-slate-900">
                Active projects
              </h2>
              <p className="text-sm text-slate-600">
                Keep tabs on milestones, upcoming approvals, and who&rsquo;s responsible for the next action.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {loading ? "Loading" : `${activeProjects.length} live`}
            </p>
          </div>

          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-3xl border border-slate-200 bg-slate-100/80" />
              ))}
            </div>
          ) : activeProjects.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600">
              No active projects right now. Start a new project to brief our producers or revisit completed work below.
            </div>
          ) : (
            <div className="grid gap-4">
              {activeProjects.map((project) => {
                const relatedOrder = project.orderId ? orders.find((order) => order.id === project.orderId) : null;
                return (
                  <article
                    key={project.id}
                    className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                          {project.orgName || "Organisation"}
                        </p>
                        <h3 className="text-lg font-semibold text-slate-900">{project.name}</h3>
                      </div>
                      <div className="flex flex-col items-start gap-1 text-right sm:items-end">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                          {project.status}
                        </span>
                        {project.stage && (
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{project.stage}</span>
                        )}
                      </div>
                    </div>

                    {project.summary && (
                      <p className="text-sm leading-relaxed text-slate-700">{project.summary}</p>
                    )}

                    <dl className="grid gap-3 text-sm text-slate-600 sm:grid-cols-4">
                      <div>
                        <dt className="font-medium text-slate-700">Next milestone</dt>
                        <dd>{project.stage ? project.stage : "Review in progress"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-700">Due / shoot date</dt>
                        <dd>{formatDate(project.dueDate)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-700">Approvals</dt>
                        <dd>
                          {project.approvalsPending > 0
                            ? `${project.approvalsPending} awaiting your review`
                            : "All approvals up to date"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-700">Order</dt>
                        <dd>
                          {relatedOrder ? (
                            <span>{relatedOrder.friendlyId}</span>
                          ) : project.orderId ? (
                            <span>{project.orderId}</span>
                          ) : (
                            "Not linked yet"
                          )}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap gap-3 pt-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                      >
                        Open project workspace
                      </Link>
                      <Link
                        href={`/projects/${project.id}/files`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                      >
                        Project files
                      </Link>
                      {relatedOrder && (
                        <Link
                          href={`/orders/${relatedOrder.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                        >
                          View order {relatedOrder.friendlyId ? `(${relatedOrder.friendlyId})` : ""}
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="projects-completed" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="projects-completed" className="text-xl font-semibold text-slate-900">
                Wrapped projects
              </h2>
              <p className="text-sm text-slate-600">
                Revisit completed work, download assets, or request a refresh when you&rsquo;re ready to brief a new project.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {loading ? "Loading" : `${completedProjects.length} archived`}
            </p>
          </div>

          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-3xl border border-slate-200 bg-slate-100/80" />
              ))}
            </div>
          ) : completedProjects.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600">
              When projects wrap, you&rsquo;ll find them here with quick access to files and approvals.
            </div>
          ) : (
            <div className="grid gap-4">
              {completedProjects.map((project) => {
                const relatedOrder = project.orderId ? orders.find((order) => order.id === project.orderId) : null;
                return (
                  <article
                    key={project.id}
                    className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-6"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                          {project.orgName || "Organisation"}
                        </p>
                        <h3 className="text-lg font-semibold text-slate-900">{project.name}</h3>
                      </div>
                      <div className="text-sm text-slate-500">
                        Wrapped {formatDate(project.updatedAt ?? project.dueDate)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                      >
                        Revisit timeline
                      </Link>
                      <Link
                        href={`/projects/${project.id}/files`}
                        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                      >
                        Download assets
                      </Link>
                      {relatedOrder && (
                        <Link
                          href={`/orders/${relatedOrder.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                        >
                          Order {relatedOrder.friendlyId ?? relatedOrder.id}
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="projects-orders" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="projects-orders" className="text-xl font-semibold text-slate-900">
                Orders & quote requests
              </h2>
              <p className="text-sm text-slate-600">
                Keep track of requests in progress and orders that still need production or approval steps.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">Orders</h3>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                {orders.length === 0 ? (
                  <li className="text-slate-500">No orders yet.</li>
                ) : (
                  orders.map((order) => (
                    <li key={order.id} className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-700">{order.friendlyId ?? order.id}</p>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{order.status}</p>
                        {order.createdAt && (
                          <p className="text-xs text-slate-500">Placed {formatDate(order.createdAt)}</p>
                        )}
                      </div>
                      <Link
                        href={`/orders/${order.id}`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                      >
                        View
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">Quote requests</h3>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                {quotes.length === 0 ? (
                  <li className="text-slate-500">No quote requests yet.</li>
                ) : (
                  quotes.map((quote) => (
                    <li key={quote.id} className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-700">{quote.name}</p>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{quote.status}</p>
                        {quote.createdAt && (
                          <p className="text-xs text-slate-500">Submitted {formatDate(quote.createdAt)}</p>
                        )}
                      </div>
                      <Link
                        href={`/projects/requests/${quote.id}`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                      >
                        View
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </PortalContainer>
  );
}

