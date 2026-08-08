/**
 * POST /api/webhooks/fastlink
 *
 * Receives Fast Link delivery events and reflects them onto the order.
 *
 * Security:
 *   - HMAC-SHA256 over the RAW body, compared in constant time. A bad signature
 *     is the only case that returns a non-2xx.
 *   - Service-role client only; no user session is involved.
 *
 * Retry policy (mirrors the Flutterwave receiver): every outcome except a failed
 * signature check returns 200. An order we cannot match will never appear later,
 * so asking Fast Link to retry it would just produce a retry storm.
 *
 * Idempotency: only genuinely changed fields are written, so a redelivered event
 * performs no write at all.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyFastLinkSignature,
  FASTLINK_SIGNATURE_HEADER,
  FASTLINK_EVENT_HEADER,
} from "@/lib/fastlink/webhook";
import { toCarmelStatus, isIssueStatus, TERMINAL_CARMEL_STATUSES } from "@/lib/fastlink/status";

const HANDLED_EVENTS = new Set(["order.created", "order.status_changed", "order.assigned"]);

const ORDER_COLUMNS = "id, status, fastlink_order_id, fastlink_status";

/**
 * Fast Link's id first (indexed), then our own order id, which Fast Link echoes
 * back as platform_order_id. The fallback matters for the window between
 * creating an order there and recording its id here.
 */
async function findOrder(admin, fastlinkOrderId, platformOrderId) {
  if (fastlinkOrderId) {
    const { data } = await admin
      .from("orders").select(ORDER_COLUMNS)
      .eq("fastlink_order_id", fastlinkOrderId).maybeSingle();
    if (data) return data;
  }
  if (platformOrderId) {
    const { data } = await admin
      .from("orders").select(ORDER_COLUMNS)
      .eq("id", platformOrderId).maybeSingle();
    if (data) return data;
  }
  return null;
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get(FASTLINK_SIGNATURE_HEADER);

    if (!verifyFastLinkSignature(rawBody, signature)) {
      console.warn("[fastlink-webhook] Invalid signature — request rejected");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const event = payload?.event ?? request.headers.get(FASTLINK_EVENT_HEADER);
    if (!HANDLED_EVENTS.has(event)) {
      return NextResponse.json({ received: true, ignored: event ?? null });
    }

    // Fast Link nests the order under `data`; tolerate a flat body too.
    const data = payload?.data ?? payload;
    const fastlinkOrderId = data?.id != null ? String(data.id) : null;
    const platformOrderId = data?.platform_order_id ?? null;
    const fastlinkStatus = data?.status ?? null;

    const admin = createAdminClient();
    const order = await findOrder(admin, fastlinkOrderId, platformOrderId);

    if (!order) {
      console.warn(
        `[fastlink-webhook] ${event}: no order for fastlink_order_id=${fastlinkOrderId} platform_order_id=${platformOrderId}`,
      );
      return NextResponse.json({ received: true, matched: false });
    }

    // Build the update from changed fields only — this is what makes redelivery a no-op.
    const update = {};

    if (fastlinkOrderId && order.fastlink_order_id !== fastlinkOrderId) {
      update.fastlink_order_id = fastlinkOrderId;
    }
    if (fastlinkStatus && order.fastlink_status !== fastlinkStatus) {
      update.fastlink_status = fastlinkStatus;
    }

    // An unmapped status is recorded but never guessed at — better a stale carmel
    // status than a wrong one.
    const carmelStatus = toCarmelStatus(fastlinkStatus);
    if (
      carmelStatus &&
      carmelStatus !== order.status &&
      !TERMINAL_CARMEL_STATUSES.has(order.status)
    ) {
      update.status = carmelStatus;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ received: true, matched: true, changed: false });
    }

    update.updated_at = new Date().toISOString();
    const { error } = await admin.from("orders").update(update).eq("id", order.id);
    if (error) {
      // Still 200: a retry would hit the same failure. Surfaced in logs instead.
      console.error(`[fastlink-webhook] order ${order.id} update failed:`, error.message);
      return NextResponse.json({ received: true, matched: true, changed: false });
    }

    // Record the transition so the customer timeline can show when each step
    // happened. Guarded on fastlink_status having actually moved, so a redelivered
    // event writes nothing here either. A failure is logged, never propagated —
    // the order update is what matters, and losing an audit row must not trigger
    // a retry of an event we have already applied.
    if (update.fastlink_status) {
      const { error: eventError } = await admin.from("fastlink_order_events").insert({
        order_id:          order.id,
        fastlink_order_id: fastlinkOrderId,
        event,
        fastlink_status:   fastlinkStatus,
        carmel_status:     carmelStatus ?? null,
        payload:           data ?? null,
      });
      if (eventError) {
        console.error(`[fastlink-webhook] order ${order.id} event insert failed:`, eventError.message);
      }
    }

    if (isIssueStatus(fastlinkStatus)) {
      console.warn(`[fastlink-webhook] order ${order.id} needs attention — Fast Link status "${fastlinkStatus}"`);
    }

    return NextResponse.json({
      received: true,
      matched: true,
      changed: true,
      orderId: order.id,
      status: update.status ?? order.status,
      fastlinkStatus,
    });
  } catch (error) {
    console.error("[fastlink-webhook] Unhandled error:", error);
    return NextResponse.json({ received: true, error: "handler_error" });
  }
}
