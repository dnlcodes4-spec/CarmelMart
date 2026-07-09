/**
 * Query normalizer for product search.
 *
 * MUST stay behaviourally identical to the SQL function public.search_normalize()
 * (supabase/migrations/20260709000000_humanized_product_search.sql). The indexed
 * document and the incoming query are both passed through it, so any divergence
 * silently breaks matching. tests/lib/search.test.js pins the shared cases.
 *
 * Splitting letter/digit boundaries is what lets "tecno spark 50" find
 * "Tecno Spark50" — without it the tsvector holds `spark50` and the query
 * asks for `spark` AND `50`.
 */

// Combining diacritical marks, stripped after NFD decomposition — the JS
// equivalent of Postgres unaccent().
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalize(input) {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, "$1 $2")  // spark50 -> spark 50
    .replace(/([0-9])([a-z])/g, "$1 $2"); // 9pm     -> 9 pm
}

/** Normalized, whitespace-split, empties dropped. */
export function tokenize(input) {
  return normalize(input).split(/\s+/).filter(Boolean);
}
