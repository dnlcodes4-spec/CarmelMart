import { describe, it, expect } from "vitest";
import { normalize, tokenize } from "@/lib/search/normalize";
import { expandQuery, SYNONYM_GROUPS } from "@/lib/search/synonyms";

// ── normalize() ⟷ SQL public.search_normalize() ───────────────────────────────
//
// Expected values below are the VERBATIM output of the SQL function, captured
// from the live database. If normalize() drifts from search_normalize(), the
// indexed document and the query stop agreeing and matching silently degrades.
// Regenerate with:
//   select i, public.search_normalize(i) from unnest(array[...]) i;

const SQL_PARITY = [
  ["Tecno Spark50",                    "tecno spark 50"],
  ["9pm elixir perfume",               "9 pm elixir perfume"],
  ["Itel A200+",                       "itel a 200+"],
  ["YD18D Selfie Tripod Stand",        "yd 18 d selfie tripod stand"],
  ["Café Crème",                       "cafe creme"],
  ["ROLEX Silver Watch",               "rolex silver watch"],
  ["Power bank",                       "power bank"],
  ["powerbank",                        "powerbank"],
  ["Z6D",                              "z 6 d"],
  ["Optimals Eye & Lip Contour Cream", "optimals eye & lip contour cream"],
];

describe("normalize — parity with SQL search_normalize()", () => {
  SQL_PARITY.forEach(([input, expected]) => {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(normalize(input)).toBe(expected);
    });
  });

  it("returns empty string for nullish input", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
    expect(normalize("")).toBe("");
  });
});

describe("normalize — the letter/digit split that makes Spark50 findable", () => {
  it("splits letter→digit so a query with a space still matches", () => {
    // The whole point: both sides converge on the same tokens.
    expect(normalize("tecno spark 50")).toBe(normalize("Tecno Spark50"));
  });

  it("splits digit→letter", () => {
    expect(normalize("9pm")).toBe("9 pm");
  });
});

describe("tokenize", () => {
  it("splits on whitespace and drops empties", () => {
    expect(tokenize("  Rolex   Silver  ")).toEqual(["rolex", "silver"]);
  });

  it("yields the split tokens for a run-together model name", () => {
    expect(tokenize("Spark50")).toEqual(["spark", "50"]);
  });

  it("returns an empty array for nullish input", () => {
    expect(tokenize(null)).toEqual([]);
  });
});

// ── expandQuery() ─────────────────────────────────────────────────────────────

describe("expandQuery — bridges vocabulary gaps stemming cannot", () => {
  it("reaches the Footwear category from 'shoes'", () => {
    // Measured: `shoes` matched 1 of 4 Footwear products without this.
    expect(expandQuery("shoes")).toContain("footwear");
    expect(expandQuery("shoes")).toContain("heels");
  });

  it("bridges powerbank → 'power bank' across the space", () => {
    expect(expandQuery("powerbank")).toContain("power bank");
  });

  it("bridges the multi-word 'power bank' → powerbank", () => {
    expect(expandQuery("power bank")).toContain("powerbank");
  });

  it("does not echo back a term the shopper already typed", () => {
    expect(expandQuery("shoes")).not.toContain("shoes");
    expect(expandQuery("watch")).not.toContain("watch");
  });

  it("returns nothing for an unknown term", () => {
    expect(expandQuery("rolex")).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(expandQuery("")).toEqual([]);
    expect(expandQuery(null)).toEqual([]);
  });

  it("is case- and accent-insensitive", () => {
    expect(expandQuery("SHOES")).toContain("footwear");
  });

  it("caps expansion so the tsquery cannot blow up", () => {
    expect(expandQuery("shoes").length).toBeLessThanOrEqual(12);
  });
});

describe("expandQuery — precision guards", () => {
  it("never links phone to headphones", () => {
    // word_similarity('phone','headphones') = 0.50. They share a substring, not
    // a meaning; conflating them made a `phone` search return earbuds.
    const phone = expandQuery("phone");
    expect(phone).not.toContain("headphones");
    expect(phone).not.toContain("earbuds");

    const earbuds = expandQuery("earbuds");
    expect(earbuds).not.toContain("phone");
  });
});

describe("SYNONYM_GROUPS — registry integrity", () => {
  it("assigns every term to exactly one group", () => {
    const seen = new Map();
    SYNONYM_GROUPS.forEach((group, i) => {
      group.forEach((term) => {
        const t = normalize(term);
        expect(seen.has(t), `"${t}" appears in groups ${seen.get(t)} and ${i}`).toBe(false);
        seen.set(t, i);
      });
    });
  });

  it("stores every term already normalized", () => {
    SYNONYM_GROUPS.flat().forEach((term) => {
      expect(normalize(term)).toBe(term);
    });
  });

  it("has no single-term groups", () => {
    SYNONYM_GROUPS.forEach((group) => expect(group.length).toBeGreaterThan(1));
  });
});
