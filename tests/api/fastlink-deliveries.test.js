/**
 * The review queue: deliveries Fast Link could not complete.
 *
 * The point of this endpoint is that these orders were deliberately NOT
 * cancelled by the webhook, so the queue has to carry enough for a person to
 * decide between re-dispatching, sending an in-house rider, and cancelling with
 * a refund. Losing the reason would make it undecidable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORDERS = [
  { id: "o-cancelled", status: "confirmed", total: 15500, created_at: "2026-09-18T10:00:00Z",
    delivery_address: { fullName: "Ada", phone: "+2348000000000" },
    fastlink_order_id: "4220", fastlink_status: "cancelled", fastlink_dispatched_at: "2026-09-18T10:24:00Z" },
  { id: "o-failed", status: "shipped", total: 8000, created_at: "2026-09-17T09:00:00Z",
    delivery_address: { fullName: "Bola", phone: "+2348111111111" },
    fastlink_order_id: "4200", fastlink_status: "failed", fastlink_dispatched_at: "2026-09-17T09:30:00Z" },
];

const EVENTS = [
  { order_id: "o-cancelled", fastlink_status: "cancelled", created_at: "2026-09-18T10:30:00Z",
    payload: { cancellation_reason: "No rider available", status: "cancelled" } },
  { order_id: "o-cancelled", fastlink_status: "pending", created_at: "2026-09-18T10:24:00Z",
    payload: { status: "pending" } },
  { order_id: "o-failed", fastlink_status: "failed", created_at: "2026-09-17T11:00:00Z",
    payload: { status: "failed" } },
];

let inStatuses;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: ORDERS, error: null }),
        single: async () => ({ data: { role: "admin" }, error: null }),
        in(col, vals) {
          if (table === "orders") inStatuses = vals;
          chain.then = (resolve) => resolve({
            data: table === "orders" ? ORDERS : EVENTS, error: null,
          });
          return chain;
        },
      };
      return chain;
    },
  }),
}));

const { GET } = await import("@/app/api/admin/fastlink/deliveries/route");

beforeEach(() => { inStatuses = null; });

describe("review queue", () => {
  it("asks for exactly the statuses that need a person", async () => {
    await GET();
    expect(new Set(inStatuses)).toEqual(new Set(["postponed", "no_response", "failed", "cancelled"]));
  });

  it("carries Fast Link's reason so the decision can be made", async () => {
    const body = await (await GET()).json();
    const cancelled = body.deliveries.find((d) => d.orderId === "o-cancelled");
    expect(cancelled.reason).toBe("No rider available");
  });

  it("takes the reason from the most recent event, not the first", async () => {
    const body = await (await GET()).json();
    const cancelled = body.deliveries.find((d) => d.orderId === "o-cancelled");
    expect(cancelled.fastlinkStatus).toBe("cancelled");
    expect(cancelled.reason).not.toBeNull();
  });

  it("shows the order is still live — the webhook did not cancel it", async () => {
    const body = await (await GET()).json();
    expect(body.deliveries.find((d) => d.orderId === "o-cancelled").orderStatus).toBe("confirmed");
  });

  it("copes with a delivery whose event carried no reason", async () => {
    const body = await (await GET()).json();
    const failed = body.deliveries.find((d) => d.orderId === "o-failed");
    expect(failed.reason).toBeNull();
    expect(failed.title).toBeTruthy();
  });

  it("includes who to phone, since the next step is usually a call", async () => {
    const body = await (await GET()).json();
    const d = body.deliveries[0];
    expect(d.customerName).toBeTruthy();
    expect(d.customerPhone).toBeTruthy();
  });
});
