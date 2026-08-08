/**
 * The orders list flags orders whose delivery is in trouble, so a customer sees
 * the problem without opening the order.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.FASTLINK_API_KEY = "pk_test";
  process.env.FASTLINK_API_SECRET = "sk_test";
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ status: init?.status ?? 200, _data: data, json: async () => data }),
  },
}));

let orderRows;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "cust-1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: orderRows, error: null }),
      };
      return chain;
    },
  }),
}));

const { GET } = await import("@/app/api/customer/orders/route");

const order = (id, fastlink_status) => ({
  id: `${id}-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`.slice(0, 36),
  status: "shipped",
  total: 5000,
  created_at: "2026-08-01T09:00:00.000Z",
  delivery_address: {},
  fastlink_status,
  order_items: [{ id: "i1", quantity: 1, unit_price: 5000, total: 5000, products: { name: "Bag", images: ["x.jpg"] } }],
});

beforeEach(() => { orderRows = []; });

describe("GET /api/customer/orders — delivery issue flag", () => {
  it("flags orders whose delivery has a problem", async () => {
    orderRows = [order("1", "postponed"), order("2", "no_response"), order("3", "failed")];
    const res = await GET();
    expect(res._data.orders.every((o) => o.hasDeliveryIssue === true)).toBe(true);
  });

  it("does not flag a healthy delivery", async () => {
    orderRows = [order("1", "in_transit"), order("2", "delivered")];
    const res = await GET();
    expect(res._data.orders.every((o) => o.hasDeliveryIssue === false)).toBe(true);
  });

  it("does not flag an order that never went to Fast Link", async () => {
    orderRows = [order("1", null)];
    const res = await GET();
    expect(res._data.orders[0].hasDeliveryIssue).toBe(false);
  });

  it("does not flag an unrecognised status", async () => {
    orderRows = [order("1", "teleported")];
    const res = await GET();
    expect(res._data.orders[0].hasDeliveryIssue).toBe(false);
  });

  it("keeps the existing list fields intact", async () => {
    orderRows = [order("1", "postponed")];
    const res = await GET();
    const [o] = res._data.orders;
    expect(o.shortId).toMatch(/^#CM-/);
    expect(o.itemCount).toBe(1);
    expect(o.firstItem).toBe("Bag");
    expect(o.total).toBe(5000);
  });
});
