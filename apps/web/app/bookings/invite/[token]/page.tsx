"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import PortalContainer from "@/components/PortalContainer";
import { ensureFirebase, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";

interface InvitePayload {
  token: string;
  projectId: string;
  bookingId: string;
  email: string | null;
  organisation: string | null;
  contactName: string | null;
  contactEmail: string | null;
  status: string | null;
  respondedAt: Date | null;
}

interface ProjectPayload {
  id: string;
  title: string | null;
  franchiseId: string | null;
  franchiseName: string | null;
  orgId: string | null;
  orgName: string | null;
}

interface BookingSlotPayload {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  notes: string;
  booked: number;
}

interface BookingFieldPayload {
  id: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
}

interface BookingUploadPayload {
  id: string;
  label: string;
  description: string;
  accept: string;
  required: boolean;
}

interface BookingAgreementPayload {
  heading: string;
  body: string;
  acknowledgementLabel: string;
  requireSignature: boolean;
}

interface BookingPayload {
  id: string;
  taskTitle: string;
  introduction: string;
  slots: BookingSlotPayload[];
  responseFields: BookingFieldPayload[];
  uploadRequirements: BookingUploadPayload[];
  agreement: BookingAgreementPayload;
}

interface InviteLookupResponse {
  invite: InvitePayload;
  project: ProjectPayload;
  booking: BookingPayload;
}

interface UploadReference {
  id: string;
  name: string;
  url: string;
  contentType: string | null;
}

const bookingSlotFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const parseIsoDate = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatSlotWindow = (slot: BookingSlotPayload): string => {
  const start = parseIsoDate(slot.startAt);
  const end = parseIsoDate(slot.endAt);
  if (start && end) {
    return `${bookingSlotFormatter.format(start)} – ${bookingSlotFormatter.format(end)}`;
  }
  if (start) {
    return `${bookingSlotFormatter.format(start)} onwards`;
  }
  if (end) {
    return `Ends ${bookingSlotFormatter.format(end)}`;
  }
  return slot.label;
};

const createResponseId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `resp_${Math.random().toString(36).slice(2, 10)}`;
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

const normaliseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const record = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof record.toDate === "function") {
      try {
        return record.toDate();
      } catch {
        // fall through
      }
    }
    if (typeof record.seconds === "number") {
      const millis = record.seconds * 1000 + Math.floor((record.nanoseconds ?? 0) / 1_000_000);
      return new Date(millis);
    }
  }
  return null;
};

export default function BookingInviteAcceptancePage({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [booking, setBooking] = useState<BookingPayload | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [organisation, setOrganisation] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [contactEmail, setContactEmail] = useState<string>("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, File | null>>({});
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const callable = httpsCallable(functions, "projectBookings_getInvite");
        const result = await callable({ token: params.token });
        if (!active) return;
        const data = (result?.data as InviteLookupResponse) || ({} as InviteLookupResponse);
        if (!data.invite || !data.booking) {
          throw new Error("Invite not found");
        }
        setInvite({
          ...data.invite,
          email: data.invite.email ?? null,
          organisation: data.invite.organisation ?? null,
          contactName: data.invite.contactName ?? null,
          contactEmail: data.invite.contactEmail ?? null,
          status: data.invite.status ?? null,
          respondedAt: normaliseDate((data.invite as unknown as Record<string, unknown>).respondedAt),
        });
        setProject(data.project ?? null);
        setBooking(data.booking);
        setOrganisation(data.invite.organisation ?? "");
        setContactName(data.invite.contactName ?? "");
        setContactEmail(data.invite.contactEmail ?? data.invite.email ?? "");
      } catch (err) {
        console.error("Failed to load invite details", err);
        if (active) {
          setError("We couldn't find this invitation. Please contact your Pineapple Tapped producer for assistance.");
          setInvite(null);
          setBooking(null);
          setProject(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [params.token]);

  useEffect(() => {
    if (!booking) {
      setResponses({});
      setUploads({});
      setSelectedSlot("");
      return;
    }
    const answerDefaults: Record<string, string> = {};
    booking.responseFields.forEach((field) => {
      answerDefaults[field.id] = "";
    });
    setResponses(answerDefaults);

    const uploadDefaults: Record<string, File | null> = {};
    booking.uploadRequirements.forEach((req) => {
      uploadDefaults[req.id] = null;
    });
    setUploads(uploadDefaults);

    const firstAvailable = booking.slots.find((slot) => slot.capacity - slot.booked > 0);
    if (firstAvailable) {
      setSelectedSlot(firstAvailable.id);
    } else if (booking.slots.length > 0) {
      setSelectedSlot(booking.slots[0].id);
    }
  }, [booking]);

  const slotOptions = useMemo(() => {
    if (!booking) return [];
    return booking.slots.map((slot) => {
      const remaining = Math.max(0, slot.capacity - slot.booked);
      return {
        id: slot.id,
        display: formatSlotWindow(slot),
        capacity: slot.capacity,
        remaining,
        disabled: remaining <= 0,
      };
    });
  }, [booking]);

  const handleResponseChange = (fieldId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleUploadChange = (fieldId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
    setUploads((prev) => ({ ...prev, [fieldId]: file }));
  };

  const disableForm = submitSuccess || invite?.status?.toLowerCase() === "responded" || invite?.status?.toLowerCase() === "completed";

  const handleSubmit = async () => {
    if (!invite || !booking) return;
    setSubmitError(null);

    const problems: string[] = [];
    const slotRecord = booking.slots.find((slot) => slot.id === selectedSlot);
    if (!slotRecord) {
      problems.push("Please choose an available slot.");
    } else if (slotRecord.capacity - slotRecord.booked <= 0) {
      problems.push("The selected slot is already full. Please choose another.");
    }

    if (!contactName.trim()) {
      problems.push("Enter the primary contact name.");
    }
    if (!contactEmail.trim() || !EMAIL_PATTERN.test(contactEmail.trim())) {
      problems.push("Enter a valid contact email address.");
    }

    booking.responseFields.forEach((field) => {
      if (field.required && !responses[field.id]?.trim()) {
        problems.push(`Please complete the “${field.label}” field.`);
      }
    });

    booking.uploadRequirements.forEach((req) => {
      if (req.required && !uploads[req.id]) {
        problems.push(`Please upload a file for “${req.label}”.`);
      }
    });

    if (!agreementAccepted) {
      problems.push("Please confirm you agree to the participation terms.");
    }
    if (booking.agreement.requireSignature && !signatureName.trim()) {
      problems.push("Type your name to sign the agreement.");
    }

    if (problems.length > 0) {
      setSubmitError(problems.join(" "));
      return;
    }

    setSubmitting(true);

    try {
      const responseId = createResponseId();
      let uploadedFiles: UploadReference[] = [];
      const uploadEntries = Object.entries(uploads).filter(([, file]) => Boolean(file));
      if (uploadEntries.length > 0) {
        const { storage } = await ensureFirebase();
        const storageMod = await import("firebase/storage");
        uploadedFiles = (
          await Promise.all(
            uploadEntries.map(async ([fieldId, file]) => {
              if (!file) return null;
              const safeName = file.name.replace(/[^a-z0-9_.-]+/gi, "-");
              const path = `projectBookings/${invite.projectId}/${booking.id}/responses/${responseId}/${fieldId}-${safeName}`;
              const ref = storageMod.ref(storage, path);
              await storageMod.uploadBytes(ref, file, { contentType: file.type || undefined });
              const url = await storageMod.getDownloadURL(ref);
              return {
                id: fieldId,
                name: file.name,
                url,
                contentType: file.type || null,
              } satisfies UploadReference;
            }),
          )
        ).filter((item): item is UploadReference => Boolean(item));
      }

      const callable = httpsCallable(functions, "projectBookings_acceptInvite");
      await callable({
        token: invite.token,
        slotId: selectedSlot,
        organisation,
        contactName,
        contactEmail,
        answers: responses,
        uploads: uploadedFiles,
        agreementAccepted: true,
        signatureName: booking.agreement.requireSignature ? signatureName : null,
        responseId,
      });

      setSubmitSuccess(true);
      setInvite((prev) => (prev ? { ...prev, status: "responded", respondedAt: new Date() } : prev));
    } catch (err) {
      console.error("Failed to submit booking response", err);
      setSubmitError(
        err instanceof Error
          ? err.message
          : "We couldn't confirm your slot just now. Please try again or contact your producer."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalContainer>
      <div className="mx-auto max-w-3xl space-y-6 py-10">
        <header className="space-y-2 text-center">
          <p className="text-sm uppercase tracking-wide text-gray-500">Project booking</p>
          <h1 className="text-2xl font-semibold text-gray-900">
            {project?.title || booking?.taskTitle || "Confirm your filming session"}
          </h1>
          {booking?.introduction ? (
            <p className="text-base text-gray-600">{booking.introduction}</p>
          ) : null}
        </header>

        {loading ? (
          <p className="text-center text-sm text-gray-600">Loading invitation…</p>
        ) : error ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : !invite || !booking ? (
          <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            This invitation is unavailable. Please reach out to your Pineapple Tapped contact to request a new link.
          </div>
        ) : (
          <div className="space-y-6">
            {disableForm ? (
              <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                Thank you! Your booking details have already been received.
              </div>
            ) : null}

            <section className="space-y-4 rounded border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Your details</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-sm font-medium text-gray-700">Organisation</span>
                  <input
                    type="text"
                    value={organisation}
                    onChange={(e) => setOrganisation(e.target.value)}
                    className="input"
                    disabled={disableForm}
                    placeholder="Business or organisation name"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium text-gray-700">Contact name *</span>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="input"
                    disabled={disableForm}
                    placeholder="Primary contact"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium text-gray-700">Contact email *</span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="input"
                    disabled={disableForm}
                    placeholder="name@example.com"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium text-gray-700">Preferred slot *</span>
                  <select
                    value={selectedSlot}
                    onChange={(e) => setSelectedSlot(e.target.value)}
                    className="input"
                    disabled={disableForm || slotOptions.length === 0}
                  >
                    {slotOptions.length === 0 ? <option value="">No sessions available</option> : null}
                    {slotOptions.map((option) => (
                      <option key={option.id} value={option.id} disabled={option.disabled}>
                        {option.display} · {option.remaining} of {option.capacity} available
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            {booking.responseFields.length > 0 ? (
              <section className="space-y-4 rounded border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Additional information</h2>
                <div className="grid gap-4">
                  {booking.responseFields.map((field) => {
                    const commonProps = {
                      id: field.id,
                      value: responses[field.id] ?? "",
                      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                        handleResponseChange(field.id, e.target.value),
                      placeholder: field.placeholder,
                      className: "input",
                      disabled: disableForm,
                    };
                    if (field.type === "textarea") {
                      return (
                        <label key={field.id} className="grid gap-1">
                          <span className="text-sm font-medium text-gray-700">
                            {field.label}
                            {field.required ? <span className="text-red-500"> *</span> : null}
                          </span>
                          <textarea {...commonProps} className="input min-h-[120px]" />
                        </label>
                      );
                    }
                    const inputType =
                      field.type === "email"
                        ? "email"
                        : field.type === "phone"
                          ? "tel"
                          : field.type === "website"
                            ? "url"
                            : "text";
                    return (
                      <label key={field.id} className="grid gap-1">
                        <span className="text-sm font-medium text-gray-700">
                          {field.label}
                          {field.required ? <span className="text-red-500"> *</span> : null}
                        </span>
                        <input {...commonProps} type={inputType} />
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {booking.uploadRequirements.length > 0 ? (
              <section className="space-y-4 rounded border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Uploads</h2>
                <div className="grid gap-4">
                  {booking.uploadRequirements.map((req) => {
                    const file = uploads[req.id];
                    return (
                      <label key={req.id} className="grid gap-1">
                        <span className="text-sm font-medium text-gray-700">
                          {req.label}
                          {req.required ? <span className="text-red-500"> *</span> : null}
                        </span>
                        <input
                          type="file"
                          accept={req.accept || undefined}
                          onChange={(e) => handleUploadChange(req.id, e)}
                          disabled={disableForm}
                        />
                        {req.description ? (
                          <span className="text-xs text-gray-500">{req.description}</span>
                        ) : null}
                        {file ? <span className="text-xs text-gray-500">{file.name}</span> : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="space-y-3 rounded border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Agreement</h2>
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">{booking.agreement.heading}</h3>
                  {booking.agreement.body ? (
                    <div className="prose prose-sm mt-2 max-w-none whitespace-pre-wrap text-gray-700">
                      {booking.agreement.body}
                    </div>
                  ) : null}
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={agreementAccepted}
                    onChange={(e) => setAgreementAccepted(e.target.checked)}
                    disabled={disableForm}
                  />
                  <span>{booking.agreement.acknowledgementLabel}</span>
                </label>
                {booking.agreement.requireSignature ? (
                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-gray-700">Type your name to sign *</span>
                    <input
                      type="text"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      className="input"
                      disabled={disableForm}
                      placeholder="Full name"
                    />
                  </label>
                ) : null}
              </div>
            </section>

            {submitError ? (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={disableForm || submitting}
                className="inline-flex items-center justify-center rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Submitting…" : submitSuccess ? "Submitted" : "Confirm booking"}
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
