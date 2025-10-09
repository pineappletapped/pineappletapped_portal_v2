# Website Design Admin Page Review

## Overview
The Website Design admin screen (`apps/web/app/admin/website-design/ClientPage.tsx`) now exposes four primary workspaces, each styled with the shared portal hero treatment:

- **Homepage** – manage hero copy, CTA content, hero media URLs, workflow video and stages, and the homepage card grid. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L132-L383】
- **Landing pages** – create lightweight page entries (title & slug) that feed the marketing router. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L385-L436】
- **Navigation** – drag and drop categories to control the main menu order. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L438-L471】
- **Branding** – update tracking pixel IDs and jump to the brand guidelines workspace. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L473-L520】

## Front-end coverage
The public homepage (`apps/web/app/page.tsx`) reads from `getHomepage()` and other services to render a number of sections. 【F:apps/web/app/page.tsx†L1-L151】 The refreshed admin Homepage tab now controls the elements that previously required code edits:

- **Hero media** – video source, poster image, and alternative text are saved via the admin form and used by the hero component. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L208-L261】【F:apps/web/app/page.tsx†L25-L37】
- **Process section** – title, description, video, poster, and ordered stage list can all be curated from the workflow editor. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L263-L381】
- **Homepage cards** – add, edit, and remove the highlight cards displayed beneath the hero. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L383-L431】

Sections such as services, featured products, recent blog posts, and client logos continue to source their data from the respective category, product, blog, and logo collections managed elsewhere in the CMS. 【F:apps/web/app/page.tsx†L61-L149】
