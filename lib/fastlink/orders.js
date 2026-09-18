/**
 * lib/fastlink/orders.js — dispatch paid carmel orders to Fast Link.
 *
 * Once an order is paid and created, it's handed to Fast Link as a delivery
 * order. Each line references its vendor by our own id (merchant_external_id),
 * and the parcel leaves from that vendor's default pickup address.
 *
 * dispatchOrder is idempotent + best-effort:
 *   - no-op when Fast Link credentials aren't configured
 *   - skips digital-only orders (nothing to deliver)
 *   - skips orders already dispatched (orders.fastlink_order_id set)
 *   - never throws — records fastlink_dispatch_error on failure for later retry
 *
 * ⚠️  SERVER ONLY. Pass a service-role admin Supabase client in.
 */

import { config } from "@/lib/config";
import { fastlink } from "@/lib/fastlink/client";

const coord = (lat, lng) => (lat != null && lng != null ? `${lat},${lng}` : null);

/** Build the Fast Link create-order payload from a carmel order + its items. */
export function buildFastLinkOrderPayload({ order, items, address }) {
  const destCoords =
    coord(address?.lat, address?.lng) ??
    (typeof address?.coordinates === "string" ? address.coordinates : null);

  const addressText =
    [address?.houseNumber, address?.street, address?.area, address?.city, address?.lga, address?.state]
      .filter(Boolean)
      .join(", ") ||
    address?.street ||
    "";

  return {
    platform_order_id: String(order.id),
    customer_name:     address?.fullName ?? "Customer",
    phone_number:      address?.phone ?? "",
    delivery_address:  addressText,
    coordinates:       destCoords,
    items: items.map((it) => ({
      merchant_external_id: it.vendor_id, // our vendor id = Fast Link merchant external_id
      product_name:         it.name,
      quantity:             it.quantity,
      weight:               config.fastlink.defaultItemWeightKg,
      price:                String(it.unit_price),
    })),
  };
}

/**
 * Dispatch a carmel order to Fast Link.
 * @returns {Promise<{dispatched:boolean, fastlinkOrderId?:string, skipped?:string, error?:string}>}
 */
/** Persist a dispatch failure without throwing. */
async function recordDispatchError(admin, orderId, message) {
  try {
    await admin
      .from("orders")
      .update({ fastlink_dispatch_error: String(message ?? "").slice(0, 500) })
      .eq("id", orderId);
  } catch {
    /* best-effort */
  }
}

export async function dispatchOrder(admin, orderId) {
  if (!config.fastlink.enabled) return { dispatched: false, skipped: "provider_disabled" };

  const { data: order, error } = await admin
    .from("orders")
    .select("id, delivery_address, fastlink_order_id")
    .eq("id", orderId)
    .single();
  if (error || !order) return { dispatched: false, error: "order_not_found" };
  if (order.fastlink_order_id) {
    return { dispatched: false, skipped: "already_dispatched", fastlinkOrderId: order.fastlink_order_id };
  }

  // The name lives on products, not order_items — selecting it here made the
  // query fail, and the empty result read as "all digital", so every order was
  // silently skipped and Fast Link never received one.
  const { data: items, error: itemsError } = await admin
    .from("order_items")
    .select("vendor_id, quantity, unit_price, delivery_format, products(name)")
    .eq("order_id", orderId);

  // A failed lookup is not a business decision. Surfacing it stops a query
  // problem from impersonating "there was nothing to deliver".
  if (itemsError) {
    await recordDispatchError(admin, orderId, itemsError.message);
    return { dispatched: false, error: itemsError.message };
  }

  const physical = (items ?? [])
    .filter((i) => i.delivery_format !== "digital")
    .map((i) => ({ ...i, name: i.products?.name ?? "Item" }));
  if (physical.length === 0) return { dispatched: false, skipped: "all_digital" };

  const address = order.delivery_address ?? {};
  const payload = buildFastLinkOrderPayload({ order, items: physical, address });

  try {
    const flOrder = await fastlink.createOrder(payload);
    let flId = flOrder?.id ?? flOrder?.order_number ?? null;

    // Their create replies 201 with an empty body, so there is no id to read.
    // Resolving it matters beyond tidiness: the guard above skips an order that
    // already has one, so a null id means a second dispatch would create a
    // duplicate delivery on their account. It is also the handle for cancelling
    // and for tracking.
    if (flId == null) {
      try {
        const found = await fastlink.listOrders({ platform_order_id: String(order.id) });
        flId = found?.results?.[0]?.id ?? null;
      } catch (lookupErr) {
        console.error(`[fastlink] could not resolve order id for ${orderId}:`, lookupErr.message);
      }
    }
    await admin
      .from("orders")
      .update({
        fastlink_order_id:       flId != null ? String(flId) : null,
        fastlink_status:         flOrder?.status ?? "pending",
        fastlink_dispatched_at:  new Date().toISOString(),
        fastlink_dispatch_error: null,
      })
      .eq("id", orderId);
    return { dispatched: true, fastlinkOrderId: flId != null ? String(flId) : null };
  } catch (err) {
    console.error(`[fastlink] dispatch failed for order ${orderId}:`, err.message);
    await admin
      .from("orders")
      .update({ fastlink_dispatch_error: String(err.message).slice(0, 500) })
      .eq("id", orderId);
    return { dispatched: false, error: err.message };
  }
}
