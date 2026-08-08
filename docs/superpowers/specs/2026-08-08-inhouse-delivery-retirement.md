# Retiring in-house delivery — inventory and preconditions

**Date:** 2026-08-08
**Status:** prepared, not executed
**Phase:** 5

## Why this was not executed

Phase 5 was planned as "retire the in-house rider system". It was deliberately
**not** carried out, because the preconditions are not met:

| | |
|---|---|
| Orders total | 7 |
| Orders with a rider assigned | **7 — all of them** |
| Users with `role=rider` | 2 |
| `delivery_zones` rows | 2 — every checkout quote currently falls back to these |
| Fast Link pickup addresses | **0** usable |
| Orders dispatched to Fast Link | **0** |
| `FASTLINK_WEBHOOK_SECRET` | unset |
| Deployed | no |

`quoteShippingForItems` returns `fallback` for every order because no vendor has
a pickup address, so checkout prices from `delivery_zones` and fulfilment happens
by rider. Deleting that today would leave carmel-mart with no working delivery.

## What was done instead

1. **`config.delivery.inHouseEnabled`** — defaults ON; only the exact string
   `"false"` in `DELIVERY_INHOUSE_ENABLED` turns it off, so a typo cannot silently
   disable fulfilment.
2. **The single door is gated.** Rider assignment happens in exactly one place,
   `PATCH /api/admin/orders/[id]`. With the flag off it returns 409.
   - Unassigning still works, or an order could be stranded with a rider who is no
     longer delivering.
   - Orders already assigned are untouched.
   - The `/rider` portal is deliberately **not** closed — riders must finish
     in-flight deliveries. It drains naturally once no new orders arrive.
3. **Every surface carries a deprecation marker** pointing back here.

## Preconditions for actually deleting

In order:

1. All 60 remaining vendors have a Fast Link pickup address (set via the
   autocomplete in vendor settings, not the geocoding backfill — see the Fast Link
   memory for why free-text geocoding produced a wrong city).
2. `FASTLINK_WEBHOOK_SECRET` set and the webhook registered.
3. Deployed, with real orders dispatching and status flowing back.
4. `DELIVERY_INHOUSE_ENABLED=false` has run clean in production for a meaningful
   period — long enough for the in-flight riders to drain.

Only then is the inventory below safe to remove.

## Removal inventory

**Delete outright**

| Path | Notes |
|---|---|
| `app/(rider)/layout.jsx` | rider portal shell |
| `app/(rider)/rider/page.jsx` | |
| `app/(rider)/rider/orders/page.jsx` | subscribes to `rider_id` Realtime |
| `app/api/rider/orders/route.js` | |
| `app/api/rider/orders/[id]/status/route.js` | |
| `app/api/admin/riders/route.js` | |
| `app/api/admin/riders/[id]/route.js` | |
| `app/(admin)/admin/riders/page.jsx` | |
| `components/shared/rider/RiderShell.jsx` | |
| `app/api/admin/vendor-riders/route.js` | vendor self-reported rider capability |
| `app/api/vendor/delivery-rider/route.js` | |
| `components/shared/vendor/DeliveryRiderPrompt.jsx` | |
| `app/api/customer/orders/[id]/rider-review/route.js` | check `rider_reviews` retention first |
| `app/api/admin/delivery-zones/route.js` | only after Fast Link prices every order |
| `app/api/admin/delivery-zones/[id]/route.js` | |
| `app/api/delivery-zones/route.js` | |

**Edit, do not delete**

| Path | Change |
|---|---|
| `middleware.js` | drop `RIDER_PATHS` |
| `lib/session.js` | drop `requireRider` |
| `lib/auth-context.jsx` | drop the rider role |
| `app/auth/callback/route.js` | drop rider post-login routing |
| `app/(auth)/login/page.jsx` | drop rider redirect |
| `components/common/navbar/index.jsx`, `MobileDrawer.jsx` | drop rider links |
| `components/shared/admin/AdminShell.jsx` | drop the Riders nav item |
| `components/shared/vendor/VendorShell.jsx` | drop the rider prompt |
| `app/(admin)/admin/orders/page.jsx` | drop the assign-rider UI |
| `app/api/admin/orders/[id]/route.js` | drop `rider_id` assignment and the flag guard |
| `app/api/admin/orders/route.js`, `app/api/vendor/orders/[id]/route.js` | drop rider joins |
| `app/api/vendor/shipping/route.js` | drop `vendor_shipping_zones` |
| `app/(pages)/orders/[id]/page.jsx` | drop the rider review form |
| `app/(pages)/dashboard/page.jsx`, `help/page.jsx`, `offline/page.jsx`, `vendor/welcome/page.jsx`, `admin/users/page.jsx`, `accountant/dashboard/page.jsx` | drop rider copy and role handling |

**Keep permanently**

- `orders.rider_id` — the 7 historical orders reference it. The plan called this
  out from the start.
- `rider_reviews` rows, unless a retention decision says otherwise.
- The `rider` value in the users role enum, so historical rows stay valid.

## Database

`vendor_shipping_zones` is already empty (0 rows) and can go with the code.
`delivery_zones` holds 2 live rows and must outlive the code until Fast Link
prices every order.
