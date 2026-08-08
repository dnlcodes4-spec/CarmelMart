/**
 * Duplicate-vendor detection, advisory only.
 *
 * Sellers who mistype their email on signup re-register rather than recover the
 * account, which is how carmel-mart ended up with pairs like
 * slayfits.ng@mail.com / slayfits.ng@gmail.com. Fixtures below are the real
 * shapes those duplicates take: same phone in different formats, or the same
 * business name under a different phone.
 */
import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  normalizeBusinessName,
  findDuplicateVendors,
  describeDuplicates,
} from "@/lib/vendors/duplicates";

const VENDORS = [
  { id: "slay-1", business_name: "Slayfits.NG", phone: "08035640284",     verification_status: "verified" },
  { id: "slay-2", business_name: "Slayfits NG", phone: "+2348035640284",  verification_status: "verified" },
  { id: "bisi-1", business_name: "BisiBagz",    phone: "+2348149581424",  verification_status: "verified" },
  { id: "bisi-2", business_name: "BisiBagz",    phone: "+2348149581424",  verification_status: "verified" },
  { id: "bisi-3", business_name: "BisiBagz",    phone: "+2348132824243",  verification_status: "verified" },
  { id: "solo-1", business_name: "Zenas Agrohub", phone: "08011112222",   verification_status: "verified" },
  { id: "pend-1", business_name: "Slayfits.NG", phone: "08035640284",     verification_status: "pending" },
  { id: "nophone", business_name: "No Phone Store", phone: null,          verification_status: "verified" },
];

/** Fake admin client returning the verified subset, like the real query does. */
function makeAdmin(rows = VENDORS) {
  return {
    from() {
      let filtered = rows;
      const chain = {
        select: () => chain,
        eq(col, val) { filtered = filtered.filter((r) => r[col] === val); return chain; },
        neq(col, val) { filtered = filtered.filter((r) => r[col] !== val); return chain; },
        then: undefined,
        async run() { return { data: filtered, error: null }; },
      };
      // Await the chain directly, as supabase-js allows.
      chain.then = (resolve) => resolve({ data: filtered, error: null });
      return chain;
    },
  };
}

describe("normalizePhone", () => {
  it("reduces Nigerian numbers to a common local form", () => {
    expect(normalizePhone("+2348149581424")).toBe("08149581424");
    expect(normalizePhone("2348149581424")).toBe("08149581424");
    expect(normalizePhone("08149581424")).toBe("08149581424");
    expect(normalizePhone("0814 958 1424")).toBe("08149581424");
    expect(normalizePhone("0814-958-1424")).toBe("08149581424");
  });

  it("returns empty string for missing input rather than throwing", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("normalizeBusinessName", () => {
  it("ignores case, punctuation, emoji and spacing", () => {
    expect(normalizeBusinessName("Slayfits.NG")).toBe(normalizeBusinessName("Slayfits NG"));
    expect(normalizeBusinessName("Carmel Business Concept")).toBe(normalizeBusinessName("CARMEL BUSINESS CONCEPT"));
    expect(normalizeBusinessName("✨ Clamor Thrift & Luxe ✨")).toBe("clamorthriftluxe");
  });

  it("keeps genuinely different names distinct", () => {
    expect(normalizeBusinessName("BisiBagz")).not.toBe(normalizeBusinessName("Zenas Agrohub"));
  });
});

describe("findDuplicateVendors", () => {
  it("matches a phone stored in a different format", async () => {
    const dupes = await findDuplicateVendors(makeAdmin(), {
      vendorId: "slay-2", phone: "+2348035640284", businessName: "Slayfits NG",
    });
    expect(dupes.map((d) => d.id)).toContain("slay-1");
    expect(dupes.find((d) => d.id === "slay-1").matchedOn).toContain("phone");
  });

  it("matches a shared business name even when the phone differs", async () => {
    const dupes = await findDuplicateVendors(makeAdmin(), {
      vendorId: "bisi-3", phone: "+2348132824243", businessName: "BisiBagz",
    });
    expect(dupes.map((d) => d.id).sort()).toEqual(["bisi-1", "bisi-2"]);
    expect(dupes[0].matchedOn).toContain("name");
  });

  it("never reports the vendor being approved as its own duplicate", async () => {
    const dupes = await findDuplicateVendors(makeAdmin(), {
      vendorId: "bisi-1", phone: "+2348149581424", businessName: "BisiBagz",
    });
    expect(dupes.map((d) => d.id)).not.toContain("bisi-1");
  });

  it("ignores vendors that are not verified", async () => {
    const dupes = await findDuplicateVendors(makeAdmin(), {
      vendorId: "slay-2", phone: "+2348035640284", businessName: "Slayfits NG",
    });
    expect(dupes.map((d) => d.id)).not.toContain("pend-1");
  });

  it("returns nothing for a vendor with no match", async () => {
    const dupes = await findDuplicateVendors(makeAdmin(), {
      vendorId: "solo-1", phone: "08011112222", businessName: "Zenas Agrohub",
    });
    expect(dupes).toEqual([]);
  });

  it("does not treat two missing phones as a match", async () => {
    const dupes = await findDuplicateVendors(makeAdmin(), {
      vendorId: "new-1", phone: null, businessName: "Something Else Entirely",
    });
    expect(dupes).toEqual([]);
  });

  it("is advisory only — never throws when the lookup fails", async () => {
    const broken = { from: () => { throw new Error("db down"); } };
    await expect(
      findDuplicateVendors(broken, { vendorId: "x", phone: "08011112222", businessName: "X" }),
    ).resolves.toEqual([]);
  });
});

describe("describeDuplicates", () => {
  const dupe = (name, ...matchedOn) => ({ id: name, business_name: name, matchedOn });

  it("says nothing when there is nothing to say", () => {
    expect(describeDuplicates([])).toBeNull();
    expect(describeDuplicates(null)).toBeNull();
    expect(describeDuplicates(undefined)).toBeNull();
  });

  it("names the single match and what matched", () => {
    const msg = describeDuplicates([dupe("Slayfits.NG", "phone", "name")]);
    expect(msg).toContain("Slayfits.NG");
    expect(msg).toMatch(/phone/i);
    expect(msg).toMatch(/name/i);
  });

  it("reads naturally for one match", () => {
    const msg = describeDuplicates([dupe("BisiBagz", "name")]);
    expect(msg).not.toMatch(/\b1 vendors\b/);
    expect(msg).toMatch(/already verified/i);
  });

  it("counts several matches rather than listing endlessly", () => {
    const msg = describeDuplicates([dupe("A", "name"), dupe("B", "name"), dupe("C", "phone")]);
    expect(msg).toContain("3");
  });

  it("still names the businesses when there are several", () => {
    const msg = describeDuplicates([dupe("A", "name"), dupe("B", "phone")]);
    expect(msg).toContain("A");
    expect(msg).toContain("B");
  });

  it("survives a duplicate with no name", () => {
    const msg = describeDuplicates([{ id: "x", business_name: null, matchedOn: ["phone"] }]);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });
});
