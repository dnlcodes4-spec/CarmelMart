/**
 * Admin path for setting a vendor's pickup point.
 *
 * Needed for the tail of vendors who never open the portal — ops can place the
 * point during a phone call. Coordinates only: typed addresses cannot be
 * geocoded reliably here, which is the whole reason the map exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ status: init?.status ?? 200, _data: data, json: async () => data }),
  },
}));

let role;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));

let vendorRow, writes, vendorList, productRows;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table) {
      const f = {};
      const chain = {
        select: () => chain,
        eq(col, val) { f[col] = val; return chain; },
        is: () => chain,
        in: () => chain,
        order: () => Promise.resolve({
          data: table === "vendors" ? vendorList : productRows, error: null,
        }),
        then(resolve) {
          resolve({ data: table === "products" ? productRows : vendorList, error: null });
        },
        single: async () =>
          table === "users"
            ? { data: { role }, error: null }
            : { data: vendorRow, error: vendorRow ? null : { message: "missing" } },
        update(values) {
          return { eq: async () => { writes.push({ table, values }); return { data: null, error: null }; } };
        },
      };
      return chain;
    },
  }),
}));

const syncPickupAddress = vi.fn(async () => "77");
vi.mock("@/lib/fastlink/merchants", () => ({
  syncPickupAddress: (...a) => syncPickupAddress(...a),
}));

const { POST, GET } = await import("@/app/api/admin/fastlink/pickup/route");

const post = (body) => POST({ json: async () => body });
const vendorWrites = () => writes.filter((w) => w.table === "vendors");

beforeEach(() => {
  writes = [];
  role = "admin";
  vendorRow = { id: "v1", business_name: "BisiBagz", fastlink_merchant_id: "17" };
  vendorList = [
    { id: "v1", business_name: "BisiBagz",  phone: "0814", address: "Abeokuta",  fastlink_merchant_id: "17" },
    { id: "v2", business_name: "Zenas",     phone: "0801", address: "Sango Ota", fastlink_merchant_id: "64" },
  ];
  productRows = [{ vendor_id: "v1" }, { vendor_id: "v1" }];
  syncPickupAddress.mockClear();
});

describe("GET — vendors still missing a pickup point", () => {
  it("refuses a non-admin", async () => {
    role = "vendor";
    expect((await GET()).status).toBe(403);
  });

  it("lists vendors with no pin", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res._data.vendors.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("flags which of them can actually receive an order today", async () => {
    const res = await GET();
    const byId = Object.fromEntries(res._data.vendors.map((v) => [v.id, v]));
    // Only vendors with active products matter for the migration right now.
    expect(byId.v1.hasActiveProducts).toBe(true);
    expect(byId.v2.hasActiveProducts).toBe(false);
  });

  it("sorts vendors with products first, so ops work the list top-down", async () => {
    vendorList = [
      { id: "v2", business_name: "Zenas",   phone: "0801", address: "x", fastlink_merchant_id: "64" },
      { id: "v1", business_name: "BisiBagz", phone: "0814", address: "y", fastlink_merchant_id: "17" },
    ];
    const res = await GET();
    expect(res._data.vendors[0].id).toBe("v1");
  });

  it("reports how many still need a point", async () => {
    const res = await GET();
    expect(res._data.total).toBe(2);
    expect(res._data.withActiveProducts).toBe(1);
  });
});

describe("authorisation", () => {
  it("refuses a non-admin", async () => {
    role = "vendor";
    const res = await post({ vendorId: "v1", latitude: 7.15, longitude: 3.35 });
    expect(res.status).toBe(403);
    expect(vendorWrites()).toHaveLength(0);
  });
});

describe("validation", () => {
  it("rejects a missing vendor", async () => {
    vendorRow = null;
    const res = await post({ vendorId: "nope", latitude: 7.15, longitude: 3.35 });
    expect(res.status).toBe(404);
  });

  it.each([
    ["no coordinates", { vendorId: "v1" }],
    ["latitude only", { vendorId: "v1", latitude: 7.15 }],
    ["non-numeric", { vendorId: "v1", latitude: "here", longitude: "there" }],
    ["latitude out of range", { vendorId: "v1", latitude: 120, longitude: 3.35 }],
    ["longitude out of range", { vendorId: "v1", latitude: 7.15, longitude: 200 }],
  ])("rejects %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(vendorWrites()).toHaveLength(0);
  });

  it("rejects coordinates outside Nigeria, which is almost always a mistake", async () => {
    const res = await post({ vendorId: "v1", latitude: 51.5072, longitude: -0.1276 }); // London
    expect(res.status).toBe(400);
    expect(res._data.error).toMatch(/nigeria/i);
    expect(vendorWrites()).toHaveLength(0);
  });
});

describe("setting the point", () => {
  it("stores the coordinates", async () => {
    const res = await post({ vendorId: "v1", latitude: 7.1475, longitude: 3.3619 });
    expect(res.status).toBe(200);
    expect(vendorWrites()[0].values).toMatchObject({ pickup_lat: 7.1475, pickup_lng: 3.3619 });
  });

  it("pushes a fresh default pickup to Fast Link", async () => {
    await post({ vendorId: "v1", latitude: 7.1475, longitude: 3.3619 });
    expect(syncPickupAddress).toHaveBeenCalledTimes(1);
    expect(syncPickupAddress.mock.calls[0][2]).toMatchObject({ force: true });
  });

  it("still reports success when the Fast Link push fails", async () => {
    syncPickupAddress.mockRejectedValueOnce(new Error("provider down"));
    const res = await post({ vendorId: "v1", latitude: 7.1475, longitude: 3.3619 });
    // The coordinates are saved; the sync is retryable from the same screen.
    expect(res.status).toBe(200);
    expect(res._data.synced).toBe(false);
    expect(vendorWrites()[0].values.pickup_lat).toBe(7.1475);
  });

  it("accepts an optional address note without geocoding it", async () => {
    await post({ vendorId: "v1", latitude: 7.1475, longitude: 3.3619, address: "Beside the blue gate" });
    expect(vendorWrites()[0].values.pickup_address).toBe("Beside the blue gate");
  });
});
