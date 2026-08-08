/**
 * State centroids position the map picker before a customer starts dragging.
 *
 * Geocoding is only used for what it is reliable at here — nothing. A static
 * lookup is deterministic, needs no network call, and cannot resolve Ibadan to
 * Lagos. The risk is a typo'd or missing key, which these tests close.
 */
import { describe, it, expect } from "vitest";
import NaijaStates from "naija-state-local-government";
import { stateCentre, NIGERIA_CENTRE } from "@/lib/geo/nigeria";

describe("coverage", () => {
  it("has a centre for every state the picker can offer", () => {
    const missing = NaijaStates.states().filter((s) => !stateCentre(s));
    expect(missing, `no centre for: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("stateCentre", () => {
  it("returns coordinates inside Nigeria", () => {
    for (const s of NaijaStates.states()) {
      const c = stateCentre(s);
      expect(c.lat, `${s} lat`).toBeGreaterThan(3.5);
      expect(c.lat, `${s} lat`).toBeLessThan(14.5);
      expect(c.lng, `${s} lng`).toBeGreaterThan(2.5);
      expect(c.lng, `${s} lng`).toBeLessThan(15.5);
    }
  });

  it("places well-known states roughly where they belong", () => {
    // Lagos is south-west and coastal; Kano is far north.
    expect(stateCentre("Lagos").lat).toBeLessThan(7);
    expect(stateCentre("Kano").lat).toBeGreaterThan(11);
    expect(stateCentre("Lagos").lng).toBeLessThan(stateCentre("Adamawa").lng);
  });

  it("gives distinct centres — a copy-paste error would collapse them", () => {
    const keys = NaijaStates.states().map((s) => {
      const c = stateCentre(s);
      return `${c.lat},${c.lng}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(stateCentre("  lagos ")).toEqual(stateCentre("Lagos"));
    expect(stateCentre("FCT")).toBeTruthy();
  });

  it("returns null for something that is not a state", () => {
    expect(stateCentre("Atlantis")).toBeNull();
    expect(stateCentre("")).toBeNull();
    expect(stateCentre(null)).toBeNull();
  });
});

describe("NIGERIA_CENTRE", () => {
  it("is a sane fallback when no state is chosen", () => {
    expect(NIGERIA_CENTRE.lat).toBeGreaterThan(7);
    expect(NIGERIA_CENTRE.lat).toBeLessThan(11);
  });
});
