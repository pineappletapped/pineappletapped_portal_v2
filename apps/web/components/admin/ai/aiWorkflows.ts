export type AiWorkflowStatus = "live" | "planned" | "draft";

export type AiWorkflowKind = "firestore-trigger" | "callable" | "background" | "api-route";

export type AiPromptTemplateStatus = "active" | "draft" | "archived";

export interface AiWorkflowPromptTemplate {
  name: string;
  category?: string;
  description?: string;
  content: string;
  status?: AiPromptTemplateStatus;
  notes?: string;
  estimatedTokens?: number;
}

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
        template: {
          name: "Client bio research synthesis",
          category: "Client research",
          status: "draft",
          description:
            "Summarises CRM activity, order history, and submitted questionnaires into an executive-ready client biography with key talking points.",
          content: `You are Pineapple's research specialist tasked with synthesising CRM data, previous orders, onboarding questionnaires, and public notes into an actionable client biography.\n\nReturn JSON with:\n- overview: 2 paragraphs covering who the client is, what they do, and recent activity that matters for campaign planning.\n- opportunities: array of strings highlighting 3-5 campaign or upsell ideas backed by the data provided.\n- tone: guidance on the tone of future communications (e.g. "direct and time-poor" or "collaborative and detail focused").\n- conversationStarters: array of strings containing specific facts or achievements to open sales calls.\n- risks: array of strings calling out any blockers, sensitivities, or outstanding actions.\n- sources: array summarising which inputs informed the above (e.g. "Questionnaire Q4", "Recent order 2024-06").\n\nBe concise, use British English, and never fabricate information not present in the context.`,
          notes:
            "Initial runs should stay under 900 output tokens; adjust estimatedTokens once Gemini orchestration is in place.",
          estimatedTokens: 900,
        },
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
        template: {
          name: "Client bio research synthesis",
          category: "Client research",
          status: "draft",
          description:
            "Manual staff-triggered run of the client research biography prompt so HQ can queue bespoke briefs before automation is live.",
          content: `You are Pineapple's research specialist assisting a manual request. The operator will provide context blocks such as CRM notes, onboarding questionnaire answers, recent projects, and social links.\n\nRespond in JSON with: overview (2 paragraphs), opportunities (array of 3-5 strings), risks (array of 2-3 strings), recommendedNextSteps (array of concrete follow-up actions), tone (string describing how the client prefers to communicate), and sources (array referencing which context blocks informed the recommendations).\n\nRespect opt-out flags and highlight if critical information is missing. Never invent details and flag redacted information transparently.`,
          notes:
            "Use the same template as the auto workflow but allow the operator to inject custom follow-up tasks via recommendedNextSteps.",
          estimatedTokens: 950,
        },
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
        template: {
          name: "Proposal storyboard generator",
          category: "Proposals",
          status: "draft",
          description:
            "Drafts a three-act storyboard, recommended deliverables, and production timeline from campaign objectives and package items.",
          content: `You are Pineapple's proposal storyboarding assistant. Given campaign objectives, audience, tone, deliverables, and recommended products, craft a compelling storyboard.\n\nRespond with JSON containing: narrative (string, 2 paragraphs), sections (array of 4-6 objects with id, title, summary, and talkingPoints array), timeline (array of phases with name, duration, and 3-4 tasks), and recommendedItems (array of products with name, rationale, and optional priceHint).\n\nBlend strategic messaging with tangible production actions. Write in confident British English and avoid filler. Flag if required inputs are missing.`,
          notes:
            "Tokens usually sit around 750. Ensure sections map closely to deliverables surfaced in the proposal builder.",
          estimatedTokens: 750,
        },
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
        template: {
          name: "Content repurposing toolkit",
          category: "Content ops",
          status: "draft",
          description:
            "Turns a cleaned transcript into campaign-ready assets including summary, keywords, YouTube metadata, and platform posts.",
          content: `You are Pineapple's content repurposing assistant. Using the provided transcript, project context, tone, and call to action, generate a content kit.\n\nOutput JSON with: summary (paragraph), keywords (array of 6-8 SEO phrases), youtube (object with titles array of 3 options, description paragraph, tags array of 15 keywords), and socialPosts (array where each entry has id, platform, headline, body, hashtags array).\n\nRespect platform tone guidance (e.g. energetic for Instagram, professional for LinkedIn). Keep hashtags relevant and avoid U.S. spellings. If the transcript is missing, respond with an error field explaining why generation cannot continue.`,
          notes:
            "Aim for 650 output tokens. When hooking into the toolkit UI, persist the commandName and transcript source metadata.",
          estimatedTokens: 650,
        },
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
];

export default AI_WORKFLOWS;
