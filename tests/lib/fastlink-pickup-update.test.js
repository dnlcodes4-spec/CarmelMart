/**
 * Correcting a pickup point must UPDATE it, not create a rival.
 *
 * The original code assumed Fast Link had no pickup-update endpoint and created
 * a fresh default on every correction. It does have one — /pickup-addresses/<id>/
 * allows PUT, PATCH and DELETE — and the create-fresh strategy left the old
 * record behind with is_default still true. In production that produced one
 * merchant with two default pickup points ~200km apart, so a dispatch could
 * resolve to either.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.MAPBOX_TOKEN = "pk.test-server-token";
  process.env.GEOCODING_PROVIDER = "mapbox";
  process.env.GEOCODING_COUNTRY = "ng";
  process.env.FASTLINK_API_KEY = "test-key";
  process.env.FASTLINK_API_SECRET = "test-secret";
});

import { syncPickupAddress } from "@/lib/fastlink/merchants";
import { fastlink } from "@/lib/fastlink/client";

const VENDOR = {
  id: "vendor-1",
  business_name: "Test Store",
  phone: "08000000000",
  city: "Abeokuta",
  state: "Ogun",
  address: "Camp, Abeokuta",
  fastlink_merchant_id: "42",
  fastlink_pickup_id: null,
  pickup_label: "Main pickup",
  pickup_address: "Camp, Abeokuta",
  pickup_lat: 7.1557,
  pickup_lng: 3.3451,
};

const SCHEMA_VENDORS = new Set([
  "id","business_name","address","phone","city","state","verification_status",
  "fastlink_merchant_id","fastlink_pickup_id","fastlink_synced_at","fastlink_sync_error",
  "pickup_label","pickup_address","pickup_lat","pickup_lng",
]);

function makeAdmin(updates, vendorRow = VENDOR) {
  return {
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          table === "users"
            ? { data: { email: "v@example.com" }, error: null }
            : { data: vendorRow, error: null },
        update(values) {
          if (table === "vendors") {
            const bad = Object.keys(values).find((k) => !SCHEMA_VENDORS.has(k));
            if (bad) throw new Error(`column vendors.${bad} does not exist`);
          }
          updates.push({ table, values });
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
      return chain;
    },
  };
}

let flCalls;

beforeEach(() => {
  flCalls = [];
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = input.toString();
    const ok = (body) => ({
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => body, text: async () => JSON.stringify(body),
    });
    if (url.includes("api.mapbox.com")) {
      return ok({ type: "FeatureCollection", features: [] });
    }
    flCalls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : null,
    });
    return ok({ id: 6, is_default: true });
  });
});

const pickupCalls = () => flCalls.filter((c) => c.url.includes("pickup-addresses"));

describe("syncPickupAddress — correcting an existing pickup", () => {
  it("updates the existing record instead of creating a second default", async () => {
    const stored = { ...VENDOR, fastlink_pickup_id: "5" };
    await syncPickupAddress(makeAdmin([], stored), VENDOR.id, { force: true });

    const calls = pickupCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toMatch(/pickup-addresses\/5\/?$/);
  });

  it("never POSTs when the vendor already has a pickup id", async () => {
    const stored = { ...VENDOR, fastlink_pickup_id: "5" };
    await syncPickupAddress(makeAdmin([], stored), VENDOR.id, { force: true });
    expect(pickupCalls().some((c) => c.method === "POST")).toBe(false);
  });

  it("sends the corrected coordinates in the update", async () => {
    const stored = { ...VENDOR, fastlink_pickup_id: "5", pickup_lat: 6.9256, pickup_lng: 3.7559 };
    await syncPickupAddress(makeAdmin([], stored), VENDOR.id, { force: true });

    const body = pickupCalls()[0].body;
    expect(body.latitude).toBe("6.9256");
    expect(body.longitude).toBe("3.7559");
    expect(body.is_default).toBe(true);
  });

  it("keeps the same pickup id rather than churning it", async () => {
    const updates = [];
    const stored = { ...VENDOR, fastlink_pickup_id: "5" };
    await syncPickupAddress(makeAdmin(updates, stored), VENDOR.id, { force: true });

    const row = updates.find((u) => u.table === "vendors");
    expect(row.values.fastlink_pickup_id).toBe("5");
  });
});

describe("syncPickupAddress — first time", () => {
  it("still creates when there is no pickup yet", async () => {
    await syncPickupAddress(makeAdmin([]), VENDOR.id, { force: true });

    const calls = pickupCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/pickup-addresses\/?$/);
  });

  it("skips entirely when a pickup exists and force is not set", async () => {
    const stored = { ...VENDOR, fastlink_pickup_id: "5" };
    const id = await syncPickupAddress(makeAdmin([], stored), VENDOR.id);
    expect(pickupCalls()).toHaveLength(0);
    expect(id).toBe("5");
  });
});

describe("fastlink client", () => {
  it("exposes updatePickupAddress targeting the detail endpoint", async () => {
    await fastlink.updatePickupAddress(5, { latitude: "1", longitude: "2" });
    expect(flCalls[0].method).toBe("PATCH");
    expect(flCalls[0].url).toMatch(/pickup-addresses\/5\/?$/);
  });

  it("exposes deletePickupAddress for removing an orphan", async () => {
    await fastlink.deletePickupAddress(5);
    expect(flCalls[0].method).toBe("DELETE");
    expect(flCalls[0].url).toMatch(/pickup-addresses\/5\/?$/);
  });
});
