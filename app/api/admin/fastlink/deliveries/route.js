/**
 * Deliveries that need a person — admin only.
 *
 * GET /api/admin/fastlink/deliveries
 *   → orders whose Fast Link delivery was cancelled, postponed, failed, or went
 *     unanswered, with the reason Fast Link gave.
 *
 * These are deliberately NOT applied to the order automatically. Fast Link
 * cancels for operational reasons — no rider, area not covered, address
 * unreachable — and the order is usually still deliverable another way. The
 * choice between re-dispatching, sending an in-house rider, and cancelling with
 * a refund belongs to a human, so this is the queue they work from.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FASTLINK_REVIEW_STATUSES, describeIssue } from "@/lib/fastlink/status";

async function verifyAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? admin : null;
}

/** Fast Link puts the reason at the top level of the order object it sends. */
function reasonFrom(payload) {
  const d = payload?.data ?? payload ?? {};
  const raw = d.cancellation_reason ?? d.reason ?? null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const statuses = [...FASTLINK_REVIEW_STATUSES];
  const { data: orders, error } = await admin
    .from("orders")
    .select("id, status, total, created_at, delivery_address, fastlink_order_id, fastlink_status, fastlink_dispatched_at")
    .in("fastlink_status", statuses)
    .order("fastlink_dispatched_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!orders?.length) return NextResponse.json({ deliveries: [] });

  // One query for the history rather than one per order.
  const { data: events } = await admin
    .from("fastlink_order_events")
    .select("order_id, fastlink_status, payload, created_at")
    .in("order_id", orders.map((o) => o.id))
    .order("created_at", { ascending: false });

  const latestByOrder = new Map();
  for (const e of events ?? []) {
    if (!latestByOrder.has(e.order_id)) latestByOrder.set(e.order_id, e);
  }

  const deliveries = orders.map((o) => {
    const latest = latestByOrder.get(o.id);
    const copy = describeIssue(o.fastlink_status);
    const addr = o.delivery_address ?? {};
    return {
      orderId:         o.id,
      orderStatus:     o.status,          // deliberately unchanged by the webhook
      total:           o.total,
      createdAt:       o.created_at,
      fastlinkOrderId: o.fastlink_order_id,
      fastlinkStatus:  o.fastlink_status,
      dispatchedAt:    o.fastlink_dispatched_at,
      lastUpdate:      latest?.created_at ?? null,
      reason:          reasonFrom(latest?.payload),
      title:           copy?.title ?? "Delivery needs attention",
      customerName:    addr.fullName ?? null,
      customerPhone:   addr.phone ?? null,
    };
  });

  return NextResponse.json({ deliveries });
}
