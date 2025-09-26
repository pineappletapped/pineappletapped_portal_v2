# Stripe Connect Integration Review

This document captures five recommended improvements for the newly added Stripe Connect integration.

1. **Move long-lived secrets out of Firestore and the Next.js data flow**  
   The admin settings API persists both the Stripe secret key and webhook secret in the `settings/stripeConnect` Firestore document. Those secrets are round-tripped through `/api/admin/stripe/settings`, making them visible to any admin with DevTools access and storing them unencrypted in Firestore. Prefer reading the live keys from Google Secret Manager (or environment variables) inside server-only utilities so the browser never sees the raw values. Update `apps/web/app/api/admin/stripe/settings/route.ts` and related helpers in `apps/web/lib/stripe-config.ts` to fetch and rotate secrets securely instead of serialising them in Firestore.  

2. **Verify keys with Stripe before saving**  
   The `POST /api/admin/stripe/settings` handler accepts any string and stores it. Add a server-side validation step that uses the Stripe SDK (with an ephemeral client instantiated from Secret Manager) to confirm the secret key is valid and that the webhook secret matches a configured endpoint. Returning actionable errors will reduce misconfiguration and hard-to-debug checkout failures. See the key handling flow starting at `SETTINGS_SCHEMA` parsing in `apps/web/app/api/admin/stripe/settings/route.ts`.  

3. **Tighten role-based access on the admin routes**  
   `resolveAdminContext` relies on unsigned cookies (`uid`, `roles`) for authentication. Because those values are not verified against Firebase session cookies or JWTs, an attacker that forges cookies could hit `/api/admin/stripe/settings`. Replace the cookie check with Firebase Admin session verification (e.g. `getAuth().verifySessionCookie`) or wrap the route with an App Router `withFirebaseAuth` helper to enforce signed tokens.  

4. **Validate split payment terms more rigorously**  
   The Zod schema only ensures each term has a label and numeric values. It should also guarantee the percentages sum to ≤ 100, due dates are non-decreasing, and duplicate labels are rejected. Add derived validation in the schema (e.g. `.superRefine`) so the admin UI cannot save inconsistent payout schedules that would break downstream invoicing. See the `SPLIT_TERM_SCHEMA` usage inside the same route handler.  

5. **Defer publishable key loading to the server**  
   The checkout page (`apps/web/app/checkout/page.tsx`) performs a client-side fetch to `/api/stripe/config` on mount, causing a flash of loading state and duplicated logic for ensuring the key is configured. Convert the route to a server component that calls `getStripeConnectSettings()` once during SSR and passes the publishable key as a prop. This keeps secrets off the client fetch surface, improves TTFB, and simplifies error handling in the checkout flow.
