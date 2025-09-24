# Proposal System Architecture & Content Plan

## Objectives
- Deliver a block-based proposal composer that outputs a consistent, multi-page experience for clients and is easy for sales staff to configure.
- Reuse pricing, kit, and scheduling data that already lives in Firestore so proposals stay accurate without double entry.
- Provide default copy and guardrails for every core section while allowing editors to override wording per proposal or template.
- Surface a profit & loss (P&L) side panel during pricing so staff can check margin assumptions before sending the document.

## Page Layout Overview
Proposals render as a sequence of stylised pages. Each page is composed of **blocks** that can be reused across templates.

| Page | Required Blocks | Optional Blocks |
| --- | --- | --- |
| Cover / Intro | `CoverHero`, `ProjectSnapshot` | `TestimonialQuote`, `HeroImage` |
| Credentials | `AboutUs`, `TeamHighlights` | `ClientLogos`, `Awards` |
| Scope of Work | One `PackageOverview` block per package | `StoryboardStrip`, `BehindTheScenes` |
| Timeline | `TimelinePhases` | `KeyDates`, `MilestonesGraphic` |
| Pricing | `PricingTable` | `AddOnMenu`, `InvestmentSummary` |
| Terms & Next Steps | `TermsChecklist`, `NextSteps` | `FAQ`, `SupportContact` |
| Call to Action | `AcceptanceCTA` | `ContactCTA` |

Blocks can appear in multiple sections when templates require variants (e.g., `InvestmentSummary` might also live on the cover for a quick teaser).

## Data Model

### Firestore Collections
- `proposalTemplates`
  - `name`: string
  - `blocks`: ordered array of `BlockInstance`
  - `defaultData`: map keyed by block type for default field values
- `proposalBlocks`
  - `type`: enum of registered block types
  - `label`: human-friendly name
  - `schema`: JSON schema describing configurable fields
  - `defaultCopy`: string/markdown snippet with merge tags
  - `autoSources`: metadata describing any auto-populated values (e.g., `{ field: "clientName", from: "org.displayName" }`)
- `proposals`
  - `templateId`: reference to template used
  - `blocks`: block instances with resolved data
  - `pricing`: aggregated totals, margin metrics, payment schedule
  - `status`: draft/sent/accepted/rejected
  - `orgId`, `clientContact`, `preparedBy`, etc.

### BlockInstance Shape
```ts
interface BlockInstance {
  id: string;            // unique per proposal/template
  type: BlockType;       // matches registered block component
  title?: string;        // optional override for nav menus / anchors
  data: Record<string, any>; // merged default + proposal-specific overrides
  visibility?: {
    showInPortal: boolean; // allow hiding blocks from client if needed
    showInPdf: boolean;
  };
}
```

### Registry
Create a central registry (`apps/web/lib/proposals/blocks.ts`) that exports:
- `BLOCK_TYPES`: array of block definitions (component import, schema, defaults, allowed placements).
- `resolveBlockData(context, block)`: merges defaults, template overrides, and proposal edits. Context carries `org`, `project`, `pricing`, `timeline`, etc.
- `renderers`: server/client components that map block types to JSX for PDF and portal view.

## Block Specifications & Template Copy
Each block ships with base copy containing merge tags (handlebars-style `{{ }}` placeholders). Editors can override copy per template; merge tags resolve at render time.

### 1. CoverHero
- **Fields**: `headline`, `subheadline`, `backgroundImage`, `accentColour`.
- **Auto fields**: default headline `{{projectTitle}}`, subheadline `Prepared for {{clientName}} · {{proposalDate}}`.
- **Default copy**:
  > `headline`: "{{projectTitle}}"
  > `subheadline`: "Prepared for {{clientName}} on {{proposalDate}}"

### 2. ProjectSnapshot
- **Fields**: `referenceNumber`, `preparedBy`, `summary`, `keyStats` (array of label/value).
- **Auto fields**: `referenceNumber` uses proposal ID prefix, `preparedBy` from current user.
- **Default copy**:
  - `summary`: "We're excited to partner with {{clientName}} to deliver {{projectSummary}}."
  - `keyStats` default rows: `[{ label: "Project Date", value: "{{eventDate}}" }, { label: "Location", value: "{{projectLocation}}" }]`.

### 3. AboutUs
- **Fields**: `intro`, `pillars` (array of `{ title, description }`), `credentials` (array of bullet points).
- **Default copy**:
  - `intro`: "Pineapple Tapped combines creative storytelling with production discipline to deliver standout live and digital experiences."
  - `pillars`: [
      { "title": "Strategic Storytelling", "description": "We map every deliverable back to your commercial goals." },
      { "title": "Full-Service Production", "description": "In-house crew covering video, podcast, design, and onsite activation." },
      { "title": "Measurable Impact", "description": "Real-time analytics and post-event insights to prove ROI." }
    ]
  - `credentials`: [`Trusted by {{topClients}}`, `100+ productions delivered across EMEA`, `Certified drone & livestream operators`]

### 4. TeamHighlights
- **Fields**: `teamMembers` (array referencing staff bios), `headline`, `body`.
- **Auto fields**: fetch team bios tagged with `proposalCoreTeam` in Firestore.
- **Default copy**: `headline`: "Your Production Leads", `body`: "A curated crew tailored to {{projectTitle}}.".

### 5. PackageOverview (repeat per package)
- **Fields**: `packageName`, `outcomeStatement`, `deliverables` (array with `title`, `description`, `metrics`), `inclusions`, `exclusions`.
- **Auto fields**: when linked to a product, prefill from `products` collection (name, deliverables, storyboard images).
- **Default copy**: outcome statement `"Designed to {{packageOutcome}} with measurable uplift in {{primaryMetric}}."`

### 6. TimelinePhases
- **Fields**: array of phases `{ name, startDate, endDate, description, responsibilities }`.
- **Auto fields**: compute start/end using project schedule + production duration.
- **Default copy**: fallback phases `Discovery`, `Pre-Production`, `Production`, `Post-Production`, each with generic descriptions.

### 7. PricingTable
- **Fields**: `lineItems` (array of `{ label, quantity, unitPrice, subtotal, linkedProductId? }`), `totals` (object), `notes`.
- **Auto fields**: prefill from selected products/kit; compute subtotals and totals.
- **Default copy**: `notes`: "Pricing excludes VAT. Travel & accommodation billed at cost unless noted.".

### 8. AddOnMenu
- **Fields**: array of optional upgrades with `name`, `description`, `price`.
- **Default copy**: Provide 3 sample add-ons (e.g., "Same-day social cutdowns", "Extended highlight reel").

### 9. InvestmentSummary
- **Fields**: `headline`, `investmentTotal`, `savings`, `roiNarrative`.
- **Auto fields**: total derived from Pricing block; savings computed vs. standard rates if available.
- **Default copy**: "Total investment: £{{formattedTotal}}"; ROI narrative referencing project goals.

### 10. TermsChecklist
- **Fields**: bullet list of key obligations (deposit, cancellation, revisions).
- **Default copy**:
  1. "50% deposit to schedule production dates."
  2. "Remaining balance due within 14 days of final delivery."
  3. "Two rounds of amends included per deliverable."

### 11. NextSteps
- **Fields**: `steps` array with `title`, `description`, `owner`.
- **Default copy**: Steps like `Review`, `Sign proposal`, `Pay deposit`, `Kick-off call` with target dates auto-filled from timeline.

### 12. AcceptanceCTA
- **Fields**: `ctaLabel`, `successMessage`, `depositAmount`, `paymentLinkMode` (`stripeIntent` | `invoiceRequest`).
- **Auto fields**: deposit defaults to percentage (configurable), payment link pre-configured to portal checkout.
- **Default copy**: `ctaLabel`: "Accept & Pay Deposit", `successMessage`: "Thanks {{clientName}}! We’ll confirm your booking and send onboarding details.".

## Editor Experience

### Template Builder (Admin)
- Drag-and-drop list of blocks by section with tabs for each page.
- Side panel for block settings using schema-driven forms. Auto fields display badges (e.g., "Auto-filled from organisation").
- Preview pane renders selected block with sample data.
- Template text editor supports markdown with merge tag autocomplete.

### Proposal Composer
- Stepper UI:
  1. **Project Basics** – select organisation, project record, due date, prepared by.
  2. **Packages & Scope** – choose products/packages, reorder, edit deliverable copy.
  3. **Timeline** – confirm auto-generated phases or edit dates.
  4. **Pricing** – see PricingTable, adjust quantities, toggle add-ons.
     - **P&L Side Panel** shows:
       - Revenue total, deposit amount.
       - Estimated hard costs pulled from kit bags & labour rates (reuse logic from `apps/web/lib/equipment.ts` and product calculators).
       - Margin percentage with traffic light indicator.
       - Editable inputs for external costs (freelancers, venue) with quick-add rows.
  5. **Terms & CTA** – review terms checklist, adjust deposit %, choose payment workflow.
  6. **Review & Send** – final preview, generate PDF, email options.

### Portal View (Client)
- Render the same blocks with client-safe visibility.
- Add sticky CTA button for acceptance & payment.
- Tracking: log block views and CTA clicks via existing analytics tracker.

## Automation & Calculations

### Merge Tag Context
Context assembled before render:
- `client`: org + contacts
- `project`: title, summary, schedule, location
- `pricing`: totals, deposit, margin, add-ons
- `team`: assigned staff
- `proposal`: id, date, prepared by

Tags like `{{projectTitle}}`, `{{marginPercent}}`, `{{depositDueDate}}` resolve via this context. Provide fallback formatting helpers (e.g., `formatCurrency`, `formatDate`).

### P&L Panel
- Reuse product costing data: `products` entries already store `kitBagId`, `labourFilmingRate`, `labourEditingRate` (see `apps/web/app/admin/products/[id]/ClientPage.tsx`).
- For selected packages, pull kit rentals via `getProductKit` and labour durations from scope to calculate cost of goods.
- Allow manual overrides per line.
- Display margin summary: `grossMargin = (totalRevenue - totalCosts) / totalRevenue`.
- Offer quick-export of P&L as CSV for finance.

## Roadmap

1. **Schema Foundation**
   - Introduce `proposalBlocks` registry & `BlockInstance` types in shared library.
   - Migrate existing `proposalTemplates` to new structure.
2. **Admin UI**
   - Build Template Builder page with drag/drop and schema forms.
   - Update Proposal Composer workflow to use new blocks and add P&L panel.
3. **Rendering Layer**
   - Implement shared block renderer components for portal & PDF.
   - Ensure responsive and print-friendly styles.
4. **Content Seeding**
   - Seed default blocks and copy using migration script (Cloud Function or admin command).
   - Provide at least one "Corporate Event" template utilising all sections.
5. **Automation Enhancements**
   - Hook acceptance CTA to existing Stripe deposit flow (`apps/web/app/checkout`).
   - Trigger task/workflow automation on acceptance (notify team, create project in PM tooling).

## Template Text Library (Initial Drafts)
These snippets can populate `defaultCopy` fields and be localised later.

### Cover Statement
> "Thank you for inviting Pineapple Tapped to collaborate on {{projectTitle}}. This proposal outlines how we’ll transform your objectives into an unforgettable experience."

### About Us Intro
> "From pre-production logistics to on-site execution, we’ve spent the last decade crafting campaigns that deliver measurable impact for brands like {{topClients}}."

### Scope Package Lead-In
> "Each package is modular—select the combination that fits your objectives, or mix elements to build a bespoke activation."

### Timeline Intro
> "We recommend the following schedule to keep approvals, production, and delivery on track. Need to adjust? Let us know and we’ll update immediately."

### Pricing Intro
> "All pricing is quoted in GBP and valid for 30 days. Travel outside of Greater London will be itemised once logistics are confirmed."

### Terms Lead-In
> "These terms keep the production running smoothly for both teams. Please review and let us know if you need any clarifications."

### Call to Action Copy
> "Ready to lock in your production dates? Accept below and pay the deposit securely within the portal."

## Form Fields & Maths Helpers
- **Number formatters** (`formatCurrency`, `formatPercent`) – share with cart/checkout utilities.
- **Date helpers** to compute milestones (e.g., add business days for approvals).
- **Cost calculators** pulling from kit bags, labour rates, and external expenses arrays.
- **Validation**: ensure required data per block before advancing steps.
- **Inline editors**: WYSIWYG or markdown editor for long-form sections, numeric inputs with currency prefix, select controls for auto-sourced lists.

## Integration Notes
- Use `@/lib/firebase.ensureFirebase()` before accessing auth or Firestore inside client components.
- Keep analytics optional: track block interactions but swallow failures to avoid UI flicker (see `apps/web/components/AnalyticsTracker.tsx`).
- For PDF generation, reuse existing pipeline (likely via Next.js route or Cloud Function) and pass fully resolved block data to renderer.

## Next Steps for Implementation
1. Draft TypeScript interfaces and registry scaffolding.
2. Build initial set of block components with seeded copy.
3. Implement template builder UI and migration script.
4. Add proposal composer stepper with P&L side panel.
5. Connect CTA to acceptance workflow and Stripe deposit collection.
