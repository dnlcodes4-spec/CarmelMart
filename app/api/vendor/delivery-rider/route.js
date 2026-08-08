// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VEHICLES = ["bike", "vehicle"];
const COVERAGE = ["interstate", "intrastate"];

async function getVendor() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "vendor") {
    return { error: "Forbidden — vendors only", status: 403 };
  }
  return { admin, userId: user.id };
}

/**
 * GET /api/vendor/delivery-rider
 * Returns the vendor's delivery-rider answer. `responded` is false until they
 * submit, which is what keeps the dashboard prompt showing on every login.
 */
export async function GET() {
  try {
    const guard = await getVendor();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin, userId } = guard;

    const { data: vendor } = await admin
      .from("vendors")
      .select("has_delivery_rider, delivery_rider_vehicle, delivery_rider_coverage, delivery_rider_responded_at")
      .eq("id", userId)
      .single();

    return NextResponse.json({
      responded:   !!vendor?.delivery_rider_responded_at,
      hasRider:    vendor?.has_delivery_rider ?? null,
      vehicle:     vendor?.delivery_rider_vehicle ?? null,
      coverage:    vendor?.delivery_rider_coverage ?? null,
      respondedAt: vendor?.delivery_rider_responded_at ?? null,
    });
  } catch (error) {
    console.error("[GET /api/vendor/delivery-rider]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/vendor/delivery-rider
 * Body: { hasRider: boolean, vehicle?: 'bike'|'car', coverage?: 'interstate'|'intrastate' }
 * Records the vendor's answer. When hasRider is true, vehicle + coverage are required.
 */
export async function POST(request) {
  try {
    const guard = await getVendor();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin, userId } = guard;

    const body = await request.json().catch(() => ({}));
    const hasRider = body.hasRider;

    if (typeof hasRider !== "boolean") {
      return NextResponse.json({ error: "hasRider (boolean) is required." }, { status: 400 });
    }

    let vehicle = null;
    let coverage = null;

    if (hasRider) {
      vehicle  = body.vehicle;
      coverage = body.coverage;
      if (!VEHICLES.includes(vehicle)) {
        return NextResponse.json({ error: "vehicle must be 'bike' or 'vehicle'." }, { status: 400 });
      }
      if (!COVERAGE.includes(coverage)) {
        return NextResponse.json({ error: "coverage must be 'interstate' or 'intrastate'." }, { status: 400 });
      }
    }

    const { error } = await admin
      .from("vendors")
      .update({
        has_delivery_rider:          hasRider,
        delivery_rider_vehicle:      vehicle,
        delivery_rider_coverage:     coverage,
        delivery_rider_responded_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw error;

    return NextResponse.json({ success: true, hasRider, vehicle, coverage });
  } catch (error) {
    console.error("[POST /api/vendor/delivery-rider]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
