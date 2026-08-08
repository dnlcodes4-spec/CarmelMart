/**
 * POST /api/webhooks/fastlink
 *
 * Fast Link signs each delivery with HMAC-SHA256 over the RAW body. The receiver
 * must reject forgeries, stay idempotent under redelivery, and never hand back a
 * retryable status for an order that will never exist on our side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const SECRET = "whsec_test_secret";

vi.hoisted(() => {
  process.env.FASTLINK_WEBHOOK_SECRET = "whsec_test_secret";
  process.env.FASTLINK_API_KEY = "pk_test";
  process.env.FASTLINK_API_SECRET = "sk_test";
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ status: init?.status ?? 200, _data: data, json: async () => data }),
  },
}));

let adminClient;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));

const { POST } = await import("@/app/api/webhooks/fastlink/route");

const sign = (raw, secret = SECRET) => createHmac("sha256", secret).update(raw, "utf8").digest("hex");

function makeRequest(payload, { signature, rawOverride } = {}) {
  const raw = rawOverride ?? JSON.stringify(payload);
  const sig = signature === undefined ? sign(raw) : signature;
  return {
    text: async () => raw,
    headers: { get: (h) => (h.toLowerCase() === "x-fastlink-signature" ? sig : null) },
  };
}

/** Fake admin client over in-memory `orders` and `fastlink_order_events` tables. */
function makeAdmin(orders, { failEventInsert = false, failOrderUpdate = false } = {}) {
  const updates = [];
  const events = [];
  const client = {
    updates,
    events,
    from(table) {
      const f = {};
      const chain = {
        select: () => chain,
        eq(col, val) { f[col] = val; return chain; },
        maybeSingle: async () => ({
          data: orders.find((o) => Object.entries(f).every(([k, v]) => o[k] === v)) ?? null,
          error: null,
        }),
        insert(values) {
          if (table === "fastlink_order_events") {
            if (failEventInsert) return Promise.resolve({ data: null, error: { message: "insert failed" } });
            events.push(values);
          }
          return Promise.resolve({ data: null, error: null });
        },
        update(values) {
          return {
            eq(col, val) {
              if (failOrderUpdate) return Promise.resolve({ data: null, error: { message: "update failed" } });
              const row = orders.find((o) => o[col] === val);
              if (row) { Object.assign(row, values); updates.push({ id: row.id, values }); }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
      return chain;
    },
  };
  return client;
}

const ORDER = () => ({
  id: "order-1",
  status: "confirmed",
  fastlink_order_id: "FL-100",
  fastlink_status: "pending",
});

const event = (status, extra = {}) => ({
  event: "order.status_changed",
  data: { id: "FL-100", platform_order_id: "order-1", status, ...extra },
});

beforeEach(() => { adminClient = makeAdmin([ORDER()]); });

describe("signature verification", () => {
  it("rejects a forged signature with 401", async () => {
    const res = await POST(makeRequest(event("in_transit"), { signature: "deadbeef" }));
    expect(res.status).toBe(401);
    expect(adminClient.updates).toHaveLength(0);
  });

  it("rejects a body altered after signing", async () => {
    const honest = JSON.stringify(event("in_transit"));
    const tampered = JSON.stringify(event("delivered"));
    const res = await POST(makeRequest(null, { rawOverride: tampered, signature: sign(honest) }));
    expect(res.status).toBe(401);
  });

  it("accepts a sha256= prefixed signature", async () => {
    const raw = JSON.stringify(event("in_transit"));
    const res = await POST(makeRequest(null, { rawOverride: raw, signature: `sha256=${sign(raw)}` }));
    expect(res.status).toBe(200);
  });

  it("returns 400 for a validly signed body that is not JSON", async () => {
    const res = await POST(makeRequest(null, { rawOverride: "not json" }));
    expect(res.status).toBe(400);
  });
});

describe("status handling", () => {
  it("records the Fast Link status and maps it to a carmel status", async () => {
    const res = await POST(makeRequest(event("in_transit")));
    expect(res.status).toBe(200);
    const [update] = adminClient.updates;
    expect(update.values.fastlink_status).toBe("in_transit");
    expect(update.values.status).toBe("shipped");
  });

  it("records an unknown Fast Link status without touching the carmel status", async () => {
    const res = await POST(makeRequest(event("teleported")));
    expect(res.status).toBe(200);
    const [update] = adminClient.updates;
    expect(update.values.fastlink_status).toBe("teleported");
    expect(update.values).not.toHaveProperty("status");
  });

  it("never regresses an order that is already delivered", async () => {
    adminClient = makeAdmin([{ ...ORDER(), status: "delivered", fastlink_status: "delivered" }]);
    await POST(makeRequest(event("in_transit")));
    // The late event is still recorded, but the carmel status must not move back.
    expect(adminClient.updates).toHaveLength(1);
    expect(adminClient.updates[0].values.fastlink_status).toBe("in_transit");
    expect(adminClient.updates[0].values).not.toHaveProperty("status");
  });

  it("is idempotent — a redelivered event writes nothing the second time", async () => {
    const orders = [ORDER()];
    adminClient = makeAdmin(orders);

    await POST(makeRequest(event("delivered")));
    const afterFirst = { ...orders[0] };
    const writesAfterFirst = adminClient.updates.length;
    expect(writesAfterFirst).toBe(1);

    await POST(makeRequest(event("delivered")));
    expect(orders[0]).toEqual(afterFirst);
    expect(adminClient.updates).toHaveLength(writesAfterFirst);
  });
});

describe("event history", () => {
  it("records one event per genuine transition", async () => {
    await POST(makeRequest(event("in_transit")));
    expect(adminClient.events).toHaveLength(1);
    const [row] = adminClient.events;
    expect(row).toMatchObject({
      order_id:          "order-1",
      fastlink_order_id: "FL-100",
      event:             "order.status_changed",
      fastlink_status:   "in_transit",
      carmel_status:     "shipped",
    });
  });

  it("stores the raw payload so a shape mismatch can be diagnosed later", async () => {
    await POST(makeRequest(event("in_transit", { rider: { name: "Ade" } })));
    expect(adminClient.events[0].payload).toMatchObject({
      id: "FL-100", status: "in_transit", rider: { name: "Ade" },
    });
  });

  it("records an unmapped status with a null carmel_status", async () => {
    await POST(makeRequest(event("teleported")));
    expect(adminClient.events[0]).toMatchObject({
      fastlink_status: "teleported",
      carmel_status:   null,
    });
  });

  it("writes no event when the same status is redelivered", async () => {
    await POST(makeRequest(event("in_transit")));
    expect(adminClient.events).toHaveLength(1);
    await POST(makeRequest(event("in_transit")));
    expect(adminClient.events).toHaveLength(1);
  });

  it("still records the late event when a delivered order cannot regress", async () => {
    adminClient = makeAdmin([{ ...ORDER(), status: "delivered", fastlink_status: "delivered" }]);
    await POST(makeRequest(event("in_transit")));
    expect(adminClient.events).toHaveLength(1);
    expect(adminClient.events[0].carmel_status).toBe("shipped");
  });

  it("keeps the order update when the event insert fails", async () => {
    const orders = [ORDER()];
    adminClient = makeAdmin(orders, { failEventInsert: true });
    const res = await POST(makeRequest(event("in_transit")));
    expect(res.status).toBe(200);
    expect(orders[0].status).toBe("shipped");
    expect(orders[0].fastlink_status).toBe("in_transit");
  });

  it("writes no event when the order update itself fails", async () => {
    adminClient = makeAdmin([ORDER()], { failOrderUpdate: true });
    const res = await POST(makeRequest(event("in_transit")));
    expect(res.status).toBe(200);
    expect(adminClient.events).toHaveLength(0);
  });
});

describe("order lookup", () => {
  it("falls back to platform_order_id when fastlink_order_id does not match", async () => {
    adminClient = makeAdmin([{ ...ORDER(), fastlink_order_id: null }]);
    const res = await POST(makeRequest(event("in_transit")));
    expect(res.status).toBe(200);
    expect(adminClient.updates.at(-1).values.fastlink_status).toBe("in_transit");
  });

  it("returns 200 for an unknown order so Fast Link stops retrying", async () => {
    adminClient = makeAdmin([]);
    const res = await POST(makeRequest({
      event: "order.status_changed",
      data: { id: "FL-999", platform_order_id: "nope", status: "in_transit" },
    }));
    expect(res.status).toBe(200);
    expect(res._data.matched).toBe(false);
    expect(adminClient.updates).toHaveLength(0);
  });

  it("returns 200 and ignores an event type it does not handle", async () => {
    const res = await POST(makeRequest({ event: "merchant.updated", data: { id: "FL-100" } }));
    expect(res.status).toBe(200);
    expect(adminClient.updates).toHaveLength(0);
  });
});
