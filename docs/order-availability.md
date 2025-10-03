# Order Availability and Kit Reservation Flow

This document summarises how the storefront determines production availability and assigns kit reservations when a customer adds a product to their cart.

## 1. Coverage resolution

1. The customer enters a filming address and postcode in the add-to-cart wizard.
2. The postcode is matched against franchise territories to determine the primary operator:
   - If a franchise owns the territory, the coverage assignment records the franchise ID and territory metadata.
   - If no franchise is responsible, coverage defaults to HQ operations.
3. The coverage metadata is passed to the `reserveKit` callable when the customer confirms their production date.

## 2. Reservation attempts

The `reserveKit` function evaluates availability in three stages, stopping as soon as a stage can cover the booking:

1. **Franchise operations** – Kit owned by the franchise assigned to the territory. A successful match confirms kit immediately.
2. **Franchise freelance/team network** – Kit registered to users within the same franchise. Success keeps the request in a *pending confirmation* state.
3. **HQ operations** – Company-owned kit used as a final fallback. Success also remains pending until operations confirm.

If the coverage assignment routes directly to HQ (because no franchise exists) only the HQ stage is evaluated.

Each stage uses the same equipment IDs defined on the product. If a stage cannot supply an item—because the item belongs to another owner, is already booked, marked unavailable, or lacks the required compliance standard—the stage fails and the next fallback is tried.

## 3. Equipment and standards checks

For each required kit item the reservation flow:

- Confirms the equipment document exists and belongs to the current stage owner.
- Verifies the equipment is marked available and has no bookings overlapping the requested day.
- Tracks which compliance standards the equipment meets and records any missing requirements.
- Builds a list of kit items, including rental totals, for whichever stage succeeds.

If no stage can supply the kit, the response lists the conflicts and missing standards so the UI can surface the exact issues.

## 4. UI feedback and calendar state

- The add-to-cart wizard surfaces warnings when availability falls back to the franchise team or HQ, or when conflicts/missing standards require manual confirmation.
- The production date calendar caches availability overrides locally:
  - **Confirmed** reservations mark the selected date as available.
  - **Pending** reservations mark the date as pending confirmation.
  - **Conflicts** that stop the booking mark the date as unavailable.
- Catch-all errors during reservation also mark the date as pending so users know confirmation is outstanding.
- Products declare how many days the crew will be on site via the `onsiteDays` field. The wizard blocks that many consecutive days on the availability calendar and shows the resulting range when the customer selects a start date.
- Exhibition bookings can optionally extend the reservation by a setup day; the storefront passes an explicit span override so the reservation API locks both the setup and filming dates in one request.

These steps ensure customers see the correct availability before checkout while operations receive clear visibility of which team needs to confirm the booking.
