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
- **Status:** Login telemetry now runs from a global session listener so every authenticated portal mounts the `recordLogin` callable during auth initialisation, regardless of the landing page.【F:apps/web/app/layout.tsx†L6-L47】【F:apps/web/components/LoginTelemetryListener.tsx†L1-L7】【F:apps/web/hooks/useLoginTelemetry.ts†L1-L79】
- **Remaining follow-up tasks:**
  1. Backfill recent login events (if required) by replaying authentication audit logs or prompting affected users.
  2. Verify that the admin login history page respects role-based access and shows scoped results for non-staff viewers after the change.

## CRM workspace (`/crm`)
- **What exists:** A dedicated CRM hub exposes links to leads, groups, opportunities, proposals, and quote requests for staff or client admins.【F:apps/web/app/crm/page.tsx†L1-L36】
- **Connection gap:** No navigation element points to `/crm`. Auth controls only surface buttons for the client, franchise, team, and admin portals, so staff cannot discover the CRM workspace without typing the URL manually.【F:apps/web/components/AuthLinks.tsx†L342-L393】
- **Follow-up tasks:**
  1. Design and add a CRM entry point for authorised roles (e.g. within the admin dashboard quick links or the authenticated header menu).
  2. Ensure CRM subpages inherit consistent layout and breadcrumbs when linked from new entry points.
  3. Communicate the new navigation path to operations staff so they know where to find CRM tools.

## Shared email workspace (`/emails`)
- **What exists:** Authenticated users can review organisation email threads and send new outbound emails via the `emails_send` callable integration.【F:apps/web/app/emails/page.tsx†L1-L110】
- **Connection gap:** The client dashboard's quick actions focus on projects, bookings, and planner tools, leaving no way to reach the email workspace through the UI.【F:apps/web/app/dashboard/ClientPage.tsx†L223-L240】
- **Follow-up tasks:**
  1. Introduce a dashboard tile or secondary navigation item that links to `/emails` for users who belong to an organisation.
  2. Clarify empty-state copy and permissions so users without email threads understand how the feature should be used.
  3. Add tracking to measure adoption once the entry point is live.

## Organisation manager (`/orgs`)
- **What exists:** Users can list their organisations, create new ones, and jump into an org detail page, with membership documents created automatically for new orgs.【F:apps/web/app/orgs/page.tsx†L1-L114】【F:apps/web/app/orgs/new/page.tsx†L1-L49】
- **Connection gap:** There is no discoverable path to `/orgs`; current navigation omits any account or organisation management links, so the tooling is hidden behind direct URLs.【F:apps/web/components/AuthLinks.tsx†L342-L393】【F:apps/web/app/dashboard/ClientPage.tsx†L223-L240】
- **Follow-up tasks:**
  1. Add an "Organisations" link within the client portal (e.g. under account settings or quick actions) for users who administer multiple orgs.
  2. Review role gating to ensure only appropriate users can create or switch organisations from the new entry point.
  3. Provide UX copy or onboarding guidance explaining why a user might manage multiple organisations.

---

Addressing the above tasks will ensure these already-built capabilities are discoverable and instrumented, giving teams access to analytics, CRM, email, and organisation tools without relying on deep links.
