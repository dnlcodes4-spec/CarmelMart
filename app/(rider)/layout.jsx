// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { requireRider } from "@/lib/session";
import RiderShell from "@/components/shared/rider/RiderShell";

export const metadata = {
  title: "Rider Portal — CarmelMart",
  manifest: "/rider-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CM Rider",
  },
};

export const viewport = {
  themeColor: "#059669",
};

export default async function RiderLayout({ children }) {
  await requireRider();
  return <RiderShell>{children}</RiderShell>;
}
