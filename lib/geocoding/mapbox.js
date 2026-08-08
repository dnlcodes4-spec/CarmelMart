/**
 * lib/geocoding/mapbox.js — Mapbox implementation of the geocoding provider.
 *
 * Uses the Mapbox Geocoding API v6 (GeoJSON). Forward geocoding with
 * autocomplete powers address suggestions; reverse turns a pin/centroid back
 * into a readable address. Results are normalized to the shape in ./index.js.
 *
 * ⚠️  SERVER ONLY — reads config.geocoding.mapbox.token. The client-side
 *     autocomplete widget talks to Mapbox directly with the PUBLIC token; this
 *     module is for server use (backfill, validation, reverse lookups).
 *
 * Docs: https://docs.mapbox.com/api/search/geocoding/
 */

import { config } from "@/lib/config";

const V6_BASE = "https://api.mapbox.com/search/geocode/v6";
const TIMEOUT_MS = 10_000;

/** Map a Mapbox v6 feature → our normalized GeoResult. */
function normalizeFeature(feature) {
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  const props = feature?.properties ?? {};
  const ctx = props.context ?? {};
  return {
    id:          props.mapbox_id ?? feature?.id ?? null,
    name:        props.name ?? props.name_preferred ?? "",
    fullAddress: props.full_address ?? props.place_formatted ?? props.name ?? "",
    latitude:    typeof lat === "number" ? lat : null,
    longitude:   typeof lng === "number" ? lng : null,
    // "lat,lng" string — the exact format Fast Link's coordinates fields expect.
    coordinates: typeof lat === "number" && typeof lng === "number" ? `${lat},${lng}` : null,
    context: {
      state:   ctx.region?.name ?? null,   // Nigerian state
      lga:     ctx.district?.name ?? ctx.place?.name ?? null,
      city:    ctx.place?.name ?? null,
      country: ctx.country?.name ?? null,
    },
    raw: feature,
  };
}

async function mapboxFetch(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
    throw new Error(aborted ? "Geocoding request timed out." : `Geocoding request failed: ${err.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Mapbox geocoding → ${res.status}: ${data?.message ?? res.statusText}`);
  }
  return data;
}

/**
 * Forward geocode an address string → ranked list of normalized results.
 * @param {string} query
 * @param {object} [opts] { limit=5, country, autocomplete=true, proximity: "lng,lat", permanent=false }
 */
export async function forwardGeocode(query, opts = {}) {
  const token = config.geocoding.mapbox.token;
  if (!token) throw new Error("Mapbox token is not configured.");
  if (!query?.trim()) return [];

  const url = new URL(`${V6_BASE}/forward`);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", String(opts.limit ?? 5));
  url.searchParams.set("country", opts.country ?? config.geocoding.country);
  url.searchParams.set("autocomplete", String(opts.autocomplete ?? true));
  if (opts.proximity) url.searchParams.set("proximity", opts.proximity);
  if (opts.permanent) url.searchParams.set("permanent", "true");

  const data = await mapboxFetch(url);
  return (data?.features ?? []).map(normalizeFeature);
}

/**
 * Reverse geocode coordinates → nearest normalized address.
 * @param {number} latitude
 * @param {number} longitude
 * @param {object} [opts] { permanent=false }
 * @returns {Promise<object|null>}
 */
export async function reverseGeocode(latitude, longitude, opts = {}) {
  const token = config.geocoding.mapbox.token;
  if (!token) throw new Error("Mapbox token is not configured.");
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const url = new URL(`${V6_BASE}/reverse`);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "1");
  if (opts.permanent) url.searchParams.set("permanent", "true");

  const data = await mapboxFetch(url);
  const feature = data?.features?.[0];
  return feature ? normalizeFeature(feature) : null;
}
