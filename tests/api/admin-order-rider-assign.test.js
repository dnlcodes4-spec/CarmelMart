/**
 * Rider assignment is the single place an order enters the in-house delivery
 * path, so it is the right place to close that path when Fast Link takes over.
 *
 * Two boundaries matter and are asserted here:
 *   - Unassigning must keep working when the path is closed, or an order can be
 *     stranded with a rider who is no longer delivering.
 *   - Closing the path must not touch orders already assigned; riders finish
 *     what they started.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ status: init?.status ?? 200, _data: data, json: async () => data }),
  },
}));

let inHouseEnabled;
vi.mock("@/lib/config", () => ({
  get config() {
    return {
      delivery: { inHouseEnabled },
      app: { url: "http://localhost:3000" },
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
  }),
}));

let orderRow, writes;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table) {
      const f = {};
      const chain = {
        select: () => chain,
        eq(col, val) { f[col] = val; return chain; },
        single: async () => {
          if (table === "users" && f.id === "admin-1") return { data: { role: "admin" }, error: null };
          if (table === "users") return { data: { role: "rider", status: "active" }, error: null };
          return { data: orderRow, error: orderRow ? null : { message: "missing" } };
        },
        insert: async (v) => { writes.push({ table, v }); return { data: null, error: null }; },
        update(values) {
          return { eq: async () => { writes.push({ table, values }); return { data: null, error: null }; } };
        },
      };
      return chain;
    },
  }),
}));

const { PATCH } = await import("@/app/api/admin/orders/[id]/route");

const patch = (body) =>
  PATCH({ json: async () => body }, { params: Promise.resolve({ id: "order-1" }) });

const orderWrites = () => writes.filter((w) => w.table === "orders");

beforeEach(() => {
  writes = [];
  inHouseEnabled = true;
  orderRow = { id: "order-1", status: "confirmed", rider_id: null, delivery_address: {}, total: 5000, payment_method: "card" };
});

describe("rider assignment while in-house delivery is enabled", () => {
  it("assigns a rider", async () => {
    const res = await patch({ rider_id: "rider-1" });
    expect(res.status).toBe(200);
    expect(orderWrites()[0].values.rider_id).toBe("rider-1");
  });
});

describe("rider assignment once in-house delivery is switched off", () => {
  beforeEach(() => { inHouseEnabled = false; });

  it("refuses to assign a new rider", async () => {
    const res = await patch({ rider_id: "rider-1" });
    expect(res.status).toBe(409);
    expect(res._data.error).toMatch(/in-house|retired|disabled/i);
  });

  it("writes nothing to the order when it refuses", async () => {
    await patch({ rider_id: "rider-1" });
    expect(orderWrites()).toHaveLength(0);
  });

  it("does not notify anyone when it refuses", async () => {
    await patch({ rider_id: "rider-1" });
    expect(writes.filter((w) => w.table === "notifications")).toHaveLength(0);
  });

  it("still allows unassigning, so no order is stranded", async () => {
    orderRow.rider_id = "rider-1";
    const res = await patch({ rider_id: null });
    expect(res.status).toBe(200);
    expect(orderWrites()[0].values.rider_id).toBeNull();
  });

  it("still allows reassigning away from a rider by clearing first", async () => {
    orderRow.rider_id = "rider-1";
    const res = await patch({ rider_id: undefined });
    expect(res.status).toBe(200);
  });
});
