# Affiliate programme requirements brief

## Objective
Launch a managed affiliate programme within the admin marketing workspace that enables HQ to recruit, onboard, track and pay external marketers who drive new business, while giving affiliates a self-service portal to monitor their performance and payouts.

## Stakeholders and personas
- **Marketing ops administrators** manage the affiliate directory, review applications, configure commission policies and run payouts.
- **Affiliates / social media marketers** submit onboarding forms, share tracked links, monitor attributed clients and earnings, and request withdrawals.
- **Finance** exports payout reports, reconciles remittances and ensures VAT treatment is accurate.
- **CRM / sales teams** need visibility of which clients are affiliate-sourced for pipeline and service coordination.

## Admin marketing workspace requirements
- Add an "Affiliate Programme" section under Marketing in the admin panel with tabs for:
  - **Directory**: list, search and filter affiliates (status, verification state, outstanding balance, last activity).
  - **Applications**: review pending onboarding forms, approve/reject, capture notes, and trigger welcome/decline notifications.
  - **Assets & links**: generate / regenerate unique referral links and downloadable collateral per affiliate.
  - **Payouts**: view affiliates eligible for payout (balance ≥ £50), mark payouts as scheduled/completed, record payment references, export CSV/ledger data.
- Admin actions per affiliate:
  - Create/edit affiliate profile (name, trading name, contact info, social handles, tax/VAT number, commission rate overrides, approval status, notes).
  - Suspend/terminate affiliate to stop new attribution and payouts while preserving history.
  - Reset or expire referral links.
  - View attributed clients, leads, orders, and commission ledger for auditing.
- Metrics within admin view: total leads, conversion rate, order revenue attributed, commission due/paid, last click timestamp.

## Affiliate onboarding form
- Hosted as a "Marketer" tab within the public "Join Our Team" page.
- Form fields:
  - Personal details (full name, email, phone, preferred communication channel).
  - Business information (company name, VAT number if registered, postal address, website/social profiles, primary niches/audience size).
  - Payment details (bank account holder, sort code, account number, payout preference).
  - Compliance acknowledgements (GDPR consent, affiliate agreement acceptance, marketing consent, tax declaration about VAT status).
  - Optional upload for proof of identity/business registration.
- Upon submission:
  - Create application record with status `pending_review`.
  - Notify marketing ops via email/Slack.
  - Auto-acknowledge applicant via email with expected review timeline.

## Affiliate portal requirements
- Secure login (same auth as portal) with affiliate role gating.
- Dashboard widgets:
  - Current commission balance (net, VAT, gross) and payout threshold status.
  - Month-to-date leads, orders, conversion rate, and link clicks.
  - Recent attributed clients (names only) and latest orders.
  - Latest announcements/resources from HQ.
- Detailed tabs:
  - **Performance**: charts of clicks, leads, orders, revenue over selectable time ranges; export CSV.
  - **Clients**: list names of onboarded clients with first order date, lifetime value, status.
  - **Commissions**: ledger of each order with breakdown of base amount, rate applied, net, VAT, gross, payout status, payment reference.
  - **Links & assets**: display unique referral link(s), trackable codes, creative assets, and guidance on usage.
  - **Account**: update contact info, payout details, W-8/W-9 equivalent docs, enable 2FA, view agreement copies.
- Notifications within portal for approved status, payout processed, bank details missing, link issues.

## Tracking and attribution
- Generate unique referral codes/links per affiliate (e.g. `https://domain/?ref=CODE`).
- Track click events (timestamp, affiliate, URL, IP/geo, user agent) and surface counts in portal.
- Attribute leads/orders when:
  - A session includes a valid referral code (first-party cookie with expiration, e.g. 30–60 days).
  - Client is directly selected on onboarding form (manual entry by staff) with affiliate selection.
  - Manual overrides in admin (reassign affiliate for a lead/order).
- On conversion:
  - Tag CRM client record with `affiliateId`, `affiliateName`, referral code, attribution source, and original click reference.
  - Persist attribution for lifetime of client so future orders accrue commission until affiliate is removed/suspended.
- Handle edge cases: duplicate clicks, multiple affiliates (last-touch vs. first-touch policy), cookie expiry, cross-device signups.

## Commission and payout logic
- Default commission: 50% of HQ's commission on attributed orders; allow per-affiliate overrides.
- Commission calculation per order:
  - Determine eligible orders (status confirmed/paid, exclude refunds/voids).
  - Base = HQ commission amount net of VAT.
  - Affiliate commission net = base × rate.
  - VAT = commission net × VAT rate (if affiliate VAT-registered; toggle per affiliate).
  - Gross = net + VAT.
- Ledger entries created automatically when order closes, with order reference, client, date, amounts, and payout state (`pending`, `scheduled`, `paid`, `held`).
- Allow adjustments (manual debit/credit) with notes for disputes or corrections.

## Payout workflow
- Affiliates become payout-eligible when pending net balance ≥ £50.
- Admin payout run (monthly):
  1. Filter eligible affiliates.
  2. Validate bank details and compliance docs.
  3. Mark entries as `scheduled` and export remittance report (per affiliate and consolidated CSV).
  4. Finance processes payments manually in banking system.
  5. Admin marks payments `paid`, records payment date/reference, and triggers email notification with remittance PDF (showing net + VAT breakdown).
- Allow affiliates to download historical remittances and view payout timeline.
- Handle withheld payments (missing bank details, compliance hold) with alerts and status badges.

## Data model considerations
- Collections / tables:
  - `affiliates` (profile, status, commissionRate, VAT flag, payout details, lastLogin, metrics).
  - `affiliateApplications` (form responses, review status, reviewer notes, decision timestamps).
  - `affiliateClicks` (link tracking events).
  - `affiliateCommissions` (per order ledger entries, amounts, payout status).
  - Extend `clients` and `orders` with embedded affiliate references.
- Audit fields (createdBy, updatedBy, timestamps) for compliance.
- Secure storage for payout details (encrypted at rest, restricted access).

## Compliance, security, and ops
- Enforce GDPR principles: only expose client names to affiliates, no contact details; include privacy notice in onboarding.
- Require acceptance of affiliate agreement and store version/date.
- Support right-to-be-forgotten requests by anonymising data while preserving financial records.
- Role-based access controls so only marketing/finance staff see payout details.
- Logging and alerts for suspicious click activity (fraud detection thresholds).

## Communications and automation
- Email/SMS templates:
  - Application received, approved, rejected, suspended.
  - New client attributed, commission posted, payout scheduled, payout completed, missing bank info reminders.
- Optional Slack/Teams notifications to marketing ops for new applications and high-performing affiliates.
- Knowledge base/FAQ integration for affiliate guidance.

## Open questions / decisions needed
1. Attribution window duration and tie-breaker policy when multiple affiliates refer the same client.
2. Whether affiliates can refer existing clients (upsell) or only net-new customers.
3. Required tax documentation for international affiliates.
4. Service-level objective for application review and payout processing.
5. Branding/copy requirements for public marketing pages and portal UI.

