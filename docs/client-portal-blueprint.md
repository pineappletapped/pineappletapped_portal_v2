# Client portal experience blueprint

This note captures the client portal features that exist today, how the refreshed dashboard surfaces them, and which follow-up
connections remain for the roadmap. Use it alongside the feature connection review to keep the client journey coherent.

## Experience pillars delivered in the dashboard

| Pillar | What the user sees | Data source / workspace |
| --- | --- | --- |
| Welcome & quick actions | Hero banner summarising active work, direct links to project creation, bookings, catalogue, analytics, shared inbox and organisation management. | `apps/web/app/dashboard/ClientPage.tsx` hero metrics and quick action nav. |
| Tasks | Filterable list of outstanding customer tasks with direct action buttons. | Project task sub-collections, surfaced in `ClientPage.tsx`. |
| Projects | Snapshot of live projects with status and milestone context plus “view all” CTA. | Firestore `projects` collection. |
| Orders & billing | Latest orders with status + placed date and a link to full details, including those teammates raised under the same organisation. | Firestore `orders` collection filtered by user ID and organisation membership. |
| Asset deliveries | Quick access to newly uploaded assets and approvals. | Firestore `assets` collection. |
| Bookings | Upcoming shoot schedule with manage CTA. | Firestore `bookings` collection. |
| Growth opportunities | Remarketing suggestions and campaign recommendations to drive upsells. | `remarketingSuggestions` and `recommendations` collections. |
| Social scheduling (feature-flagged) | Hidden module for connecting social accounts, planning posts, and reviewing asset performance when enabled. | See `docs/social-scheduling-module.md` for rollout plan; data spans `socialAccounts`, `socialPosts`, analytics collections. |
| Annual content planner | Highlight card promoting the `/dashboard/content-planner` tool. | Planner workspace within the app. |
| Notifications | Recent messages and milestones for quick scanning. | Firestore `notifications` collection. |

## Draft features and connection tasks

| Feature | Current state | Connection tasks |
| --- | --- | --- |
| Analytics dashboard (`/analytics`) | Fully functional but historically hidden; now linked from dashboard quick actions. | Verify eligibility gating and capture onboarding copy for analytics usage. |
| Shared email workspace (`/emails`) | Callable-backed email hub; now accessible via quick actions. | Adoption telemetry after launch. |
| Organisation manager (`/orgs`) | Allows switching and creating organisations; now discoverable via quick actions. | Review role gating and document when to create a new org. |
| Storage automation (`/admin/storage`) | Admin-only but referenced in sales conversations. | Expose relevant read-only summary in client portal once integration supports it. |
| CRM light-touch view | Leads/opportunities live under `/crm` for eligible roles. | Evaluate a read-only funnel snapshot card for client admins inside the portal. |
| Proposal follow-up | Proposals surface in CRM but not in client portal. | Design a proposal status widget that links back to `/crm/proposals`. |
| Post-campaign retros | No dedicated UI yet. | Scope a “campaign insights” module pulling from analytics and survey responses. |
| Social scheduling & analytics module | Planning doc drafted; UI intentionally hidden behind feature flag pending pilot. | Build account connection hub, composer, calendar UI, and export mode per `docs/social-scheduling-module.md`; ship admin/franchise toggles before exposing to clients. |

## Next steps

1. Prioritise analytics onboarding copy and eligibility checks.
2. Define telemetry events for the shared inbox and organisation quick actions.
3. Prototype proposal and CRM summary widgets once the data contracts stabilise.
4. Align design with marketing for the post-campaign retrospective feature before build.
