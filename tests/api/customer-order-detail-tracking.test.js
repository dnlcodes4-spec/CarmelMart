/**
 * The detail endpoint must actually reach the event table and hand the page a
 * `delivery` block. buildTracking is unit-tested separately; this covers the
 * wiring — the column names, the query, and the response shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ status: init?.status ?? 200, _data: data, json: async () => data }),
  },
}));

let orderRow, eventRows, selectedColumns;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "cust-1" } }, error: null }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table) {
      const chain = {
        select(cols) { selectedColumns[table] = String(cols ?? ""); return chain; },
        eq: () => chain,
        in: () => chain,
        order: async () => ({ data: table === "fastlink_order_events" ? eventRows : [], error: null }),
        single: async () => ({ data: orderRow, error: orderRow ? null : { message: "not found" } }),
        limit: async () => ({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const { GET } = await import("@/app/api/customer/orders/[id]/route");

const call = () => GET({}, { params: Promise.resolve({ id: "order-1" }) });

beforeEach(() => {
  selectedColumns = {};
  eventRows = [];
  orderRow = {
    id: "order-1",
    status: "shipped",
    total: 5000,
    pod_deposit: 0,
    payment_method: "card",
    payment_status: "paid",
    payment_ref: "ref",
    delivery_address: {},
    notes: null,
    created_at: "2026-08-01T09:00:00.000Z",
    fastlink_status: null,
    fastlink_dispatched_at: null,
    order_items: [],
  };
});

describe("GET /api/customer/orders/[id] — delivery tracking", () => {
  it("selects the fastlink columns it depends on", async () => {
    await call();
    expect(selectedColumns.orders).toContain("fastlink_status");
    expect(selectedColumns.orders).toContain("fastlink_dispatched_at");
  });

  it("queries the event table for this order's history", async () => {
    await call();
    expect(selectedColumns.fastlink_order_events).toBeDefined();
    expect(selectedColumns.fastlink_order_events).toContain("carmel_status");
    expect(selectedColumns.fastlink_order_events).toContain("created_at");
  });

  it("returns a delivery block alongside the timeline", async () => {
    const res = await call();
    expect(res._data.order.delivery).toBeDefined();
    expect(res._data.order.tracking).toHaveLength(5);
  });

  it("timestamps timeline steps from the event history", async () => {
    eventRows = [
      { carmel_status: "confirmed",  fastlink_status: "confirmed",  created_at: "2026-08-01T09:05:00.000Z" },
      { carmel_status: "shipped",    fastlink_status: "in_transit", created_at: "2026-08-01T14:30:00.000Z" },
    ];
    const res = await call();
    const { tracking } = res._data.order;
    expect(tracking[0].at).toBe("2026-08-01T09:00:00.000Z"); // order.created_at
    expect(tracking[1].at).toBe("2026-08-01T09:05:00.000Z");
    expect(tracking[3].at).toBe("2026-08-01T14:30:00.000Z");
  });

  it("surfaces a delivery problem with customer-facing copy", async () => {
    orderRow.fastlink_status = "postponed";
    const res = await call();
    const { delivery } = res._data.order;
    expect(delivery.isIssue).toBe(true);
    expect(delivery.issue.title).toMatch(/postpone/i);
  });

  it("reports no problem for a healthy delivery", async () => {
    orderRow.fastlink_status = "in_transit";
    const res = await call();
    expect(res._data.order.delivery.isIssue).toBe(false);
    expect(res._data.order.delivery.issue).toBeNull();
  });

  it("still renders for an order with no delivery history at all", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const { tracking, delivery } = res._data.order;
    expect(tracking.map((s) => s.done)).toEqual([true, true, true, true, false]);
    expect(tracking.slice(1).every((s) => s.at === null)).toBe(true);
    expect(delivery.isIssue).toBe(false);
  });
});
