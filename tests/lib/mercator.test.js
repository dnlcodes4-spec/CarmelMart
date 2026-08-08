/**
 * Slippy-map maths for the pickup picker.
 *
 * The picker is a static map image with a fixed crosshair; dragging pans the
 * centre. Turning a pixel drag into a coordinate change is the whole trick, and
 * getting it wrong puts a vendor's pickup point somewhere they never chose — so
 * it is pure and tested rather than buried in a component.
 */
import { describe, it, expect } from "vitest";
import { lngLatToWorld, worldToLngLat, panByPixels, clampLat, MAX_LAT } from "@/lib/geo/mercator";

const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

describe("lngLatToWorld", () => {
  it("puts the null island at the centre of the world at zoom 0", () => {
    const { x, y } = lngLatToWorld(0, 0, 0);
    expect(close(x, 128)).toBe(true);
    expect(close(y, 128)).toBe(true);
  });

  it("puts the antimeridian at the western edge", () => {
    expect(close(lngLatToWorld(-180, 0, 0).x, 0)).toBe(true);
  });

  it("doubles the world size per zoom level", () => {
    expect(close(lngLatToWorld(0, 0, 1).x, 256)).toBe(true);
    expect(close(lngLatToWorld(0, 0, 2).x, 512)).toBe(true);
  });

  it("places northern latitudes above the equator", () => {
    expect(lngLatToWorld(0, 10, 0).y).toBeLessThan(128);
  });
});

describe("round trip", () => {
  it("returns the original coordinates", () => {
    for (const [lng, lat] of [[3.3792, 6.5244], [3.9470, 7.3775], [-0.1276, 51.5072], [0, 0]]) {
      for (const zoom of [4, 10, 16]) {
        const { x, y } = lngLatToWorld(lng, lat, zoom);
        const back = worldToLngLat(x, y, zoom);
        expect(close(back.lng, lng, 1e-9), `lng z${zoom}`).toBe(true);
        expect(close(back.lat, lat, 1e-9), `lat z${zoom}`).toBe(true);
      }
    }
  });
});

describe("panByPixels", () => {
  const LAGOS = { lng: 3.3792, lat: 6.5244 };

  it("dragging the map left moves the centre east", () => {
    // Dragging content left (-dx) reveals what is to the east.
    const moved = panByPixels(LAGOS.lng, LAGOS.lat, -100, 0, 14);
    expect(moved.lng).toBeGreaterThan(LAGOS.lng);
  });

  it("dragging the map right moves the centre west", () => {
    const moved = panByPixels(LAGOS.lng, LAGOS.lat, 100, 0, 14);
    expect(moved.lng).toBeLessThan(LAGOS.lng);
  });

  it("dragging up moves the centre south", () => {
    const moved = panByPixels(LAGOS.lng, LAGOS.lat, 0, -100, 14);
    expect(moved.lat).toBeLessThan(LAGOS.lat);
  });

  it("moves nothing when nothing is dragged", () => {
    const moved = panByPixels(LAGOS.lng, LAGOS.lat, 0, 0, 14);
    expect(close(moved.lng, LAGOS.lng, 1e-9)).toBe(true);
    expect(close(moved.lat, LAGOS.lat, 1e-9)).toBe(true);
  });

  it("moves less per pixel as you zoom in — the point of zooming to place a pin", () => {
    const coarse = panByPixels(LAGOS.lng, LAGOS.lat, -100, 0, 10);
    const fine   = panByPixels(LAGOS.lng, LAGOS.lat, -100, 0, 16);
    expect(coarse.lng - LAGOS.lng).toBeGreaterThan(fine.lng - LAGOS.lng);
  });

  it("is reversible — pan out and back returns to the start", () => {
    const away = panByPixels(LAGOS.lng, LAGOS.lat, -137, 83, 15);
    const back = panByPixels(away.lng, away.lat, 137, -83, 15);
    expect(close(back.lng, LAGOS.lng, 1e-9)).toBe(true);
    expect(close(back.lat, LAGOS.lat, 1e-9)).toBe(true);
  });

  it("never pans past the Mercator limit", () => {
    const moved = panByPixels(0, 85, 0, -100000, 10);
    expect(moved.lat).toBeLessThanOrEqual(MAX_LAT);
    expect(Number.isFinite(moved.lat)).toBe(true);
  });
});

describe("clampLat", () => {
  it("leaves ordinary latitudes alone", () => {
    expect(clampLat(6.5244)).toBe(6.5244);
  });

  it("clamps beyond the Mercator limit at both poles", () => {
    expect(clampLat(89)).toBe(MAX_LAT);
    expect(clampLat(-89)).toBe(-MAX_LAT);
  });
});
