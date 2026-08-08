# Fast Link customer delivery tracking

**Date:** 2026-08-08
**Status:** approved, implementing
**Phase:** 4 (second half — the webhook receiver shipped separately)

## Problem

Fast Link reports eleven delivery states. carmel-mart orders have five. `toCarmelStatus`
collapses the difference, and three Fast Link states that mean *the delivery is in
trouble* — `postponed`, `no_response`, `failed` — all map to `shipped`.

The consequence: a customer whose parcel is stuck sees a cheerful "Out for Delivery"
step with no indication anything is wrong. They contact support to find out what the
system already knows.

Secondarily, `orders.fastlink_status` holds only the latest state. Every transition's
timing is lost on overwrite, so the timeline cannot show when anything happened.

## Goal

Make delivery problems visible to the customer. Finer-grained progress is explicitly
**not** the goal — eleven steps do not help someone whose parcel is stuck.

## Non-goals

- Rendering Fast Link's raw state vocabulary to customers
- Emailing or otherwise notifying customers off-page
- Admin/ops tooling over the event history (the data will support it later)
- Any change to how orders are dispatched

## Design

### Data

New table, applied to the live database and recorded in
`supabase/migrations/20260808000000_fastlink_order_events.sql`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `order_id` | uuid not null | FK → `orders(id)` on delete cascade |
| `fastlink_order_id` | text | |
| `event` | text not null | `order.created` \| `order.status_changed` \| `order.assigned` |
| `fastlink_status` | text | raw Fast Link state |
| `carmel_status` | text | mapped result, null when unrecognised |
| `payload` | jsonb | raw Fast Link data object |
| `created_at` | timestamptz not null | `now()` |

Index on `(order_id, created_at)`. RLS enabled with no policies — service-role only.
Verified behaviourally: anonymous reads return nothing and anonymous inserts are
rejected by policy.

`payload` is retained because the webhook body shape is inferred from Fast Link's docs
rather than observed. The raw copy is what lets us correct the parser once real events
arrive.

### Webhook receiver

`app/api/webhooks/fastlink/route.js` inserts one row **only on a genuine transition** —
when `fastlink_status` actually changed. Redelivery already performs no order write and
will record no event, so "history" means transitions rather than delivery attempts.

The insert is wrapped so failure cannot alter the response. The order update is what
matters; losing an audit row must never turn into a retry.

### Order detail API

`app/api/customer/orders/[id]/route.js` adds `fastlink_status, fastlink_dispatched_at`
to its select, then reads the event rows for the order.

The existing five steps are unchanged in shape. Each gains an `at` timestamp resolved
from the **earliest** event whose `carmel_status` matches that step — earliest, not
latest, so a flapping status cannot keep pushing a step's time forward. `placed` always
uses `order.created_at`.

Response gains:

```js
delivery: {
  fastlinkStatus,                    // raw state
  isIssue,                           // isIssueStatus()
  issue: { title, message } | null,  // describeIssue()
  dispatchedAt,
  lastUpdate,                        // newest event created_at
}
```

### Orders list API

`app/api/customer/orders/route.js` GET adds `fastlink_status` to the select and a
`hasDeliveryIssue` boolean per order.

### Customer-facing copy

`describeIssue(fastlinkStatus)` is added to `lib/fastlink/status.js` — already the single
source of truth for this vocabulary, and import-free so both routes can use it. Copy is
produced server-side; clients only render.

| status | title | message |
|---|---|---|
| `postponed` | Delivery postponed | Your delivery has been rescheduled. We'll let you know when the rider is on the way again. |
| `no_response` | We couldn't reach you | The rider tried to contact you without success. Please keep your phone nearby — they'll try again. |
| `failed` | Delivery attempt failed | Something went wrong with this delivery. Our team is looking into it. |

Any other status returns `null`.

### UI

`app/(pages)/orders/[id]/page.jsx` — timestamps under completed steps; a warning block
inside the existing tracking card when `delivery.isIssue`. No new component beyond the
banner; the timeline markup already exists.

`app/(pages)/orders/page.jsx` — badge on orders where `hasDeliveryIssue`.

The Realtime subscription already refetches on any `orders` UPDATE, so webhook writes
refresh both surfaces with no additional plumbing.

## Error handling

Tracking is decoration on a page that must always render:

- Events query fails → fall back to today's untimed boolean steps
- Order has no events (anything dispatched before this shipped) → same fallback
- Unrecognised `fastlink_status` → no banner, consistent with the receiver, which
  records but never guesses

## Testing

- `describeIssue` — copy for each issue status, null for everything else
- Webhook — writes an event on transition, none on redelivery, and still returns 200
  when the insert fails
- Order detail API — steps timestamped from events, clean fallback when absent, issue
  block present and absent
- Orders list API — `hasDeliveryIssue` set correctly

## Known limitations

- Orders dispatched before this ships have no event history and show untimed steps.
  Currently zero orders are dispatched, so this affects nothing.
- The webhook payload shape remains an assumption until the first real event. The
  receiver logs `matched:false` / `ignored` so a mismatch surfaces rather than passing
  silently.
