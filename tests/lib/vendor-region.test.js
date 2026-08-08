/**
 * city/state are null on 49 of 61 vendors. Parsing them out of the free-text
 * address would be guesswork — the same guesswork that put an Ibadan shop in
 * Lagos. A pickup point is authoritative, and reverse geocoding a coordinate to
 * its region is the one thing Mapbox does reliably here.
 *
 * So the data heals itself as vendors set their pins, rather than being bulk
 * filled with plausible-looking mistakes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const reverseGeocode = vi.fn();
vi.mock("@/lib/geocoding", () => ({ reverseGeocode: (...a) => reverseGeocode(...a) }));

const { fillRegionFromPoint } = await import("@/lib/vendors/region");

let vendorRow, writes;
function makeAdmin() {
  return {
    from() {
      const f = {};
      const chain = {
        select: () => chain,
        eq(col, val) { f[col] = val; return chain; },
        single: async () => ({ data: vendorRow, error: vendorRow ? null : { message: "missing" } }),
        update(values) {
          return { eq: async () => { writes.push(values); return { data: null, error: null }; } };
        },
      };
      return chain;
    },
  };
}

const POINT = { latitude: 7.1475, longitude: 3.3619 };

beforeEach(() => {
  writes = [];
  vendorRow = { id: "v1", city: null, state: null };
  reverseGeocode.mockReset();
  reverseGeocode.mockResolvedValue({
    context: { state: "Ogun", city: "Abeokuta", country: "Nigeria" },
  });
});

describe("filling from a point", () => {
  it("sets both when the vendor has neither", async () => {
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes[0]).toEqual({ city: "Abeokuta", state: "Ogun" });
  });

  it("fills only the missing one, never overwriting what a vendor entered", async () => {
    vendorRow = { id: "v1", city: "My Town", state: null };
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes[0]).toEqual({ state: "Ogun" });
  });

  it("writes nothing when both are already set", async () => {
    vendorRow = { id: "v1", city: "Abeokuta", state: "Ogun" };
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes).toHaveLength(0);
  });

  it("treats blank strings as missing", async () => {
    vendorRow = { id: "v1", city: "   ", state: "" };
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes[0]).toEqual({ city: "Abeokuta", state: "Ogun" });
  });
});

describe("when the lookup gives us nothing useful", () => {
  it("writes nothing when reverse geocoding returns no region", async () => {
    reverseGeocode.mockResolvedValue({ context: { country: "Nigeria" } });
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes).toHaveLength(0);
  });

  it("writes nothing when reverse geocoding returns null", async () => {
    reverseGeocode.mockResolvedValue(null);
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes).toHaveLength(0);
  });

  it("fills the state even when no city comes back", async () => {
    reverseGeocode.mockResolvedValue({ context: { state: "Ogun", city: null } });
    await fillRegionFromPoint(makeAdmin(), "v1", POINT);
    expect(writes[0]).toEqual({ state: "Ogun" });
  });
});

describe("it must never disrupt saving a pickup point", () => {
  it("swallows a geocoding failure", async () => {
    reverseGeocode.mockRejectedValue(new Error("provider down"));
    await expect(fillRegionFromPoint(makeAdmin(), "v1", POINT)).resolves.not.toThrow();
    expect(writes).toHaveLength(0);
  });

  it("swallows a missing vendor", async () => {
    vendorRow = null;
    await expect(fillRegionFromPoint(makeAdmin(), "nope", POINT)).resolves.not.toThrow();
  });

  it("does nothing without usable coordinates", async () => {
    await fillRegionFromPoint(makeAdmin(), "v1", { latitude: null, longitude: null });
    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
