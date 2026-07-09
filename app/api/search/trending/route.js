import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/search/trending
 *
 * Trending search chips for the navbar dropdown, derived from live product
 * names. Replaces a hardcoded list whose nine entries all returned zero
 * results against this catalogue.
 *
 * Returns: { success, suggestions: [{ label, category }] }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(12, Math.max(1, Number(searchParams.get("limit") || 8)));

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("trending_search_terms", { p_limit: limit });
    if (error) throw error;

    const suggestions = (data ?? []).map((row) => ({
      label:    row.label,
      category: row.category ?? "All Categories",
    }));

    return NextResponse.json(
      { success: true, suggestions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    // A dead dropdown is worse than an empty one — never 500 the navbar.
    return NextResponse.json({ success: false, suggestions: [], error: error.message });
  }
}
