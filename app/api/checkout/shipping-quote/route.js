/**
 * POST /api/checkout/shipping-quote
 *
 * Prices delivery for a cart via Fast Link. A cart can span multiple vendors and
 * Fast Link quotes a single pickup→destination leg, so we quote each vendor's
 * pickup → the customer and sum the legs (see lib/fastlink/shipping).
 *
 * Public (checkout, guests included). Never throws: on any problem it responds
 * { ok, fallback: true, reason } and the checkout keeps its zone-based fee.
 *
 * Body: { destination: { lat, lng } | { address }, items: [{ vendorId, quantity }] }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { quoteShippingForItems } from "@/lib/fastlink/shipping";
import { undeliverableVendors, describeUndeliverable } from "@/lib/fastlink/coverage";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const admin = createAdminClient();

  // Surfaced separately from pricing: a vendor with no pickup point is not a
  // quote that failed, it is a sale we cannot fulfil. Checkout needs to say so
  // before the customer reaches the pay button, rather than at order creation.
  const blocked = await undeliverableVendors(
    admin,
    (Array.isArray(body.items) ? body.items : []).map((i) => i?.vendorId ?? i?.vendor_id),
  );
  if (blocked.length > 0) {
    return NextResponse.json({
      ok: true,
      fallback: true,
      reason: "vendor_not_deliverable",
      deliverable: false,
      message: describeUndeliverable(blocked),
      vendors: blocked.map((v) => v.id),
    });
  }

  const result = await quoteShippingForItems({
    admin,
    destination: body.destination,
    items: body.items,
  });

  return NextResponse.json({ ok: true, deliverable: true, ...result });
}
