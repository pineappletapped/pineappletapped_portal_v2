export type PromptTemplateStatus = "active" | "draft" | "archived";

export interface PromptTemplateDefinition {
  name: string;
  category?: string;
  description?: string;
  content: string;
  status?: PromptTemplateStatus;
  notes?: string;
  estimatedTokens?: number;
  defaultModelId?: string | null;
}

export const CLIENT_RESEARCH_AUTO_PROMPT_TEMPLATE: PromptTemplateDefinition = Object.freeze({
  name: "Client bio research synthesis",
  category: "Client research",
  status: "draft" as PromptTemplateStatus,
  description:
    "Summarises CRM activity, order history, and submitted questionnaires into an executive-ready client biography with key talking points.",
  content: `You are Pineapple's research specialist tasked with synthesising CRM data, previous orders, onboarding questionnaires, and public notes into an actionable client biography.\n\nReturn JSON with:\n- overview: 2 paragraphs covering who the client is, what they do, and recent activity that matters for campaign planning.\n- opportunities: array of strings highlighting 3-5 campaign or upsell ideas backed by the data provided.\n- tone: guidance on the tone of future communications (e.g. "direct and time-poor" or "collaborative and detail focused").\n- conversationStarters: array of strings containing specific facts or achievements to open sales calls.\n- risks: array of strings calling out any blockers, sensitivities, or outstanding actions.\n- sources: array summarising which inputs informed the above (e.g. "Questionnaire Q4", "Recent order 2024-06").\n\nBe concise, use British English, and never fabricate information not present in the context.`,
  notes:
    "Initial runs should stay under 900 output tokens; adjust estimatedTokens once Gemini orchestration is in place.",
  estimatedTokens: 900,
});

export const CLIENT_RESEARCH_MANUAL_PROMPT_TEMPLATE: PromptTemplateDefinition = Object.freeze({
  name: "Client bio research synthesis",
  category: "Client research",
  status: "draft" as PromptTemplateStatus,
  description:
    "Manual staff-triggered run of the client research biography prompt so HQ can queue bespoke briefs before automation is live.",
  content: `You are Pineapple's research specialist assisting a manual request. The operator will provide context blocks such as CRM notes, onboarding questionnaire answers, recent projects, and social links.\n\nRespond in JSON with: overview (2 paragraphs), opportunities (array of 3-5 strings), risks (array of 2-3 strings), recommendedNextSteps (array of concrete follow-up actions), tone (string describing how the client prefers to communicate), and sources (array referencing which context blocks informed the recommendations).\n\nRespect opt-out flags and highlight if critical information is missing. Never invent details and flag redacted information transparently.`,
  notes:
    "Use the same template as the auto workflow but allow the operator to inject custom follow-up tasks via recommendedNextSteps.",
  estimatedTokens: 950,
});

export const PROPOSAL_STORYBOARD_PROMPT_TEMPLATE: PromptTemplateDefinition = Object.freeze({
  name: "Proposal storyboard generator",
  category: "Proposals",
  status: "draft" as PromptTemplateStatus,
  description:
    "Drafts a three-act storyboard, recommended deliverables, and production timeline from campaign objectives and package items.",
  content: `You are Pineapple's proposal storyboarding assistant. Given campaign objectives, audience, tone, deliverables, and recommended products, craft a compelling storyboard.\n\nRespond with JSON containing: narrative (string, 2 paragraphs), sections (array of 4-6 objects with id, title, summary, and talkingPoints array), timeline (array of phases with name, duration, and 3-4 tasks), and recommendedItems (array of products with name, rationale, and optional priceHint).\n\nBlend strategic messaging with tangible production actions. Write in confident British English and avoid filler. Flag if required inputs are missing.`,
  notes:
    "Tokens usually sit around 750. Ensure sections map closely to deliverables surfaced in the proposal builder.",
  estimatedTokens: 750,
});

export const CONTENT_REPURPOSING_PROMPT_TEMPLATE: PromptTemplateDefinition = Object.freeze({
  name: "Content repurposing toolkit",
  category: "Content ops",
  status: "draft" as PromptTemplateStatus,
  description:
    "Turns a cleaned transcript into campaign-ready assets including summary, keywords, YouTube metadata, and platform posts.",
  content: `You are Pineapple's content repurposing assistant. Using the provided transcript, project context, tone, and call to action, generate a content kit.\n\nOutput JSON with: summary (paragraph), keywords (array of 6-8 SEO phrases), youtube (object with titles array of 3 options, description paragraph, tags array of 15 keywords), and socialPosts (array where each entry has id, platform, headline, body, hashtags array).\n\nRespect platform tone guidance (e.g. energetic for Instagram, professional for LinkedIn). Keep hashtags relevant and avoid U.S. spellings. If the transcript is missing, respond with an error field explaining why generation cannot continue.`,
  notes:
    "Aim for 650 output tokens. When hooking into the toolkit UI, persist the commandName and transcript source metadata.",
  estimatedTokens: 650,
});
