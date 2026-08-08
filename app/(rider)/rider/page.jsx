// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { redirect } from "next/navigation";
export default function RiderRootPage() {
  redirect("/rider/orders");
}
