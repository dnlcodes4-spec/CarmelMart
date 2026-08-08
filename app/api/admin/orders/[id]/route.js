import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? { user, admin } : null;
}

export async function GET(request, { params }) {
  try {
    const ctx = await requireAdmin();
    if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const { admin } = ctx;

    const [{ data: order }, { data: items }, { data: platformFeeRow }] = await Promise.all([
      admin
        .from("orders")
        .select("id, customer_id, rider_id, status, total, payment_method, payment_status, payment_ref, pod_deposit, delivery_address, notes, created_at")
        .eq("id", id)
        .single(),
      admin
        .from("order_items")
        .select("id, quantity, unit_price, total, vendor_id, variant_id, variant_combination, products(id, name, images)")
        .eq("order_id", id),
      admin.from("platform_settings").select("value").eq("key", "platform_fee_percent").single(),
    ]);

    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // Customer info
    const { data: customer } = order.customer_id
      ? await admin.from("users").select("first_name, last_name, email, phone").eq("id", order.customer_id).single()
      : { data: null };

    // Vendor store names for each item
    const vendorIds = [...new Set((items ?? []).map((i) => i.vendor_id).filter(Boolean))];
    let vendorMap = {};
    if (vendorIds.length) {
      const { data: vendors } = await admin.from("vendors").select("id, store_name").in("id", vendorIds);
      vendorMap = Object.fromEntries((vendors ?? []).map((v) => [v.id, v.store_name]));
    }

    const addr          = order.delivery_address ?? {};
    const deliveryFee   = addr.delivery_fee ?? 0;
    const itemsSubtotal = (items ?? []).reduce((s, i) => s + (i.total ?? i.unit_price * i.quantity), 0);
    const platformRate  = Number(platformFeeRow?.value ?? 6.5);
    const platformFee   = Math.round(itemsSubtotal * platformRate / 100);

    return NextResponse.json({
      order: {
        id:             order.id,
        shortId:        `#CM-${order.id.slice(0, 8).toUpperCase()}`,
        status:         order.status,
        total:          order.total,
        items_subtotal: itemsSubtotal,
        delivery_fee:   deliveryFee,
        platform_fee:   platformFee,
        platform_rate:  platformRate,
        payment_method: order.payment_method ?? null,
        payment_status: order.payment_status ?? null,
        payment_ref:    order.payment_ref ?? null,
        pod_deposit:    order.pod_deposit ?? 0,
        notes:          order.notes ?? null,
        date:           new Date(order.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }),
        customer: {
          id:    order.customer_id ?? null,
          name:  [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || customer?.email || "Unknown",
          email: customer?.email ?? null,
          phone: customer?.phone ?? addr.phone ?? null,
        },
        address: addr,
        items: (items ?? []).map((it) => ({
          id:           it.id,
          product_name: it.products?.name ?? "Product",
          image:        Array.isArray(it.products?.images) ? it.products.images[0] : null,
          vendor_name:         vendorMap[it.vendor_id] ?? null,
          quantity:            it.quantity,
          unit_price:          it.unit_price,
          total:               it.total ?? it.unit_price * it.quantity,
          variant_id:          it.variant_id ?? null,
          variant_combination: it.variant_combination ?? null,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const ctx = await requireAdmin();
    if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { admin } = ctx;

    const { id: orderId } = await params;
    const { rider_id } = await request.json();

    // Assignment is the one door into the in-house delivery path, so it is where
    // that path closes when Fast Link takes over. Clearing a rider stays allowed
    // — otherwise an order could be stranded with someone no longer delivering.
    const isAssigning = rider_id !== null && rider_id !== undefined;
    if (isAssigning && !config.delivery.inHouseEnabled) {
      return NextResponse.json(
        { error: "In-house rider delivery is retired. Orders are dispatched through the delivery provider instead." },
        { status: 409 },
      );
    }

    // Fetch current order to check status and previous rider
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("id, status, rider_id, delivery_address, total, payment_method")
      .eq("id", orderId)
      .single();
    if (orderErr || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    if (["delivered", "cancelled", "refunded"].includes(order.status)) {
      return NextResponse.json({ error: `Cannot assign a rider to a ${order.status} order.` }, { status: 400 });
    }

    if (rider_id !== null && rider_id !== undefined) {
      const { data: rider } = await admin.from("users").select("role, status").eq("id", rider_id).single();
      if (!rider || rider.role !== "rider") return NextResponse.json({ error: "Invalid rider" }, { status: 400 });
      if (rider.status !== "active") return NextResponse.json({ error: "Rider is not active" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // If assigning a rider and the order is still pending, auto-confirm it
    const statusUpdate = (rider_id && order.status === "pending")
      ? { rider_id: rider_id ?? null, status: "confirmed", updated_at: now }
      : { rider_id: rider_id ?? null, updated_at: now };

    const { error } = await admin
      .from("orders")
      .update(statusUpdate)
      .eq("id", orderId);
    if (error) throw error;

    // Notify the newly assigned rider (fire-and-forget)
    if (rider_id && rider_id !== order.rider_id) {
      try {
        const shortId = `#CM-${orderId.slice(0, 8).toUpperCase()}`;
        const addr    = order.delivery_address ?? {};
        await admin.from("notifications").insert({
          user_id: rider_id,
          type:    "delivery_assigned",
          title:   `New Delivery: ${shortId}`,
          message: `You have been assigned order ${shortId} — ${[addr.city, addr.state].filter(Boolean).join(", ") || "see portal for details"}.`,
          link:    `/rider/orders`,
        });
      } catch (notifyErr) {
        console.error("[admin/orders/assign] rider notification failed (non-fatal):", notifyErr.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
