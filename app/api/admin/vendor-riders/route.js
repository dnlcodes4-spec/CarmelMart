// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function guardAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") return { error: "Forbidden — admin only", status: 403 };
  return { admin };
}

/**
 * GET /api/admin/vendor-riders
 * Vendor self-reported delivery-rider capability, for the admin Riders page.
 * Returns every vendor with their answer plus a summary breakdown.
 */
export async function GET() {
  try {
    const guard = await guardAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin } = guard;

    const { data: vendors, error } = await admin
      .from("vendors")
      .select("id, business_name, state, city, has_delivery_rider, delivery_rider_vehicle, delivery_rider_coverage, delivery_rider_responded_at")
      .order("delivery_rider_responded_at", { ascending: false, nullsFirst: false });
    if (error) throw error;

    const list = (vendors ?? []).map((v) => ({
      id:           v.id,
      business_name: v.business_name || "Unnamed Vendor",
      location:     [v.city, v.state].filter(Boolean).join(", "),
      // null = not answered yet, true = has rider, false = no rider
      hasRider:     v.delivery_rider_responded_at ? v.has_delivery_rider : null,
      vehicle:      v.delivery_rider_vehicle ?? null,
      coverage:     v.delivery_rider_coverage ?? null,
      responded:    !!v.delivery_rider_responded_at,
      responded_at: v.delivery_rider_responded_at,
    }));

    const summary = {
      total:        list.length,
      withRider:    list.filter((v) => v.hasRider === true).length,
      withoutRider: list.filter((v) => v.hasRider === false).length,
      pending:      list.filter((v) => !v.responded).length,
    };

    return NextResponse.json({ vendors: list, summary });
  } catch (error) {
    console.error("[GET /api/admin/vendor-riders]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
