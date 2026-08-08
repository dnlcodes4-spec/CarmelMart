/**
 * lib/vendors/region.js — derive a vendor's city and state from their pickup point.
 *
 * city/state are null on most vendors. They could be parsed out of the free-text
 * address, but that is the same guesswork that resolved an Ibadan shop to Lagos,
 * and these fields are display-only — writing plausible mistakes into them buys
 * nothing.
 *
 * A pickup point is authoritative, and reverse geocoding a coordinate to its
 * containing region is the one thing Mapbox is dependable at here. So the data
 * heals itself as vendors set their pins.
 *
 * ⚠️  SERVER ONLY. Best-effort by design: every failure path is silent, because
 * this must never disrupt saving a pickup point.
 */

import { reverseGeocode } from "@/lib/geocoding";

const blank = (v) => typeof v !== "string" || v.trim() === "";

/**
 * @param {object} admin      service-role Supabase client
 * @param {string} vendorId
 * @param {object} point      { latitude, longitude }
 */
export async function fillRegionFromPoint(admin, vendorId, { latitude, longitude } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  try {
    const { data: vendor } = await admin
      .from("vendors").select("id, city, state").eq("id", vendorId).single();
    if (!vendor) return;

    // Nothing to fill — and never overwrite something a vendor typed themselves.
    if (!blank(vendor.city) && !blank(vendor.state)) return;

    const place = await reverseGeocode(latitude, longitude);
    const update = {};
    if (blank(vendor.city) && place?.context?.city) update.city = place.context.city;
    if (blank(vendor.state) && place?.context?.state) update.state = place.context.state;
    if (Object.keys(update).length === 0) return;

    await admin.from("vendors").update(update).eq("id", vendorId);
  } catch (err) {
    console.error(`[vendors/region] could not derive region for ${vendorId}:`, err.message);
  }
}
