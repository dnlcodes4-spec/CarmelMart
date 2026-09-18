/**
 * A zero-cost quote must never be treated as a real price.
 *
 * Fast Link returns a well-formed success response with every rate at 0.00 when
 * the platform's pricing formula has not been configured — correct currency,
 * correct distance, cost "0.00". Taken at face value that is a successful quote
 * of nothing, which would charge every customer ₦0 for delivery and overwrite
 * the zone fee server-side. Falling back to zone pricing is the safe reading.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.FASTLINK_API_KEY = "test-key";
  process.env.FASTLINK_API_SECRET = "test-secret";
});

import { quoteShippingForItems } from "@/lib/fastlink/shipping";

const VENDORS = [
  { id: "v1", pickup_lat: 6.9256, pickup_lng: 3.7559 },
  { id: "v2", pickup_lat: 6.4531, pickup_lng: 3.3958 },
];

function makeAdmin(rows = VENDORS) {
  return {
    from() {
      const chain = {
        select: () => chain,
        in: async () => ({ data: rows, error: null }),
      };
      return chain;
    },
  };
}

/** costs: cost string returned per successive calculateShipping call. */
function stubFastLink(costs) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const cost = costs[Math.min(i++, costs.length - 1)];
    // The client reads res.text() and parses it itself.
    const body = JSON.stringify({ currency: "NGN", cost, distance_km: 65.7, weight_kg: 2.5 });
    return {
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  });
}

const DEST = { lat: 6.4531, lng: 3.3958 };
const ITEMS = [{ vendorId: "v1", quantity: 1 }, { vendorId: "v2", quantity: 2 }];

beforeEach(() => { vi.restoreAllMocks(); });

describe("quoteShippingForItems — unconfigured pricing", () => {
  it("falls back when every leg quotes zero", async () => {
    stubFastLink(["0.00"]);
    const r = await quoteShippingForItems({ admin: makeAdmin(), destination: DEST, items: ITEMS });
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("provider_zero_price");
  });

  it("falls back when only one leg quotes zero", async () => {
    // A gap in per-merchant pricing is no more chargeable than a total gap.
    stubFastLink(["500.00", "0.00"]);
    const r = await quoteShippingForItems({ admin: makeAdmin(), destination: DEST, items: ITEMS });
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("provider_zero_price");
  });

  it("treats a negative cost as unusable too", async () => {
    stubFastLink(["-50.00"]);
    const r = await quoteShippingForItems({ admin: makeAdmin(), destination: DEST, items: ITEMS });
    expect(r.fallback).toBe(true);
  });

  it("treats a non-numeric cost as unusable", async () => {
    stubFastLink([""]);
    const r = await quoteShippingForItems({ admin: makeAdmin(), destination: DEST, items: ITEMS });
    expect(r.fallback).toBe(true);
  });
});

describe("quoteShippingForItems — configured pricing", () => {
  it("still returns a real quote when every leg has a price", async () => {
    stubFastLink(["500.00", "750.00"]);
    const r = await quoteShippingForItems({ admin: makeAdmin(), destination: DEST, items: ITEMS });
    expect(r.fallback).toBe(false);
    expect(r.totalFee).toBe(1250);
    expect(r.currency).toBe("NGN");
    expect(r.breakdown).toHaveLength(2);
  });

  it("rounds to whole naira as before", async () => {
    stubFastLink(["499.60", "0.40"].slice(0, 1));
    const r = await quoteShippingForItems({
      admin: makeAdmin([VENDORS[0]]), destination: DEST, items: [{ vendorId: "v1", quantity: 1 }],
    });
    expect(r.fallback).toBe(false);
    expect(r.totalFee).toBe(500);
  });
});
