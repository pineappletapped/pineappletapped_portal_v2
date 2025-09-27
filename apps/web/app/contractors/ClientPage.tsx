"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import PortalContainer from "@/components/PortalContainer";
import AvailabilityCalendar, { AvailabilityStatus } from "@/components/AvailabilityCalendar";
import WorkwearPortal from "@/components/WorkwearPortal";
import ContractorProfileForm from "@/components/ContractorProfileForm";
import ContractorKitManager from "@/components/ContractorKitManager";
import { auth, db, functions } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { extractUserRoles, hasRole } from "@/lib/roles";

type TeamTab =
  | "dashboard"
  | "notices"
  | "availability"
  | "projects"
  | "kit"
  | "workwear"
  | "profile";

type ProjectFilter = "all" | "current" | "need-invoice" | "pending-payment" | "archived";

interface BookingRecord {
  id: string;
  slot?: {
    date?: string;
    start?: string;
    end?: string;
  };
  status?: string;
  tasksComplete?: boolean;
  clientPaid?: boolean;
  contractorPaid?: boolean;
  invoiceStatus?: string | null;
  [key: string]: any;
}

interface TaskRecord {
  id: string;
  title?: string | null;
  status?: string | null;
  [key: string]: any;
}

interface ProductRecord {
  id: string;
  name?: string | null;
  status?: string | null;
  [key: string]: any;
}

interface NoticeRecord {
  id: string;
  title?: string | null;
  message?: string | null;
  createdAt?: any;
  authorUid?: string | null;
}

const parseDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("parseDate failed", error);
      return null;
    }
  }
  return null;
};

const formatDateTime = (value: any) => {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const slotDateToDate = (slot?: BookingRecord["slot"]): Date | null => {
  if (!slot?.date) return null;
  const date = new Date(slot.date);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const determineProjectFilter = (booking: BookingRecord): ProjectFilter => {
  if (booking.status === "archived" || booking.archived) {
    return "archived";
  }

  const slotDate = slotDateToDate(booking.slot);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (slotDate && slotDate >= today) {
    return "current";
  }

  const invoiceStatus = (booking.invoiceStatus || "").toString().toLowerCase();
  if (invoiceStatus.includes("awaiting") || invoiceStatus.includes("draft")) {
    return "need-invoice";
  }
  if (invoiceStatus.includes("pending") || invoiceStatus.includes("processing")) {
    return "pending-payment";
  }

  if (booking.tasksComplete && !booking.clientPaid) {
    return "need-invoice";
  }

  if (booking.clientPaid && !booking.contractorPaid) {
    return "pending-payment";
  }

  if (!booking.tasksComplete) {
    return "current";
  }

  return "archived";
};

const tabId = (tab: TeamTab) => `team-tab-${tab}`;
const panelId = (tab: TeamTab) => `team-panel-${tab}`;

export default function ContractorPortal() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TeamTab>("dashboard");
  const [projectsFilter, setProjectsFilter] = useState<ProjectFilter>("current");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [availableBookings, setAvailableBookings] = useState<BookingRecord[]>([]);
  const [availability, setAvailability] = useState<Record<string, AvailabilityStatus>>({});
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [notices, setNotices] = useState<NoticeRecord[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        const profile = profileSnap.data() as any;
        const profileDoc = {
          ...profile,
          id: profileSnap.id,
          uid: user.uid,
          email: profile?.email ?? user.email ?? null,
        };
        const roles = extractUserRoles(profileDoc);
        setIsStaff(hasRole(roles, ["admin", "operations", "projects"]));

        const [taskSnap, bookingSnap, openSnap, availabilitySnap, noticeSnap, productSnap] = await Promise.all([
          getDocs(query(collection(db, "contractorTasks"), where("uid", "==", user.uid))),
          getDocs(query(collection(db, "bookings"), where("contractorUid", "==", user.uid))),
          getDocs(query(collection(db, "bookings"), where("contractorUid", "==", null))),
          getDocs(query(collection(db, "availability"), where("uid", "==", user.uid))),
          getDocs(query(collection(db, "teamNotices"), orderBy("createdAt", "desc"))),
          getDocs(query(collection(db, "contractorProducts"), where("uid", "==", user.uid))).catch((error) => {
            console.warn("Failed to load contractor products", error);
            return { docs: [] } as any;
          }),
        ]);

        setTasks(taskSnap.docs.map((d) => ({ ...(d.data() as TaskRecord), id: d.id })));
        const bookingDocs = bookingSnap.docs.map((d) => ({ ...(d.data() as BookingRecord), id: d.id }));
        setBookings(bookingDocs);
        setAvailableBookings(openSnap.docs.map((d) => ({ ...(d.data() as BookingRecord), id: d.id })));

        const availabilityMap: Record<string, AvailabilityStatus> = {};
        availabilitySnap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data.date && data.status) {
            availabilityMap[data.date] = data.status as AvailabilityStatus;
          }
        });
        setAvailability(availabilityMap);

        setNotices(noticeSnap.docs.map((d) => ({ ...(d.data() as NoticeRecord), id: d.id })));

        if ("docs" in productSnap) {
          setProducts(productSnap.docs.map((d: any) => ({ ...(d.data() as ProductRecord), id: d.id })));
        } else {
          setProducts([]);
        }
      } catch (error) {
        console.warn("Failed to load team workspace", error);
      }

      setLoading(false);
    })();
  }, []);

  const markTaskComplete = async (id: string) => {
    try {
      const fn = httpsCallable(functions, "contractor_updateTask");
      await fn({ taskId: id, status: "submitted" });
      setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status: "submitted" } : task)));
    } catch (error) {
      console.warn("markTaskComplete failed", error);
    }
  };

  const applyForBooking = async (id: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await addDoc(collection(db, "bookingApplications"), {
        bookingId: id,
        uid: user.uid,
        createdAt: Date.now(),
      });
      alert("Application sent");
    } catch (error) {
      console.warn("applyForBooking failed", error);
    }
  };

  const updateDay = async (date: string, status: AvailabilityStatus) => {
    const user = auth.currentUser;
    if (!user) return;
    setAvailability((prev) => ({ ...prev, [date]: status }));
    await setDoc(doc(db, "availability", `${user.uid}_${date}`), {
      uid: user.uid,
      date,
      status,
    });
  };

  const submitNotice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user || !isStaff) return;
    try {
      await addDoc(collection(db, "teamNotices"), {
        title: noticeTitle.trim(),
        message: noticeMessage.trim(),
        createdAt: serverTimestamp(),
        authorUid: user.uid,
      });
      setNoticeTitle("");
      setNoticeMessage("");
      const refresh = await getDocs(query(collection(db, "teamNotices"), orderBy("createdAt", "desc")));
      setNotices(refresh.docs.map((d) => ({ ...(d.data() as NoticeRecord), id: d.id })));
    } catch (error) {
      console.warn("submitNotice failed", error);
    }
  };

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const upcomingBookings = useMemo(() => {
    const items = bookings
      .map((booking) => ({ booking, date: slotDateToDate(booking.slot) }))
      .filter((item) => item.date && item.date >= today)
      .sort((a, b) => (a.date && b.date ? a.date.getTime() - b.date.getTime() : 0));
    return items.map((item) => item.booking).slice(0, 5);
  }, [bookings, today]);

  const nextBooking = upcomingBookings[0];

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== "submitted"), [tasks]);

  const projectEntries = useMemo(() => {
    const entries = bookings.map((booking) => ({
      booking,
      stage: determineProjectFilter(booking),
      slotDate: slotDateToDate(booking.slot),
    }));
    const filtered = projectsFilter === "all"
      ? entries
      : entries.filter((entry) => entry.stage === projectsFilter);
    return filtered
      .sort((a, b) => {
        const aTime = a.slotDate ? a.slotDate.getTime() : 0;
        const bTime = b.slotDate ? b.slotDate.getTime() : 0;
        return bTime - aTime;
      })
      .map((entry) => entry.booking);
  }, [bookings, projectsFilter]);

  const formatSlotLabel = (booking: BookingRecord) => {
    const date = slotDateToDate(booking.slot);
    if (!date) {
      return "Schedule to be confirmed";
    }
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
    const start = booking.slot?.start ? ` ${booking.slot.start}` : "";
    const end = booking.slot?.end ? ` - ${booking.slot.end}` : "";
    return `${dateLabel}${start}${end}`.trim();
  };

  const renderProjectStatus = (booking: BookingRecord) => {
    const stage = determineProjectFilter(booking);
    switch (stage) {
      case "current":
        return "In progress";
      case "need-invoice":
        return "Ready to invoice";
      case "pending-payment":
        return "Awaiting payment";
      case "archived":
        return "Archived";
      default:
        return "In review";
    }
  };

  if (loading) {
    return (
      <PortalContainer>
        <div className="py-16 text-center text-sm text-slate-500">Preparing your team workspace…</div>
      </PortalContainer>
    );
  }

  const tabs: { id: TeamTab; label: string; description?: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "notices", label: "Notice Board" },
    { id: "availability", label: "Availability" },
    { id: "projects", label: "Projects" },
    { id: "kit", label: "My Kit" },
    { id: "workwear", label: "Order Workwear" },
    { id: "profile", label: "My Profile" },
  ];

  return (
    <PortalContainer>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-6 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Team Portal</h1>
            <p className="mt-1 text-sm text-slate-600">
              Track your bookings, tasks, kit and availability in one place. Tabs organise the tools you use most during a shoot week.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/messages" className="btn-outline text-sm">
              Messenger
            </Link>
            <Link href="/contractors/workwear" className="btn-outline text-sm">
              Open workwear hub
            </Link>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Team workspace tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              aria-controls={panelId(tab.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "bg-slate-900 text-white shadow"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section
          id={panelId("dashboard")}
          role="tabpanel"
          aria-labelledby={tabId("dashboard")}
          hidden={activeTab !== "dashboard"}
          className="flex flex-col gap-6"
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Next booking</h2>
              {nextBooking ? (
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <p className="text-lg font-semibold text-slate-900">{formatSlotLabel(nextBooking)}</p>
                  <p className="text-sm text-slate-500">
                    {nextBooking.clientName || nextBooking.projectName || "Client details to follow"}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                      {renderProjectStatus(nextBooking)}
                    </span>
                    {nextBooking.location && <span>{nextBooking.location}</span>}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No upcoming bookings yet. Check the open opportunities below.</p>
              )}
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Active products</h2>
              {products.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {products.map((product) => (
                    <li key={product.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span>{product.name || "Untitled product"}</span>
                      {product.status && (
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {product.status}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Products linked to your shoots will appear here once HQ assigns them to you.
                </p>
              )}
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1 md:col-span-2 xl:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Assigned tasks</h2>
              {openTasks.length ? (
                <ul className="mt-3 space-y-3">
                  {openTasks.map((task) => (
                    <li key={task.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-900">{task.title || "Task"}</p>
                      <p className="mt-1 text-xs text-slate-500">Status: {task.status || "in progress"}</p>
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                        onClick={() => markTaskComplete(task.id)}
                      >
                        Mark complete
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No outstanding tasks. We&apos;ll notify you when new work drops.</p>
              )}
            </article>
          </div>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Open opportunities</h2>
                <p className="text-sm text-slate-500">Pick up extra shoots that match your skills.</p>
              </div>
            </div>
            {availableBookings.length ? (
              <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {availableBookings.map((booking) => (
                  <li key={booking.id} className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-2 text-sm text-slate-600">
                      <p className="text-base font-semibold text-slate-900">{formatSlotLabel(booking)}</p>
                      <p className="text-xs uppercase tracking-wide text-slate-500">{booking.serviceName || booking.projectName || "General assignment"}</p>
                      {booking.location && <p className="text-xs text-slate-500">{booking.location}</p>}
                    </div>
                    <button
                      type="button"
                      className="mt-4 inline-flex items-center justify-center rounded-full bg-orange px-3 py-1 text-sm font-semibold text-white hover:bg-orange/80"
                      onClick={() => applyForBooking(booking.id)}
                    >
                      Apply for this slot
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No open opportunities right now. Check back soon or update your availability.</p>
            )}
          </article>
        </section>

        <section
          id={panelId("notices")}
          role="tabpanel"
          aria-labelledby={tabId("notices")}
          hidden={activeTab !== "notices"}
          className="flex flex-col gap-6"
        >
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Team notice board</h2>
                <p className="text-sm text-slate-500">HQ and franchise managers post important updates here.</p>
              </div>
            </div>
            {isStaff && (
              <form onSubmit={submitNotice} className="mb-6 grid gap-3">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="notice-title">
                    Title
                  </label>
                  <input
                    id="notice-title"
                    value={noticeTitle}
                    onChange={(event) => setNoticeTitle(event.target.value)}
                    className="input"
                    placeholder="Share the headline"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="notice-message">
                    Message
                  </label>
                  <textarea
                    id="notice-message"
                    value={noticeMessage}
                    onChange={(event) => setNoticeMessage(event.target.value)}
                    className="textarea"
                    rows={4}
                    placeholder="Add supporting detail"
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn">
                    Publish update
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-4">
              {notices.length ? (
                notices.map((notice) => (
                  <article key={notice.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{notice.title || "Team update"}</h3>
                      <p className="text-xs text-slate-500">{formatDateTime(notice.createdAt)}</p>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{notice.message || "Details coming soon."}</p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-500">No notices yet. Updates from HQ will appear here.</p>
              )}
            </div>
          </article>
        </section>

        <section
          id={panelId("availability")}
          role="tabpanel"
          aria-labelledby={tabId("availability")}
          hidden={activeTab !== "availability"}
          className="flex flex-col gap-6"
        >
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-slate-900">Availability planner</h2>
              <p className="text-sm text-slate-500">
                Tap a date to cycle through your status. HQ uses this view when assigning new work.
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
              <AvailabilityCalendar availability={availability} onChange={updateDay} />
              <aside className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                <h3 className="text-sm font-semibold text-slate-900">Colour key</h3>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 rounded-full bg-green-500" aria-hidden />
                    Available for bookings
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 rounded-full bg-yellow-400" aria-hidden />
                    Partially available / check details
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 rounded-full bg-red-500" aria-hidden />
                    Already booked
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 rounded-full bg-black" aria-hidden />
                    Unavailable
                  </li>
                </ul>
                <p className="pt-2 text-xs text-slate-500">
                  Need to make changes for a past date? Drop HQ a message in the portal messenger so payroll can be updated.
                </p>
              </aside>
            </div>
          </article>
        </section>

        <section
          id={panelId("projects")}
          role="tabpanel"
          aria-labelledby={tabId("projects")}
          hidden={activeTab !== "projects"}
          className="flex flex-col gap-6"
        >
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Project pipeline</h2>
                <p className="text-sm text-slate-500">Filter your shoots by status to see what needs attention.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["all", "current", "need-invoice", "pending-payment", "archived"].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      projectsFilter === filter
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                    onClick={() => setProjectsFilter(filter as ProjectFilter)}
                  >
                    {filter === "need-invoice"
                      ? "Need invoice"
                      : filter === "pending-payment"
                      ? "Pending payment"
                      : filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {projectEntries.length ? (
              <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {projectEntries.map((booking) => (
                  <li key={booking.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p className="text-base font-semibold text-slate-900">
                      {booking.projectName || booking.clientName || "Untitled project"}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                      {renderProjectStatus(booking)}
                    </p>
                    <p className="mt-2 text-sm">{formatSlotLabel(booking)}</p>
                    {booking.notes && <p className="mt-2 text-xs text-slate-500">Notes: {booking.notes}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-sm text-slate-500">No projects match this filter. Try switching to another status.</p>
            )}
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">My tasks</h2>
            </div>
            {tasks.length ? (
              <ul className="mt-4 space-y-3">
                {tasks.map((task) => (
                  <li key={task.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{task.title || "Task"}</p>
                      <span className="text-xs uppercase tracking-wide text-slate-500">{task.status || "in progress"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {task.status !== "submitted" ? (
                        <button
                          type="button"
                          className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                          onClick={() => markTaskComplete(task.id)}
                        >
                          Mark complete
                        </button>
                      ) : (
                        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                          Submitted
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No tasks assigned to you at the moment.</p>
            )}
          </article>
        </section>

        <section
          id={panelId("kit")}
          role="tabpanel"
          aria-labelledby={tabId("kit")}
          hidden={activeTab !== "kit"}
        >
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">My kit register</h2>
            <p className="mt-1 text-sm text-slate-500">Log the equipment you hold so HQ can track availability.</p>
            <div className="mt-4">
              <ContractorKitManager />
            </div>
          </article>
        </section>

        <section
          id={panelId("workwear")}
          role="tabpanel"
          aria-labelledby={tabId("workwear")}
          hidden={activeTab !== "workwear"}
        >
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Order workwear</h2>
            <p className="mt-1 text-sm text-slate-500">Request branded uniforms and replacements.</p>
            <div className="mt-4">
              <WorkwearPortal audience="team" />
            </div>
          </article>
        </section>

        <section
          id={panelId("profile")}
          role="tabpanel"
          aria-labelledby={tabId("profile")}
          hidden={activeTab !== "profile"}
        >
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">My profile</h2>
            <p className="mt-1 text-sm text-slate-500">Keep your details current so bookings and payments run smoothly.</p>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-slate-600">Signed in as {auth.currentUser?.email}</p>
              <ContractorProfileForm />
            </div>
          </article>
        </section>
      </div>
    </PortalContainer>
  );
}

