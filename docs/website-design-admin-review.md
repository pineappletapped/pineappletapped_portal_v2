# Website Design Admin Page Review

## Overview
The Website Design admin screen (`apps/web/app/admin/website-design/ClientPage.tsx`) currently exposes four primary tabs:

- **Homepage** – edit hero, about, CTA copy and a set of homepage cards, persisting to `settings/homepage` in Firestore. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L33-L140】
- **Pages** – add barebones page documents (title & slug). 【F:apps/web/app/admin/website-design/ClientPage.tsx†L183-L197】
- **Menu** – reorder top-level categories used for navigation. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L200-L229】
- **Branding** – set tracking pixel IDs, with a CTA directing editors to brand guidelines for visual assets. 【F:apps/web/app/admin/website-design/ClientPage.tsx†L232-L240】【F:apps/web/app/admin/website-design/ClientPage.tsx†L243-L262】

## Front-end coverage
The public homepage (`apps/web/app/page.tsx`) reads from `getHomepage()` and other services to render a number of sections. 【F:apps/web/app/page.tsx†L1-L151】 While the admin Homepage tab controls headline text, about copy, CTA messaging, and the optional card grid, several key elements remain hard-coded or sourced elsewhere:

- **Hero media** – the hero video URL and poster are fixed in the component and cannot be updated from the admin UI. 【F:apps/web/app/page.tsx†L27-L33】
- **Process section** – title, description, video, poster, and the list of stages are expected in Firestore, but the admin page offers no interface to edit them. 【F:apps/web/app/page.tsx†L35-L41】
- **Services, products, blog, and client logos** – these sections rely on category, product, blog post, and logo collections managed by other parts of the CMS, not by the Website Design screen. 【F:apps/web/app/page.tsx†L61-L149】

## Conclusion
The current Website Design admin page does **not** provide control over every piece of text or every element displayed on the public site. Editors can manage key homepage copy blocks and card content, but hero media, the process walkthrough, and the dynamically generated sections (services, product highlights, blog feed, client logos) must be updated through other dedicated admin tooling or code changes.
