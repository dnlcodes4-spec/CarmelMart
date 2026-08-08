// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/customer/orders/[id]/rider-review
 * Body: { rating, on_time, professional, package_condition, would_recommend, comment? }
 *
 * - Order must be delivered and belong to the authenticated customer.
 * - One review per order per customer (DB unique constraint enforces this).
 */
export async function POST(request, { params }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: orderId } = await params;
    const admin = createAdminClient();

    // Verify order exists, is delivered, and belongs to this customer
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("id, status, customer_id, rider_id")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    if (order.customer_id !== user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (order.status !== "delivered") {
      return NextResponse.json(
        { error: "Reviews can only be submitted for delivered orders." },
        { status: 400 }
      );
    }

    // Check for existing review
    const { data: existing } = await admin
      .from("rider_reviews")
      .select("id")
      .eq("order_id", orderId)
      .eq("customer_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "You have already reviewed this delivery." }, { status: 409 });
    }

    const body = await request.json();
    const { rating, on_time, professional, package_condition, would_recommend, comment } = body;

    if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "rating must be an integer between 1 and 5." }, { status: 400 });
    }

    const { data: review, error: insertErr } = await admin
      .from("rider_reviews")
      .insert({
        order_id:          orderId,
        customer_id:       user.id,
        rider_id:          order.rider_id ?? null,
        rating:            Math.round(rating),
        on_time:           on_time           ?? null,
        professional:      professional      ?? null,
        package_condition: package_condition ?? null,
        would_recommend:   would_recommend   ?? null,
        comment:           comment?.trim()   || null,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    return NextResponse.json({ success: true, review_id: review.id });
  } catch (error) {
    console.error("[POST /api/customer/orders/[id]/rider-review]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/customer/orders/[id]/rider-review
 * Returns the review for this order if one exists (for the authenticated customer).
 */
export async function GET(request, { params }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: orderId } = await params;
    const admin = createAdminClient();

    const { data: review } = await admin
      .from("rider_reviews")
      .select("id, rating, on_time, professional, package_condition, would_recommend, comment, created_at")
      .eq("order_id", orderId)
      .eq("customer_id", user.id)
      .maybeSingle();

    return NextResponse.json({ review: review ?? null });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
