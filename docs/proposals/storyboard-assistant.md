# Proposal storyboard assistant

## Overview
The proposal storyboard assistant turns discovery inputs from the proposal builder into a narrative deck that campaign planners can review before presenting to clients. It will eventually call into the AI prompt library so the same behaviour can be tuned centrally from the AI management workspace.

## Inputs collected by the API route
- Proposal metadata: project name, audience, tone, key goals
- Selected deliverables and recommended products (with indicative pricing)
- Planner notes and any internal reminders

The Next.js route at `apps/web/app/api/proposals/storyboard/route.ts` currently synthesises these inputs with deterministic logic. Once the AI prompt is connected, the handler should fetch the `Proposal storyboard generator` prompt from Firestore, inject the structured inputs, and record a command log entry with `commandName` set to `proposal_storyboard_generate`.

## Output contract
The assistant should respond with JSON that contains:
- `narrative`: two concise paragraphs that frame the proposal and the strategic direction
- `sections`: 4–6 storyboard beats with `title`, `summary`, and supporting `talkingPoints`
- `timeline`: 3 production phases including durations and tangible tasks
- `recommendedItems`: up to three products or add-ons with `rationale` and optional `priceHint`

## Next steps to fully activate the workflow
1. Wire the API route to call the prompt stored in `aiPrompts` (creating it from the catalog template if it does not exist yet).
2. Log usage to `aiCommandLogs` with the generated `requestId` so the AI management dashboard can trace spend.
3. Deliver the generated storyboard back into the proposal UI, allowing admins to approve or request a re-run.
4. Capture feedback and revisions so the prompt can be iteratively improved from the AI management workspace.
