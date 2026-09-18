import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || null;
    const page   = Math.max(1, Number(searchParams.get("page") || 1));
    const limit  = 25;

    let query = admin
      .from("orders")
      .select("id, customer_id, rider_id, status, total, created_at, delivery_address, fastlink_status", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) query = query.eq("status", status);

    const { data: orderRows, error: qErr, count } = await query;
    if (qErr) throw qErr;

    // Bulk-fetch customer + rider info
    const personIds = [...new Set([
      ...(orderRows ?? []).map((o) => o.customer_id),
      ...(orderRows ?? []).map((o) => o.rider_id),
    ].filter(Boolean))];

    let personMap = {};
    if (personIds.length > 0) {
      const { data: persons } = await admin
        .from("users")
        .select("id, email, phone, first_name, last_name, role")
        .in("id", personIds);
      personMap = Object.fromEntries((persons ?? []).map((p) => [p.id, p]));
    }

    const orders = (orderRows || []).map((o) => {
      const c = personMap[o.customer_id];
      const r = o.rider_id ? personMap[o.rider_id] : null;
      return {
        id:         o.id,
        customerId: o.customer_id,
        shortId:    `#CM-${o.id.slice(0, 8).toUpperCase()}`,
        status:     o.status,
        total:      o.total,
        customer:   c?.email ?? "Unknown",
        phone:      c?.phone ?? o.delivery_address?.phone ?? null,
        city:       o.delivery_address?.city ?? "—",
        date:       new Date(o.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }),
        rider_id:   o.rider_id ?? null,
        rider_name: r ? [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email : null,
      };
    });

    return NextResponse.json({ orders, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit), page });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
