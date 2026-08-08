// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function getAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = createAdminClient();
  const { data: p } = await admin.from("users").select("role").eq("id", user.id).single();
  if (!p || p.role !== "admin") return null;
  return { user, admin };
}

export async function GET() {
  try {
    const ctx = await getAdmin();
    if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await ctx.admin
      .from("delivery_zones")
      .select("id, state, lga, base_fee, per_kg_fee, estimated_days, active")
      .order("state", { ascending: true })
      .order("lga",   { ascending: true });

    if (error) throw error;
    return NextResponse.json({ zones: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const ctx = await getAdmin();
    if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { state, lga, base_fee, per_kg_fee, estimated_days } = await request.json();
    if (!state?.trim()) return NextResponse.json({ error: "State is required" }, { status: 400 });

    const { data, error } = await ctx.admin
      .from("delivery_zones")
      .insert({
        state:          state.trim(),
        lga:            lga?.trim() || null,
        base_fee:       Number(base_fee)       || 0,
        per_kg_fee:     Number(per_kg_fee)     || 0,
        estimated_days: Number(estimated_days) || 3,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ zone: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
