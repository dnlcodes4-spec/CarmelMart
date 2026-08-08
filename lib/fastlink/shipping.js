/**
 * lib/fastlink/shipping.js — shared Fast Link shipping-quote logic.
 *
 * A cart can span multiple vendors; Fast Link prices a single pickup→destination
 * leg, so we quote each vendor's pickup → the customer and sum the legs. Used by
 * both the checkout quote endpoint and the server-side fee recompute at order
 * creation, so a quote and its later recompute are computed identically.
 *
 * Never throws — returns { fallback: true, reason } on any problem so callers can
 * fall back to a zone/static fee. Returns { fallback: false, totalFee, … } only
 * when every vendor was priced.
 *
 * ⚠️  SERVER ONLY. Pass a service-role admin Supabase client in.
 */

import { config } from "@/lib/config";
import { fastlink, FastLinkError } from "@/lib/fastlink/client";
import { geocodeOne } from "@/lib/geocoding";

const coord = (lat, lng) => `${lat},${lng}`;

/**
 * Resolve { lat, lng } from a destination that may carry explicit lat/lng or a
 * "lat,lng" coordinates string. Returns null if neither is usable.
 */
export function parseDestination(dest) {
  if (!dest) return null;
  let lat = Number(dest.lat);
  let lng = Number(dest.lng);
  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && typeof dest.coordinates === "string") {
    const [a, b] = dest.coordinates.split(",").map((s) => Number(s.trim()));
    lat = a;
    lng = b;
  }
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Quote delivery for a set of items to a destination.
 *
 * @param {object}   args
 * @param {object}   args.admin        service-role Supabase client
 * @param {object}   args.destination  { lat, lng } | { coordinates } | { address }
 * @param {Array}    args.items        [{ vendorId|vendor_id, quantity }]
 * @param {boolean} [args.allowGeocode=true] geocode destination.address if no coords
 * @returns {Promise<{fallback:boolean, reason?:string, totalFee?:number, currency?:string, destination?:object, breakdown?:Array}>}
 */
export async function quoteShippingForItems({ admin, destination, items, allowGeocode = true }) {
  if (!config.fastlink.enabled) return { fallback: true, reason: "provider_disabled" };

  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { fallback: true, reason: "no_items" };

  let dest = parseDestination(destination);
  if (!dest && allowGeocode && destination?.address && config.geocoding.enabled) {
    try {
      // Deliberately temporary (not permanent): this coordinate prices a quote
      // and is discarded. Only call sites that persist coordinates opt in.
      const g = await geocodeOne(destination.address);
      if (g) dest = { lat: g.latitude, lng: g.longitude };
    } catch {
      /* fall through */
    }
  }
  if (!dest) return { fallback: true, reason: "no_destination_coords" };

  const qtyByVendor = new Map();
  for (const it of list) {
    const vid = it.vendorId ?? it.vendor_id;
    if (!vid) continue;
    qtyByVendor.set(vid, (qtyByVendor.get(vid) ?? 0) + (Number(it.quantity) || 1));
  }
  const vendorIds = [...qtyByVendor.keys()];
  if (vendorIds.length === 0) return { fallback: true, reason: "no_vendors" };

  const { data: vendors, error } = await admin
    .from("vendors")
    .select("id, pickup_lat, pickup_lng")
    .in("id", vendorIds);
  if (error) return { fallback: true, reason: "vendor_lookup_failed" };

  const pickupById = Object.fromEntries((vendors ?? []).map((v) => [v.id, v]));
  const destinationStr = coord(dest.lat, dest.lng);
  const weightPerItem = config.fastlink.defaultItemWeightKg;

  const breakdown = [];
  let currency = "NGN";
  let total = 0;

  for (const vid of vendorIds) {
    const v = pickupById[vid];
    if (!v || v.pickup_lat == null || v.pickup_lng == null) {
      return { fallback: true, reason: "vendor_missing_pickup", vendorId: vid };
    }
    try {
      const res = await fastlink.calculateShipping({
        pickup:      coord(v.pickup_lat, v.pickup_lng),
        destination: destinationStr,
        items:       [{ weight: weightPerItem, quantity: qtyByVendor.get(vid) }],
      });
      const fee = Math.round(Number(res?.cost) || 0);
      currency = res?.currency ?? currency;
      total += fee;
      breakdown.push({ vendorId: vid, fee, distance_km: res?.distance_km ?? null });
    } catch (err) {
      const status = err instanceof FastLinkError ? err.status : null;
      console.error(`[fastlink] shipping quote failed for vendor ${vid} (status ${status}):`, err.message);
      return { fallback: true, reason: "provider_error" };
    }
  }

  return { fallback: false, currency, totalFee: total, destination: dest, breakdown };
}
