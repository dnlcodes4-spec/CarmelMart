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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const admin = createAdminClient();
  const result = await quoteShippingForItems({
    admin,
    destination: body.destination,
    items: body.items,
  });

  return NextResponse.json({ ok: true, ...result });
}
