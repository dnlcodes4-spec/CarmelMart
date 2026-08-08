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

  const { data: items } = await admin
    .from("order_items")
    .select("vendor_id, name, quantity, unit_price, delivery_format")
    .eq("order_id", orderId);

  const physical = (items ?? []).filter((i) => i.delivery_format !== "digital");
  if (physical.length === 0) return { dispatched: false, skipped: "all_digital" };

  const address = order.delivery_address ?? {};
  const payload = buildFastLinkOrderPayload({ order, items: physical, address });

  try {
    const flOrder = await fastlink.createOrder(payload);
    const flId = flOrder?.id ?? flOrder?.order_number ?? null;
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
