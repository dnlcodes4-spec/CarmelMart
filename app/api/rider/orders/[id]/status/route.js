// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderStatusUpdate } from "@/lib/email";
import { getCommissionRate } from "@/lib/subscription";

// Riders can only advance orders through delivery states — no skipping.
const ALLOWED_TRANSITIONS = {
  pending:    ["confirmed"],
  confirmed:  ["processing"],
  processing: ["shipped"],
  shipped:    ["delivered"],
};

async function guardRiderOrAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 };
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "rider"].includes(profile.role)) {
    return { error: "Forbidden", status: 403 };
  }
  if (profile.role === "rider" && (profile.status === "suspended" || profile.status === "banned")) {
    return { error: "Account suspended.", status: 403 };
  }
  return { user, admin, role: profile.role };
}

/**
 * PATCH /api/rider/orders/[id]/status
 * Body: { status: 'confirmed' | 'processing' | 'shipped' | 'delivered' }
 *
 * Riders: strict forward-only delivery transitions for orders assigned to them.
 * Admins: can set any valid delivery status.
 */
export async function PATCH(request, { params }) {
  try {
    const guard = await guardRiderOrAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { user, admin, role } = guard;
    const { id: orderId } = await params;

    const body = await request.json();
    const { status: newStatus } = body;

    if (!newStatus) {
      return NextResponse.json({ error: "status is required." }, { status: 400 });
    }

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("id, status, payment_status, customer_id, total, payment_method, delivery_address, rider_id")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    // Riders can only update orders assigned to them
    if (role === "rider" && order.rider_id !== user.id) {
      return NextResponse.json({ error: "This order is not assigned to you." }, { status: 403 });
    }

    const currentStatus = order.status;

    if (role === "rider") {
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes(newStatus)) {
        return NextResponse.json(
          {
            error: `Cannot move order from '${currentStatus}' to '${newStatus}'. Allowed: [${allowed.join(", ")}].`,
            code:  "INVALID_TRANSITION",
          },
          { status: 400 }
        );
      }
    } else {
      // Admin: allow any delivery state except refunded (use refund endpoint for that)
      const validStates = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
      if (!validStates.includes(newStatus)) {
        return NextResponse.json({ error: `Invalid status '${newStatus}'. Use the refund endpoint for refunds.` }, { status: 400 });
      }
    }

    if (currentStatus === newStatus) {
      return NextResponse.json({ error: "Order is already in that status." }, { status: 400 });
    }

    const now     = new Date().toISOString();
    const shortId = `#CM-${orderId.slice(0, 8).toUpperCase()}`;

    const { error: updateErr } = await admin
      .from("orders")
      .update({ status: newStatus, updated_at: now })
      .eq("id", orderId);
    if (updateErr) throw updateErr;

    const STATUS_LABELS = {
      confirmed:  "confirmed",
      processing: "being packed",
      shipped:    "out for delivery",
      delivered:  "delivered",
      cancelled:  "cancelled",
    };
    const statusLabel = STATUS_LABELS[newStatus] ?? newStatus;

    // Customer email + in-app notification (fire-and-forget)
    try {
      const { data: customer } = await admin
        .from("users")
        .select("email")
        .eq("id", order.customer_id)
        .single();

      if (customer?.email) {
        await sendOrderStatusUpdate({ to: customer.email, order, newStatus });
      }

      await admin.from("notifications").insert({
        user_id: order.customer_id,
        type:    "order_update",
        title:   `Order ${shortId} ${newStatus === "delivered" ? "Delivered!" : "Updated"}`,
        message: `Your order ${shortId} is now ${statusLabel}.`,
        link:    `/orders/${orderId}`,
      });
    } catch (err) {
      console.error("[rider/status] customer notification failed (non-fatal):", err.message);
    }

    // Credit vendor wallets on delivery
    if (newStatus === "delivered" && order.payment_status === "paid") {
      try {
        const { data: items } = await admin
          .from("order_items")
          .select("vendor_id, total, product_id")
          .eq("order_id", orderId);

        if (items?.length) {
          const vendorIds  = [...new Set(items.map((i) => i.vendor_id))];
          const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];

          const [
            { data: vendorRows },
            { data: allRateOverrides },
            { data: platformFeeRow },
          ] = await Promise.all([
            admin.from("vendors").select("id, subscription_tier").in("id", vendorIds),
            admin.from("commission_rates").select("target_id, rate, type").in("type", ["vendor", "category"]),
            admin.from("platform_settings").select("value").eq("key", "platform_fee_percent").single(),
          ]);

          let productCategoryMap = {};
          if (productIds.length > 0) {
            const { data: productRows } = await admin
              .from("products").select("id, category_id").in("id", productIds);
            productCategoryMap = Object.fromEntries((productRows ?? []).map((p) => [p.id, p.category_id]));
          }

          const platformDefaultRate = Number(platformFeeRow?.value ?? getCommissionRate("free"));
          const tierMap = Object.fromEntries(
            (vendorRows ?? []).map((v) => [v.id, v.subscription_tier ?? "free"])
          );
          const vendorOverrideMap = Object.fromEntries(
            (allRateOverrides ?? []).filter((r) => r.type === "vendor").map((r) => [r.target_id, Number(r.rate)])
          );
          const categoryOverrideMap = Object.fromEntries(
            (allRateOverrides ?? []).filter((r) => r.type === "category").map((r) => [r.target_id, Number(r.rate)])
          );

          // Compute per-vendor earnings by summing per-item commissions.
          // Priority: vendor override → item's category override → tier default
          // (free-tier default comes from platform_settings so admin can change it without a deploy)
          const vendorEarningsMap = {};
          for (const item of items) {
            const vid        = item.vendor_id;
            const categoryId = productCategoryMap[item.product_id];
            const tier       = tierMap[vid] ?? "free";
            let rate;
            if (vendorOverrideMap[vid] !== undefined) {
              rate = vendorOverrideMap[vid];
            } else if (categoryId && categoryOverrideMap[categoryId] !== undefined) {
              rate = categoryOverrideMap[categoryId];
            } else {
              rate = tier === "free" ? platformDefaultRate : getCommissionRate(tier);
            }
            vendorEarningsMap[vid] = (vendorEarningsMap[vid] ?? 0) + Math.round((item.total ?? 0) * (1 - rate / 100));
          }

          for (const [vendorId, vendorEarning] of Object.entries(vendorEarningsMap)) {
            if (vendorEarning <= 0) continue;

            // Idempotency: skip if this vendor was already credited for this order
            const { count: alreadyCredited } = await admin
              .from("wallet_transactions")
              .select("id", { count: "exact", head: true })
              .eq("reference", orderId)
              .eq("user_id", vendorId)
              .eq("type", "credit");
            if ((alreadyCredited ?? 0) > 0) continue;

            const { error: walletErr } = await admin.rpc("increment_wallet", {
              p_user_id: vendorId,
              p_amount:  vendorEarning,
            });
            if (walletErr) throw walletErr;

            await admin.from("wallet_transactions").insert({
              user_id:     vendorId,
              type:        "credit",
              amount:      vendorEarning,
              description: `Order ${shortId} delivered — after commission`,
              reference:   orderId,
              created_at:  now,
            });
          }
        }
      } catch (commErr) {
        console.error("[rider/status] commission crediting failed:", commErr.message);
      }
    }

    // Vendor in-app notifications (fire-and-forget)
    try {
      const { data: vendorRows } = await admin
        .from("order_items")
        .select("vendor_id")
        .eq("order_id", orderId);

      const uniqueVendorIds = [...new Set((vendorRows ?? []).map((r) => r.vendor_id))];
      if (uniqueVendorIds.length > 0) {
        await admin.from("notifications").insert(
          uniqueVendorIds.map((vendorId) => ({
            user_id: vendorId,
            type:    "order_update",
            title:   `Order ${shortId} ${newStatus === "delivered" ? "Delivered" : "Status Updated"}`,
            message: `Order ${shortId} containing your item(s) is now ${statusLabel}.`,
            link:    `/vendor/orders`,
          }))
        );
      }
    } catch (err) {
      console.error("[rider/status] vendor notifications failed (non-fatal):", err.message);
    }

    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    console.error("[PATCH /api/rider/orders/[id]/status]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
