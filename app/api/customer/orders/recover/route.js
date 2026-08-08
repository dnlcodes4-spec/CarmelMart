/**
 * POST /api/customer/orders/recover
 *
 * Crash-recovery for the checkout flow.
 *
 * When the browser closes or crashes after Flutterwave charges the customer
 * but before the JS callback creates the order, the checkout page stores a
 * "pending checkout" entry in localStorage. On the next visit the user is
 * offered a "Complete my order" button that calls this endpoint.
 *
 * Responses:
 *   { success: true, order_id }   — order created (or already existed)
 *   { not_found: true }           — no successful payment found on Flutterwave
 *   { error }                     — server error
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderConfirmation, sendVendorNewOrder } from "@/lib/email";
import { quoteShippingForItems } from "@/lib/fastlink/shipping";
import { dispatchOrder } from "@/lib/fastlink/orders";

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLW_TIMEOUT_MS = 10_000;

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

// Fast path: numeric transaction ID available (callback fired before crash)
async function verifyByTransactionId(transactionId) {
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
      {
        headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(FLW_TIMEOUT_MS),
      },
    );
    const data = await res.json();
    if (!res.ok || data.status !== "success" || data.data?.status !== "successful") return null;
    return data.data;
  } catch {
    return null;
  }
}

// Slow path: search by tx_ref (browser crashed before callback fired).
// Returns { tx } for successful payments, { pending: true } for in-progress bank transfers, or null.
async function verifyByTxRef(txRef) {
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions?tx_ref=${encodeURIComponent(txRef)}`,
      {
        headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
        signal: AbortSignal.timeout(FLW_TIMEOUT_MS),
      },
    );
    const data = await res.json();
    if (!res.ok || data.status !== "success") return null;
    const list = data.data ?? [];
    const successful = list.find((t) => t.status === "successful" && t.currency === "NGN");
    if (successful) return { tx: successful };
    const pending = list.find((t) => t.status === "pending" && t.currency === "NGN");
    if (pending) return { pending: true };
    return null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    if (!FLW_SECRET_KEY) {
      return NextResponse.json({ error: "Payment verification is not configured." }, { status: 500 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { txRef, transactionId, payload } = body;

    if (!txRef)   return NextResponse.json({ error: "txRef is required." }, { status: 400 });
    if (!payload) return NextResponse.json({ error: "payload is required." }, { status: 400 });

    const admin = createAdminClient();

    // ── 1. Idempotency ────────────────────────────────────────────────────────
    // Order may already exist if the client callback succeeded before the crash,
    // or if this recovery endpoint was called twice.
    const { data: existing } = await admin
      .from("orders")
      .select("id")
      .eq("payment_ref", txRef)
      .eq("customer_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, order_id: existing.id });
    }

    // ── 2. Verify payment with Flutterwave ────────────────────────────────────
    let tx = null;
    if (transactionId) {
      tx = await verifyByTransactionId(transactionId);
    }
    // Fall back to tx_ref search when transactionId is missing (browser crashed
    // during the Flutterwave modal, before our callback received the ID).
    if (!tx) {
      const result = await verifyByTxRef(txRef);
      if (result?.pending) return NextResponse.json({ pending: true });
      tx = result?.tx ?? null;
    }

    if (!tx || tx.tx_ref !== txRef || tx.currency !== "NGN") {
      return NextResponse.json({ not_found: true });
    }

    // ── 3. Re-validate and price items server-side ────────────────────────────
    const { items, delivery_address, promo_id } = payload;
    if (!items?.length) return NextResponse.json({ error: "No items in payload." }, { status: 400 });

    const normalizedItems = items.map((item) => ({
      productId:      item.productId,
      quantity:       toPositiveInt(item.quantity, 1),
      deliveryFormat: item.delivery_format === "digital" ? "digital" : "physical",
    }));

    const productIds = [...new Set(normalizedItems.map((i) => i.productId).filter(Boolean))];

    const { data: products, error: prodErr } = await admin
      .from("products")
      .select("id, name, price, sale_price, stock, vendor_id, is_digital, digital_price")
      .in("id", productIds)
      .eq("status", "active")
      .eq("moderation_status", "approved");

    if (prodErr) throw prodErr;

    const productMap = Object.fromEntries((products ?? []).map((p) => [p.id, p]));

    const orderItems = normalizedItems.map((item) => {
      const product = productMap[item.productId];
      if (!product) throw new Error(`Product ${item.productId} is no longer available.`);
      const unitPrice =
        item.deliveryFormat === "digital" && product.is_digital && product.digital_price
          ? Math.round(product.digital_price)
          : Math.round(product.sale_price ?? product.price);
      return {
        product_id:      item.productId,
        vendor_id:       product.vendor_id,
        quantity:        item.quantity,
        unit_price:      unitPrice,
        total:           unitPrice * item.quantity,
        name:            product.name,
        delivery_format: item.deliveryFormat,
      };
    });

    const subtotal    = orderItems.reduce((sum, i) => sum + i.total, 0);

    // Recompute the delivery fee server-side via Fast Link (falls back to the
    // client fee when Fast Link can't price the cart) — same as the main POST.
    let deliveryFee = toPositiveInt(delivery_address?.delivery_fee, 0);
    if (orderItems.some((i) => i.delivery_format !== "digital")) {
      const quote = await quoteShippingForItems({ admin, destination: delivery_address, items: orderItems });
      if (!quote.fallback) deliveryFee = quote.totalFee;
    }

    // Best-effort promo re-validation — if the promo expired between checkout
    // and recovery, proceed without the discount rather than blocking the order.
    let promoId  = null;
    let discount = 0;
    if (promo_id) {
      try {
        const { data: promo } = await admin
          .from("promo_codes")
          .select("id, type, value, min_order, active")
          .eq("id", promo_id)
          .single();
        if (promo?.active && subtotal >= promo.min_order) {
          const raw = promo.type === "percentage"
            ? Math.round(subtotal * (promo.value / 100))
            : promo.value;
          discount = Math.min(subtotal, Math.max(0, raw));
          promoId  = promo.id;
        }
      } catch { /* promo no longer valid */ }
    }

    const discountedSubtotal = Math.max(0, subtotal - discount);
    const total              = discountedSubtotal + deliveryFee;

    // ── 4. Amount integrity ───────────────────────────────────────────────────
    if (Number(tx.charged_amount ?? tx.amount) < total) {
      return NextResponse.json(
        { error: "Verified payment amount is less than the order total. Please contact support." },
        { status: 400 },
      );
    }

    // ── 5. Create the order ───────────────────────────────────────────────────
    const { data: orderId, error: createErr } = await admin.rpc("create_customer_order_atomic", {
      p_customer_id:      user.id,
      p_items:            orderItems,
      p_delivery_address: { ...(delivery_address ?? {}), delivery_fee: deliveryFee },
      p_payment_method:   "card",
      p_payment_status:   "paid",
      p_payment_ref:      txRef,
      p_pod_deposit:      0,
      p_discount:         discount,
      p_promo_id:         promoId,
      p_total:            total,
      p_order_status:     "confirmed",
    });

    if (createErr) throw createErr;

    // ── 6. Emails (fire and forget) ───────────────────────────────────────────
    sendOrderConfirmation({
      to: user.email,
      order: {
        id:             orderId,
        items:          orderItems.map((item) => ({ ...item, productId: item.product_id })),
        delivery_address,
        delivery_fee:   deliveryFee,
        payment_method: "card",
        discount,
        total,
      },
    });

    const vendorGroups = {};
    for (const item of orderItems) {
      if (!vendorGroups[item.vendor_id]) vendorGroups[item.vendor_id] = [];
      vendorGroups[item.vendor_id].push({ ...item, productId: item.product_id });
    }
    const vendorIds = Object.keys(vendorGroups);
    if (vendorIds.length > 0) {
      const { data: vendorUsers } = await admin.from("users").select("id, email").in("id", vendorIds);
      for (const vendorUser of (vendorUsers ?? [])) {
        if (vendorUser.email) {
          sendVendorNewOrder({
            to:          vendorUser.email,
            order:       { id: orderId, delivery_address, payment_method: "card" },
            vendorItems: vendorGroups[vendorUser.id],
          });
        }
      }
    }

    // Hand the recovered order to Fast Link (best-effort + idempotent).
    await dispatchOrder(admin, orderId);

    return NextResponse.json({ success: true, order_id: orderId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
