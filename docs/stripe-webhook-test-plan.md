# Stripe Webhook Regression Test Plan

This plan captures the coverage required for the new Stripe reconciliation helpers that
record order and invoice payments. Automated tests should be implemented under the
Functions test suite.

## Payment Intent Reconciliation
- **Handles first-time payment**: dispatch a `payment_intent.succeeded` fixture with
  `metadata.invoiceId` and assert the invoice document is marked paid, outstanding
  balance cleared, history appended, and Stripe audit fields populated.
- **Duplicate webhook event**: replay the same payload and confirm the invoice is left
  unchanged and no duplicate history entry is created.
- **Missing invoice metadata**: send a payment intent without `invoiceId`/`payment_link`
  and verify the helper no-ops while logging a warning.

## Checkout Session Reconciliation
- **Session completion with metadata**: simulate `checkout.session.completed` with
  `metadata.orderId` and `metadata.invoiceId`. Confirm
  `recordOrderStripePayment` is invoked once, the order payment schedule updates,
  and invoice reconciliation runs exactly once.
- **Session missing order metadata**: ensure the webhook exits gracefully when the
  session lacks `client_reference_id` and `metadata.orderId`, and no Firestore writes
  occur.
- **Session referencing unknown order**: ensure the checkout session record still
  persists on the order document when the order snapshot is missing, allowing staff
  to diagnose the orphaned payment.

## Order Payment Helpers
- **Deposit then balance flow**: seed an order with a payment schedule, feed
  deposit and balance payments, and assert `processOrderPostPayment` marks the
  appropriate schedule entries paid and auto-creates the project when absent.
- **Custom payment type**: submit a payment with `type: 'custom'` and confirm it is
  stored, added to history, and does not alter the schedule.
- **Idempotent session tracking**: call `updateOrderCheckoutSessionRecord` twice with
  the same session; confirm the existing entry is merged and timestamps are updated
  without creating duplicates.

Documented expectations should translate into Jest (or equivalent) cases alongside
Firestore emulator fixtures so future webhook changes remain safe.
