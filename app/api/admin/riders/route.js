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
 * GET /api/admin/riders
 * - ?active=true  → only active riders (for assignment dropdown — admin only)
 * - no param      → all riders by status (admin only, for management page)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const guard = await guardAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin } = guard;

    let query = admin
      .from("users")
      .select("id, first_name, last_name, phone, email, status, created_at")
      .eq("role", "rider")
      .order("created_at", { ascending: false });

    if (activeOnly) query = query.eq("status", "active");

    const { data: riders, error } = await query;
    if (error) throw error;

    const formatted = (riders ?? []).map((r) => ({
      id:         r.id,
      name:       [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unnamed Rider",
      first_name: r.first_name ?? "",
      last_name:  r.last_name  ?? "",
      phone:      r.phone  ?? "",
      email:      r.email  ?? "",
      status:     r.status,
      created_at: r.created_at,
    }));

    return NextResponse.json({ riders: formatted });
  } catch (error) {
    console.error("[GET /api/admin/riders]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/riders
 * Body: { first_name, last_name, email, phone, password }
 *
 * Creates a Supabase auth user + users profile with role='rider'.
 * Email confirmation is skipped — admin distributes credentials manually.
 */
export async function POST(request) {
  try {
    const guard = await guardAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { admin } = guard;

    const body = await request.json();
    const { first_name, last_name, email, phone, password } = body;

    if (!first_name?.trim() || !email?.trim() || !password) {
      return NextResponse.json(
        { error: "first_name, email, and password are required." },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    // Check email not already taken
    const { data: existing } = await admin
      .from("users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    // Create auth user (skip email confirmation)
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email:         email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { first_name: first_name.trim(), last_name: last_name?.trim() ?? "" },
    });

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    const authUser = authData.user;

    // Insert profile with rider role
    const { error: profileErr } = await admin.from("users").insert({
      id:         authUser.id,
      email:      email.trim().toLowerCase(),
      first_name: first_name.trim(),
      last_name:  last_name?.trim() ?? "",
      phone:      phone?.trim() ?? null,
      role:       "rider",
      status:     "active",
      verified:   true,
    });

    if (profileErr) {
      await admin.auth.admin.deleteUser(authUser.id);
      throw profileErr;
    }

    return NextResponse.json({
      success: true,
      rider: {
        id:         authUser.id,
        first_name: first_name.trim(),
        last_name:  last_name?.trim() ?? "",
        email:      email.trim().toLowerCase(),
        phone:      phone?.trim() ?? null,
        status:     "active",
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/riders]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
