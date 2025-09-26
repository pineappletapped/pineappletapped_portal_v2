# Stripe Connect Integration Guide

This project ships with a full Stripe Connect platform implementation that powers
checkout, invoicing and franchise payouts. The configuration is managed through
the admin dashboard so that production keys can be rotated without redeploying
code.

## Configuring platform keys

1. Sign into the admin portal and open **Finance → Stripe Connect Settings**.
2. Enter the publishable key (`pk_live_…`) that should be exposed to the
   storefront checkout.
3. Paste the secret key (`sk_live_…`) and webhook signing secret (`whsec_…`).
   Leaving these fields blank will keep the currently stored values. Tick the
   “Clear stored secret on save” checkbox when you need to revoke a credential.
4. Configure optional defaults such as the platform fee percentage, the payout
   schedule (in days) and any split-payment terms.
5. Click **Save configuration**. Changes are persisted to the `settings`
   collection in Firestore and cached for both Next.js routes and Cloud
   Functions.

## Franchise onboarding

Franchise records can launch Stripe Connect onboarding or log into the Express
Dashboard from the **Franchises** admin area. The backend creates or refreshes
account links via `/api/stripe/connect/accounts` and stores the resulting Stripe
account ID against the franchise document.

## Checkout behaviour

The checkout page fetches the publishable key and split-payment configuration via
`/api/stripe/config`. Missing settings are handled gracefully with user-friendly
error states so the storefront does not crash if the keys have not been entered
yet.

## Cloud Functions

Server-side payments and transfers run inside Firebase Cloud Functions. The
functions load the latest Stripe configuration from Firestore, calculate
application fees, and create transfers to connected accounts during order
fulfilment. Secrets are cached between invocations to avoid excessive Firestore
reads while still supporting key rotation through the admin UI.
