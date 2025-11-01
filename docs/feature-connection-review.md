# Feature connection review

This note captures portal features that are implemented in the codebase but are not yet surfaced through the product experience. For each area we describe the current state, highlight the connection gap, and outline follow-up tasks to make the feature reachable.

## Client analytics dashboard (`/analytics`)
- **What exists:** A client-facing analytics dashboard aggregates orders, projects, assets, leads, storage usage and revision metrics for the signed-in user's organisations by querying multiple Firestore collections.【F:apps/web/app/analytics/page.tsx†L1-L120】
- **Connection gap:** Neither the public site header nor the client dashboard offers a route to `/analytics`, so the dashboard is effectively hidden unless the exact URL is known.【F:apps/web/components/SiteHeader.tsx†L160-L189】【F:apps/web/app/dashboard/ClientPage.tsx†L223-L240】
- **Follow-up tasks:**
  1. Add a prominent entry point (e.g. quick action card or navigation item) for eligible portal users that links to `/analytics`.
  2. Gate the link based on data availability so users without org data see contextual guidance instead of an empty dashboard.
  3. Capture product requirements (copy, iconography) for the new entry point with the product team.

## Login history telemetry
- **What exists:** A callable `recordLogin` function appends login events to the `loginHistory` collection, and the admin login history screen lists these events with timestamps and user email resolution.【F:functions/src/index.ts†L6675-L6688】【F:apps/web/app/admin/login-history/ClientPage.tsx†L1-L73】
- **Status:** Login telemetry is currently disabled in the portal; the global session listener and supporting client hook were removed after repeated `recordLogin` errors to stabilise the checkout and browsing experience.【F:apps/web/app/layout.tsx†L1-L120】
- **Remaining follow-up tasks:**
  1. Backfill recent login events (if required) by replaying authentication audit logs or prompting affected users.
  2. Verify that the admin login history page respects role-based access and shows scoped results for non-staff viewers after the change.

## Client analytics telemetry
- **What exists:** The analytics library can enqueue page-view events and flush them to the `analytics_track` HTTP function when a tracker mounts in the client runtime.【F:apps/web/lib/analytics.ts†L1-L520】
- **Status:** The root layout no longer mounts the analytics tracker component so page-view collection is paused while callable errors are investigated.【F:apps/web/app/layout.tsx†L1-L120】
- **Remaining follow-up tasks:**
  1. Fix the callable deployment or routing so the tracker can reach a healthy endpoint before re-enabling telemetry.
  2. Reintroduce the tracker component (and any necessary guards) once the backend is stable, ensuring failures surface as console warnings instead of noisy errors.

## CRM navigation (`/crm`)
- **What exists:** A dedicated CRM hub exposes links to leads, groups, opportunities, proposals, and quote requests for staff or client admins.【F:apps/web/app/crm/page.tsx†L1-L36】
- **Status:** The admin dashboard quick links now surface the CRM area under a single “CRM” link, and the franchise portal highlights the filtered leads view without referencing a separate workspace button.【F:apps/web/app/admin/ClientPage.tsx†L236-L287】【F:apps/web/app/franchise/ClientPage.tsx†L912-L977】
- **Remaining follow-up tasks:**
  1. Ensure CRM subpages inherit consistent layout and breadcrumbs when linked from the admin and franchise entry points.
  2. Communicate the refreshed navigation labels to operations staff and franchisees so they know where to find CRM tools.

## Storage automation (`/admin/storage`)
- **What exists:** Administrators can configure the Google Drive automation defaults that provision client folders and assign HQ access for new orders.【F:apps/web/app/admin/storage/ClientPage.tsx†L1-L202】
- **Status:** The admin dashboard quick links now include a dedicated “Storage Automation” entry so operations teams can launch the settings without diving through the product catalogue.【F:apps/web/app/admin/ClientPage.tsx†L244-L286】
- **Remaining follow-up tasks:**
  1. Audit additional storage backends (e.g. OneDrive) and surface their settings within the same workspace when ready.
  2. Provide runbooks for operations covering required Drive IDs and permission hygiene.
  3. Add telemetry to confirm when storage settings change and alert the integrations team if automation fails.

## Shared email workspace (`/emails`)
- **What exists:** Authenticated users can review organisation email threads and send new outbound emails via the `emails_send` callable integration.【F:apps/web/app/emails/page.tsx†L1-L110】
- **Connection gap:** The client dashboard's quick actions focus on projects, bookings, and planner tools, leaving no way to reach the email workspace through the UI.【F:apps/web/app/dashboard/ClientPage.tsx†L223-L240】
- **Follow-up tasks:**
  1. Introduce a dashboard tile or secondary navigation item that links to `/emails` for users who belong to an organisation.
  2. Clarify empty-state copy and permissions so users without email threads understand how the feature should be used.
  3. Add tracking to measure adoption once the entry point is live.

## Social scheduling module (feature-flagged)
- **Status:** Admin and franchise tools now surface global, franchise, and organisation-level rollout toggles with audit logging so HQ can stage the pilot while automation work continues.【F:apps/web/components/admin/tools/SocialSchedulerWorkspace.tsx†L43-L104】【F:apps/web/app/api/social-scheduler/feature-flags/route.ts†L1-L249】
- **Remaining follow-up tasks:**
  1. Implement Firestore collections and security rules for `socialAccounts`, `socialPosts`, variants, targets, and analytics, plus secure token storage.
  2. (Completed) Build admin and franchise feature flag management to enable the module for test organisations without global exposure.【F:apps/web/components/admin/tools/SocialSchedulerWorkspace.tsx†L916-L1119】【F:apps/web/app/api/social-scheduler/feature-flags/route.ts†L101-L249】
  3. Deliver the account connection hub, composer, calendar, approval flow, and CSV/ICS export experience in the portal before toggling visibility for clients.
  4. Instrument publishing workers with alerting and reporting so operations can monitor failures prior to public launch.

## Organisation manager (`/orgs`)
- **What exists:** Users can list their organisations, create new ones, and jump into an org detail page, with membership documents created automatically for new orgs.【F:apps/web/app/orgs/page.tsx†L1-L114】【F:apps/web/app/orgs/new/page.tsx†L1-L49】
- **Connection gap:** There is no discoverable path to `/orgs`; current navigation omits any account or organisation management links, so the tooling is hidden behind direct URLs.【F:apps/web/components/AuthLinks.tsx†L342-L393】【F:apps/web/app/dashboard/ClientPage.tsx†L223-L240】
- **Follow-up tasks:**
  1. Add an "Organisations" link within the client portal (e.g. under account settings or quick actions) for users who administer multiple orgs.
  2. Review role gating to ensure only appropriate users can create or switch organisations from the new entry point.
  3. Provide UX copy or onboarding guidance explaining why a user might manage multiple organisations.

---

Addressing the above tasks will ensure these already-built capabilities are discoverable and instrumented, giving teams access to analytics, CRM, email, and organisation tools without relying on deep links.
