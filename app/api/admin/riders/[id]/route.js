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
  if (!profile || profile.role !== "admin") return { error: "Forbidden", status: 403 };
  return { admin };
}

/**
 * PATCH /api/admin/riders/[id]
 * Body: { status: 'active' | 'suspended' | 'banned' }
 */
export async function PATCH(request, { params }) {
  try {
    const guard = await guardAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin } = guard;
    const { id } = await params;

    const body = await request.json();
    const { status } = body;

    if (!["active", "suspended", "banned"].includes(status)) {
      return NextResponse.json(
        { error: "status must be 'active', 'suspended', or 'banned'." },
        { status: 400 }
      );
    }

    const { data: target, error: fetchErr } = await admin
      .from("users")
      .select("id, role, status")
      .eq("id", id)
      .single();

    if (fetchErr || !target) {
      return NextResponse.json({ error: "Rider not found." }, { status: 404 });
    }
    if (target.role !== "rider") {
      return NextResponse.json({ error: "Can only manage rider accounts via this endpoint." }, { status: 400 });
    }

    const { error: updateErr } = await admin
      .from("users")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, new_status: status });
  } catch (error) {
    console.error("[PATCH /api/admin/riders/[id]]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/riders/[id]
 * Hard deletes if no order history; bans otherwise to preserve delivery records.
 */
export async function DELETE(request, { params }) {
  try {
    const guard = await guardAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin } = guard;
    const { id } = await params;

    const { data: target, error: fetchErr } = await admin
      .from("users")
      .select("id, role")
      .eq("id", id)
      .single();

    if (fetchErr || !target) {
      return NextResponse.json({ error: "Rider not found." }, { status: 404 });
    }
    if (target.role !== "rider") {
      return NextResponse.json({ error: "Can only delete rider accounts via this endpoint." }, { status: 400 });
    }

    // Check if rider has any order history
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", id);

    if ((count ?? 0) > 0) {
      await admin
        .from("users")
        .update({ status: "banned", updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: "Rider deactivated (has delivery history — account retained for records).",
      });
    }

    const { error: deleteErr } = await admin.auth.admin.deleteUser(id);
    if (deleteErr) throw deleteErr;

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[DELETE /api/admin/riders/[id]]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
