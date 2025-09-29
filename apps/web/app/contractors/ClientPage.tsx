"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import AvailabilityCalendar, { AvailabilityStatus } from "@/components/AvailabilityCalendar";
import WorkwearPortal from "@/components/WorkwearPortal";
import ContractorProfileForm from "@/components/ContractorProfileForm";
import ContractorKitManager from "@/components/ContractorKitManager";
import ComplianceBadge from "@/components/ComplianceBadge";
import {
  complianceDateToDisplay,
  complianceDateToInputValue,
  deriveComplianceState,
  type ComplianceRecord,
} from "@/lib/compliance";
import { auth, db, ensureFirebase, functions } from "@/lib/firebase";
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
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

type TeamTab =
  | "dashboard"
  | "notices"
  | "availability"
  | "projects"
  | "compliance"
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
  const [complianceRecord, setComplianceRecord] = useState<ComplianceRecord | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(true);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [licenceFile, setLicenceFile] = useState<File | null>(null);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [licenceExpiry, setLicenceExpiry] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [submittingCompliance, setSubmittingCompliance] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        setComplianceLoading(true);
        setComplianceError(null);
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

        const [
          taskSnap,
          bookingSnap,
          openSnap,
          availabilitySnap,
          noticeSnap,
          productSnap,
          complianceSnap,
        ] = await Promise.all([
          getDocs(query(collection(db, "contractorTasks"), where("uid", "==", user.uid))),
          getDocs(query(collection(db, "bookings"), where("contractorUid", "==", user.uid))),
          getDocs(query(collection(db, "bookings"), where("contractorUid", "==", null))),
          getDocs(query(collection(db, "availability"), where("uid", "==", user.uid))),
          getDocs(query(collection(db, "teamNotices"), orderBy("createdAt", "desc"))),
          getDocs(query(collection(db, "contractorProducts"), where("uid", "==", user.uid))).catch((error) => {
            console.warn("Failed to load contractor products", error);
            return { docs: [] } as any;
          }),
          getDoc(doc(db, "users", user.uid, "compliance", "profile")).catch((error) => {
            console.warn("Failed to load compliance record", error);
            return null;
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

        if (complianceSnap && "exists" in complianceSnap && complianceSnap?.exists()) {
          setComplianceRecord({
            id: complianceSnap.id,
            uid: user.uid,
            ...(complianceSnap.data() as Record<string, unknown>),
          } as ComplianceRecord);
        } else {
          setComplianceRecord(null);
        }
        setComplianceLoading(false);
      } catch (error) {
        console.warn("Failed to load team workspace", error);
        setComplianceLoading(false);
        setComplianceError("We couldn't load your compliance record. Please refresh the page.");
        setComplianceRecord(null);
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

  const submitCompliance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      setComplianceError("You need to be signed in to submit compliance documents.");
      return;
    }

    setSubmittingCompliance(true);
    setComplianceError(null);

    try {
      const { db: ensuredDb, storage } = await ensureFirebase();
      const database = ensuredDb || db;
      if (!database) {
        throw new Error("Firestore is unavailable. Please try again shortly.");
      }
      if (!storage || (storage as any).__isPlaceholder) {
        throw new Error("File storage is unavailable. Please refresh and retry.");
      }

      const licenceExpiryDate = licenceExpiry ? new Date(licenceExpiry) : null;
      if (!licenceExpiryDate || Number.isNaN(licenceExpiryDate.getTime())) {
        throw new Error("Enter the expiry date for your pilot licence.");
      }

      const insuranceExpiryDate = insuranceExpiry ? new Date(insuranceExpiry) : null;
      if (!insuranceExpiryDate || Number.isNaN(insuranceExpiryDate.getTime())) {
        throw new Error("Enter the expiry date for your insurance policy.");
      }

      const hasExistingLicence = Boolean(complianceRecord?.licenceUrl);
      const hasExistingInsurance = Boolean(complianceRecord?.insuranceUrl);

      if (!licenceFile && !hasExistingLicence) {
        throw new Error("Upload your pilot licence before submitting for review.");
      }

      if (!insuranceFile && !hasExistingInsurance) {
        throw new Error("Upload your insurance certificate before submitting for review.");
      }

      const complianceRef = doc(database, "users", user.uid, "compliance", "profile");
      const timestamp = serverTimestamp();

      let licenceUrl = complianceRecord?.licenceUrl ?? null;
      let insuranceUrl = complianceRecord?.insuranceUrl ?? null;

      const payload: Record<string, unknown> = {
        uid: user.uid,
        status: "pending",
        licenceExpiry: licenceExpiryDate.toISOString(),
        insuranceExpiry: insuranceExpiryDate.toISOString(),
        reviewerUid: null,
        reviewNotes: null,
        reviewedAt: null,
        submittedAt: timestamp,
        updatedAt: timestamp,
      };

      if (licenceFile) {
        const licenceRef = ref(
          storage,
          `users/${user.uid}/compliance/licence-${Date.now()}-${licenceFile.name}`
        );
        await uploadBytes(licenceRef, licenceFile);
        licenceUrl = await getDownloadURL(licenceRef);
        payload.licenceUploadedAt = timestamp;
        payload.licenceName = licenceFile.name;
      } else if (complianceRecord?.licenceName) {
        payload.licenceName = complianceRecord.licenceName;
      }

      if (insuranceFile) {
        const insuranceRef = ref(
          storage,
          `users/${user.uid}/compliance/insurance-${Date.now()}-${insuranceFile.name}`
        );
        await uploadBytes(insuranceRef, insuranceFile);
        insuranceUrl = await getDownloadURL(insuranceRef);
        payload.insuranceUploadedAt = timestamp;
        payload.insuranceName = insuranceFile.name;
      } else if (complianceRecord?.insuranceName) {
        payload.insuranceName = complianceRecord.insuranceName;
      }

      if (licenceUrl) {
        payload.licenceUrl = licenceUrl;
      }
      if (insuranceUrl) {
        payload.insuranceUrl = insuranceUrl;
      }

      await setDoc(complianceRef, payload, { merge: true });

      const refreshed = await getDoc(complianceRef);
      if (refreshed.exists()) {
        setComplianceRecord({
          id: refreshed.id,
          uid: user.uid,
          ...(refreshed.data() as Record<string, unknown>),
        } as ComplianceRecord);
      } else {
        setComplianceRecord(null);
      }

      alert("Compliance documents submitted. HQ will confirm once approved.");
    } catch (error: any) {
      console.warn("submitCompliance failed", error);
      setComplianceError(error?.message || "Failed to submit compliance documents.");
    } finally {
      setSubmittingCompliance(false);
    }
  };

  useEffect(() => {
    setLicenceExpiry(complianceDateToInputValue(complianceRecord?.licenceExpiry));
    setInsuranceExpiry(
      complianceDateToInputValue(complianceRecord?.insuranceExpiry)
    );
    setLicenceFile(null);
    setInsuranceFile(null);
  }, [complianceRecord]);

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const complianceState = useMemo(
    () => deriveComplianceState(complianceRecord),
    [complianceRecord]
  );
  const complianceBadgeTitle = complianceState.issues.join("\n");

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
    { id: "compliance", label: "Compliance" },
    { id: "kit", label: "My Kit" },
    { id: "workwear", label: "Order Workwear" },
    { id: "profile", label: "My Profile" },
  ];

  const quickLinks: { tab: TeamTab; title: string; description: string }[] = [
    {
      tab: "compliance",
      title: "Compliance",
      description: "Upload your drone licence and insurance for HQ approval.",
    },
    {
      tab: "projects",
      title: "Projects",
      description: "Check your current shoots, tasks and opportunities.",
    },
    {
      tab: "availability",
      title: "Availability",
      description: "Update your calendar so HQ can line up the next job.",
    },
    {
      tab: "notices",
      title: "Notice board",
      description: "Catch up on the latest updates from HQ and franchises.",
    },
  ];

  const heroMetrics = [
    {
      label: "Drone compliance",
      value: (
        <ComplianceBadge
          status={complianceState.status}
          title={complianceBadgeTitle}
        />
      ),
    },
    { label: "Upcoming bookings", value: upcomingBookings.length },
    { label: "Open tasks", value: openTasks.length },
    { label: "Shifts available", value: availableBookings.length },
    { label: "New notices", value: notices.length },
  ];

  const heroActions = [
    {
      label: "Start training",
      description: "Brush up on workflows, kit prep, and edit tips.",
      href: "/training",
    },
    {
      label: "Update compliance",
      description: "Upload your drone licence and insurance for review.",
      onClick: () => setActiveTab("compliance"),
    },
    {
      label: "Review projects",
      description: "Check briefs, files, and tasks for current shoots.",
      onClick: () => setActiveTab("projects"),
    },
    {
      label: "Update availability",
      description: "Set your calendar so HQ can book you in.",
      onClick: () => setActiveTab("availability"),
    },
    {
      label: "Catch up on notices",
      description: "Read updates from HQ and franchise leads.",
      onClick: () => setActiveTab("notices"),
    },
    {
      label: "Open messenger",
      description: "Jump into conversations with HQ.",
      href: "/admin/messages",
    },
  ];

  type HeroConfig = {
    title: string;
    description: string;
    metrics?: typeof heroMetrics;
    quickActions?: typeof heroActions;
  };

  const hero: HeroConfig = (() => {
    switch (activeTab) {
      case "notices":
        return {
          title: "Notice board",
          description: "Catch up on announcements from HQ and franchise leads in one place.",
        } as const;
      case "availability":
        return {
          title: "Update your availability",
          description: "Keep your calendar current so HQ knows when to line up the next shoot.",
        } as const;
      case "projects":
        return {
          title: "Project pipeline",
          description: "Review briefs, tasks, and delivery status for every booking you&apos;re involved in.",
        } as const;
      case "compliance":
        return {
          title: "Compliance centre",
          description: "Upload and maintain your drone licence and insurance so you&apos;re cleared for upcoming work.",
        } as const;
      case "kit":
        return {
          title: "Kit locker",
          description: "Track the equipment issued to you and request updates when something changes.",
        } as const;
      case "workwear":
        return {
          title: "Order workwear",
          description: "Grab the latest branded apparel so you look the part on every shoot.",
        } as const;
      case "profile":
        return {
          title: "Your profile",
          description: "Update your contact details and preferences so HQ can stay in touch.",
        } as const;
      case "dashboard":
      default:
        return {
          title: "Your crew HQ",
          description:
            "Track bookings, stay ahead on tasks, and keep your kit details current so every shoot runs smoothly.",
          metrics: heroMetrics,
          quickActions: heroActions,
        } as const;
    }
  })();

  return (
    <PortalContainer>
      <div className="space-y-10">
        <PortalHero
          eyebrow="Team portal"
          title={hero.title}
          description={hero.description}
          backgroundClass="bg-emerald-900"
          metrics={hero.metrics}
          quickActions={hero.quickActions}
        />

        <nav
          className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-4"
          role="tablist"
          aria-label="Team workspace tabs"
        >
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
          className={`flex flex-col gap-6 ${activeTab === "dashboard" ? "" : "hidden"}`}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
                <p className="text-sm text-slate-600">
                  Use the tabs above to jump into your work. We&apos;ve highlighted the key areas you&apos;ll need today so you can
                  focus on the next shoot.
                </p>
                {nextBooking ? (
                  <p className="text-sm text-slate-500">
                    Your next booking is <span className="font-semibold text-slate-900">{formatSlotLabel(nextBooking)}</span>
                    {nextBooking.location ? ` • ${nextBooking.location}` : ""}. Head to Projects when you&apos;re ready to review
                    the brief.
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    No bookings are scheduled yet. Update your availability so HQ knows when you can take on new work.
                  </p>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {quickLinks.map((link) => (
                  <button
                    key={link.tab}
                    type="button"
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                    onClick={() => setActiveTab(link.tab)}
                  >
                    <p className="text-sm font-semibold text-slate-900">{link.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{link.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </article>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Upcoming booking</h3>
              {nextBooking ? (
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <p className="text-base font-semibold text-slate-900">{formatSlotLabel(nextBooking)}</p>
                  <p>{nextBooking.clientName || nextBooking.projectName || "Details to be confirmed"}</p>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                    onClick={() => setActiveTab("projects")}
                  >
                    View project plan
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">We&apos;ll show your next confirmed slot here.</p>
              )}
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Outstanding tasks</h3>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{openTasks.length}</p>
              <p className="text-xs text-slate-500">Waiting for your review</p>
              <button
                type="button"
                className="mt-3 inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                onClick={() => setActiveTab("projects")}
              >
                Go to tasks
              </button>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Active products</h3>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{products.length}</p>
              <p className="text-xs text-slate-500">Allocated to you</p>
              <button
                type="button"
                className="mt-3 inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                onClick={() => setActiveTab("projects")}
              >
                Review lineup
              </button>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">New notices</h3>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{notices.length}</p>
              <p className="text-xs text-slate-500">Latest updates from HQ</p>
              <button
                type="button"
                className="mt-3 inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                onClick={() => setActiveTab("notices")}
              >
                Read notices
              </button>
            </article>
          </div>
        </section>

        <section
          id={panelId("notices")}
          role="tabpanel"
          aria-labelledby={tabId("notices")}
          className={`flex flex-col gap-6 ${activeTab === "notices" ? "" : "hidden"}`}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
          className={`flex flex-col gap-6 ${activeTab === "availability" ? "" : "hidden"}`}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
          className={`flex flex-col gap-6 ${activeTab === "projects" ? "" : "hidden"}`}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Project tasks</h2>
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

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Open opportunities</h2>
                <p className="text-sm text-slate-500">Apply for shoots that match your availability.</p>
              </div>
            </div>
            {availableBookings.length ? (
              <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {availableBookings.map((booking) => (
                  <li
                    key={booking.id}
                    className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="space-y-2 text-sm text-slate-600">
                      <p className="text-base font-semibold text-slate-900">{formatSlotLabel(booking)}</p>
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {booking.serviceName || booking.projectName || "General assignment"}
                      </p>
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
          id={panelId("compliance")}
          role="tabpanel"
          aria-labelledby={tabId("compliance")}
          className={activeTab === "compliance" ? "flex flex-col gap-6" : "hidden"}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Drone compliance</h2>
                <p className="text-sm text-slate-500">
                  Upload your pilot licence and insurance so HQ can approve you for drone work.
                </p>
              </div>
              <ComplianceBadge status={complianceState.status} title={complianceBadgeTitle} />
            </div>

            {complianceLoading ? (
              <p className="mt-6 text-sm text-slate-500">Loading your compliance record…</p>
            ) : (
              <>
                {complianceError && (
                  <p className="mt-4 text-sm text-red-600">{complianceError}</p>
                )}

                {complianceState.issues.length > 0 && (
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-600">
                    {complianceState.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}

                <form className="mt-6 grid gap-6" onSubmit={submitCompliance}>
                  <fieldset className="grid gap-3 rounded-2xl border border-slate-200 p-4">
                    <legend className="text-sm font-semibold text-slate-900">Pilot licence</legend>
                    {complianceRecord?.licenceUrl ? (
                      <div className="flex flex-col gap-1 text-xs text-slate-600">
                        <a
                          className="text-blue-600 hover:underline"
                          href={complianceRecord.licenceUrl as string}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          View current licence ({complianceRecord.licenceName || "Download"})
                        </a>
                        <span>
                          Expires {complianceDateToDisplay(complianceRecord.licenceExpiry)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Upload your pilot licence (PDF or image).
                      </p>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(event) =>
                        setLicenceFile(event.target.files?.[0] ?? null)
                      }
                    />
                    <label className="grid gap-1 text-xs text-slate-600" htmlFor="licence-expiry">
                      <span className="font-medium text-slate-700">Expiry date</span>
                      <input
                        id="licence-expiry"
                        type="date"
                        className="input"
                        value={licenceExpiry}
                        onChange={(event) => setLicenceExpiry(event.target.value)}
                        required
                      />
                    </label>
                  </fieldset>

                  <fieldset className="grid gap-3 rounded-2xl border border-slate-200 p-4">
                    <legend className="text-sm font-semibold text-slate-900">Insurance certificate</legend>
                    {complianceRecord?.insuranceUrl ? (
                      <div className="flex flex-col gap-1 text-xs text-slate-600">
                        <a
                          className="text-blue-600 hover:underline"
                          href={complianceRecord.insuranceUrl as string}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          View current policy ({complianceRecord.insuranceName || "Download"})
                        </a>
                        <span>
                          Expires {complianceDateToDisplay(complianceRecord.insuranceExpiry)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Upload your insurance certificate (PDF or image).
                      </p>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(event) =>
                        setInsuranceFile(event.target.files?.[0] ?? null)
                      }
                    />
                    <label className="grid gap-1 text-xs text-slate-600" htmlFor="insurance-expiry">
                      <span className="font-medium text-slate-700">Expiry date</span>
                      <input
                        id="insurance-expiry"
                        type="date"
                        className="input"
                        value={insuranceExpiry}
                        onChange={(event) => setInsuranceExpiry(event.target.value)}
                        required
                      />
                    </label>
                  </fieldset>

                  {complianceRecord?.reviewNotes && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      <p className="font-semibold">HQ feedback</p>
                      <p className="mt-1 whitespace-pre-line">{complianceRecord.reviewNotes as string}</p>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button type="submit" className="btn" disabled={submittingCompliance}>
                      {submittingCompliance ? "Submitting…" : "Submit for review"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </article>
        </section>

        <section
          id={panelId("kit")}
          role="tabpanel"
          aria-labelledby={tabId("kit")}
          className={activeTab === "kit" ? "flex flex-col gap-6" : "hidden"}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
          className={activeTab === "workwear" ? "flex flex-col gap-6" : "hidden"}
        >
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
          className={activeTab === "profile" ? "flex flex-col gap-6" : "hidden"}
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

