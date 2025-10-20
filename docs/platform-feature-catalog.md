# Pineapple Tapped Portal Feature Catalogue

This catalogue captures the notable features implemented in the Pineapple Tapped portal so the platform can be re-created or extended with a clear understanding of how each capability works.

## Workspace Shell & Navigation

- **Adaptive workspace resolver.** `PortalContainer` inspects the current pathname and selects a role-specific configuration that drives navigation sections, quick actions, and layout chrome for the admin and client experiences.【F:apps/web/components/PortalContainer.tsx†L83-L382】
- **Persistent identity block.** The container subscribes to Firebase Auth, surfaces the signed-in user’s initials, and gracefully falls back when no profile metadata is available.【F:apps/web/components/PortalContainer.tsx†L213-L352】
- **Responsive navigation.** Desktop users get a full-height sidebar with grouped links while mobile users receive an overlay drawer with accessible open/close controls so the workspace works on every screen width.【F:apps/web/components/PortalContainer.tsx†L252-L408】

## Shared Layout Components

- **Portal hero module.** `PortalHero` standardises the hero treatment across workspaces, exposing eyebrow, title, descriptive copy, KPI tiles, and quick action slots that can be rendered as links or buttons.【F:apps/web/components/PortalHero.tsx†L1-L80】
- **Admin layout scaffolding.** `AdminWorkspaceLayout` wraps screens in the shared shell, rendering a branded header, optional hero ribbon, flexible action slots, and tone-aware `AdminSection` panels to keep admin surfaces consistent.【F:apps/web/components/admin/AdminWorkspaceLayout.tsx†L20-L96】

## Access Control & Role Awareness

- **Role-gated routing.** The `useRoleGate` hook bootstraps Firebase Auth, fetches the requesting user’s role document, and exposes loading/allowed state so views can protect staff-only interfaces without flashing restricted content.【F:apps/web/hooks/useRoleGate.ts†L1-L96】

## Admin Operations Workspace

- **Operational overview.** The admin dashboard aggregates order, project, client, product, quote, and proposal totals via Firestore aggregate queries and trend samplers to provide an instant operational pulse.【F:apps/web/app/admin/ClientPage.tsx†L25-L200】
- **Risk and backlog alerts.** Threshold checks raise prominent hero alerts when quotes or proposals breach configured backlog levels, ensuring teams know when to intervene.【F:apps/web/app/admin/ClientPage.tsx†L134-L289】
- **Productivity feeds.** Recent project tasks, curated quick links, and hero quick actions connect admins to fulfilment, tooling, people management, and marketing destinations in a single workspace.【F:apps/web/app/admin/ClientPage.tsx†L291-L400】

## Client Collaboration Workspace

- **Unified dashboard.** The client dashboard composes orders, bookings, organisation projects, remarketing recommendations, notifications, and asset releases associated with the signed-in user and their organisations.【F:apps/web/app/dashboard/ClientPage.tsx†L24-L200】
- **Project context enrichment.** For each project, the dashboard resolves linked orders to summarise kit requirements and filters client-facing tasks so customers can track actionable items without digging into admin tooling.【F:apps/web/app/dashboard/ClientPage.tsx†L86-L133】
- **Remarketing intelligence.** HQ-driven remarketing suggestions merge user-specific and organisation-level campaigns, filter to actionable statuses, and surface the newest opportunities first.【F:apps/web/app/dashboard/ClientPage.tsx†L141-L193】

## Platform Services & Integrations

- **CORS foundation.** A bespoke CORS utility compiles wildcard-aware origin patterns, honours environment overrides, manages preflight responses, and exposes `withCors` so HTTPS functions can share a single enforcement path.【F:functions/src/utils/cors.ts†L1-L314】
- **Order intake API.** The `createOrder` HTTPS endpoint validates authentication headers, accepts raw or JSON-wrapped payloads, and delegates to the order execution pipeline under the shared CORS layer.【F:functions/src/index.ts†L11019-L11099】
- **Automatic client research.** Whenever an order is created, the platform inspects client preferences, attempts wallet debits, writes audit logs, and optionally enqueues a research job to keep onboarding insights flowing without manual work.【F:functions/src/index.ts†L11101-L11199】
- **Stripe billing toolkit.** Callable Stripe helpers generate PaymentIntents for deposits, balances, or custom amounts, calculate franchise and organiser fee splits, and respect authenticated access controls.【F:functions/src/index.ts†L11870-L11958】
- **Lifecycle email scheduling.** Staff can create, update, and delete email schedules while a five-minute Pub/Sub task fans out batched outreach to lead groups and advances the next-run cursor.【F:functions/src/index.ts†L14088-L14166】

## Using This Catalogue

Each section above links to the concrete implementation that delivers the described behaviour. Rebuilding the platform involves recreating the workspace shell, shared layout components, role-aware guards, and the orchestration endpoints outlined here. The cited modules provide the exact data flows, access checks, and UI compositions that define Pineapple Tapped’s portal experience.
