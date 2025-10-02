# Social scheduling and analytics module roadmap

## Objective
Deliver an opt-in social scheduling and performance module that lets Pineapple Tapped clients, franchises, and HQ staff connect official social accounts, compose platform-specific posts sourced from delivered assets, schedule automated publishing, and surface cross-network analytics. The experience must support staged rollout (initially hidden) and respect GDPR by controlling exposure of performance data to end clients.

## Personas and access levels
- **HQ marketing operations**: configure platform integrations, monitor publishing queues, manage feature flags, and troubleshoot failures.
- **Franchise marketing leads**: pilot the module for select franchise accounts, review queued posts, and approve schedules before HQ enablement.
- **Client marketing managers**: connect their brand accounts, request approvals, review analytics for their own organisations when the feature is toggled on.
- **Creative producers / editors**: source final deliverables from the asset library to attach to scheduled posts and request approvals.

## Feature flag and rollout strategy
- Introduce global booleans in remote config / Firestore (mirroring existing feature-flag approach) for `social_scheduler_enabled` and `marketplace_enabled`; default both to `false` until internal QA completes.
- Add per-franchise overrides (stored under `franchises/{id}/featureFlags`) to selectively enable the scheduler for pilot franchises without exposing it to all clients. Admin tooling now writes scheduler overrides to `franchises/{id}/featureFlags/socialScheduler` with audit logging.
- Add per-organisation (client) visibility toggles so account managers can hide analytics and publishing UI from customers even when the franchise tests internally. Organisation overrides live at `orgs/{id}/featureFlags/socialScheduler` and inherit global/franchise defaults until explicitly set.
- Expose admin tooling to flip each layer of the toggle hierarchy and record an audit trail (user, timestamp, rationale) for compliance.
- Provide fallbacks: when the scheduler is disabled, surface “Export plan” UX that downloads CSV/ICS data instead of offering publish buttons.

## Experience overview
1. **Account connections hub** (client & franchise portal)
   - Support OAuth flows for YouTube, LinkedIn, Facebook Pages, Instagram, TikTok, and Vimeo with clear scopes for publishing vs. analytics.
   - Store refresh tokens securely (Secret Manager / encrypted Firestore fields) and monitor expiry; show actionable statuses (active, requires re-auth, permission mismatch).
   - Allow multiple accounts per platform scoped to an organisation; franchise users can connect on behalf of clients with delegated access.
   - Provide granular permission toggles per account ("allow scheduling", "allow analytics only").
2. **Post composer workspace**
   - Pull media from existing deliverables (assets, clips, exported graphics) with search + filters; allow direct upload when needed.
   - Capture captions, hashtags, first comments, thumbnails, and UTM tagged links with validation per platform requirements.
   - Support platform variants via tabbed interface and show preview cards for each network.
   - Offer AI assist actions (caption suggestions, hashtag variants, optimal times) and log provenance of generated copy.
3. **Approval workflow**
   - Post lifecycle: `draft → awaiting_approval → approved → scheduled → publishing → published / failed`.
   - Configurable approvers: client-side marketing managers, franchise leads, HQ operations.
   - Track comments and change history; notify stakeholders via email/in-app when approvals are requested or decisions change status.
4. **Scheduling & calendar**
   - Calendar views (month/week/day) with drag-to-reschedule interactions and timezone awareness per organisation.
   - Queue management for bulk duplication across platforms, conflict detection (two posts within 5 minutes on same platform), and warnings about outside service hours.
   - Export options (CSV and ICS) for offline workflows when auto-publish is off.
5. **Publishing pipeline**
   - Background workers per platform (Cloud Run / queue consumers) that publish at scheduled times, handle retries, and persist external post IDs.
   - Maintain delivery logs with request/response payload snapshots (redacted) for debugging.
   - Surface per-target status inside the portal with retry and "mark as manually posted" actions.
6. **Analytics integration**
   - Once an external post ID is stored, fetch performance metrics (views, reach, engagement, conversions) on a recurring cadence and attach to post records.
   - Display analytics dashboards in both scheduler and dedicated analytics module with filters by platform, campaign, asset, or deliverable.
   - Provide toggle to hide analytics widgets when organisation-level permission is off; show explanatory copy instead.
7. **Reporting & exports**
   - Allow CSV exports of scheduled posts, published history, and analytics summaries.
   - Generate shareable reports for clients featuring asset performance, tied back to deliverables.

## Data model (proposed collections / tables)
- `socialAccounts`: `{ id, organisationId, franchiseId?, platform, accountRef, displayName, avatarUrl, scopes: { publish: boolean, analytics: boolean }, status, lastSyncedAt, expiresAt, createdBy, createdAt, updatedAt }`.
- `socialAccountSecrets`: secure storage reference for tokens / refresh tokens (never exposed to clients directly).
- `socialPosts`: `{ id, organisationId, projectId?, deliverableId?, createdBy, ownerRole, status, scheduledAt, timezone, approvalState, approvalHistory[], createdAt, updatedAt }`.
- `socialPostVariants`: `{ id, postId, platform, caption, hashtags, firstComment, linkSettings, thumbnailRef, mediaRefs[], aiAssistMetadata }`.
- `socialPostTargets`: `{ id, postId, variantId, accountId, status, scheduledAt, publishedAt, externalPostId, failureCode?, failureMessage?, retryCount, lastTriedAt }`.
- `socialPostAnalytics`: `{ targetId, fetchedAt, metrics: { views, watchTime, likes, shares, comments, clicks, conversions }, source }`.
- `socialApprovals`: `{ id, postId, approverId, approverRole, state, comment, decidedAt }` (or embed in post history).
- `featureFlags`: extend existing config to include scheduler toggles at global / franchise / organisation scope.
- `auditLogs`: track flag changes, connection changes, approval decisions, and manual overrides.

## API and integration requirements
- Build REST/GraphQL endpoints or callable functions for:
  - Listing, creating, updating social accounts with OAuth initiation endpoints and webhook/callback handlers per platform.
  - Managing post drafts, variants, and approvals with role-based access control.
  - Scheduling operations that enqueue publish jobs into a task queue (e.g., Cloud Tasks) with platform-specific payloads.
  - Publishing worker endpoints that platforms call for status updates (e.g., YouTube upload callbacks).
  - Analytics ingestion pipelines retrieving metrics via platform APIs (respecting rate limits with cached sync windows).
- Ensure failure handling, retries, and alerting (Cloud Logging metrics, Slack notifications) for publish errors and token expiry.
- Synchronise deliverable metadata by referencing existing Firestore collections (`assets`, `deliverables`, `projects`) and ensure referential integrity when source assets are archived.

## Permissions and security
- Reuse existing role schema (clientAdmin, clientEditor, franchiseAdmin, franchiseStaff, hqAdmin) and map capabilities: only admins toggle features, editors create drafts, approvers change approval state.
- When analytics is disabled for a client, suppress metrics in both scheduler and general analytics dashboards while allowing HQ/franchise to view internally via role gating.
- Encrypt stored tokens using application-level encryption or Secret Manager; rotate client secrets regularly and log access.
- Comply with GDPR: display consent copy before connecting accounts, allow disconnect & data deletion requests, and only retain analytics for agreed retention period (e.g., 24 months).

## UX copy and guidance considerations
- Provide onboarding wizard inside scheduler guiding users through connecting accounts, selecting deliverables, and requesting approval.
- Empty states should explain why features might be hidden (e.g., "Your organisation hasn’t enabled social scheduling yet. Contact your account manager.").
- When toggles are off, show value propositions encouraging upgrade/internal enablement without exposing disabled controls.

## Phase roadmap
- **V0 (internal, hidden)**: implement core data model, account connection scaffolding, post composer, CSV/ICS export, feature flag admin UI; restrict to HQ internal org.
- **V1**: enable YouTube and LinkedIn publishing, approval workflow, calendar UI, and analytics ingestion for those platforms; release to select franchises.
- **V1.1**: add Instagram, TikTok, Facebook Pages publishing paths, extended media validations, and notification templates.
- **V1.2**: introduce AI scheduling suggestions, hashtag variants, clip recommendations from analytics, and expand analytics dashboard integration.
- **V2**: bulk scheduling, campaign templates, recurring content series automation, and deeper analytics comparisons across campaigns.

## Operational readiness
- Document runbooks for reconnecting tokens, monitoring publish queues, and handling platform-specific compliance (e.g., Facebook Page review).
- Establish SLAs for publishing failures (e.g., respond within 2 hours during business hours) and track via on-call alerts.
- Align legal/privacy review for storing third-party tokens and presenting analytics to clients.
- Train franchise pilots with sandbox accounts before exposing to clients.

## Dependencies and next steps
1. Confirm OAuth credentials and developer app approvals for each platform.
2. Implement feature flag configuration UI in admin portal and ensure audit logging is in place before enabling pilots.
3. Prototype account connection flow and composer UI to validate UX with internal stakeholders.
4. Integrate deliverable picker with existing asset library, ensuring permissions align.
5. Finalise analytics data retention policy and cross-link to the broader analytics module documentation.
