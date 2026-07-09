import { normalize, tokenize } from "./normalize";

/**
 * Bidirectional synonym groups, OR-ed into the tsquery by search_products().
 *
 * These bridge vocabulary gaps that stemming provably cannot. Measured against
 * the live catalogue: `shoes` matched 1 product because the category is named
 * "Footwear"; `powerbank` matched 0 because the product is "Power bank".
 * Mapping a query term onto a CATEGORY name is the highest-leverage entry here,
 * since the category sits at weight B and covers a whole aisle in one hop.
 *
 * Deliberately NOT linked: phone ↔ headphones. They share a substring, not a
 * meaning, and conflating them makes a "phone" search return earbuds.
 *
 * Multi-word entries are matched against adjacent token pairs, so "power bank"
 * and "powerbank" reach each other.
 */
export const SYNONYM_GROUPS = [
  // Footwear — the category is "Footwear", the products are heels/boots/sneakers.
  ["shoe", "shoes", "footwear", "sneaker", "sneakers", "trainers", "canvas", "heels", "slippers", "boot", "boots", "sandals"],

  // Personal gadgets — the category name carries "powerbanks".
  ["powerbank", "powerbanks", "power bank"],
  ["earbuds", "earphones", "earpiece", "airpods", "headphones", "headset"],

  // Phones, laptops, tablets
  ["phone", "phones", "mobile", "handset", "smartphone"],
  ["laptop", "laptops", "notebook", "computer"],

  ["watch", "watches", "wristwatch", "timepiece"],
  ["perfume", "fragrance", "cologne", "scent"],
  ["bag", "bags", "handbag", "purse", "tote", "backpack"],
  ["jewelry", "jewellery", "necklace", "bracelet", "earrings"],

  ["fridge", "refrigerator", "freezer"],
  ["tv", "television"],
  ["pot", "pots", "pan", "pans", "cookware", "utensils", "kitchenware"],

  ["cream", "lotion", "moisturizer", "moisturiser"],
  ["yoghurt", "yogurt"],

  // Nigerian market vocabulary
  ["ankara", "aso ebi", "native wear"],
  ["agbada", "kaftan", "senator"],
  ["gele", "headtie", "head tie"],
];

/** term → index into SYNONYM_GROUPS */
const TERM_TO_GROUP = new Map();
SYNONYM_GROUPS.forEach((group, i) => {
  group.forEach((term) => TERM_TO_GROUP.set(normalize(term), i));
});

const MAX_EXPANSIONS = 12;

/**
 * Extra terms to OR into the query. Never returns terms the shopper already
 * typed — those are handled by the tsquery itself.
 */
export function expandQuery(query) {
  const norm = normalize(query);
  if (!norm) return [];

  const tokens = tokenize(query);
  const present = new Set(tokens);

  // Whole query, each token, and adjacent pairs (so "power bank" is seen).
  const probes = [norm, ...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    probes.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  const hits = new Set();
  for (const probe of probes) {
    const groupIndex = TERM_TO_GROUP.get(probe);
    if (groupIndex !== undefined) hits.add(groupIndex);
  }

  const expansions = [];
  for (const groupIndex of hits) {
    for (const term of SYNONYM_GROUPS[groupIndex]) {
      const t = normalize(term);
      // Skip what the shopper typed: single tokens they used, and the exact query.
      if (t === norm) continue;
      if (!t.includes(" ") && present.has(t)) continue;
      if (!expansions.includes(t)) expansions.push(t);
    }
  }

  return expansions.slice(0, MAX_EXPANSIONS);
}
