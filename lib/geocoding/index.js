/**
 * lib/geocoding/index.js — provider-agnostic geocoding facade.
 *
 * Callers import from here, never from a specific provider, so swapping Mapbox
 * for Google/OSM later is a one-file change. Selected via config.geocoding.provider.
 *
 * Normalized result shape (GeoResult):
 *   {
 *     id, name, fullAddress,
 *     latitude, longitude,
 *     coordinates,            // "lat,lng" — ready for Fast Link's coordinates fields
 *     context: { state, lga, city, country },
 *     raw,                    // provider's original feature
 *   }
 *
 * ⚠️  SERVER ONLY.
 *
 * TEMPORARY vs PERMANENT: results default to Mapbox's temporary terms, which
 * forbid storing them. Any caller that writes coordinates to the database must
 * pass `{ permanent: true }`. It bills at a higher rate, so it stays opt-in
 * per call rather than being turned on globally.
 */

import { config } from "@/lib/config";
import * as mapbox from "./mapbox";

const PROVIDERS = {
  mapbox,
};

function activeProvider() {
  const name = config.geocoding.provider;
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown geocoding provider: "${name}"`);
  return provider;
}

/** Forward geocode an address string → ranked GeoResult[]. */
export function forwardGeocode(query, opts) {
  return activeProvider().forwardGeocode(query, opts);
}

/** Reverse geocode coordinates → nearest GeoResult (or null). */
export function reverseGeocode(latitude, longitude, opts) {
  return activeProvider().reverseGeocode(latitude, longitude, opts);
}

/**
 * Convenience: best single match for an address, or null.
 * Handy for backfill and server-side validation of a saved address.
 * Pass `{ permanent: true }` when the result will be persisted.
 */
export async function geocodeOne(query, opts) {
  const results = await forwardGeocode(query, { ...opts, limit: 1 });
  return results[0] ?? null;
}
