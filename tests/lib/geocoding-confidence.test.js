/**
 * Mapbox returns street-level matches for Nigerian addresses while quietly
 * reporting that it ignored the city and state. That is how a vendor in Ibadan
 * ended up with a pickup point in Lagos.
 *
 * The signal is in match_code. Callers that persist coordinates must be able to
 * demand a confident result and get null instead of a plausible-looking wrong one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.MAPBOX_TOKEN = "pk.test-token";
  process.env.GEOCODING_PROVIDER = "mapbox";
  process.env.GEOCODING_COUNTRY = "ng";
});

import { forwardGeocode, geocodeOne } from "@/lib/geocoding";

/** Real shapes observed from the API. */
const MATCH = {
  // Vendor wrote Ibadan, Oyo. Mapbox returned a Lagos street.
  wrongState: { address_number: "matched", street: "unmatched", place: "unmatched", region: "unmatched", country: "inferred", confidence: "low" },
  // Genuinely correct Lagos address. `place` differs in naming but region is right.
  good:       { address_number: "matched", street: "matched", place: "unmatched", region: "matched", country: "matched", confidence: "high" },
  // Right region but Mapbox is unsure.
  lowButRight:{ address_number: "matched", street: "matched", place: "matched", region: "matched", country: "matched", confidence: "low" },
};

const feature = (match_code, name = "Somewhere") => ({
  geometry: { type: "Point", coordinates: [3.38, 6.45] },
  properties: {
    mapbox_id: "abc", name, full_address: `${name}, Nigeria`,
    context: { region: { name: "Lagos" }, country: { name: "Nigeria" } },
    ...(match_code ? { match_code } : {}),
  },
});

function mockFeatures(...features) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true, status: 200, statusText: "OK",
    json: async () => ({ type: "FeatureCollection", features }),
  }));
}

beforeEach(() => { mockFeatures(feature(MATCH.good)); });

describe("confidence data on results", () => {
  it("exposes the reported confidence", async () => {
    const [r] = await forwardGeocode("somewhere");
    expect(r.confidence).toBe("high");
  });

  it("exposes whether the region matched", async () => {
    const [r] = await forwardGeocode("somewhere");
    expect(r.regionMatched).toBe(true);
  });

  it("reports an unmatched region as such", async () => {
    mockFeatures(feature(MATCH.wrongState));
    const [r] = await forwardGeocode("somewhere");
    expect(r.regionMatched).toBe(false);
  });
});

describe("default behaviour is unchanged", () => {
  it("returns low-confidence results when the caller has not asked for confidence", async () => {
    mockFeatures(feature(MATCH.wrongState));
    const results = await forwardGeocode("somewhere");
    expect(results).toHaveLength(1);
  });
});

describe("requireConfident", () => {
  it("drops a result whose region was not matched — the Ibadan-to-Lagos failure", async () => {
    mockFeatures(feature(MATCH.wrongState, "Alafia Street, Lagos"));
    const results = await forwardGeocode("47 Alafia Street, Ibadan", { requireConfident: true });
    expect(results).toEqual([]);
  });

  it("drops a low-confidence result even when the region matched", async () => {
    mockFeatures(feature(MATCH.lowButRight));
    const results = await forwardGeocode("somewhere", { requireConfident: true });
    expect(results).toEqual([]);
  });

  it("keeps a confident result whose place differs in naming but region is right", async () => {
    mockFeatures(feature(MATCH.good, "Admiralty Way 12"));
    const results = await forwardGeocode("12 Admiralty Way, Lekki", { requireConfident: true });
    expect(results).toHaveLength(1);
  });

  it("drops a result carrying no match_code, since it cannot be verified", async () => {
    mockFeatures(feature(null));
    const results = await forwardGeocode("somewhere", { requireConfident: true });
    expect(results).toEqual([]);
  });

  it("keeps only the confident entries from a mixed response", async () => {
    mockFeatures(feature(MATCH.wrongState, "Wrong"), feature(MATCH.good, "Right"), feature(null, "Unverifiable"));
    const results = await forwardGeocode("somewhere", { requireConfident: true });
    expect(results.map((r) => r.name)).toEqual(["Right"]);
  });
});

describe("geocodeOne", () => {
  it("returns null rather than a plausible-looking wrong point", async () => {
    mockFeatures(feature(MATCH.wrongState));
    expect(await geocodeOne("47 Alafia Street, Ibadan", { requireConfident: true })).toBeNull();
  });

  it("still returns a confident match", async () => {
    mockFeatures(feature(MATCH.good, "Admiralty Way 12"));
    const one = await geocodeOne("12 Admiralty Way, Lekki", { requireConfident: true });
    expect(one?.name).toBe("Admiralty Way 12");
  });
});
