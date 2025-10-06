"use client";

import { useEffect, useMemo, useState } from "react";
import { PDFDownloadLink, pdf } from "@react-pdf/renderer";
import CallSheetPDF, {
  CallSheetContactDetails,
  CallSheetCrewMember,
  CallSheetData,
  CallSheetScheduleItem,
  CallSheetShotItem,
} from "@/components/CallSheetPDF";
import type { KitSummary } from "@/lib/kit-summary";
import { ensureFirebase } from "@/lib/firebase";

interface TimestampLike {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
}

export interface ProjectLikeRecord {
  id: string;
  title?: string | null;
  name?: string | null;
  serviceName?: string | null;
  projectOverview?: string | null;
  summary?: string | null;
  description?: string | null;
  notes?: string | null;
  projectNotes?: string | null;
  brief?: string | null;
  orderNotes?: string | null;
  location?: string | null;
  locationAddress?: string | null;
  shootLocation?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  clientPostalCode?: string | null;
  locationNotes?: string | null;
  callTime?: string | null;
  wrapTime?: string | null;
  callSheetNotes?: string | null;
  kitReservationWindow?: string | null;
  kitReservationStart?: string | null;
  kitReservationEnd?: string | null;
  kitNotes?: string | null;
  userEmail?: string | null;
  userPhone?: string | null;
  userName?: string | null;
  ownerUid?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  franchiseAssignedUser?: {
    displayName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    phone?: string | null;
  } | null;
  franchiseAssignment?: {
    territoryLabel?: string | null;
    territoryPostalCode?: string | null;
    locationAddress?: string | null;
  } | null;
  projectTeam?: any;
  teamMembers?: any;
  keyShots?: any;
  shotList?: any;
  heroShots?: any;
  storyboardShots?: any;
  clientContact?: any;
  clientContactName?: string | null;
  clientContactEmail?: string | null;
  clientContactPhone?: string | null;
  clientContactNotes?: string | null;
  dueDate?: Date | TimestampLike | string | null;
  filmingDueDate?: Date | TimestampLike | string | null;
  kickoffDate?: Date | TimestampLike | string | null;
}

export interface ProjectBookingSlotLike {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  notes?: string | null;
}

export interface ProjectBookingRecordLike {
  id: string;
  taskTitle: string;
  introduction?: string | null;
  slots: ProjectBookingSlotLike[];
}

export interface StaffOptionLike {
  uid: string;
  label: string;
  email?: string | null;
  phoneNumber?: string | null;
}

interface RecipientEntry {
  id: string;
  email: string;
  name?: string;
  include: boolean;
}

interface CallSheetBuilderProps {
  project: ProjectLikeRecord;
  kitSummary?: KitSummary | null;
  bookings?: ProjectBookingRecordLike[];
  staffOptions: StaffOptionLike[];
  onClose: () => void;
}

interface CallSheetFormState extends CallSheetData {
  recipients: RecipientEntry[];
  message: string;
}

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    if (typeof (value as TimestampLike).toDate === "function") {
      try {
        return (value as TimestampLike).toDate!();
      } catch (err) {
        console.warn("Failed to convert timestamp via toDate", err);
      }
    }
    if (
      typeof (value as TimestampLike).seconds === "number" &&
      typeof (value as TimestampLike).nanoseconds === "number"
    ) {
      const seconds = (value as TimestampLike).seconds!;
      const nanos = (value as TimestampLike).nanoseconds!;
      return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
    }
  }
  return null;
};

const toIsoDate = (value: Date | null): string | undefined => {
  if (!value) return undefined;
  const iso = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
    .toISOString()
    .slice(0, 10);
  return iso;
};

const dedupeBy = <T,>(items: T[], selector: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = selector(item);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const asStringArray = (input: any): string[] => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const value = (entry as any).name || (entry as any).title || (entry as any).label;
          return typeof value === "string" ? value : null;
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));
  }
  return [];
};

const resolveLocationString = (project: ProjectLikeRecord): string => {
  const candidates = [
    project.location,
    project.locationAddress,
    project.shootLocation,
    project.venueAddress,
    project.venueName,
    project.franchiseAssignment?.locationAddress,
    project.franchiseAssignment?.territoryLabel,
    project.franchiseAssignment?.territoryPostalCode,
    project.clientPostalCode,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
};

const resolveOverview = (project: ProjectLikeRecord): string => {
  const candidates = [
    project.projectOverview,
    project.summary,
    project.description,
    project.projectNotes,
    project.brief,
    project.notes,
    project.orderNotes,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  const title = project.title || project.name || project.serviceName;
  if (title) {
    return `${title} production overview`;
  }
  return "";
};

const resolveClientContact = (project: ProjectLikeRecord): CallSheetContactDetails | undefined => {
  const base = project.clientContact && typeof project.clientContact === "object" ? (project.clientContact as any) : {};
  const nameCandidate =
    base.name ||
    base.displayName ||
    project.clientContactName ||
    project.userName ||
    (typeof base.firstName === "string" || typeof base.lastName === "string"
      ? `${base.firstName || ""} ${base.lastName || ""}`.trim()
      : null);
  const emailCandidate = base.email || project.clientContactEmail || project.userEmail;
  const phoneCandidate = base.phone || base.phoneNumber || project.clientContactPhone || project.userPhone;
  const notesCandidate = project.clientContactNotes || base.notes;

  if (!nameCandidate && !emailCandidate && !phoneCandidate && !notesCandidate) {
    return emailCandidate ? { email: emailCandidate } : undefined;
  }

  return {
    name: typeof nameCandidate === "string" ? nameCandidate : undefined,
    email: typeof emailCandidate === "string" ? emailCandidate : undefined,
    phone: typeof phoneCandidate === "string" ? phoneCandidate : undefined,
    notes: typeof notesCandidate === "string" ? notesCandidate : undefined,
  };
};

const resolveCrew = (
  project: ProjectLikeRecord,
  staffOptions: StaffOptionLike[]
): CallSheetCrewMember[] => {
  const crew: CallSheetCrewMember[] = [];

  if (project.ownerUid) {
    const owner = staffOptions.find((member) => member.uid === project.ownerUid);
    crew.push({
      name: owner?.label || project.ownerName || "Project Lead",
      role: "Producer",
      email: owner?.email || project.ownerEmail || undefined,
      phone: owner?.phoneNumber || undefined,
    });
  } else if (project.ownerName) {
    crew.push({ name: project.ownerName, role: "Producer", email: project.ownerEmail || undefined });
  }

  const assigned = project.franchiseAssignedUser;
  if (assigned && (assigned.displayName || assigned.email)) {
    crew.push({
      name: assigned.displayName || assigned.email || "Franchise Operator",
      role: "Franchise Operator",
      email: assigned.email || undefined,
      phone: assigned.phoneNumber || assigned.phone || undefined,
    });
  }

  const teamInputs = Array.isArray(project.projectTeam)
    ? project.projectTeam
    : Array.isArray(project.teamMembers)
    ? project.teamMembers
    : [];

  teamInputs.forEach((entry: any) => {
    if (!entry || typeof entry !== "object") return;
    const name = (entry.name as string) || (entry.displayName as string) || (entry.label as string) || "";
    const email = (entry.email as string) || (entry.contactEmail as string) || "";
    const role = (entry.role as string) || (entry.title as string) || undefined;
    const phone = (entry.phone as string) || (entry.phoneNumber as string) || undefined;
    if (!name && !email) return;
    crew.push({
      name: name || email || "Crew Member",
      role,
      email: email || undefined,
      phone,
    });
  });

  return dedupeBy(
    crew.filter((member) => member.name && member.name.trim().length > 0),
    (member) => `${member.name?.toLowerCase() || ""}|${member.email?.toLowerCase() || ""}`
  );
};

const resolveScheduleFromBookings = (bookings?: ProjectBookingRecordLike[]): CallSheetScheduleItem[] => {
  if (!bookings || bookings.length === 0) return [];
  const items: CallSheetScheduleItem[] = [];
  bookings.forEach((booking) => {
    const slots = booking.slots || [];
    slots.forEach((slot) => {
      items.push({
        time: slot.startAt || undefined,
        heading: slot.label || booking.taskTitle || "Session",
        owner: booking.introduction || undefined,
        notes: slot.notes || undefined,
      });
    });
  });
  return items;
};

const resolveCallAndWrapTimes = (project: ProjectLikeRecord, schedule: CallSheetScheduleItem[]) => {
  const times: Date[] = [];
  const wrapTimes: Date[] = [];
  schedule.forEach((item) => {
    if (item.time) {
      const parsed = new Date(item.time);
      if (!Number.isNaN(parsed.getTime())) times.push(parsed);
    }
  });

  const kitStart = project.kitReservationStart || project.kitReservationWindow;
  const kitEnd = project.kitReservationEnd || project.kitReservationWindow;

  if (kitStart && typeof kitStart === "string") {
    const parsed = new Date(kitStart);
    if (!Number.isNaN(parsed.getTime())) times.push(parsed);
  }
  if (kitEnd && typeof kitEnd === "string") {
    const parsed = new Date(kitEnd);
    if (!Number.isNaN(parsed.getTime())) wrapTimes.push(parsed);
  }

  schedule.forEach((item) => {
    if (item.notes) {
      const matches = item.notes.match(/(\d{1,2}:\d{2})/);
      if (matches) {
        const [hours, minutes] = matches[1].split(":").map((part) => Number(part));
        if (Number.isFinite(hours) && Number.isFinite(minutes)) {
          const base = toDate(project.filmingDueDate || project.dueDate || project.kickoffDate) || new Date();
          const candidate = new Date(base);
          candidate.setHours(hours, minutes, 0, 0);
          wrapTimes.push(candidate);
        }
      }
    }
  });

  const callTime = times.length
    ? times.reduce((earliest, current) => (current < earliest ? current : earliest))
    : toDate(project.kickoffDate) || toDate(project.dueDate);

  const wrapTime = wrapTimes.length
    ? wrapTimes.reduce((latest, current) => (current > latest ? current : latest))
    : undefined;

  return {
    callTime: callTime ? callTime.toISOString() : project.callTime || undefined,
    wrapTime: wrapTime ? wrapTime.toISOString() : project.wrapTime || undefined,
  };
};

const resolveShotList = (project: ProjectLikeRecord): CallSheetShotItem[] => {
  const arrays = [project.keyShots, project.shotList, project.heroShots, project.storyboardShots];
  const shots: CallSheetShotItem[] = [];
  arrays.forEach((entry) => {
    const values = asStringArray(entry);
    values.forEach((value) => {
      shots.push({ name: value });
    });
  });
  return dedupeBy(shots, (item) => item.name.toLowerCase());
};

const resolveKitNotes = (project: ProjectLikeRecord, kitSummary?: KitSummary | null): string => {
  const candidateNotes = [project.kitNotes, project.callSheetNotes];
  for (const note of candidateNotes) {
    if (typeof note === "string" && note.trim().length > 0) {
      return note.trim();
    }
  }
  if (kitSummary) {
    const parts = [kitSummary.label, kitSummary.window].filter((part) => part && part.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(" – ");
    }
    if (kitSummary.hasDrone) {
      return "Includes drone kit";
    }
  }
  return "";
};

const buildDefaultRecipients = (
  project: ProjectLikeRecord,
  crew: CallSheetCrewMember[],
  staffOptions: StaffOptionLike[]
): RecipientEntry[] => {
  const recipients = new Map<string, RecipientEntry>();

  const addRecipient = (email?: string | null, name?: string | null) => {
    if (!email || typeof email !== "string") return;
    const trimmed = email.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (recipients.has(key)) return;
    recipients.set(key, {
      id: key,
      email: trimmed,
      name: name || undefined,
      include: true,
    });
  };

  crew.forEach((member) => addRecipient(member.email, member.name));

  const teamInputs = Array.isArray(project.projectTeam)
    ? project.projectTeam
    : Array.isArray(project.teamMembers)
    ? project.teamMembers
    : [];
  teamInputs.forEach((entry: any) => {
    if (!entry || typeof entry !== "object") return;
    addRecipient((entry.email as string) || (entry.contactEmail as string), (entry.name as string) || (entry.displayName as string));
  });

  addRecipient(project.userEmail, project.userName || undefined);
  addRecipient(project.clientContactEmail, project.clientContactName || undefined);

  if (project.ownerUid) {
    const owner = staffOptions.find((member) => member.uid === project.ownerUid);
    addRecipient(owner?.email, owner?.label || undefined);
  } else if (project.ownerEmail) {
    addRecipient(project.ownerEmail, project.ownerName || undefined);
  }

  if (project.franchiseAssignedUser?.email) {
    addRecipient(project.franchiseAssignedUser.email, project.franchiseAssignedUser.displayName || undefined);
  }

  return Array.from(recipients.values());
};

const buildDefaultSheet = (
  project: ProjectLikeRecord,
  kitSummary: KitSummary | null | undefined,
  bookings: ProjectBookingRecordLike[] | undefined,
  staffOptions: StaffOptionLike[]
): CallSheetFormState => {
  const schedule = resolveScheduleFromBookings(bookings);
  const crew = resolveCrew(project, staffOptions);
  const { callTime, wrapTime } = resolveCallAndWrapTimes(project, schedule);
  const shootDate = toIsoDate(
    toDate(project.filmingDueDate) || toDate(project.dueDate) || toDate(project.kickoffDate)
  );

  const sheet: CallSheetData = {
    title: project.title || project.name || project.serviceName || "Call Sheet",
    projectOverview: resolveOverview(project),
    location: resolveLocationString(project),
    shootDate,
    callTime,
    wrapTime,
    kitNotes: resolveKitNotes(project, kitSummary),
    schedule: schedule.length > 0 ? schedule : [{ heading: "Arrival", notes: "Confirm call time" }],
    shots: resolveShotList(project),
    crew,
    clientContact: resolveClientContact(project),
    additionalNotes: project.locationNotes || project.callSheetNotes || "",
  };

  const recipients = buildDefaultRecipients(project, crew, staffOptions);
  const defaultMessage = `Hi team,\n\nPlease find the call sheet for ${sheet.title} attached. Let me know if you have any questions.\n\nThanks,`;

  return { ...sheet, recipients, message: defaultMessage };
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      } else {
        reject(new Error("Unexpected FileReader result"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80) || "call-sheet";
};

export default function CallSheetBuilder({ project, kitSummary, bookings, staffOptions, onClose }: CallSheetBuilderProps) {
  const seed = useMemo(
    () => buildDefaultSheet(project, kitSummary || null, bookings, staffOptions),
    [project, kitSummary, bookings, staffOptions]
  );
  const [form, setForm] = useState<CallSheetFormState>(seed);
  const [newRecipient, setNewRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  useEffect(() => {
    setForm(seed);
    setSendSuccess(false);
    setNewRecipient("");
  }, [seed]);

  const updateScheduleItem = (index: number, field: keyof CallSheetScheduleItem, value: string) => {
    setForm((prev) => {
      const schedule = [...prev.schedule];
      schedule[index] = { ...schedule[index], [field]: value };
      return { ...prev, schedule };
    });
  };

  const updateShotItem = (index: number, field: keyof CallSheetShotItem, value: string) => {
    setForm((prev) => {
      const shots = [...prev.shots];
      shots[index] = { ...shots[index], [field]: value };
      return { ...prev, shots };
    });
  };

  const updateCrewMember = (index: number, field: keyof CallSheetCrewMember, value: string) => {
    setForm((prev) => {
      const crew = [...prev.crew];
      crew[index] = { ...crew[index], [field]: value };
      return { ...prev, crew };
    });
  };

  const toggleRecipient = (id: string, include: boolean) => {
    setForm((prev) => ({
      ...prev,
      recipients: prev.recipients.map((recipient) =>
        recipient.id === id ? { ...recipient, include } : recipient
      ),
    }));
  };

  const addRecipient = () => {
    const trimmed = newRecipient.trim();
    if (!trimmed) return;
    const id = trimmed.toLowerCase();
    setForm((prev) => {
      if (prev.recipients.some((recipient) => recipient.id === id)) {
        return {
          ...prev,
          recipients: prev.recipients.map((recipient) =>
            recipient.id === id ? { ...recipient, include: true } : recipient
          ),
        };
      }
      return {
        ...prev,
        recipients: [...prev.recipients, { id, email: trimmed, include: true }],
      };
    });
    setNewRecipient("");
  };

  const removeScheduleItem = (index: number) => {
    setForm((prev) => ({ ...prev, schedule: prev.schedule.filter((_, i) => i !== index) }));
  };

  const removeShotItem = (index: number) => {
    setForm((prev) => ({ ...prev, shots: prev.shots.filter((_, i) => i !== index) }));
  };

  const removeCrewMember = (index: number) => {
    setForm((prev) => ({ ...prev, crew: prev.crew.filter((_, i) => i !== index) }));
  };

  const handleSend = async () => {
    const recipients = form.recipients.filter((recipient) => recipient.include).map((recipient) => recipient.email);
    if (recipients.length === 0) {
      alert("Select at least one recipient before sending the call sheet.");
      return;
    }
    setSending(true);
    setSendSuccess(false);
    try {
      await ensureFirebase();
      const { functions } = await ensureFirebase();
      if (!functions) throw new Error("Firebase functions are unavailable");
      const { httpsCallable } = await import("firebase/functions");
      const call = httpsCallable(functions, "emails_send");
      const doc = <CallSheetPDF sheet={form} />;
      const blob = await pdf(doc).toBlob();
      const base64 = await blobToBase64(blob);
      const subject = `Call sheet – ${form.title || project.title || project.name || "Project"}`;
      const body = form.message || `Call sheet for ${form.title || project.title || project.name || "the project"}`;
      const filename = `${slugify(form.title || project.title || project.name || "call-sheet")}.pdf`;
      await call({
        projectId: project.id,
        to: recipients.join(","),
        subject,
        body,
        attachments: [
          {
            filename,
            contentType: "application/pdf",
            content: base64,
          },
        ],
      });
      setSendSuccess(true);
    } catch (err) {
      console.error("Failed to send call sheet", err);
      alert(err instanceof Error ? err.message : "Failed to send call sheet");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <section
        className="relative z-50 ml-auto flex h-full w-full max-w-4xl flex-col bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">Call sheet builder</h2>
            <p className="text-sm text-gray-500">Prefill the call sheet and share it with the project crew.</p>
          </div>
          <button type="button" className="btn btn-sm btn-outline" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-6 pb-8">
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-gray-700">Project overview</h3>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium uppercase text-gray-500">Title</span>
                  <input
                    className="input"
                    value={form.title}
                    onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium uppercase text-gray-500">Shoot date</span>
                  <input
                    type="date"
                    className="input"
                    value={form.shootDate || ""}
                    onChange={(event) => setForm((prev) => ({ ...prev, shootDate: event.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium uppercase text-gray-500">Call time</span>
                  <input
                    className="input"
                    value={form.callTime || ""}
                    placeholder="07:30"
                    onChange={(event) => setForm((prev) => ({ ...prev, callTime: event.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium uppercase text-gray-500">Wrap time</span>
                  <input
                    className="input"
                    value={form.wrapTime || ""}
                    placeholder="18:00"
                    onChange={(event) => setForm((prev) => ({ ...prev, wrapTime: event.target.value }))}
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase text-gray-500">Location</span>
                <input
                  className="input"
                  value={form.location || ""}
                  placeholder="Venue name, address, postcode"
                  onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase text-gray-500">Project overview</span>
                <textarea
                  className="input"
                  rows={4}
                  value={form.projectOverview || ""}
                  onChange={(event) => setForm((prev) => ({ ...prev, projectOverview: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase text-gray-500">Kit notes</span>
                <textarea
                  className="input"
                  rows={3}
                  value={form.kitNotes || ""}
                  placeholder="Summary of equipment, logistics, or access requirements"
                  onChange={(event) => setForm((prev) => ({ ...prev, kitNotes: event.target.value }))}
                />
              </label>
            </section>

            <section className="grid gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Schedule</h3>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      schedule: [...prev.schedule, { heading: "New activity", time: "", owner: "", notes: "" }],
                    }))
                  }
                >
                  Add slot
                </button>
              </div>
              {form.schedule.length === 0 ? (
                <p className="text-xs text-gray-500">Add each key milestone or arrival time for the shoot day.</p>
              ) : (
                <div className="grid gap-3">
                  {form.schedule.map((item, index) => (
                    <div key={index} className="grid gap-2 rounded border border-gray-200 p-3">
                      <div className="grid gap-2 sm:grid-cols-4 sm:gap-3">
                        <input
                          className="input"
                          placeholder="08:00"
                          value={item.time || ""}
                          onChange={(event) => updateScheduleItem(index, "time", event.target.value)}
                        />
                        <input
                          className="input sm:col-span-2"
                          placeholder="Activity"
                          value={item.heading}
                          onChange={(event) => updateScheduleItem(index, "heading", event.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="Owner / lead"
                          value={item.owner || ""}
                          onChange={(event) => updateScheduleItem(index, "owner", event.target.value)}
                        />
                      </div>
                      <textarea
                        className="input"
                        rows={2}
                        placeholder="Notes"
                        value={item.notes || ""}
                        onChange={(event) => updateScheduleItem(index, "notes", event.target.value)}
                      />
                      <div className="flex justify-end">
                        <button type="button" className="btn btn-xs btn-outline" onClick={() => removeScheduleItem(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Key shots</h3>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      shots: [...prev.shots, { name: "Shot" }],
                    }))
                  }
                >
                  Add shot
                </button>
              </div>
              {form.shots.length === 0 ? (
                <p className="text-xs text-gray-500">List the must-capture shots or scenes for the crew.</p>
              ) : (
                <div className="grid gap-3">
                  {form.shots.map((shot, index) => (
                    <div key={index} className="grid gap-2 rounded border border-gray-200 p-3">
                      <input
                        className="input"
                        placeholder={`Shot #${index + 1}`}
                        value={shot.name}
                        onChange={(event) => updateShotItem(index, "name", event.target.value)}
                      />
                      <textarea
                        className="input"
                        rows={2}
                        placeholder="Notes or references"
                        value={shot.notes || ""}
                        onChange={(event) => updateShotItem(index, "notes", event.target.value)}
                      />
                      <div className="flex justify-end">
                        <button type="button" className="btn btn-xs btn-outline" onClick={() => removeShotItem(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Crew</h3>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      crew: [...prev.crew, { name: "Crew member", role: "", email: "", phone: "" }],
                    }))
                  }
                >
                  Add crew member
                </button>
              </div>
              {form.crew.length === 0 ? (
                <p className="text-xs text-gray-500">Capture every crew member, their role, and how to reach them on the day.</p>
              ) : (
                <div className="grid gap-3">
                  {form.crew.map((member, index) => (
                    <div key={index} className="grid gap-2 rounded border border-gray-200 p-3">
                      <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <input
                          className="input"
                          placeholder="Name"
                          value={member.name}
                          onChange={(event) => updateCrewMember(index, "name", event.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="Role"
                          value={member.role || ""}
                          onChange={(event) => updateCrewMember(index, "role", event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <input
                          className="input"
                          placeholder="Email"
                          value={member.email || ""}
                          onChange={(event) => updateCrewMember(index, "email", event.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="Phone"
                          value={member.phone || ""}
                          onChange={(event) => updateCrewMember(index, "phone", event.target.value)}
                        />
                      </div>
                      {member.notes !== undefined ? (
                        <textarea
                          className="input"
                          rows={2}
                          placeholder="Notes"
                          value={member.notes || ""}
                          onChange={(event) => updateCrewMember(index, "notes", event.target.value)}
                        />
                      ) : null}
                      <div className="flex justify-end">
                        <button type="button" className="btn btn-xs btn-outline" onClick={() => removeCrewMember(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-gray-700">Client contact & notes</h3>
              <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
                <input
                  className="input"
                  placeholder="Client name"
                  value={form.clientContact?.name || ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      clientContact: { ...prev.clientContact, name: event.target.value },
                    }))
                  }
                />
                <input
                  className="input"
                  placeholder="Client email"
                  value={form.clientContact?.email || ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      clientContact: { ...prev.clientContact, email: event.target.value },
                    }))
                  }
                />
                <input
                  className="input"
                  placeholder="Client phone"
                  value={form.clientContact?.phone || ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      clientContact: { ...prev.clientContact, phone: event.target.value },
                    }))
                  }
                />
              </div>
              <textarea
                className="input"
                rows={3}
                placeholder="Notes for the crew"
                value={form.additionalNotes || ""}
                onChange={(event) => setForm((prev) => ({ ...prev, additionalNotes: event.target.value }))}
              />
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-gray-700">Send to crew</h3>
              <p className="text-xs text-gray-500">
                Select who should receive the call sheet PDF. You can add extra recipients before sending.
              </p>
              <div className="grid gap-2">
                {form.recipients.length === 0 ? (
                  <p className="text-xs text-gray-500">No crew email addresses detected yet. Add recipients below.</p>
                ) : (
                  form.recipients.map((recipient) => (
                    <label key={recipient.id} className="flex items-center justify-between gap-4 rounded border border-gray-200 p-3">
                      <span className="text-sm">
                        <span className="font-medium">{recipient.name || recipient.email}</span>
                        <span className="block text-xs text-gray-500">{recipient.email}</span>
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={recipient.include}
                        onChange={(event) => toggleRecipient(recipient.id, event.target.checked)}
                      />
                    </label>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Add recipient email"
                  value={newRecipient}
                  onChange={(event) => setNewRecipient(event.target.value)}
                />
                <button type="button" className="btn btn-sm" onClick={addRecipient}>
                  Add
                </button>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase text-gray-500">Email message</span>
                <textarea
                  className="input"
                  rows={4}
                  value={form.message}
                  onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
                />
              </label>
              {sendSuccess ? (
                <p className="text-xs font-semibold text-green-600">Call sheet sent to selected crew.</p>
              ) : null}
            </section>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <PDFDownloadLink document={<CallSheetPDF sheet={form} />} fileName={`${slugify(form.title)}.pdf`}>
            {({ loading }) => (
              <button type="button" className="btn btn-outline btn-sm" disabled={loading}>
                {loading ? "Preparing…" : "Download PDF"}
              </button>
            )}
          </PDFDownloadLink>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm" onClick={handleSend} disabled={sending}>
              {sending ? "Sending…" : "Send to crew"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
