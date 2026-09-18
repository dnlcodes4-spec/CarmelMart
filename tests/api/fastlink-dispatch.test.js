/**
 * dispatchOrder — sending a paid order to Fast Link.
 *
 * Found in production testing: the item query selected `order_items.name`,
 * which does not exist. PostgREST rejected the query, the error was discarded,
 * and the empty result was read as "every item is digital" — so every order was
 * silently skipped and Fast Link never received one. Nothing was recorded,
 * because a skip is not a failure.
 *
 * The fake below rejects unknown columns exactly as PostgREST does, so that
 * class of drift fails loudly instead of masquerading as a business rule.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.FASTLINK_API_KEY = "test-key";
  process.env.FASTLINK_API_SECRET = "test-secret";
});

import { dispatchOrder } from "@/lib/fastlink/orders";

const SCHEMA = {
  orders: new Set([
    "id", "customer_id", "status", "total", "payment_method", "payment_status",
    "payment_ref", "pod_deposit", "delivery_address", "notes", "created_at",
    "updated_at", "rider_id", "fastlink_order_id", "fastlink_status",
    "fastlink_dispatched_at", "fastlink_dispatch_error",
  ]),
  order_items: new Set([
    "id", "order_id", "product_id", "vendor_id", "quantity", "unit_price",
    "total", "created_at", "delivery_format", "variant_id", "variant_combination",
  ]),
};

const ORDER = {
  id: "order-1",
  fastlink_order_id: null,
  delivery_address: {
    fullName: "Ada", phone: "+2348000000000", street: "1 Test Street",
    city: "Lagos", state: "Lagos", lat: 6.6018, lng: 3.3515,
  },
};

const ITEMS = [
  { vendor_id: "vendor-1", quantity: 2, unit_price: 15500, delivery_format: "physical",
    products: { name: "Kids Backpack" } },
];

/** Parses a PostgREST select string, allowing embedded resources like products(name). */
function badColumn(table, sel) {
  const known = SCHEMA[table];
  if (!known) return null;
  const top = String(sel).replace(/\w+\s*\([^)]*\)/g, "").split(",").map((c) => c.trim()).filter(Boolean);
  const bad = top.find((c) => c !== "*" && !known.has(c));
  return bad ? `column ${table}.${bad} does not exist` : null;
}

function makeAdmin({ items = ITEMS, updates = [] } = {}) {
  return {
    from(table) {
      let err = null;
      const chain = {
        select(sel = "*") { err = badColumn(table, sel); return chain; },
        eq: () => chain,
        single: async () => err
          ? { data: null, error: { message: err } }
          : { data: ORDER, error: null },
        update(values) { updates.push(values); return { eq: async () => ({ error: null }) }; },
        then: (resolve) => resolve(err ? { data: null, error: { message: err } } : { data: items, error: null }),
      };
      return chain;
    },
  };
}

let sent;
beforeEach(() => {
  sent = [];
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    sent.push({ url: input.toString(), body: init.body ? JSON.parse(init.body) : null });
    return {
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => ({ id: 4242, status: "pending" }),
      text: async () => JSON.stringify({ id: 4242, status: "pending" }),
    };
  });
});

describe("dispatchOrder", () => {
  it("dispatches an order of physical goods", async () => {
    const result = await dispatchOrder(makeAdmin(), ORDER.id);
    expect(result.skipped).toBeUndefined();
    expect(result.dispatched).toBe(true);
    expect(result.fastlinkOrderId).toBe("4242");
  });

  it("only selects order_items columns that exist", async () => {
    // The original bug: a bad column made the query fail, and the empty result
    // was misread as "all digital" rather than surfacing as a problem.
    const result = await dispatchOrder(makeAdmin(), ORDER.id);
    expect(result.skipped).not.toBe("all_digital");
  });

  it("sends the product name, not a placeholder", async () => {
    await dispatchOrder(makeAdmin(), ORDER.id);
    const order = sent.find((s) => s.url.includes("orders"));
    expect(order.body.items[0].product_name).toBe("Kids Backpack");
    expect(order.body.items[0].merchant_external_id).toBe("vendor-1");
  });

  it("still skips an order that really is all digital", async () => {
    const digital = [{ ...ITEMS[0], delivery_format: "digital" }];
    const result = await dispatchOrder(makeAdmin({ items: digital }), ORDER.id);
    expect(result.skipped).toBe("all_digital");
  });

  it("carries the destination coordinates Fast Link routes on", async () => {
    await dispatchOrder(makeAdmin(), ORDER.id);
    const order = sent.find((s) => s.url.includes("orders"));
    expect(order.body.coordinates).toBe("6.6018,3.3515");
    expect(order.body.platform_order_id).toBe("order-1");
  });
});

describe("resolving the Fast Link order id", () => {
  /** Their create returns 201 with an empty body, so the client yields null. */
  function makeSilentCreate({ lookup = { count: 1, results: [{ id: 4220 }] } } = {}) {
    globalThis.fetch = vi.fn(async (input, init = {}) => {
      const url = input.toString();
      const method = init.method ?? "GET";
      sent.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
      const reply = (body, text) => ({
        ok: true, status: body ? 200 : 201, statusText: "OK",
        headers: { get: () => "application/json" },
        json: async () => body, text: async () => text ?? (body ? JSON.stringify(body) : ""),
      });
      if (method === "POST") return reply(null, "");        // empty create response
      return reply(lookup);                                  // the follow-up lookup
    });
  }

  it("looks the order up by platform_order_id when create says nothing", async () => {
    makeSilentCreate();
    const updates = [];
    const result = await dispatchOrder(makeAdmin({ updates }), ORDER.id);

    expect(result.fastlinkOrderId).toBe("4220");
    expect(updates.at(-1).fastlink_order_id).toBe("4220");
  });

  it("queries the lookup with our own order id", async () => {
    makeSilentCreate();
    await dispatchOrder(makeAdmin(), ORDER.id);
    const lookup = sent.find((s) => s.method === "GET");
    expect(lookup.url).toContain("platform_order_id=order-1");
  });

  it("still reports success when the id cannot be resolved", async () => {
    // The delivery exists either way; losing the id must not look like failure.
    makeSilentCreate({ lookup: { count: 0, results: [] } });
    const result = await dispatchOrder(makeAdmin(), ORDER.id);
    expect(result.dispatched).toBe(true);
    expect(result.fastlinkOrderId).toBeNull();
  });

  it("without the id the idempotency guard cannot work — so it must be resolved", async () => {
    // Guard is `if (order.fastlink_order_id) return already_dispatched`. A null
    // id means a second dispatch creates a duplicate delivery on their account.
    makeSilentCreate();
    const updates = [];
    await dispatchOrder(makeAdmin({ updates }), ORDER.id);
    expect(updates.at(-1).fastlink_order_id).not.toBeNull();
  });
});
