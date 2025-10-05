import {
  CLIENT_RESEARCH_AUTO_PROMPT_TEMPLATE,
  CLIENT_RESEARCH_MANUAL_PROMPT_TEMPLATE,
  CONTENT_REPURPOSING_PROMPT_TEMPLATE,
  PROPOSAL_STORYBOARD_PROMPT_TEMPLATE,
  BLOG_POST_DRAFT_PROMPT_TEMPLATE,
  type PromptTemplateDefinition,
  type PromptTemplateStatus,
} from "@/lib/ai/templates";

export type AiWorkflowStatus = "live" | "planned" | "draft";

export type AiWorkflowKind = "firestore-trigger" | "callable" | "background" | "api-route";

export type AiPromptTemplateStatus = PromptTemplateStatus;

export type AiWorkflowPromptTemplate = PromptTemplateDefinition;

export interface AiWorkflowPromptRef {
  label: string;
  status: AiWorkflowStatus;
  notes?: string;
  commandName?: string;
  promptDocHint?: string;
  promptId?: string;
  promptName?: string;
  template?: AiWorkflowPromptTemplate;
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
        promptName: "Client bio research synthesis",
        template: CLIENT_RESEARCH_AUTO_PROMPT_TEMPLATE,
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
        promptName: "Client bio research synthesis",
        template: CLIENT_RESEARCH_MANUAL_PROMPT_TEMPLATE,
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
  {
    id: "proposal-storyboard-assistant",
    title: "Proposal storyboard assistant",
    functionName: "POST /api/proposals/storyboard",
    kind: "api-route",
    entryPoint: "Route handler · Next.js",
    description:
      "Transforms proposal line items and creative notes into a draft storyboard with narrative, scenes, and production timeline for admins.",
    status: "live",
    codeLocation: {
      path: "apps/web/app/api/proposals/storyboard/route.ts",
      anchor: "buildNarrative",
    },
    prompts: [
      {
        label: "Storyboard generator",
        status: "draft",
        commandName: "proposal_storyboard_generate",
        promptName: "Proposal storyboard generator",
        notes:
          "Hook this up once the admin assistant can call aiPrompts; logs should record commandName proposal_storyboard_generate for analytics.",
        template: PROPOSAL_STORYBOARD_PROMPT_TEMPLATE,
      },
    ],
    docs: [
      {
        label: "Proposal storyboard flow",
        path: "docs/proposals/storyboard-assistant.md",
      },
    ],
    notes:
      "Once the prompt is live, persist requestId and storyboardId on aiCommandLogs for traceability.",
  },
  {
    id: "content-repurposing-assistant",
    title: "Content repurposing assistant",
    functionName: "POST /api/tools/social-assistant",
    kind: "api-route",
    entryPoint: "Route handler · Next.js",
    description:
      "Takes transcripts or SRT uploads and drafts summaries, YouTube metadata, and multi-platform social posts for editors.",
    status: "live",
    codeLocation: {
      path: "apps/web/app/api/tools/social-assistant/route.ts",
      anchor: "parsePayload",
    },
    prompts: [
      {
        label: "Transcript repurposing kit",
        status: "draft",
        commandName: "content_repurpose_generate",
        promptName: "Content repurposing toolkit",
        notes:
          "Once connected, ensure uploads log aiCommandLogs with commandName content_repurpose_generate and store outputs against the project.",
        template: CONTENT_REPURPOSING_PROMPT_TEMPLATE,
      },
    ],
    docs: [
      {
        label: "Content assistant workspace",
        path: "docs/ai-content-repurpose.md",
      },
    ],
    notes:
      "Link generated assets back into projectKnowledge so future assistants can reference approved copy.",
  },
  {
    id: "blog-drafting-assistant",
    title: "Blog drafting assistant",
    functionName: "POST /api/admin/blog/generate-draft",
    kind: "api-route",
    entryPoint: "Route handler · Next.js",
    description:
      "Turns an editorial summary and campaign context into a ready-to-review blog draft with refreshed SEO copy for marketing reviewers.",
    status: "live",
    codeLocation: {
      path: "apps/web/app/api/admin/blog/generate-draft/route.ts",
    },
    prompts: [
      {
        label: "Editorial draft assistant",
        status: "live",
        commandName: "blog_post_generate",
        promptName: "Blog editorial draft assistant",
        template: BLOG_POST_DRAFT_PROMPT_TEMPLATE,
        notes:
          "Flags thin briefs via warnings so editors know when to add more background before publishing.",
      },
    ],
    notes:
      "Records aiCommandLogs entries (blog_post_generate) with token usage and warnings so the AI management centre can audit editorial output.",
  },
];

export default AI_WORKFLOWS;
