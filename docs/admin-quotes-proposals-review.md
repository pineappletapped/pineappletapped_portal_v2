# Admin Quotes & Proposals Review

## Overview
The admin workspace exposes a combined Quotes & Proposals surface plus dedicated builders for new proposals and reusable templates. The experience currently leans on client-side Firestore queries and callable functions to populate tables, draft proposals, and persist template changes.

## Key findings

### 1. Editing flow is wired to a non-existent implementation
The listing links "Edit" actions to `/admin/proposals/new?id=...`, but the builder never reads the query string or hydrates existing proposals. Pressing Edit simply opens an empty creation wizard, so staff cannot revise records they have already sent.【F:apps/web/app/admin/proposals/ClientPage.tsx†L147-L151】【F:apps/web/app/admin/proposals/new/ClientPage.tsx†L115-L191】【F:apps/web/app/admin/proposals/new/ClientPage.tsx†L518-L823】

### 2. Firestore queries load entire collections without filtering
Both the list page and the creation wizard call `getDocs` on `proposals`, `quoteRequests`, `users`, `orgs`, `products`, `proposalSections`, `agreements`, and `proposalTemplates` with no limits, ordering, or pagination. At scale this will block the UI, trigger expensive reads, and risks exceeding query limits.【F:apps/web/app/admin/proposals/ClientPage.tsx†L83-L90】【F:apps/web/app/admin/proposals/new/ClientPage.tsx†L175-L191】【F:apps/web/app/admin/proposals/templates/ClientPage.tsx†L159-L205】

### 3. Status updates lack error handling or optimistic guards
Changing proposal or quote status immediately mutates local state after `updateDoc` but never awaits completion with error handling or disables the select while a request is in flight. Any rejected write will leave the UI out of sync with Firestore and gives no feedback to the user.【F:apps/web/app/admin/proposals/ClientPage.tsx†L96-L154】

### 4. Proposal creation leans on broad permissions and minimal validation
The creation wizard relies on reading the current user document to infer roles, then fetches CRM directories, organisations, sections, templates, and agreements entirely on the client. Beyond checking `orgId` and `clientEmail`, the submit handler forwards whatever `items`, `agreements`, and `sections` are in state to the callable. There is no client-side confirmation that a proposal contains at least one line item, nor that pricing numbers are finite.【F:apps/web/app/admin/proposals/new/ClientPage.tsx†L165-L537】【F:functions/src/index.ts†L15690-L15862】

### 5. Template workspace mirrors the same scaling and validation gaps
The template builder eagerly loads every template, agreement, and product on mount and only surfaces a console error when loading fails. Saving changes depends on a callable but there is no indication of concurrent edits, required fields, or validation for placeholder usage, which increases the chance of publishing incomplete templates.【F:apps/web/app/admin/proposals/templates/ClientPage.tsx†L121-L240】

### 6. Callable backend does not integrate with CRM or quote pipelines
`admin_createProposal` normalises items, sections, and agreements before inserting a `proposals` document and writing an audit log, but it does not update the originating `quoteRequests` record, CRM pipeline status, or notify the assigned salesperson. The admin UI therefore requires manual follow-up to keep sales tooling in sync.【F:functions/src/index.ts†L15690-L15862】

## Recommendations
1. Implement a dedicated edit route that loads an existing proposal by id, populates the wizard, and persists incremental changes.
2. Replace unbounded collection reads with paginated queries (e.g., ordering by `createdAt` and limiting page size) or server-side data loaders.
3. Introduce request-state management for status changes (disable the select, surface errors, and roll back optimistic updates on failure).
4. Add validation in both the client wizard and callable to enforce required fields (at least one priced item, numeric totals, valid email) and constrain access via server-side role checks.
5. Batch template metadata through lightweight list endpoints and require explicit validation feedback before saving to avoid corrupt presets.
6. Extend the callable flow to update linked quote/CRM records and trigger notifications so proposals stay aligned with the broader sales pipeline.
