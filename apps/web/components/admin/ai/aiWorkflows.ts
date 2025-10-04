export type AiWorkflowStatus = "live" | "planned" | "draft";

export type AiWorkflowKind = "firestore-trigger" | "callable" | "background";

export interface AiWorkflowPromptRef {
  label: string;
  status: AiWorkflowStatus;
  notes?: string;
  commandName?: string;
  promptDocHint?: string;
}

export interface AiWorkflowDocLink {
  label: string;
  path: string;
}

export interface AiWorkflowLocation {
  path: string;
  anchor?: string;
}

export interface AiWorkflowSummary {
  id: string;
  title: string;
  functionName: string;
  kind: AiWorkflowKind;
  entryPoint: string;
  description: string;
  status: AiWorkflowStatus;
  codeLocation: AiWorkflowLocation;
  prompts: AiWorkflowPromptRef[];
  docs?: AiWorkflowDocLink[];
  notes?: string;
}

export const AI_WORKFLOWS: AiWorkflowSummary[] = [
  {
    id: "client-research-auto",
    title: "Client research auto queue",
    functionName: "clientResearch_onOrderCreated",
    kind: "firestore-trigger",
    entryPoint: "orders/{orderId} · onCreate",
    description:
      "Automatically inspects new orders, honours client opt-in flags, and enqueues clientResearchJobs with wallet debits when balances permit.",
    status: "live",
    codeLocation: {
      path: "functions/src/index.ts",
      anchor: "clientResearch_onOrderCreated",
    },
    prompts: [
      {
        label: "Gemini research briefing",
        status: "planned",
        notes:
          "Prompt schema and orchestration live in the Gemini pipeline roadmap; see the prompt design notes for structure and tone guidance.",
        promptDocHint: "docs/ai-client-research-plan.md#gemini-prompt-design",
      },
    ],
    docs: [
      {
        label: "AI client research plan",
        path: "docs/ai-client-research-plan.md",
      },
    ],
    notes:
      "Jobs are also mirrored into clientResearchQueue for downstream Gemini workers; once the processor is live, link token spend back into aiCommandLogs.",
  },
  {
    id: "client-research-manual",
    title: "Client research manual enqueue",
    functionName: "createClientResearchJob",
    kind: "callable",
    entryPoint: "callable · createClientResearchJob",
    description:
      "Staff-triggered callable that validates wallet balances, records billing metadata, and places manual client research jobs into the queue.",
    status: "live",
    codeLocation: {
      path: "functions/src/index.ts",
      anchor: "createClientResearchJob",
    },
    prompts: [
      {
        label: "Gemini research briefing",
        status: "planned",
        notes:
          "Shares the same Gemini templates as the auto workflow; once orchestration lands, bind finished prompts back to the originating proposal.",
        promptDocHint: "docs/ai-client-research-plan.md#gemini-prompt-design",
      },
    ],
    docs: [
      {
        label: "AI client research plan",
        path: "docs/ai-client-research-plan.md",
      },
    ],
    notes:
      "Records payment_required jobs when wallets are short; follow up in the AI queue processor so retries can emit aiCommandLogs for billing insights.",
  },
  {
    id: "project-booking-invite",
    title: "Project booking invite logging",
    functionName: "projectBookings_sendInvites",
    kind: "callable",
    entryPoint: "callable · projectBookings_sendInvites",
    description:
      "Generates filming session invite tokens, emails recipients, and records placeholder AI command logs so copy helpers can plug in later.",
    status: "live",
    codeLocation: {
      path: "functions/src/index.ts",
      anchor: "projectBookings_sendInvites",
    },
    prompts: [
      {
        label: "Project booking invite",
        status: "live",
        notes: "Logs to aiCommandLogs with zero-token usage so the future copy assistant can reuse the same commandName when enabled.",
        commandName: "project_booking_invite",
      },
    ],
    notes:
      "Pairs invite metadata with commandName so downstream automation can detect which franchise/client initiated an outreach batch.",
  },
  {
    id: "project-booking-response",
    title: "Project booking response logging",
    functionName: "projectBookings_acceptInvite",
    kind: "callable",
    entryPoint: "callable · projectBookings_acceptInvite",
    description:
      "Captures attendee availability, updates booking stats, and logs AI usage stubs ready for follow-up messaging workflows.",
    status: "live",
    codeLocation: {
      path: "functions/src/index.ts",
      anchor: "projectBookings_acceptInvite",
    },
    prompts: [
      {
        label: "Project booking response",
        status: "live",
        notes: "Uses aiCommandLogs commandName project_booking_response to reserve analytics space for automatic reply generation.",
        commandName: "project_booking_response",
      },
    ],
    notes:
      "Clears stale state in the viewer on errors; tie future AI follow-ups back through the same commandName for auditing.",
  },
  {
    id: "project-booking-purchase",
    title: "Storefront booking purchase logging",
    functionName: "fulfilCampaignBookingPurchase",
    kind: "background",
    entryPoint: "helper · fulfilCampaignBookingPurchase",
    description:
      "Runs during checkout fulfilment to allocate paid booking slots and emits AI command logs so nurture copy can hook into purchases.",
    status: "live",
    codeLocation: {
      path: "functions/src/index.ts",
      anchor: "fulfilCampaignBookingPurchase",
    },
    prompts: [
      {
        label: "Project booking purchase",
        status: "live",
        notes: "Writes aiCommandLogs entries with commandName project_booking_purchase for analytics continuity once messaging is automated.",
        commandName: "project_booking_purchase",
      },
    ],
    notes:
      "Currently records zero token spend; update once post-purchase assistants begin drafting recap emails or briefs.",
  },
];
