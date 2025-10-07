
"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Timestamp,
  Unsubscribe,
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import PortalHero from "@/components/PortalHero";
import { ensureFirebase } from "@/lib/firebase";

type ScenarioDefaults = {
  id: string;
  label: string;
  description: string;
  defaultSubject: string;
  defaultPreviewText?: string;
  defaultBody: string;
  defaultFromName: string;
  defaultFromEmail: string;
  defaultReplyTo?: string;
};

type ScenarioOverride = {
  subject?: string | null;
  previewText?: string | null;
  body?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  sendFromAccountId?: string | null;
  scenarioLabel?: string | null;
  scenarioDescription?: string | null;
  updatedAt?: Timestamp | Date | null;
  updatedBy?: string | null;
  updatedByEmail?: string | null;
  updatedByName?: string | null;
};

interface ScenarioRecord extends ScenarioDefaults {
  activeSubject: string;
  activePreviewText: string;
  activeBody: string;
  activeFromName: string;
  activeFromEmail: string;
  activeReplyTo: string;
  sendFromAccountId: string | null;
  overrideSubject: string | null;
  overridePreviewText: string | null;
  overrideBody: string | null;
  overrideFromName: string | null;
  overrideFromEmail: string | null;
  overrideReplyTo: string | null;
  lastUpdated: Timestamp | Date | null;
  lastUpdatedBy: string | null;
  lastUpdatedByEmail: string | null;
  lastUpdatedByName: string | null;
}

interface TemplateFormState {
  subject: string;
  previewText: string;
  body: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  sendFromAccountId: string;
}

interface EmailSenderRecord {
  id: string;
  provider: string;
  email: string;
  displayName: string;
  status: string;
  sendAs?: string | null;
  inboxLabel?: string | null;
  requestedAt: Timestamp | Date | null;
  connectedAt: Timestamp | Date | null;
  lastSyncedAt: Timestamp | Date | null;
  error?: string | null;
}

interface GlobalEmailSettings {
  defaultSenderId: string | null;
  fallbackFromName?: string | null;
  fallbackFromEmail?: string | null;
  supportContact?: string | null;
  updatedAt?: Timestamp | Date | null;
  updatedByName?: string | null;
  updatedByEmail?: string | null;
}

interface InboxMessageRecord {
  id: string;
  subject: string;
  from: string;
  to: string[];
  snippet: string;
  receivedAt: Date | null;
  accountId: string | null;
  threadId?: string | null;
  unread: boolean;
  labels: string[];
}

const DEFAULT_SCENARIOS: ScenarioDefaults[] = [
  {
    id: "new-account",
    label: "New account welcome",
    description:
      "Greets a brand-new user after their portal profile is created and shares onboarding resources.",
    defaultSubject: "Welcome to Pineapple Tapped",
    defaultPreviewText: "Everything you need to get started is inside the portal.",
    defaultBody: `Hi {{firstName}},

We're thrilled to welcome you to Pineapple Tapped. Your new portal account is ready – log in to review onboarding checklists, past orders, and the tools available to your team.

If you have any questions, simply reply to this email and we'll help right away.

Cheers,
The Pineapple Tapped crew`,
    defaultFromName: "Pineapple Tapped Team",
    defaultFromEmail: "hello@pineappletapped.com",
    defaultReplyTo: "support@pineappletapped.com",
  },
  {
    id: "new-order",
    label: "New order confirmation",
    description:
      "Sent when a client places a fresh order so they immediately receive a receipt and next steps.",
    defaultSubject: "We've received your order {{orderNumber}}",
    defaultPreviewText: "Here is what happens next with your Pineapple Tapped project.",
    defaultBody: `Hi {{firstName}},

Thanks for placing order {{orderNumber}}. Our production team has started preparing everything and you'll see the timeline update in your portal shortly.

We'll reach out if we need anything else. Otherwise, expect another email when assets are ready for review.

Warm regards,
Pineapple Tapped Operations`,
    defaultFromName: "Pineapple Tapped Operations",
    defaultFromEmail: "operations@pineappletapped.com",
    defaultReplyTo: "projects@pineappletapped.com",
  },
  {
    id: "project-ready",
    label: "Project ready for review",
    description:
      "Alerts stakeholders that a deliverable has been uploaded and is awaiting approval inside the portal.",
    defaultSubject: "Your project {{projectName}} is ready to review",
    defaultPreviewText: "Log in to approve, request changes, or share feedback with the team.",
    defaultBody: `Hello {{firstName}},

Great news – {{projectName}} is ready for your review. Visit the portal to preview files, leave feedback, and let us know when it's approved to release.

Need help? Reply to this email or message us through the portal.

Thanks again,
Pineapple Tapped Production`,
    defaultFromName: "Pineapple Tapped Production",
    defaultFromEmail: "production@pineappletapped.com",
    defaultReplyTo: "projects@pineappletapped.com",
  },
  {
    id: "affiliate-sale",
    label: "Affiliate sale notification",
    description:
      "Lets affiliates know when a referral converts so they can celebrate and track payouts.",
    defaultSubject: "You earned a commission from {{clientName}}",
    defaultPreviewText: "Here are the details of the latest sale attributed to your link.",
    defaultBody: `Hi {{firstName}},

Congrats! {{clientName}} has just completed a purchase through your affiliate link. The order total was {{orderTotal}} and your estimated payout is {{commissionAmount}}.

We'll include the sale in your next affiliate statement automatically.

Keep up the great work,
Pineapple Tapped Partnerships`,
    defaultFromName: "Pineapple Tapped Partnerships",
    defaultFromEmail: "affiliates@pineappletapped.com",
    defaultReplyTo: "partners@pineappletapped.com",
  },
  {
    id: "invoice-issued",
    label: "Invoice issued",
    description:
      "Sends a copy of a freshly raised invoice including payment terms and online payment options.",
    defaultSubject: "Invoice {{invoiceNumber}} from Pineapple Tapped",
    defaultPreviewText: "Securely pay online or review the schedule agreed with our team.",
    defaultBody: `Hi {{firstName}},

We've attached invoice {{invoiceNumber}} for {{projectName}}. You can pay online using the link in your portal or follow the scheduled instalments if we agreed split payments.

Let us know if anything looks incorrect – we're happy to help.

Thanks,
Pineapple Tapped Finance`,
    defaultFromName: "Pineapple Tapped Finance",
    defaultFromEmail: "finance@pineappletapped.com",
    defaultReplyTo: "accounts@pineappletapped.com",
  },
  {
    id: "payment-reminder",
    label: "Payment reminder",
    description:
      "Nudges clients a few days before or after a due date with a friendly reminder and helpful links.",
    defaultSubject: "Reminder: payment for {{invoiceNumber}}",
    defaultPreviewText: "You can settle the balance securely via the Pineapple Tapped portal.",
    defaultBody: `Hello {{firstName}},

This is a quick reminder that invoice {{invoiceNumber}} is due on {{dueDate}}. You can complete payment online from the portal or let us know if you need an updated schedule.

If payment has already been made, thank you – no action is needed.

All the best,
Pineapple Tapped Finance`,
    defaultFromName: "Pineapple Tapped Finance",
    defaultFromEmail: "finance@pineappletapped.com",
    defaultReplyTo: "accounts@pineappletapped.com",
  },
  {
    id: "project-complete",
    label: "Project completion",
    description:
      "Wraps up projects with a thank you note, final links, and suggestions for the client's next steps.",
    defaultSubject: "{{projectName}} is wrapped!",
    defaultPreviewText: "Here are your final deliverables and recommendations for what's next.",
    defaultBody: `Hi {{firstName}},

Thanks for collaborating with us on {{projectName}}. The project is now complete and your final deliverables are available in the portal for download anytime.

We'd love to know how everything went and support your next campaign when you're ready.

Warm wishes,
Pineapple Tapped Team`,
    defaultFromName: "Pineapple Tapped Team",
    defaultFromEmail: "hello@pineappletapped.com",
    defaultReplyTo: "support@pineappletapped.com",
  },
  {
    id: "weekly-digest",
    label: "Weekly activity digest",
    description:
      "Summarises portal activity, open tasks, and fresh leads so franchises stay informed.",
    defaultSubject: "Your Pineapple Tapped weekly recap",
    defaultPreviewText: "Highlights from the past 7 days plus what's coming up next week.",
    defaultBody: `Hi {{firstName}},

Here's your weekly Pineapple Tapped digest. Inside you'll find new leads, project milestones, and upcoming deadlines so nothing slips through the cracks.

Jump into the portal to action the recommended next steps or reassign tasks if you're away.

Have a brilliant week!
Pineapple Tapped`,
    defaultFromName: "Pineapple Tapped",
    defaultFromEmail: "hello@pineappletapped.com",
    defaultReplyTo: "support@pineappletapped.com",
  },
];

const DEFAULT_SCENARIO_IDS = new Set(DEFAULT_SCENARIOS.map((scenario) => scenario.id));

const PLACEHOLDER_TOKENS = [
  "{{firstName}}",
  "{{lastName}}",
  "{{orderNumber}}",
  "{{projectName}}",
  "{{invoiceNumber}}",
  "{{dueDate}}",
  "{{clientName}}",
  "{{commissionAmount}}",
  "{{orderTotal}}",
];

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function hydrateScenario(
  defaults: ScenarioDefaults,
  override?: ScenarioOverride
): ScenarioRecord {
  const overrideSubject = (override?.subject ?? undefined) ?? null;
  const overridePreview = (override?.previewText ?? undefined) ?? null;
  const overrideBody = (override?.body ?? undefined) ?? null;
  const overrideFromName = (override?.fromName ?? undefined) ?? null;
  const overrideFromEmail = (override?.fromEmail ?? undefined) ?? null;
  const overrideReplyTo = (override?.replyTo ?? undefined) ?? null;

  const activeSubject = overrideSubject ?? defaults.defaultSubject;
  const activePreviewText = overridePreview ?? defaults.defaultPreviewText ?? "";
  const activeBody = overrideBody ?? defaults.defaultBody;
  const activeFromName = overrideFromName ?? defaults.defaultFromName;
  const activeFromEmail = overrideFromEmail ?? defaults.defaultFromEmail;
  const activeReplyTo = overrideReplyTo ?? defaults.defaultReplyTo ?? "";

  return {
    ...defaults,
    activeSubject,
    activePreviewText,
    activeBody,
    activeFromName,
    activeFromEmail,
    activeReplyTo,
    sendFromAccountId: override?.sendFromAccountId ?? null,
    overrideSubject,
    overridePreviewText: overridePreview,
    overrideBody,
    overrideFromName,
    overrideFromEmail,
    overrideReplyTo,
    lastUpdated: override?.updatedAt ?? null,
    lastUpdatedBy: override?.updatedBy ?? null,
    lastUpdatedByEmail: override?.updatedByEmail ?? null,
    lastUpdatedByName: override?.updatedByName ?? null,
  };
}

function buildTemplateFormState(record: ScenarioRecord): TemplateFormState {
  return {
    subject: record.activeSubject,
    previewText: record.activePreviewText,
    body: record.activeBody,
    fromName: record.activeFromName,
    fromEmail: record.activeFromEmail,
    replyTo: record.activeReplyTo,
    sendFromAccountId: record.sendFromAccountId ?? "",
  };
}

function hasScenarioCustomisation(record: ScenarioRecord): boolean {
  if (record.overrideSubject && record.overrideSubject.trim() !== record.defaultSubject.trim()) {
    return true;
  }
  if (
    record.overridePreviewText &&
    (record.defaultPreviewText ?? "").trim() !== record.overridePreviewText.trim()
  ) {
    return true;
  }
  if (record.overrideBody && record.overrideBody.trim() !== record.defaultBody.trim()) {
    return true;
  }
  if (record.overrideFromName && record.overrideFromName.trim() !== record.defaultFromName.trim()) {
    return true;
  }
  if (
    record.overrideFromEmail && record.overrideFromEmail.trim() !== record.defaultFromEmail.trim()
  ) {
    return true;
  }
  if (
    record.overrideReplyTo &&
    (record.defaultReplyTo ?? "").trim() !== record.overrideReplyTo.trim()
  ) {
    return true;
  }
  if (record.sendFromAccountId) {
    return true;
  }
  return false;
}

function hasFormChanges(record: ScenarioRecord, form: TemplateFormState): boolean {
  return (
    record.activeSubject.trim() !== form.subject.trim() ||
    record.activePreviewText.trim() !== form.previewText.trim() ||
    record.activeBody.trim() !== form.body.trim() ||
    record.activeFromName.trim() !== form.fromName.trim() ||
    record.activeFromEmail.trim() !== form.fromEmail.trim() ||
    record.activeReplyTo.trim() !== form.replyTo.trim() ||
    (record.sendFromAccountId ?? "") !== (form.sendFromAccountId ?? "")
  );
}

function createCustomScenario(id: string, override: ScenarioOverride): ScenarioRecord {
  const label =
    override.scenarioLabel?.trim() ||
    override.updatedByName?.trim() ||
    id.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const description =
    override.scenarioDescription?.trim() ||
    "Custom automation email created directly in Firestore.";

  const defaults: ScenarioDefaults = {
    id,
    label,
    description,
    defaultSubject: override.subject?.trim() || "Custom email",
    defaultPreviewText: override.previewText?.trim() || "",
    defaultBody:
      override.body?.trim() ||
      `Hi {{firstName}},

This is a custom automation email. Update the body in the admin portal to keep everything in sync.

Thanks,
Pineapple Tapped`,
    defaultFromName: override.fromName?.trim() || "Pineapple Tapped",
    defaultFromEmail: override.fromEmail?.trim() || "hello@pineappletapped.com",
    defaultReplyTo: override.replyTo?.trim() || "support@pineappletapped.com",
  };

  return hydrateScenario(defaults, override);
}

function formatTimestamp(value: Timestamp | Date | null): string {
  const date = toDate(value ?? undefined);
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function EmailTemplatesWorkspace() {
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>(
    DEFAULT_SCENARIOS.map((defaults) => hydrateScenario(defaults))
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    DEFAULT_SCENARIOS[0]?.id ?? ""
  );
  const [formState, setFormState] = useState<TemplateFormState>(() =>
    buildTemplateFormState(hydrateScenario(DEFAULT_SCENARIOS[0]))
  );
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [senders, setSenders] = useState<EmailSenderRecord[]>([]);
  const [gmailAddress, setGmailAddress] = useState("");
  const [requestingConnection, setRequestingConnection] = useState(false);
  const [inboxMessages, setInboxMessages] = useState<InboxMessageRecord[]>([]);
  const [inboxFilter, setInboxFilter] = useState<string>("all");
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalEmailSettings | null>(null);
  const [globalForm, setGlobalForm] = useState({
    defaultSenderId: "",
    fallbackFromName: "",
    fallbackFromEmail: "",
    supportContact: "",
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [removingSenderId, setRemovingSenderId] = useState<string | null>(null);

  const dbRef = useRef<any>(null);
  const authUnsubscribeRef = useRef<() => void>();

  useEffect(() => {
    let mounted = true;
    let templatesUnsub: Unsubscribe | null = null;
    let sendersUnsub: Unsubscribe | null = null;
    let inboxUnsub: Unsubscribe | null = null;
    let settingsUnsub: Unsubscribe | null = null;

    ensureFirebase()
      .then(({ auth, db }) => {
        if (!mounted) return;
        dbRef.current = db;
        setCurrentUser(auth.currentUser);
        authUnsubscribeRef.current = auth.onAuthStateChanged((user: unknown) => {
          if (!mounted) return;
          setCurrentUser(user);
        });

        templatesUnsub = onSnapshot(
          collection(db, "emailTemplates"),
          (snapshot) => {
            const overrides = new Map<string, ScenarioOverride>();
            snapshot.forEach((docSnap) => {
              overrides.set(docSnap.id, docSnap.data() as ScenarioOverride);
            });

            const baseRecords = DEFAULT_SCENARIOS.map((defaults) =>
              hydrateScenario(defaults, overrides.get(defaults.id))
            ).sort((a, b) => a.label.localeCompare(b.label));

            const customRecords: ScenarioRecord[] = [];
            overrides.forEach((override, id) => {
              if (DEFAULT_SCENARIO_IDS.has(id)) return;
              customRecords.push(createCustomScenario(id, override));
            });
            customRecords.sort((a, b) => a.label.localeCompare(b.label));

            const nextScenarios = [...baseRecords, ...customRecords];
            setScenarios(nextScenarios);
            setSelectedScenarioId((current) => {
              if (current && nextScenarios.some((scenario) => scenario.id === current)) {
                return current;
              }
              return nextScenarios[0]?.id ?? "";
            });
            setLoading(false);
          },
          (error) => {
            console.error("Failed to load email templates", error);
            if (!mounted) return;
            setErrorMessage(
              "Unable to load email templates from Firestore. Check your security rules or network connection."
            );
            setLoading(false);
          }
        );

        sendersUnsub = onSnapshot(
          collection(db, "emailSenders"),
          (snapshot) => {
            const records: EmailSenderRecord[] = snapshot.docs
              .map((docSnap) => {
                const data = docSnap.data() as Record<string, any>;
                return {
                  id: docSnap.id,
                  provider: data.provider ?? "gmail",
                  email: data.email ?? "",
                  displayName: data.displayName ?? data.email ?? docSnap.id,
                  status: data.status ?? "pending",
                  sendAs: data.sendAs ?? null,
                  inboxLabel: data.inboxLabel ?? null,
                  requestedAt: toDate(data.requestedAt) ?? toDate(data.createdAt),
                  connectedAt: toDate(data.connectedAt) ?? toDate(data.authorisedAt),
                  lastSyncedAt: toDate(data.lastSyncedAt),
                  error: data.error ?? null,
                } as EmailSenderRecord;
              })
              .sort((a, b) => a.displayName.localeCompare(b.displayName));

            setSenders(records);
          },
          (error) => {
            console.error("Failed to load email senders", error);
          }
        );

        const inboxQuery = query(
          collection(db, "emailInbox"),
          orderBy("receivedAt", "desc"),
          limit(30)
        );

        inboxUnsub = onSnapshot(
          inboxQuery,
          (snapshot) => {
            const messages: InboxMessageRecord[] = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as Record<string, any>;
              return {
                id: docSnap.id,
                subject: data.subject ?? "(no subject)",
                from: data.from ?? "",
                to: Array.isArray(data.to) ? data.to : data.to ? [data.to] : [],
                snippet: data.snippet ?? data.preview ?? "",
                receivedAt: toDate(data.receivedAt),
                accountId: data.accountId ?? null,
                threadId: data.threadId ?? null,
                unread: Boolean(data.unread ?? false),
                labels: Array.isArray(data.labels) ? data.labels : [],
              };
            });
            setInboxMessages(messages);
            setInboxError(null);
          },
          (error) => {
            console.error("Failed to subscribe to email inbox", error);
            setInboxError(
              "Unable to load the shared inbox. Ensure the emailInbox collection exists and has an index on receivedAt."
            );
          }
        );

        settingsUnsub = onSnapshot(
          doc(db, "emailSettings", "global"),
          (snapshot) => {
            if (!snapshot.exists()) {
              setGlobalSettings(null);
              setGlobalForm({
                defaultSenderId: "",
                fallbackFromName: "",
                fallbackFromEmail: "",
                supportContact: "",
              });
              return;
            }
            const data = snapshot.data() as GlobalEmailSettings;
            setGlobalSettings(data);
            setGlobalForm({
              defaultSenderId: data.defaultSenderId ?? "",
              fallbackFromName: data.fallbackFromName ?? "",
              fallbackFromEmail: data.fallbackFromEmail ?? "",
              supportContact: data.supportContact ?? "",
            });
          },
          (error) => {
            console.error("Failed to load global email settings", error);
          }
        );
      })
      .catch((error) => {
        console.error("Email templates workspace initialisation failed", error);
        if (!mounted) return;
        setErrorMessage("We couldn't initialise Firebase. Refresh and try again.");
        setLoading(false);
      });

    return () => {
      mounted = false;
      templatesUnsub?.();
      sendersUnsub?.();
      inboxUnsub?.();
      settingsUnsub?.();
      authUnsubscribeRef.current?.();
    };
  }, []);

  const selectedScenario = useMemo(() => {
    return scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0] ?? null;
  }, [scenarios, selectedScenarioId]);

  useEffect(() => {
    if (!selectedScenario) return;
    setFormState(buildTemplateFormState(selectedScenario));
  }, [selectedScenario]);

  const customisedCount = useMemo(
    () => scenarios.filter((scenario) => hasScenarioCustomisation(scenario)).length,
    [scenarios]
  );

  const connectedSenders = useMemo(
    () => senders.filter((sender) => sender.status === "connected"),
    [senders]
  );

  useEffect(() => {
    if (!formState.sendFromAccountId) return;
    const senderExists = senders.some((sender) => sender.id === formState.sendFromAccountId);
    if (senderExists) return;
    setFormState((prev) => ({ ...prev, sendFromAccountId: "" }));
  }, [formState.sendFromAccountId, senders]);

  useEffect(() => {
    if (!globalForm.defaultSenderId) return;
    const senderExists = senders.some((sender) => sender.id === globalForm.defaultSenderId);
    if (senderExists) return;
    setGlobalForm((prev) => ({ ...prev, defaultSenderId: "" }));
  }, [globalForm.defaultSenderId, senders]);

  const inboxMessagesThisWeek = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return inboxMessages.filter((message) => {
      const received = message.receivedAt;
      if (!received) return false;
      return received >= weekAgo;
    }).length;
  }, [inboxMessages]);

  const selectedInboxMessages = useMemo(() => {
    if (inboxFilter === "all") return inboxMessages;
    return inboxMessages.filter((message) => message.accountId === inboxFilter);
  }, [inboxFilter, inboxMessages]);

  const formIsDirty = useMemo(() => {
    if (!selectedScenario) return false;
    return hasFormChanges(selectedScenario, formState);
  }, [selectedScenario, formState]);

  const handleTemplateSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedScenario) {
      setErrorMessage("Select a template before saving.");
      return;
    }

    const subject = formState.subject.trim();
    const body = formState.body.trim();
    if (!subject || !body) {
      setErrorMessage("Subject and body are required.");
      return;
    }

    setSavingTemplate(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      if (!dbRef.current) {
        const { db } = await ensureFirebase();
        dbRef.current = db;
      }

      const docRef = doc(dbRef.current, "emailTemplates", selectedScenario.id);
      await setDoc(
        docRef,
        {
          subject,
          previewText: formState.previewText.trim() || null,
          body,
          fromName: formState.fromName.trim(),
          fromEmail: formState.fromEmail.trim(),
          replyTo: formState.replyTo.trim() || null,
          sendFromAccountId: formState.sendFromAccountId || null,
          scenarioLabel: selectedScenario.label,
          scenarioDescription: selectedScenario.description,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid ?? null,
          updatedByEmail: currentUser?.email ?? null,
          updatedByName:
            (currentUser?.displayName as string | undefined) ||
            (currentUser?.email as string | undefined) ||
            null,
        },
        { merge: true }
      );

      setStatusMessage("Template saved");
    } catch (error) {
      console.error("Failed to save email template", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save template. Try again."
      );
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleResetTemplate = async () => {
    if (!selectedScenario) return;
    if (!dbRef.current) {
      const { db } = await ensureFirebase();
      dbRef.current = db;
    }

    const confirmation = window.confirm(
      "Reset this template to the Pineapple Tapped defaults? This removes any custom copy."
    );
    if (!confirmation) return;

    try {
      await deleteDoc(doc(dbRef.current, "emailTemplates", selectedScenario.id));
      setStatusMessage("Template reverted to defaults");
      setErrorMessage(null);
    } catch (error) {
      console.error("Failed to reset template", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to reset template. Try again."
      );
    }
  };

  const handleRequestGmailConnection = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = gmailAddress.trim();
    if (!trimmed) {
      setErrorMessage("Enter the Gmail address you want to connect.");
      return;
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }

    if (senders.some((sender) => sender.email.toLowerCase() === trimmed.toLowerCase())) {
      setErrorMessage("That mailbox is already tracked.");
      return;
    }

    setRequestingConnection(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (!dbRef.current) {
        const { db } = await ensureFirebase();
        dbRef.current = db;
      }

      await addDoc(collection(dbRef.current, "emailSenders"), {
        provider: "gmail",
        email: trimmed,
        displayName: trimmed,
        status: "pending",
        requestedAt: serverTimestamp(),
        requestedBy: currentUser?.uid ?? null,
        requestedByEmail: currentUser?.email ?? null,
        requestedByName:
          (currentUser?.displayName as string | undefined) ||
          (currentUser?.email as string | undefined) ||
          null,
      });

      setStatusMessage(
        "Gmail connection requested. Complete the OAuth handshake from the Cloud Functions logs to finish linking."
      );
      setGmailAddress("");
    } catch (error) {
      console.error("Failed to request Gmail connection", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to request Gmail connection"
      );
    } finally {
      setRequestingConnection(false);
    }
  };

  const handleGlobalSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSavingGlobal(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (!dbRef.current) {
        const { db } = await ensureFirebase();
        dbRef.current = db;
      }

      await setDoc(
        doc(dbRef.current, "emailSettings", "global"),
        {
          defaultSenderId: globalForm.defaultSenderId || null,
          fallbackFromName: globalForm.fallbackFromName.trim() || null,
          fallbackFromEmail: globalForm.fallbackFromEmail.trim() || null,
          supportContact: globalForm.supportContact.trim() || null,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid ?? null,
          updatedByName:
            (currentUser?.displayName as string | undefined) ||
            (currentUser?.email as string | undefined) ||
            null,
          updatedByEmail: currentUser?.email ?? null,
        },
        { merge: true }
      );

      setStatusMessage("Global sending defaults updated");
    } catch (error) {
      console.error("Failed to update global email settings", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to update global defaults"
      );
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleRemoveSender = async (sender: EmailSenderRecord) => {
    const confirmed = window.confirm(
      `Remove ${sender.displayName || sender.email} from the connected accounts? Templates using this inbox will fall back to the global default.`
    );
    if (!confirmed) return;

    setRemovingSenderId(sender.id);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (!dbRef.current) {
        const { db } = await ensureFirebase();
        dbRef.current = db;
      }

      const db = dbRef.current;

      const updates: Promise<unknown>[] = [];

      if (globalSettings?.defaultSenderId === sender.id) {
        updates.push(
          setDoc(
            doc(db, "emailSettings", "global"),
            {
              defaultSenderId: null,
              updatedAt: serverTimestamp(),
              updatedBy: currentUser?.uid ?? null,
              updatedByName:
                (currentUser?.displayName as string | undefined) ||
                (currentUser?.email as string | undefined) ||
                null,
              updatedByEmail: currentUser?.email ?? null,
            },
            { merge: true }
          )
        );
      }

      const impactedScenarios = scenarios.filter((scenario) => scenario.sendFromAccountId === sender.id);
      impactedScenarios.forEach((scenario) => {
        updates.push(
          setDoc(
            doc(db, "emailTemplates", scenario.id),
            {
              sendFromAccountId: null,
              updatedAt: serverTimestamp(),
              updatedBy: currentUser?.uid ?? null,
              updatedByName:
                (currentUser?.displayName as string | undefined) ||
                (currentUser?.email as string | undefined) ||
                null,
              updatedByEmail: currentUser?.email ?? null,
            },
            { merge: true }
          )
        );
      });

      await Promise.all([
        deleteDoc(doc(db, "emailSenders", sender.id)),
        ...updates,
      ]);

      setStatusMessage("Sender removed. Any automations using it now inherit the default configuration.");
    } catch (error) {
      console.error("Failed to remove email sender", error);
      setErrorMessage(error instanceof Error ? error.message : "Unable to remove sender. Try again.");
    } finally {
      setRemovingSenderId(null);
    }
  };

  const selectedSender = useMemo(() => {
    if (!formState.sendFromAccountId) return null;
    return senders.find((sender) => sender.id === formState.sendFromAccountId) ?? null;
  }, [formState.sendFromAccountId, senders]);

  const heroMetrics = [
    { label: "Templates customised", value: customisedCount },
    { label: "Connected senders", value: connectedSenders.length },
    { label: "Inbox (7 days)", value: inboxMessagesThisWeek },
  ];

  const heroActions = [
    {
      label: "Review Gmail accounts",
      description: "Check connected senders and sync status.",
      onClick: () => {
        const element = document.getElementById("email-gmail-connections");
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
    },
    {
      label: "See automation inbox",
      description: "Monitor recent replies and bounces.",
      onClick: () => {
        const element = document.getElementById("email-inbox-panel");
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PortalHero
        eyebrow="Automations"
        title="Email templates & sending settings"
        description="Configure automated messaging, maintain consistent copy, and manage the shared inbox powering Pineapple Tapped notifications."
        metrics={heroMetrics}
        quickActions={heroActions}
      />

      {statusMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading templates…
        </div>
      ) : !selectedScenario ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-sm text-amber-900 shadow-sm">
          No templates available. Create a document in the emailTemplates collection to get started.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_320px]">
          <aside className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Automation library</h2>
              <p className="mt-1 text-xs text-slate-500">
                Select a scenario to edit its subject line, preview copy, and body text. Customised templates are highlighted.
              </p>
              <div className="mt-4 space-y-2">
                {scenarios.map((scenario) => {
                  const isSelected = scenario.id === selectedScenarioId;
                  const customised = hasScenarioCustomisation(scenario);
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => setSelectedScenarioId(scenario.id)}
                      className={`w-full rounded-2xl border px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white shadow"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{scenario.label}</span>
                        {customised ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            Custom
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={`mt-1 text-xs ${
                          isSelected ? "text-white/80" : "text-slate-500"
                        }`}
                      >
                        {scenario.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Merge fields</h3>
              <p className="mt-1 text-xs text-slate-500">
                Personalise messages with dynamic tags. Ensure each placeholder has data available in the triggering workflow.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PLACEHOLDER_TOKENS.map((token) => (
                  <span
                    key={token}
                    className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700"
                  >
                    {token}
                  </span>
                ))}
              </div>
            </div>
          </aside>

          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">{selectedScenario.label}</h2>
              <p className="text-sm text-slate-500">{selectedScenario.description}</p>
              <p className="text-xs text-slate-400">
                Last updated: {formatTimestamp(selectedScenario.lastUpdated)}
                {selectedScenario.lastUpdatedByName ? ` • ${selectedScenario.lastUpdatedByName}` : ""}
                {!selectedScenario.lastUpdatedByName && selectedScenario.lastUpdatedByEmail
                  ? ` • ${selectedScenario.lastUpdatedByEmail}`
                  : ""}
              </p>
            </header>

            <form className="space-y-5" onSubmit={handleTemplateSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Subject</span>
                  <input
                    type="text"
                    value={formState.subject}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, subject: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder={selectedScenario.defaultSubject}
                  />
                </label>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Preview text</span>
                  <input
                    type="text"
                    value={formState.previewText}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, previewText: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder="Shown next to the subject in inboxes"
                  />
                </label>
              </div>

              <label className="space-y-1 text-sm text-slate-700">
                <span className="font-medium">Email body</span>
                <textarea
                  value={formState.body}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, body: event.target.value }))
                  }
                  rows={14}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  placeholder={selectedScenario.defaultBody}
                />
                <span className="block text-xs text-slate-400">
                  Use blank lines to create new paragraphs. Markdown basics (bold, italics, lists) are supported downstream.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">From name</span>
                  <input
                    type="text"
                    value={formState.fromName}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, fromName: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder={selectedScenario.defaultFromName}
                  />
                </label>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">From email</span>
                  <input
                    type="email"
                    value={formState.fromEmail}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, fromEmail: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder={selectedScenario.defaultFromEmail}
                  />
                </label>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Reply-to</span>
                  <input
                    type="email"
                    value={formState.replyTo}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, replyTo: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder="Defaults to the from address"
                  />
                </label>
              </div>

              <label className="space-y-1 text-sm text-slate-700">
                <span className="font-medium">Send using</span>
                <select
                  value={formState.sendFromAccountId}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, sendFromAccountId: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  <option value="">
                    Use global default
                    {globalSettings?.defaultSenderId
                      ? ` (${senders.find((sender) => sender.id === globalSettings.defaultSenderId)?.displayName || "Unknown"})`
                      : ""}
                  </option>
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.displayName} • {sender.status}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-slate-400">
                  Choose a specific Gmail account for this automation or inherit the global sender configuration.
                </span>
              </label>

              {selectedSender ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-800">{selectedSender.displayName}</span>{" "}
                    is currently <span className="font-semibold">{selectedSender.status}</span>.
                  </p>
                  {selectedSender.lastSyncedAt ? (
                    <p className="mt-1">
                      Last synced {formatTimestamp(selectedSender.lastSyncedAt as Timestamp | Date)}.
                    </p>
                  ) : null}
                  {selectedSender.error ? (
                    <p className="mt-1 text-rose-600">{selectedSender.error}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={savingTemplate || !formIsDirty}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {savingTemplate ? "Saving…" : formIsDirty ? "Save changes" : "Saved"}
                </button>
                <button
                  type="button"
                  onClick={handleResetTemplate}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  Reset to defaults
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-6">
            <section
              id="email-gmail-connections"
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-base font-semibold text-slate-900">Sending accounts</h2>
              <p className="mt-1 text-sm text-slate-500">
                Link shared Gmail inboxes to power automated sending. Once authorised, the account can be selected per template or set as the global default.
              </p>

              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
                <h3 className="text-sm font-semibold text-slate-900">Connection checklist</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Request access with the shared Gmail address so we create a pending record.</li>
                  <li>Approve the OAuth prompt from the generated Cloud Functions link or Google Cloud console.</li>
                  <li>Return here to confirm the status shows <span className="font-semibold text-emerald-700">connected</span> and assign it to templates or the global default.</li>
                </ol>
              </div>

              <form className="mt-4 space-y-3" onSubmit={handleRequestGmailConnection}>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Connect new Gmail address</span>
                  <input
                    type="email"
                    value={gmailAddress}
                    onChange={(event) => setGmailAddress(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder="admin@pineappletapped.com"
                  />
                </label>
                <button
                  type="submit"
                  disabled={requestingConnection}
                  className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {requestingConnection ? "Requesting…" : "Request connection"}
                </button>
                <p className="text-xs text-slate-400">
                  We create a pending record in Firestore. Complete OAuth consent from the Google Cloud console or a Cloud Functions link to finish authorising the inbox.
                </p>
              </form>

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Linked senders</h3>
                {senders.length === 0 ? (
                  <p className="text-xs text-slate-400">No Gmail accounts connected yet.</p>
                ) : (
                  <ul className="space-y-3 text-sm text-slate-700">
                    {senders.map((sender) => (
                      <li
                        key={sender.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{sender.displayName}</p>
                            <p className="text-xs text-slate-500">{sender.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                                sender.status === "connected"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : sender.status === "error"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {sender.status}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveSender(sender)}
                              disabled={removingSenderId === sender.id}
                              className="rounded-full border border-rose-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-rose-100 disabled:text-rose-300"
                            >
                              {removingSenderId === sender.id ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        </div>
                        <dl className="mt-2 grid gap-2 text-xs text-slate-500">
                          <div className="flex items-center justify-between">
                            <dt>Requested</dt>
                            <dd>{formatTimestamp(sender.requestedAt as Timestamp | Date)}</dd>
                          </div>
                          <div className="flex items-center justify-between">
                            <dt>Connected</dt>
                            <dd>{formatTimestamp(sender.connectedAt as Timestamp | Date)}</dd>
                          </div>
                          <div className="flex items-center justify-between">
                            <dt>Last sync</dt>
                            <dd>
                              {sender.lastSyncedAt
                                ? formatTimestamp(sender.lastSyncedAt as Timestamp | Date)
                                : "—"}
                            </dd>
                          </div>
                          {sender.error ? (
                            <div className="rounded-xl bg-rose-100 px-3 py-2 text-rose-700">
                              {sender.error}
                            </div>
                          ) : null}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Global defaults</h2>
              <p className="mt-1 text-sm text-slate-500">
                Define the fallback sender, reply identity, and contact information used when a template doesn’t provide its own values.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleGlobalSettingsSubmit}>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Default sender</span>
                  <select
                    value={globalForm.defaultSenderId}
                    onChange={(event) =>
                      setGlobalForm((prev) => ({ ...prev, defaultSenderId: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  >
                    <option value="">Select a connected account</option>
                    {senders.map((sender) => (
                      <option key={sender.id} value={sender.id}>
                        {sender.displayName} • {sender.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Fallback from name</span>
                  <input
                    type="text"
                    value={globalForm.fallbackFromName}
                    onChange={(event) =>
                      setGlobalForm((prev) => ({ ...prev, fallbackFromName: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder="Pineapple Tapped"
                  />
                </label>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Fallback from email</span>
                  <input
                    type="email"
                    value={globalForm.fallbackFromEmail}
                    onChange={(event) =>
                      setGlobalForm((prev) => ({ ...prev, fallbackFromEmail: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder="hello@pineappletapped.com"
                  />
                </label>
                <label className="space-y-1 text-sm text-slate-700">
                  <span className="font-medium">Support contact (footer)</span>
                  <input
                    type="text"
                    value={globalForm.supportContact}
                    onChange={(event) =>
                      setGlobalForm((prev) => ({ ...prev, supportContact: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    placeholder="Call 0203 123 4567 or reply to this email"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingGlobal}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {savingGlobal ? "Saving…" : "Save defaults"}
                </button>
                {globalSettings?.updatedAt ? (
                  <p className="text-xs text-slate-400">
                    Last updated {formatTimestamp(globalSettings.updatedAt)}
                    {globalSettings.updatedByName ? ` by ${globalSettings.updatedByName}` : ""}
                    {!globalSettings.updatedByName && globalSettings.updatedByEmail
                      ? ` by ${globalSettings.updatedByEmail}`
                      : ""}
                  </p>
                ) : null}
              </form>
            </section>

            <section
              id="email-inbox-panel"
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-base font-semibold text-slate-900">Automation inbox</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review the latest inbound emails captured from connected Gmail accounts – including replies, bounces, and support conversations.
              </p>

              <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
                <span>Show:</span>
                <select
                  value={inboxFilter}
                  onChange={(event) => setInboxFilter(event.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  <option value="all">All accounts</option>
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.displayName}
                    </option>
                  ))}
                </select>
              </label>

              {inboxError ? (
                <p className="mt-4 rounded-2xl bg-rose-100 p-3 text-xs text-rose-700">
                  {inboxError}
                </p>
              ) : null}

              <ul className="mt-4 space-y-3 text-sm text-slate-700">
                {selectedInboxMessages.length === 0 ? (
                  <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-400">
                    No messages captured yet.
                  </li>
                ) : (
                  selectedInboxMessages.map((message) => (
                    <li
                      key={message.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {message.subject || "(no subject)"}
                        </p>
                        <span className="text-xs text-slate-400">
                          {message.receivedAt
                            ? formatTimestamp(message.receivedAt)
                            : "Unknown"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        From {message.from || "Unknown sender"}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        {message.snippet || "No preview available."}
                      </p>
                      {message.labels.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.labels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full bg-slate-200 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
