import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { expandQuery } from "@/lib/search/synonyms";
import { normalize } from "@/lib/search/normalize";

// Trim and cap only. The value is passed as a bound RPC parameter, so the old
// stripping of % _ * ( ) , was never a safety measure — it just silently
// mangled legitimate queries like "50% cotton" and "Optimals Eye & Lip".
function sanitizeSearchTerm(value) {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return cleaned || null;
}

/**
 * GET /api/products
 *
 * Retrieval runs through the search_products() SQL function, which ranks by
 * relevance (impossible through PostgREST — it cannot ORDER BY ts_rank) and
 * applies every filter in SQL so pagination counts are correct.
 *
 * Query params:
 *   category    — category slug
 *   category_id — category UUID (takes precedence over slug)
 *   search      — text search; stemmed, synonym-expanded, typo-tolerant
 *   min_price / max_price — NGN
 *   min_rating  — minimum avg_rating (0–5)
 *   sort        — relevance | newest | price_asc | price_desc | rating | popular | discount
 *   page        — 1-based (default 1)
 *   per_page    — default 12, max 48
 *   vendor_id, badge, condition, color, size, brand, delivery
 *   featured       — "true" for featured only
 *   verified_only  — "true" for verified vendors only
 *   min_discount   — minimum discount % (1–99)
 *
 * Response adds two fields when `search` is present:
 *   relaxed    — true when no exact match existed and results were widened
 *   didYouMean — nearest catalogue term, when nothing matched at all
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const categorySlug = searchParams.get("category")    || null;
    const categoryId   = searchParams.get("category_id") || null;
    const search       = sanitizeSearchTerm(searchParams.get("search"));
    const minPrice     = searchParams.get("min_price")  ? Number(searchParams.get("min_price"))  : null;
    const maxPrice     = searchParams.get("max_price")  ? Number(searchParams.get("max_price"))  : null;
    const minRating    = searchParams.get("min_rating") ? Number(searchParams.get("min_rating")) : null;
    const sort         = searchParams.get("sort")      || (search ? "relevance" : "newest");
    const vendorId     = searchParams.get("vendor_id") || null;
    const badge        = searchParams.get("badge")     || null;
    const featured     = searchParams.get("featured")      === "true";
    const condition    = searchParams.get("condition")     || null;
    const verifiedOnly = searchParams.get("verified_only") === "true";
    const minDiscount  = searchParams.get("min_discount") ? Number(searchParams.get("min_discount")) : null;
    const color        = searchParams.get("color")    || null;
    const size         = searchParams.get("size")     || null;
    const brand        = sanitizeSearchTerm(searchParams.get("brand"));
    const delivery     = searchParams.get("delivery") || null;
    const page         = Math.max(1, Number(searchParams.get("page") || 1));
    const perPage      = Math.min(48, Math.max(1, Number(searchParams.get("per_page") || 12)));
    const offset       = (page - 1) * perPage;

    const supabase = await createClient();

    const emptyResult = (extra = {}) =>
      NextResponse.json({
        success: true,
        products: [],
        pagination: { total: 0, page, perPage, pages: 0 },
        relaxed: false,
        didYouMean: null,
        ...extra,
      });

    // ── Resolve the category slug to an id (the RPC expands to children) ─────
    let resolvedCategoryId = categoryId;
    if (!categoryId && categorySlug) {
      const { data: cat } = await supabase
        .from("categories").select("id").eq("slug", categorySlug).single();
      if (!cat) return emptyResult();
      resolvedCategoryId = cat.id;
    }

    const { data, error } = await supabase.rpc("search_products", {
      p_search:        search,
      p_synonyms:      search ? expandQuery(search) : [],
      p_category_id:   resolvedCategoryId,
      p_min_price:     minPrice,
      p_max_price:     maxPrice,
      p_min_rating:    minRating,
      p_vendor_id:     vendorId,
      p_badge:         badge,
      p_condition:     condition,
      p_verified_only: verifiedOnly,
      p_min_discount:  minDiscount,
      p_color:         color,
      p_size:          size,
      p_brand:         brand,
      p_delivery:      delivery,
      p_featured:      featured,
      p_sort:          sort,
      p_limit:         perPage,
      p_offset:        offset,
    });
    if (error) throw error;

    const rows = data ?? [];

    // Nearest catalogue term, for when the query did not match cleanly. Worth
    // showing alongside relaxed results too, not only on a dead end: the
    // relaxed pass rescues almost every typo, so a zero-result search is
    // usually pure noise with no near term anyway.
    const suggestFor = async (query) => {
      const { data: word } = await supabase.rpc("search_did_you_mean", { p_query: query });
      // A suggestion identical to what they typed is noise.
      return word && word !== normalize(query) ? word : null;
    };

    if (rows.length === 0) {
      if (searchParams.get("__noSuggest") === "1") return emptyResult({ didYouMean: null });
      return emptyResult({ didYouMean: search ? await suggestFor(search) : null });
    }

    const total   = Number(rows[0].total_count ?? 0);
    const relaxed = Boolean(rows[0].relaxed);
    const didYouMean = search && relaxed ? await suggestFor(search) : null;

    // ── Bulk-fetch vendor info (name + tier) for the returned page ───────────
    const vendorIds = [...new Set(rows.map((p) => p.vendor_id).filter(Boolean))];
    let vendorMap = {};
    if (vendorIds.length > 0) {
      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, business_name, verification_status, subscription_tier")
        .in("id", vendorIds);
      vendorMap = Object.fromEntries((vendors ?? []).map((v) => [v.id, v]));
    }

    let products = rows.map((p) => {
      const vendor = vendorMap[p.vendor_id] ?? null;
      const discount = p.sale_price && p.price > 0
        ? Math.round(((p.price - p.sale_price) / p.price) * 100)
        : 0;
      return {
        id:          p.id,
        name:        p.name,
        slug:        p.slug,
        description: p.description,
        price:       p.price,
        salePrice:   p.sale_price,
        discount,
        stock:       p.stock,
        image:       Array.isArray(p.images) ? p.images[0] : null,
        images:      Array.isArray(p.images) ? p.images : [],
        avgRating:   Number(p.avg_rating ?? 0),
        reviewCount: p.review_count ?? 0,
        soldCount:   p.sold_count   ?? 0,
        condition:   p.condition    ?? "new",
        attributes:  p.attributes   ?? {},
        location:    p.location,
        badge:       p.badge,
        createdAt:   p.created_at,
        category:    p.category_id
          ? { id: p.category_id, name: p.category_name, slug: p.category_slug }
          : null,
        vendor: vendor
          ? {
              id:       vendor.id,
              name:     vendor.business_name,
              verified: vendor.verification_status === "verified",
              tier:     vendor.subscription_tier ?? "free",
            }
          : null,
      };
    });

    // Paid placement on the "newest" sort: VIP > Premium > Free within the page.
    // Relevance gets its tier boost from the SQL score instead, which applies
    // across the whole result set rather than just the current page.
    if (sort === "newest") {
      const TIER_RANK = { vip: 0, premium: 1, free: 2 };
      products.sort((a, b) =>
        (TIER_RANK[a.vendor?.tier ?? "free"] ?? 2) - (TIER_RANK[b.vendor?.tier ?? "free"] ?? 2));
    }

    return NextResponse.json(
      {
        success: true,
        products,
        pagination: { total, page, perPage, pages: Math.ceil(total / perPage) },
        relaxed,
        didYouMean,
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      __debugKeys: Object.keys(error ?? {}),
      __debugFull: JSON.parse(JSON.stringify(error ?? {}, Object.getOwnPropertyNames(error ?? {}))),
    }, { status: 500 });
  }
}
