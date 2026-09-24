/**
 * Which vendors can actually get a parcel to a customer.
 *
 * Fast Link is now the only delivery mechanism — the in-house riders that used
 * to absorb the gap are gone. A vendor without a Fast Link pickup point has no
 * route to the customer at all, and Fast Link accepts such an order anyway
 * (201, not a validation error), creating a delivery with no collection point.
 * So the check has to happen on our side, before money is taken.
 */
import { describe, it, expect } from "vitest";
import { undeliverableVendors, describeUndeliverable } from "@/lib/fastlink/coverage";

const VENDORS = [
  { id: "ok-1",   business_name: "BisiBagz",     fastlink_pickup_id: "17" },
  { id: "ok-2",   business_name: "Tee cakes",    fastlink_pickup_id: "21" },
  { id: "gap-1",  business_name: "Tima collection", fastlink_pickup_id: null },
  { id: "gap-2",  business_name: null,           fastlink_pickup_id: null },
];

const admin = {
  from() {
    const chain = {
      select: () => chain,
      in(_col, ids) {
        chain.then = (resolve) =>
          resolve({ data: VENDORS.filter((v) => ids.includes(v.id)), error: null });
        return chain;
      },
    };
    return chain;
  },
};

describe("undeliverableVendors", () => {
  it("names the vendors with no pickup point", async () => {
    const out = await undeliverableVendors(admin, ["ok-1", "gap-1"]);
    expect(out.map((v) => v.id)).toEqual(["gap-1"]);
  });

  it("returns nothing when every vendor can be collected from", async () => {
    expect(await undeliverableVendors(admin, ["ok-1", "ok-2"])).toEqual([]);
  });

  it("is empty for an empty cart rather than querying", async () => {
    expect(await undeliverableVendors(admin, [])).toEqual([]);
  });

  it("treats a lookup failure as deliverable, so a database blip cannot block checkout", async () => {
    // Blocking a sale on our own outage is worse than the risk it prevents:
    // the order can still be chased manually, a refused checkout cannot.
    const broken = { from: () => { throw new Error("db down"); } };
    expect(await undeliverableVendors(broken, ["gap-1"])).toEqual([]);
  });
});

describe("describeUndeliverable", () => {
  it("says nothing when there is nothing wrong", () => {
    expect(describeUndeliverable([])).toBeNull();
  });

  it("names a single seller so the customer knows what to remove", () => {
    const msg = describeUndeliverable([VENDORS[2]]);
    expect(msg).toContain("Tima collection");
    expect(msg.toLowerCase()).toMatch(/deliver/);
  });

  it("copes with a seller that has no name", () => {
    const msg = describeUndeliverable([VENDORS[3]]);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("lists several sellers rather than only the first", () => {
    const msg = describeUndeliverable([VENDORS[2], { id: "x", business_name: "Zenas", fastlink_pickup_id: null }]);
    expect(msg).toContain("Tima collection");
    expect(msg).toContain("Zenas");
  });

  it("blames the platform, not the seller", () => {
    // These vendors did nothing wrong — we have not finished onboarding them.
    const msg = describeUndeliverable([VENDORS[2]]);
    expect(msg.toLowerCase()).not.toMatch(/seller (has|did) not|vendor failed/);
  });
});
