/**
 * POST /api/admin/fastlink/pickup — set a vendor's pickup point on their behalf.
 *
 * For the tail of vendors who never open the portal: ops can place the point
 * during a phone call. Coordinates only. Mapbox cannot resolve Nigerian street
 * addresses reliably — audited against all 61 verified vendors, one could be
 * placed in the correct state — so there is deliberately no address-to-coordinate
 * path here. Any `address` supplied is stored as a note for the rider.
 *
 * Body: { vendorId, latitude, longitude, address? }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPickupAddress } from "@/lib/fastlink/merchants";
import { fillRegionFromPoint } from "@/lib/vendors/region";

/**
 * Nigeria's bounding box, padded slightly. A point outside it is a transposed
 * lat/lng or a stray click, not a Nigerian shop — and a wrong pickup is close to
 * permanent, since Fast Link has no update endpoint.
 */
const NG_BOUNDS = { minLat: 3.5, maxLat: 14.5, minLng: 2.5, maxLng: 15.5 };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? admin : null;
}

/**
 * GET — verified vendors that still have no pickup point.
 *
 * Vendors with active products are listed first: they are the only ones that can
 * receive an order today, so they are the only part of the backlog that blocks
 * the migration. The rest can wait for the in-portal prompt.
 */
export async function GET() {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: vendors, error } = await admin
      .from("vendors")
      .select("id, business_name, phone, address, fastlink_merchant_id")
      .eq("verification_status", "verified")
      .is("pickup_lat", null)
      .order("business_name");
    if (error) throw error;

    const list = vendors ?? [];
    const { data: products } = await admin
      .from("products")
      .select("vendor_id")
      .in("vendor_id", list.map((v) => v.id))
      .eq("status", "active");

    const selling = new Set((products ?? []).map((p) => p.vendor_id));
    const enriched = list
      .map((v) => ({ ...v, hasActiveProducts: selling.has(v.id) }))
      .sort((a, b) => Number(b.hasActiveProducts) - Number(a.hasActiveProducts)
        || (a.business_name ?? "").localeCompare(b.business_name ?? ""));

    return NextResponse.json({
      vendors: enriched,
      total: enriched.length,
      withActiveProducts: enriched.filter((v) => v.hasActiveProducts).length,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { vendorId, latitude, longitude, address } = await request.json().catch(() => ({}));
    if (!vendorId) return NextResponse.json({ error: "vendorId is required." }, { status: 400 });

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "latitude and longitude are required." }, { status: 400 });
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: "Coordinates are out of range." }, { status: 400 });
    }
    if (lat < NG_BOUNDS.minLat || lat > NG_BOUNDS.maxLat || lng < NG_BOUNDS.minLng || lng > NG_BOUNDS.maxLng) {
      return NextResponse.json(
        { error: "That point is outside Nigeria — check the coordinates have not been swapped." },
        { status: 400 },
      );
    }

    const { data: vendor } = await admin
      .from("vendors")
      .select("id, business_name, fastlink_merchant_id")
      .eq("id", vendorId)
      .single();
    if (!vendor) return NextResponse.json({ error: "Vendor not found." }, { status: 404 });

    const update = { pickup_lat: lat, pickup_lng: lng };
    if (typeof address === "string" && address.trim()) update.pickup_address = address.trim();

    const { error: updateError } = await admin.from("vendors").update(update).eq("id", vendorId);
    if (updateError) throw updateError;

    // city/state are display-only and mostly null. The point is authoritative,
    // so derive them from it rather than leaving the gap or guessing from text.
    await fillRegionFromPoint(admin, vendorId, { latitude: lat, longitude: lng });

    // Fast Link has no pickup update endpoint, so force a fresh default. Failing
    // here must not lose the coordinates — they are saved, and the sync can be
    // retried from the same screen.
    let synced = true;
    try {
      await syncPickupAddress(admin, vendorId, { force: true });
    } catch (flErr) {
      synced = false;
      console.error(`[admin/fastlink/pickup] sync failed for ${vendorId}:`, flErr.message);
    }

    return NextResponse.json({ ok: true, vendorId, latitude: lat, longitude: lng, synced });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
