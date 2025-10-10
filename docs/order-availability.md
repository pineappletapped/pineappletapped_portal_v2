# Order Availability and Kit Reservation Flow

This document summarises how the storefront determines production availability and assigns kit reservations when a customer adds a product to their cart.

## 1. Coverage resolution

1. The customer enters a filming address and postcode in the add-to-cart wizard.
2. The postcode is matched against franchise territories to determine the primary operator:
   - If a franchise owns the territory, the coverage assignment records the franchise ID and territory metadata.
   - If no franchise is responsible, coverage defaults to HQ operations.
3. The coverage metadata is passed to the `reserveKit` callable when the customer confirms their production date.

The wizard caches the resolved coverage alongside the cart item so that any retries reuse the same routing context. This context is the basis for which reservation stages are attempted in the next section.

## 2. Reservation attempts

The `reserveKit` function evaluates availability in three stages, stopping as soon as a stage can cover the booking:

1. **Franchise operations** – Kit owned by the franchise assigned to the territory. A successful match confirms kit immediately.
2. **Franchise freelance/team network** – Kit registered to users within the same franchise. Success keeps the request in a *pending confirmation* state.
3. **HQ operations** – Company-owned kit used as a final fallback. Success also remains pending until operations confirm.

If the coverage assignment routes directly to HQ (because no franchise exists) only the HQ stage is evaluated.

Each stage uses the same equipment IDs defined on the product. If a stage cannot supply an item—because the item belongs to another owner, is already booked, marked unavailable, or lacks the required compliance standard—the stage fails and the next fallback is tried.

> **Manual routing note:** When an enabled routing stage has the **Check kit automatically** toggle disabled the callable now short-circuits straight to that stage, skipping Firestore equipment lookups entirely. This matches the expectation that manual routing leans on the calendar’s staffing availability instead of inventory checks. 【F:functions/src/index.ts†L5861-L5877】

Behind the scenes each stage is described by a `ReservationAttempt` structure that holds the owner type (`company`, `franchise`, or `user`), franchise ID, initial status (`confirmed` for franchise-owned kit, `pending` otherwise), and whether kit is required at all. The callable iterates through this array until one attempt succeeds or every option produces conflicts.

## 3. Equipment and standards checks

For each required kit item the reservation flow:

- Confirms the equipment document exists and belongs to the current stage owner.
- Verifies the equipment is marked available and has no bookings overlapping the requested day.
- Tracks which compliance standards the equipment meets and records any missing requirements.
- Builds a list of kit items, including rental totals, for whichever stage succeeds.

The conflict test for bookings happens in two layers:

1. Firestore narrows the search by retrieving bookings where `end > start`. This keeps the query valid (only one inequality) while returning every reservation that could still be in progress when the requested window begins. 【F:functions/src/index.ts†L5954-L5963】
2. Each candidate booking is compared against the requested `start`/`end` window using the `bookingConflictsWithRange` helper. Overlaps mark the equipment as `booked`, adding a conflict if that stage owns the kit. 【F:functions/src/index.ts†L5959-L5965】

If no stage can supply the kit, the response lists the conflicts and missing standards so the UI can surface the exact issues.

## 4. Reservation outcomes and writes

- When a stage succeeds with a `confirmed` status (franchise-owned kit), the callable immediately writes booking documents under each equipment item so the time range is blocked for future checks. 【F:functions/src/index.ts†L6107-L6121】
- Pending responses skip the write so operations can intervene. The response still reports the planned kit items and the stage that will handle the job.
- If every attempt fails, the callable returns the conflicts and missing standards from the last attempt so the storefront can show specific remediation steps. 【F:functions/src/index.ts†L6127-L6156】

## 5. UI feedback and calendar state

- The add-to-cart wizard surfaces warnings when availability falls back to the franchise team or HQ, or when conflicts/missing standards require manual confirmation.
- The production date calendar caches availability overrides locally:
  - **Confirmed** reservations mark the selected date as available.
  - **Pending** reservations mark the date as pending confirmation.
  - **Conflicts** that stop the booking mark the date as unavailable.
- Catch-all errors during reservation also mark the date as pending so users know confirmation is outstanding.
- Products declare how many days the crew will be on site via the `onsiteDays` field. The wizard blocks that many consecutive days on the availability calendar and shows the resulting range when the customer selects a start date.
- Exhibition bookings can optionally extend the reservation by a setup day; the storefront passes an explicit span override so the reservation API locks both the setup and filming dates in one request.

These steps ensure customers see the correct availability before checkout while operations receive clear visibility of which team needs to confirm the booking.

## 6. Time windows for short sessions

- Products can now capture on-site setup, filming, and breakdown minutes along with an optional booking window. When a product supplies any of these timings, the add-to-cart wizard presents a list of time slots after the customer picks a production date.
- The selected slot is stored on the cart item and surfaced at checkout so operations know exactly when the crew is expected. Customers still see the day-level availability state, but the calendar requires a slot before the product can be added to the cart.
- The `reserveKit` callable receives the time window alongside the usual start date. For single-day sessions it evaluates kit conflicts using the precise start/end times so multiple bookings can coexist on the same day. Multi-day reservations continue to block full days to cover setup and filming.

## 7. Error handling surfaced to customers

- Validation failures (missing product ID/date, unparseable dates) raise `invalid-argument` errors which the client surfaces inline.
- When the callable returns a `failed-precondition` error with `missingStandards`, the wizard shows targeted messaging explaining which compliance documents are missing. 【F:apps/web/components/AddToCartWizard.tsx†L2010-L2035】
- Any other error path—including network failures or unexpected exceptions—falls back to the generic “We couldn't reserve the equipment right now. Try again in a moment.” alert. This is the exact message reported when the callable cannot complete, and it is logged alongside the thrown error in the browser console for debugging. 【F:apps/web/components/AddToCartWizard.tsx†L2036-L2045】
