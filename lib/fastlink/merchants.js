/**
 * lib/fastlink/merchants.js — provision carmel-mart vendors as Fast Link merchants.
 *
 * A vendor becomes a Fast Link "merchant" when they're approved (KYC verified).
 * Orders later reference the merchant by our own vendor id (merchant_external_id),
 * and deliveries leave from the merchant's default pickup address.
 *
 * Every export is:
 *   - idempotent — safe to call repeatedly (create-or-update)
 *   - a clean no-op when Fast Link credentials aren't configured
 *     (config.fastlink.enabled === false), so it never blocks approval pre-go-live.
 *
 * ⚠️  SERVER ONLY. Pass a service-role admin Supabase client in.
 *
 * Docs: https://marketplace-portal.fastlink.cyparta.com/api-docs
 */

import { config } from "@/lib/config";
import { fastlink } from "@/lib/fastlink/client";
import { geocodeOne } from "@/lib/geocoding";

const PICKUP_FIELDS = ["pickup_label", "pickup_address", "pickup_lat", "pickup_lng"];

/** Fast Link's merchant id is numeric; we store it as text. Coerce back when sending. */
function coerceMerchantId(id) {
  if (id == null) return id;
  return /^\d+$/.test(String(id)) ? Number(id) : id;
}

/** Load the vendor row + owner email needed to build a Fast Link merchant. */
async function loadVendor(admin, vendorId) {
  const { data: vendor, error } = await admin
    .from("vendors")
    .select(
      "id, business_name, phone, city, state, address, " +
        "fastlink_merchant_id, fastlink_pickup_id, " +
        "pickup_label, pickup_address, pickup_lat, pickup_lng",
    )
    .eq("id", vendorId)
    .single();
  if (error || !vendor) throw new Error(`Vendor ${vendorId} not found`);

  // vendors.id === users.id; email lives on users.
  const { data: userRow } = await admin.from("users").select("email").eq("id", vendorId).single();
  return { ...vendor, email: userRow?.email ?? null };
}

/** Persist a sync error message (truncated) without throwing. */
export async function recordSyncError(admin, vendorId, err) {
  try {
    await admin
      .from("vendors")
      .update({ fastlink_sync_error: String(err?.message ?? err).slice(0, 500) })
      .eq("id", vendorId);
  } catch {
    /* best-effort */
  }
}

/**
 * Create or update the Fast Link merchant for a vendor.
 * @returns the Fast Link merchant id (string), or null when FL is disabled.
 */
export async function provisionMerchant(admin, vendorId) {
  if (!config.fastlink.enabled) return null;
  const vendor = await loadVendor(admin, vendorId);

  const payload = {
    name:          vendor.business_name ?? "Vendor",
    external_id:   vendor.id, // our vendor id — becomes merchant_external_id on orders
    contact_name:  vendor.business_name ?? "Vendor",
    contact_phone: vendor.phone ?? "",
    contact_email: vendor.email ?? "",
    is_active:     true,
  };

  const merchant = vendor.fastlink_merchant_id
    ? await fastlink.updateMerchant(coerceMerchantId(vendor.fastlink_merchant_id), payload)
    : await fastlink.createMerchant(payload);

  const merchantId = merchant?.id ?? vendor.fastlink_merchant_id;
  await admin
    .from("vendors")
    .update({
      fastlink_merchant_id: merchantId != null ? String(merchantId) : null,
      fastlink_synced_at:   new Date().toISOString(),
      fastlink_sync_error:  null,
    })
    .eq("id", vendorId);

  return merchantId != null ? String(merchantId) : null;
}

/**
 * Ensure the vendor's default Fast Link pickup address exists and is current.
 *
 * Coordinate resolution, in priority order:
 *   1. explicit pickup_lat / pickup_lng on the vendor row
 *   2. server-side Mapbox geocode of pickup_address (falls back to
 *      vendors.address, then "city, state")
 *
 * Fast Link exposes no pickup-address update endpoint, so:
 *   - force=false (approval/backfill): skip if a pickup id already exists
 *   - force=true  (vendor edited pickup): create a fresh default pickup
 *
 * @returns the Fast Link pickup id (string), or null if it couldn't/didn't sync.
 */
export async function syncPickupAddress(admin, vendorId, { force = false } = {}) {
  if (!config.fastlink.enabled) return null;
  const vendor = await loadVendor(admin, vendorId);

  // Merchant must exist first.
  let merchantId = vendor.fastlink_merchant_id;
  if (!merchantId) merchantId = await provisionMerchant(admin, vendorId);
  if (!merchantId) return null;

  if (vendor.fastlink_pickup_id && !force) return vendor.fastlink_pickup_id;

  const addressText =
    vendor.pickup_address ||
    vendor.address ||
    [vendor.city, vendor.state].filter(Boolean).join(", ");

  let lat = vendor.pickup_lat;
  let lng = vendor.pickup_lng;

  if ((lat == null || lng == null) && config.geocoding.enabled && addressText) {
    // permanent: the result is written to vendors.pickup_lat/lng below, and
    //   Mapbox forbids storing coordinates returned under the default terms.
    // requireConfident: Mapbox returns street-level matches for Nigerian
    //   addresses while reporting that it ignored the city and state — which is
    //   how a vendor in Ibadan got a pickup point in Lagos. Fast Link has no
    //   pickup update endpoint, so a wrong point is effectively permanent.
    //   No pickup is the better failure; the vendor sets one from the map.
    const geo = await geocodeOne(addressText, { permanent: true, requireConfident: true });
    if (geo) {
      lat = geo.latitude;
      lng = geo.longitude;
    }
  }

  // Can't register a pickup point without coordinates — leave for later.
  if (lat == null || lng == null) return null;

  const pickup = await fastlink.createPickupAddress({
    merchant:   coerceMerchantId(merchantId),
    label:      vendor.pickup_label || "Main pickup",
    address:    addressText || vendor.business_name || "Pickup",
    latitude:   String(lat),
    longitude:  String(lng),
    is_default: true,
  });

  const pickupId = pickup?.id != null ? String(pickup.id) : vendor.fastlink_pickup_id;
  await admin
    .from("vendors")
    .update({
      fastlink_pickup_id: pickupId,
      pickup_address:     addressText || vendor.pickup_address,
      pickup_lat:         lat,
      pickup_lng:         lng,
      fastlink_synced_at: new Date().toISOString(),
      fastlink_sync_error: null,
    })
    .eq("id", vendorId);

  return pickupId;
}

/**
 * Full sync: provision the merchant, then best-effort sync the pickup address.
 * Pickup failure never fails the merchant provisioning (a merchant with no
 * pickup can be fixed later from vendor settings).
 *
 * @returns { merchantId, pickupId }
 */
export async function syncVendorToFastLink(admin, vendorId) {
  if (!config.fastlink.enabled) return { merchantId: null, pickupId: null };

  const merchantId = await provisionMerchant(admin, vendorId);
  if (!merchantId) return { merchantId: null, pickupId: null };

  let pickupId = null;
  try {
    pickupId = await syncPickupAddress(admin, vendorId);
  } catch (err) {
    console.error(`[fastlink] pickup sync failed for vendor ${vendorId}:`, err.message);
    await recordSyncError(admin, vendorId, err);
  }
  return { merchantId, pickupId };
}

export { PICKUP_FIELDS };
