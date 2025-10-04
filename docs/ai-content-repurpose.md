# Content repurposing assistant

## Overview
The content repurposing assistant converts approved transcripts into social and video-ready copy so editors can publish faster. It will be orchestrated through the AI management workspace using the `Content repurposing toolkit` prompt template.

## Current workflow shape
- Source transcript: uploaded SRT, Drive transcript, or manual paste
- Context metadata: project, client, tone, call to action, deliverable labels
- Platforms: selected set of social channels plus YouTube

The API route at `apps/web/app/api/tools/social-assistant/route.ts` currently performs deterministic parsing. When the prompt is connected, the route should load the prompt text, inject the structured context, and log a command in `aiCommandLogs` with `commandName` set to `content_repurpose_generate`.

## Output contract
When the AI prompt is used, return JSON containing:
- `summary`: 1–2 paragraph overview of the asset
- `keywords`: 6–8 SEO-friendly phrases
- `youtube`: object containing `titles` (3 options), `description`, and `tags` (15 keywords)
- `socialPosts`: array of posts with `platform`, `headline`, `body`, and `hashtags`
- Optional `warnings` array if the transcript quality prevents certain assets from being produced

## Implementation checklist
1. Create the prompt in `aiPrompts` using the template exposed on the AI management page.
2. Fetch the prompt from the API route and call the configured model (respecting the default model stored in the prompt record).
3. Save the generated kit to Firestore and the project knowledge base so future assistants can reference approved copy.
4. Track command usage and latency in `aiCommandLogs` to surface performance data back to the AI management dashboard.
