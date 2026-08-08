// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Public endpoint — no auth required. Returns active delivery zones for checkout fee lookup.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state"); // optional: filter by state

    const supabase = await createClient();
    let query = supabase
      .from("delivery_zones")
      .select("id, state, lga, base_fee, per_kg_fee, estimated_days")
      .eq("active", true)
      .order("state")
      .order("lga");

    if (state) query = query.ilike("state", state);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(
      { zones: data ?? [] },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    // Never fail publicly — return empty so checkout falls back to static fees
    return NextResponse.json({ zones: [] });
  }
}
