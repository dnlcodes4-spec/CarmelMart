// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function guardRider() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("role, status").eq("id", user.id).single();
  if (!profile || profile.role !== "rider") return { error: "Forbidden", status: 403 };
  if (profile.status === "suspended" || profile.status === "banned") {
    return { error: "Account suspended.", status: 403 };
  }
  return { user, admin };
}

// GET /api/rider/orders — fetch all orders assigned to the authenticated rider
export async function GET(request) {
  try {
    const guard = await guardRider();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { user, admin } = guard;

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status") || null;

    let query = admin
      .from("orders")
      .select("id, status, total, payment_method, delivery_address, created_at, updated_at, customer_id")
      .eq("rider_id", user.id)
      .order("created_at", { ascending: false });

    if (statusFilter) query = query.eq("status", statusFilter);

    const { data: orders, error: qErr } = await query;
    if (qErr) throw qErr;

    if (!orders?.length) return NextResponse.json({ orders: [] });

    const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))];
    const { data: customers } = await admin
      .from("users")
      .select("id, first_name, last_name, phone, email")
      .in("id", customerIds);
    const customerMap = Object.fromEntries((customers ?? []).map((c) => [c.id, c]));

    const formatted = orders.map((o) => {
      const c    = customerMap[o.customer_id] ?? {};
      const addr = o.delivery_address ?? {};
      return {
        id:             o.id,
        shortId:        `#CM-${o.id.slice(0, 8).toUpperCase()}`,
        status:         o.status,
        total:          o.total,
        payment_method: o.payment_method,
        customer: {
          name:  [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Customer",
          phone: addr.phone ?? c.phone ?? null,
          email: c.email ?? null,
        },
        delivery_address: addr,
        city:       addr.city  ?? "—",
        state:      addr.state ?? "—",
        date:       new Date(o.created_at).toLocaleDateString("en-NG", {
          day: "numeric", month: "short", year: "numeric",
        }),
        created_at: o.created_at,
        updated_at: o.updated_at,
      };
    });

    return NextResponse.json({ orders: formatted });
  } catch (error) {
    console.error("[GET /api/rider/orders]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
