/**
 * lib/geocoding — permanent vs temporary mode.
 *
 * Mapbox forbids storing results returned under the default (temporary) terms.
 * Call sites that persist coordinates must opt in with `permanent: true`, which
 * bills differently — so the flag has to be per-call, never global.
 *
 * fetch is stubbed at the network boundary; everything below it is real code.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Runs before the module graph loads, so config.geocoding picks up the token.
vi.hoisted(() => {
  process.env.MAPBOX_TOKEN = "pk.test-server-token";
  process.env.GEOCODING_PROVIDER = "mapbox";
  process.env.GEOCODING_COUNTRY = "ng";
});

import { forwardGeocode, reverseGeocode, geocodeOne } from "@/lib/geocoding";

const FEATURE = {
  id: "dXJuOm1ieHBsYzpMZWtraQ",
  geometry: { type: "Point", coordinates: [3.487438, 6.442287] },
  properties: {
    mapbox_id: "dXJuOm1ieHBsYzpMZWtraQ",
    name: "Lekki Phase 1",
    full_address: "Lekki Phase 1, Lagos, Lagos, Nigeria",
    context: {
      region: { name: "Lagos" },
      place: { name: "Lagos" },
      district: { name: "Eti-Osa" },
      country: { name: "Nigeria" },
    },
  },
};

/** @returns {URL} the URL the provider requested */
function requestedUrl() {
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  return new URL(globalThis.fetch.mock.calls[0][0].toString());
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ type: "FeatureCollection", features: [FEATURE] }),
  }));
});

describe("forwardGeocode", () => {
  it("omits the permanent flag by default, keeping requests on temporary terms", async () => {
    await forwardGeocode("Lekki Phase 1");
    expect(requestedUrl().searchParams.has("permanent")).toBe(false);
  });

  it("sends permanent=true when the caller opts in", async () => {
    await forwardGeocode("Lekki Phase 1", { permanent: true });
    expect(requestedUrl().searchParams.get("permanent")).toBe("true");
  });

  it("omits the flag for permanent: false rather than sending permanent=false", async () => {
    await forwardGeocode("Lekki Phase 1", { permanent: false });
    expect(requestedUrl().searchParams.has("permanent")).toBe(false);
  });

  it("still normalizes the feature into a GeoResult", async () => {
    const [first] = await forwardGeocode("Lekki Phase 1", { permanent: true });
    expect(first.coordinates).toBe("6.442287,3.487438");
    expect(first.context.state).toBe("Lagos");
    expect(first.context.country).toBe("Nigeria");
  });
});

describe("reverseGeocode", () => {
  it("omits the permanent flag by default", async () => {
    await reverseGeocode(6.442287, 3.487438);
    expect(requestedUrl().searchParams.has("permanent")).toBe(false);
  });

  it("sends permanent=true when the caller opts in", async () => {
    await reverseGeocode(6.442287, 3.487438, { permanent: true });
    expect(requestedUrl().searchParams.get("permanent")).toBe("true");
  });
});

describe("geocodeOne", () => {
  it("carries the permanent flag through to the provider", async () => {
    await geocodeOne("Lekki Phase 1", { permanent: true });
    const url = requestedUrl();
    expect(url.searchParams.get("permanent")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("stays temporary by default", async () => {
    await geocodeOne("Lekki Phase 1");
    expect(requestedUrl().searchParams.has("permanent")).toBe(false);
  });
});
