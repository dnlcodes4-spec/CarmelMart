/**
 * Fast Link vendor sync — admin only.
 *
 * GET  /api/admin/fastlink/sync
 *   → provisioning status counts (configured? / provisioned / pending / errors).
 *
 * POST /api/admin/fastlink/sync
 *   Body:
 *     { vendorId }            → sync one vendor (merchant + pickup)
 *     { all: true, limit? }   → backfill: sync verified vendors not yet provisioned
 *   Runs sequentially to stay friendly to Fast Link rate limits.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { syncVendorToFastLink, recordSyncError } from "@/lib/fastlink/merchants";

const BACKFILL_MAX = 100;

async function verifyAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? admin : null;
}

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const verified = { verification_status: "verified" };
  const countWhere = (extra) => {
    let q = admin.from("vendors").select("id", { count: "exact", head: true }).match(verified);
    return extra ? extra(q) : q;
  };

  const [{ count: total }, { count: provisioned }, { count: withPickup }, { count: errored }] =
    await Promise.all([
      countWhere(),
      countWhere((q) => q.not("fastlink_merchant_id", "is", null)),
      countWhere((q) => q.not("fastlink_pickup_id", "is", null)),
      countWhere((q) => q.not("fastlink_sync_error", "is", null)),
    ]);

  return NextResponse.json({
    configured:  config.fastlink.enabled,
    verified:    total ?? 0,
    provisioned: provisioned ?? 0,
    pending:     (total ?? 0) - (provisioned ?? 0),
    withPickup:  withPickup ?? 0,
    errored:     errored ?? 0,
  });
}

export async function POST(request) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!config.fastlink.enabled) {
    return NextResponse.json(
      { error: "Fast Link credentials are not configured." },
      { status: 503 },
    );
  }

  const { vendorId, all, limit } = await request.json().catch(() => ({}));

  // ── Single vendor ────────────────────────────────────────────────────────────
  if (vendorId) {
    try {
      const result = await syncVendorToFastLink(admin, vendorId);
      return NextResponse.json({ ok: true, vendorId, ...result });
    } catch (err) {
      await recordSyncError(admin, vendorId, err);
      return NextResponse.json({ ok: false, vendorId, error: err.message }, { status: 502 });
    }
  }

  // ── Backfill: verified vendors without a merchant id yet ──────────────────────
  if (all) {
    const cap = Math.min(Number(limit) || BACKFILL_MAX, BACKFILL_MAX);
    const { data: vendors, error } = await admin
      .from("vendors")
      .select("id")
      .match({ verification_status: "verified" })
      .is("fastlink_merchant_id", null)
      .limit(cap);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const results = [];
    for (const v of vendors ?? []) {
      try {
        const r = await syncVendorToFastLink(admin, v.id);
        results.push({ vendorId: v.id, ok: true, ...r });
      } catch (err) {
        await recordSyncError(admin, v.id, err);
        results.push({ vendorId: v.id, ok: false, error: err.message });
      }
    }

    return NextResponse.json({
      ok: true,
      attempted: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed:    results.filter((r) => !r.ok).length,
      results,
    });
  }

  return NextResponse.json(
    { error: "Provide { vendorId } or { all: true }." },
    { status: 400 },
  );
}
