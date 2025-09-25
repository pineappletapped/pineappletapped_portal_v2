# AI Client Research Integration Plan

## Goals
- Automatically deliver a deep client briefing whenever a new order is captured in Firestore so production and sales teams can react quickly.
- Allow account or sales users to manually trigger the same Gemini-powered workflow from the proposal builder and charge a token-based fee.
- Keep all generated intelligence inside existing Firebase services (Firestore, Cloud Storage, Auth) for unified access control and auditing.
- Optimise for the Google ecosystem by using Vertex AI-hosted Gemini models and serverless primitives (Cloud Functions, Cloud Run, Pub/Sub).

## Architecture Overview
| Layer | Responsibility | Services |
| --- | --- | --- |
| Trigger | Detect new client orders or manual requests | Firestore trigger, callable Cloud Function |
| Orchestration | Aggregate context, call external data providers, manage job lifecycle | Cloud Run Job / Cloud Functions v2, Pub/Sub |
| Intelligence | Generate structured research + narrative insights | Vertex AI Gemini 1.5 Pro & Flash |
| Storage | Persist jobs, outputs, billing usage | Firestore (`clientResearchJobs`, `clientResearchResults`, `tokenWallets`), Cloud Storage |
| Delivery | Surface insights in portal UI & notifications | Next.js app (portal), Cloud Functions for Slack/email |
| Billing | Estimate & debit token fees | Firestore wallet + Stripe recharge flow |

## Workflow
1. **Job Creation**
   - **Automatic**: Firestore onCreate trigger on `orders/{orderId}` enqueues job if `autoResearchEnabled` flag true on the client.
   - **Manual**: Proposal builder calls `createClientResearchJob` callable with `clientId`, `proposalId`, `scope`. Function validates wallet balance and writes job doc with `manual=true`.
2. **Queue & Orchestration**
   - A Pub/Sub topic `client-research-queue` decouples Firestore triggers from long-running work.
   - Cloud Run Job subscriber pulls messages, checks idempotency via `jobs/{jobId}` status, and transitions to `ingesting`.
3. **Context Assembly**
   - Fetch CRM profile (`clients/{clientId}`), previous proposals, meeting notes (via DataConnect or custom connectors), and internal value props.
   - Optional connectors to Google Drive/Docs summarised via Gemini Flash for short context tokens.
4. **External Research Gathering**
   - Hit Google Programmable Search API using `clientWebsite`, industry keywords; optionally integrate SerpAPI/Crunchbase.
   - Parse pages via Cloud Run microservice leveraging Diffbot-like summariser; persist raw snippets to Cloud Storage for traceability.
5. **Gemini Analysis Pipeline**
   - **Call 1 (Gemini 1.5 Pro)**: Provide structured prompt (system instructions + context JSON) requesting canonical JSON schema with sections such as company overview, brand values, competitor table, strategic opportunities, risk flags, suggested messaging.
   - **Validation**: Node.js service validates JSON using Zod; retries with appended error instructions if schema mismatch.
   - **Call 2 (Gemini 1.5 Flash)**: Convert validated JSON into Markdown briefing plus executive summary bullet list; highlight potential compliance issues.
6. **Result Persistence & Notification**
   - Write `clientResearchResults/{jobId}` doc with Markdown, JSON, source citations, tokens used, completion timestamp.
   - Update job status to `complete`; emit Cloud Event for UI and send Slack notification to account channel.
7. **Portal Experience**
   - Portal subscribes to `clientResearchJobs` filtered by `clientId` to show timeline chips (Queued → Gathering → Analysing → Ready → Failed).
   - Detail drawer displays Markdown with ability to copy sections into proposal blocks and download PDF (existing PDF service reuses Markdown).
   - Manual jobs show token spend + user who triggered; include re-run button if wallet balance allows.

## Data Model (Firestore)
### `clientResearchJobs`
```json
{
  "clientId": "clients/{clientId}",
  "orderId": "orders/{orderId}",
  "proposalId": "proposals/{proposalId}",
  "status": "queued", // queued | ingesting | analysing | complete | failed | payment_required
  "manual": false,
  "scope": "standard", // standard | deep_dive | competitor_refresh
  "estimatedTokens": 2500,
  "estimatedDuration": 7, // minutes
  "billingMode": "auto", // auto | manual
  "triggeredBy": "users/{uid}",
  "createdAt": Timestamp,
  "updatedAt": Timestamp
}
```

### `clientResearchResults`
```json
{
  "jobId": "clientResearchJobs/{jobId}",
  "clientId": "clients/{clientId}",
  "orderId": "orders/{orderId}",
  "summaryMarkdown": "...",
  "researchJson": { /* structured content matching schema */ },
  "sources": [{ "title": "", "url": "", "snippet": "", "publishedAt": "" }],
  "modelVersion": "gemini-1.5-pro",
  "tokensUsed": 18200,
  "tokenCostUsd": 4.38,
  "autoTriggered": true,
  "createdAt": Timestamp,
  "expiresAt": Timestamp,
  "auditTrailUrl": "gs://bucket/jobs/{jobId}/prompt.json"
}
```

### `tokenWallets`
```json
{
  "orgId": "clients/{clientId}",
  "balance": 42,
  "currency": "GBP",
  "planTier": "growth",
  "autoDebit": true,
  "lastRechargeAt": Timestamp,
  "usageLog": [
    { "jobId": "clientResearchJobs/{jobId}", "delta": -3, "reason": "client_research", "createdAt": Timestamp }
  ]
}
```

## Gemini Prompt Design
- **System Prompt Pillars**: brand tone, requirement for factual accuracy, citation of sources, UK English writing style.
- **Schema Control**: use Vertex AI JSON schema (function calling) to require keys like `company_profile`, `brand_values`, `competitor_matrix`, `opportunities`, `risks`, `talking_points`.
- **Token Budgeting**: target <20k input tokens by truncating duplicate snippets and summarising long documents with Gemini Flash pre-pass.
- **Safety**: configure safety settings to block sensitive categories; add policy statements to avoid defamatory content.
- **Evaluation**: store synthetic test prompts and expected outputs; run nightly regression to detect drift.

## Manual Run & Billing Mechanics
1. User selects "Run Deep Research" in proposal builder.
2. UI fetches token estimate via callable function using historical averages + scope multiplier.
3. Modal displays estimated completion time, token spend, GBP equivalent, and wallet balance.
4. On confirmation, backend debits wallet (or marks `payment_required` if insufficient balance) and enqueues job.
5. When job completes, usage log is appended and invoice line item created (Stripe webhook).
6. Provide admin dashboard summarising monthly token consumption per client and manual vs auto split.

## Security & Compliance
- Restrict `clientResearchResults` reads/writes to staff roles via Firestore rules; manual approval required for sharing with clients.
- Store raw prompts/responses in Cloud Storage with CMEK encryption and 90-day retention.
- Run PII scrubber on external snippets before storing; redact emails/phone numbers using Cloud DLP if required.
- Maintain audit log: job doc includes `triggeredBy`, `modelVersion`, `cost`. Logs exported to BigQuery for compliance reports.
- Provide opt-out toggle per client in CRM to disable automated research per GDPR requests.

## Implementation Roadmap
1. **Foundation (Week 1-2)**
   - Create Firestore collections, indexes, and security rules updates.
   - Implement token wallet service + Stripe webhook for top-ups.
   - Build `enqueueClientResearch` trigger and `createClientResearchJob` callable with validation tests.
2. **Data & Orchestration (Week 3-4)**
   - Stand up Pub/Sub topic, Cloud Run Job skeleton, and connector microservices for search + snippet normalisation.
   - Implement job state machine and retry logic; add Cloud Monitoring dashboards.
3. **Gemini Integration (Week 5)**
   - Author prompt templates, implement Vertex AI client with schema enforcement, handle validation/retry.
   - Store outputs in Firestore and Cloud Storage; add unit tests for schema validation.
4. **Portal Experience (Week 6)**
   - Build client research cards, detail view, manual trigger modal, and wallet balance indicator.
   - Hook into notifications (email/Slack) for completed jobs and failures.
5. **Pilot & Hardening (Week 7+)**
   - Run cost/performance tests with internal clients, tune scope multipliers, update prompts.
   - Add red-team scenarios, document SOP, finalise pricing copy, and prepare enablement materials.

## Pricing Recommendations
- Introduce £10 token packs (10 tokens); auto jobs consume 2 tokens, manual deep-dive consumes 3-5 based on scope.
- Allow organisations to set monthly auto-job cap (e.g., 10 auto runs) before requiring manual approval.
- Display projected monthly spend inside admin dashboard with alerts when balance <3 tokens.

## Future Enhancements
- Train Gemini Adapter or use Vertex AI Grounding with private knowledge base (case studies, testimonials) for richer outputs.
- Embed competitor matrix data into proposal generator blocks automatically.
- Provide Slack summary bot and Google Slides export for client presentations.
- Support multilingual briefs (Gemini translation) and territory-specific compliance guidance.

