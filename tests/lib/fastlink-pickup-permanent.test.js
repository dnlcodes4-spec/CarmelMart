/**
 * syncPickupAddress persists geocoded coordinates into vendors.pickup_lat/lng,
 * so its geocoding call must run under Mapbox's permanent terms. Temporary
 * results may not be stored, and the flag bills differently — so this asserts
 * the real outbound Mapbox URL rather than trusting a mocked module.
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

const VENDOR = {
  id: "vendor-1",
  business_name: "Test Store",
  phone: "08000000000",
  city: "Lagos",
  state: "Lagos",
  address: "12 Admiralty Way, Lekki Phase 1, Lagos",
  fastlink_merchant_id: "42",
  fastlink_pickup_id: null,
  pickup_label: "Main pickup",
  pickup_address: "12 Admiralty Way, Lekki Phase 1, Lagos",
  pickup_lat: null, // forces a geocode
  pickup_lng: null,
};

const GEO_FEATURE = {
  geometry: { type: "Point", coordinates: [3.487438, 6.442287] },
  properties: {
    mapbox_id: "dXJuOm1ieHBsYzpMZWtraQ",
    name: "Lekki Phase 1",
    full_address: "Lekki Phase 1, Lagos, Lagos, Nigeria",
    context: { region: { name: "Lagos" }, country: { name: "Nigeria" } },
  },
};

/**
 * Real column names, straight from the live schema. A stub that accepts any
 * select string hides column-name drift — PostgREST rejects unknown columns,
 * so this fake does too.
 */
const SCHEMA = {
  vendors: new Set([
    "id", "business_name", "address", "phone", "nin_verified", "cac_verified",
    "payment_verified", "bank_details", "created_at", "updated_at", "verification_type",
    "nin_data", "verification_status", "cac_number", "description", "return_policy",
    "vacation_mode", "city", "state", "bank_name", "bank_account_number", "bank_code",
    "subscription_tier", "rejection_reason", "slug", "notification_preferences",
    "has_delivery_rider", "delivery_rider_vehicle", "delivery_rider_coverage",
    "delivery_rider_responded_at", "bank_account_name", "fastlink_merchant_id",
    "fastlink_pickup_id", "fastlink_synced_at", "fastlink_sync_error",
    "pickup_label", "pickup_address", "pickup_lat", "pickup_lng",
  ]),
  users: new Set(["id", "email"]),
};

/** Mimics PostgREST: unknown column in select() or update() → error, no data. */
function assertColumns(table, columns) {
  const known = SCHEMA[table];
  if (!known) return null;
  const bad = columns.find((c) => !known.has(c));
  return bad ? `column ${table}.${bad} does not exist` : null;
}

/** Service-role client fake covering the query chains merchants.js uses. */
function makeAdmin(updates, vendorRow = VENDOR) {
  return {
    from(table) {
      let selectError = null;
      const chain = {
        select(cols = "*") {
          const columns = String(cols).split(",").map((c) => c.trim()).filter((c) => c && c !== "*");
          selectError = assertColumns(table, columns);
          return chain;
        },
        eq: () => chain,
        in: () => chain,
        single: async () => {
          if (selectError) return { data: null, error: { message: selectError } };
          return table === "users"
            ? { data: { email: "vendor@example.com" }, error: null }
            : { data: vendorRow, error: null };
        },
        update(values) {
          const bad = assertColumns(table, Object.keys(values));
          if (bad) throw new Error(bad);
          updates.push({ table, values });
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
      return chain;
    },
  };
}

let mapboxUrls;

beforeEach(() => {
  mapboxUrls = [];
  globalThis.fetch = vi.fn(async (input) => {
    const url = input.toString();
    const ok = (body) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    if (url.includes("api.mapbox.com")) {
      mapboxUrls.push(new URL(url));
      return ok({ type: "FeatureCollection", features: [GEO_FEATURE] });
    }
    return ok({ id: 987 }); // Fast Link createPickupAddress
  });
});

describe("syncPickupAddress", () => {
  it("geocodes under permanent terms because it stores the coordinates", async () => {
    const updates = [];
    await syncPickupAddress(makeAdmin(updates), VENDOR.id);

    expect(mapboxUrls).toHaveLength(1);
    expect(mapboxUrls[0].searchParams.get("permanent")).toBe("true");

    // The storage that makes permanent mode necessary in the first place.
    const vendorUpdate = updates.find((u) => u.table === "vendors");
    expect(vendorUpdate.values.pickup_lat).toBe(6.442287);
    expect(vendorUpdate.values.pickup_lng).toBe(3.487438);
  });

  it("does not geocode at all when the vendor already has coordinates", async () => {
    const updates = [];
    const stored = { ...VENDOR, pickup_lat: 6.5, pickup_lng: 3.4 };
    await syncPickupAddress(makeAdmin(updates, stored), VENDOR.id);
    expect(mapboxUrls).toHaveLength(0);
  });

  it("only selects vendor columns that exist in the schema", async () => {
    // loadVendor swallows the PostgREST error into "Vendor <id> not found", so a
    // column-name typo looks like missing data. Assert we never get there.
    const updates = [];
    await expect(syncPickupAddress(makeAdmin(updates), VENDOR.id)).resolves.not.toThrow();
    expect(updates.find((u) => u.table === "vendors")).toBeDefined();
  });

  it("falls back to vendors.address when no pickup_address is set", async () => {
    const updates = [];
    const noPickup = { ...VENDOR, pickup_address: null };
    await syncPickupAddress(makeAdmin(updates, noPickup), VENDOR.id);

    expect(mapboxUrls).toHaveLength(1);
    expect(mapboxUrls[0].searchParams.get("q")).toBe(VENDOR.address);
  });
});
