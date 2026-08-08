import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildTracking } from "@/lib/fastlink/tracking";

// GET /api/customer/orders/[id] — full order detail for the authenticated customer
export async function GET(request, { params }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const admin = createAdminClient();

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select(`
        id, status, total, pod_deposit, payment_method, payment_status,
        payment_ref, delivery_address, notes, created_at,
        fastlink_status, fastlink_dispatched_at,
        order_items (
          id, quantity, unit_price, total, delivery_format,
          variant_id, variant_combination,
          products ( id, name, images, slug, is_digital, digital_file_path )
        )
      `)
      .eq("id", id)
      .eq("customer_id", user.id)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const addr = order.delivery_address ?? {};

    // Delivery history timestamps the timeline steps. It is decoration on a page
    // that must always render, so a failure here degrades to untimed steps rather
    // than failing the request.
    const { data: deliveryEvents } = await admin
      .from("fastlink_order_events")
      .select("fastlink_status, carmel_status, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true });

    const { tracking, delivery } = buildTracking({
      orderStatus:    order.status,
      createdAt:      order.created_at,
      fastlinkStatus: order.fastlink_status ?? null,
      dispatchedAt:   order.fastlink_dispatched_at ?? null,
      events:         deliveryEvents ?? [],
    });

    // For delivered orders, pre-load which products this user has already reviewed
    let reviewedProductIds = [];
    if (order.status === "delivered") {
      const productIds = (order.order_items ?? [])
        .map((it) => it.products?.id)
        .filter(Boolean);
      if (productIds.length) {
        const { data: existingReviews } = await admin
          .from("product_reviews")
          .select("product_id")
          .eq("user_id", user.id)
          .eq("order_id", id)
          .in("product_id", productIds);
        reviewedProductIds = (existingReviews ?? []).map((r) => r.product_id);
      }
    }

    return NextResponse.json({
      order: {
        id:             order.id,
        shortId:        `#CM-${order.id.slice(0, 8).toUpperCase()}`,
        status:         order.status,
        total:          order.total,
        pod_deposit:    order.pod_deposit,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        payment_ref:    order.payment_ref,
        notes:          order.notes ?? null,
        date:           order.created_at,
        address:        addr,
        delivery_method: addr.delivery_method ?? "standard",
        delivery_fee:   addr.delivery_fee ?? 0,
        tracking,
        delivery,
        items: (order.order_items ?? []).map((it) => ({
          id:              it.id,
          product_id:      it.products?.id ?? null,
          name:            it.products?.name ?? "Product",
          slug:            it.products?.slug ?? null,
          image:           it.products?.images?.[0] ?? null,
          quantity:        it.quantity,
          price:           it.unit_price,
          total:           it.total ?? it.unit_price * it.quantity,
          is_digital:          it.products?.is_digital ?? false,
          delivery_format:     it.delivery_format ?? "physical",
          variant_id:          it.variant_id ?? null,
          variant_combination: it.variant_combination ?? null,
        })),
        reviewed_product_ids: reviewedProductIds,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
